import { accelerations, safeStep, firstContact } from "./forces.js";
import { stellarColor } from "./thermal.js";
import { fragmentImpact, hitAndRun, angularMomentum } from "./impacts.js";
import { length, mul } from "./math.js";
import { initializeRotations, advanceRotations } from "./rotation.js";
import { FragmentBudget } from "./fragment-budget.js";
export { accelerations, safeStep } from "./forces.js";
// Every state vector and calculation is SI: m, kg, s, m/s, m/s².
// The force evaluator is deliberately separate from the integrator.
export const G = 6.6743e-11;
export const BASE_STEP = 1800;
export const MAX_BODIES = 128;

function mergePair(bodies, a, b) {
  if (b.mass > a.mass) [a, b] = [b, a];
  const mass = a.mass + b.mass;
  const angular = angularMomentum(a, b);
  a.position = a.position.map(
    (v, k) => (v * a.mass + b.position[k] * b.mass) / mass,
  );
  a.velocity = a.velocity.map(
    (v, k) => (v * a.mass + b.velocity[k] * b.mass) / mass,
  );
  a.radius = Math.cbrt(a.radius ** 3 + b.radius ** 3);
  a.mass = mass;
  a.angularVelocity = mul(angular, 1 / (0.4 * mass * a.radius ** 2));
  a.rotationPeriod =
    length(a.angularVelocity) > 0
      ? (2 * Math.PI) / length(a.angularVelocity)
      : 0;
  a.rotationModel = "free";
  a.fragmentGeneration = Math.max(
    a.fragmentGeneration || 0,
    b.fragmentGeneration || 0,
  );
  if (a.kind === "Star" || b.kind === "Star") {
    // Toy merger: retain incoming radiative power and make R, L and T agree.
    // This does not model stellar evolution, fusion or collision heating.
    const luminosity = (body) =>
      Number.isFinite(body.luminosity) && body.luminosity >= 0
        ? body.luminosity
        : 0;
    a.luminosity = luminosity(a) + luminosity(b);
    a.kind = "Star";
    if (a.luminosity > 0) {
      a.effectiveTemperature = Math.pow(
        a.luminosity / (4 * Math.PI * 5.670374419e-8 * a.radius ** 2),
        0.25,
      );
      a.color = stellarColor(a.effectiveTemperature);
    } else delete a.effectiveTemperature;
  }
  if (a.parentId === b.id) a.parentId = b.parentId;
  for (const body of bodies) {
    if (body !== a && body.parentId === b.id) body.parentId = a.id;
    if (body.parentId === a.id) body.relativeTrail = [];
  }
  // A heavier descendant can absorb an ancestor. Detach the survivor if the
  // inherited hierarchy would lead back to itself, or to a removed body.
  const ancestors = new Set([a.id]);
  let parentId = a.parentId;
  while (parentId) {
    const parent = bodies.find((body) => body.id === parentId && body !== b);
    if (!parent || ancestors.has(parentId)) {
      delete a.parentId;
      break;
    }
    ancestors.add(parentId);
    parentId = parent.parentId;
  }
  a.trail = [];
  a.relativeTrail = [];
  bodies.splice(bodies.indexOf(b), 1);
  return {
    survivor: a.id,
    removed: b.id,
    text: `${a.name} absorbed ${b.name}`,
  };
}

function resolveContact(bodies, a, b, allowBounce = true, fragmentLimit = 4) {
  const before = [a, b].map(
    ({
      id,
      name,
      kind,
      mass,
      radius,
      position,
      velocity,
      color,
      orientation,
    }) => ({
      id,
      name,
      kind,
      mass,
      radius,
      position: [...position],
      velocity: [...velocity],
      color,
      orientation: orientation && [...orientation],
    }),
  );
  if (allowBounce && hitAndRun(a, b))
    return {
      kind: "bounce",
      before,
      text: `${a.name} and ${b.name} glanced apart`,
    };
  const fragments = fragmentImpact(a, b, {
    bodyCount: bodies.length,
    maxBodies: MAX_BODIES,
    fragmentLimit,
  });
  if (!fragments) {
    const event = mergePair(bodies, a, b);
    return { ...event, kind: "merge", before, afterIds: [event.survivor] };
  }
  const survivor = fragments[0].id,
    removed = survivor === a.id ? b.id : a.id;
  for (const body of bodies) {
    if (
      body !== a &&
      body !== b &&
      (body.parentId === a.id || body.parentId === b.id)
    ) {
      delete body.parentId;
      body.relativeTrail = [];
    }
  }
  for (const fragment of fragments)
    if (!bodies.some((p) => p !== a && p !== b && p.id === fragment.parentId))
      delete fragment.parentId;
  bodies.splice(bodies.indexOf(a), 1);
  bodies.splice(bodies.indexOf(b), 1);
  bodies.push(...fragments);
  return {
    kind: "fragment",
    before,
    afterIds: fragments.map((f) => f.id),
    survivor,
    removed,
    text: `${a.name} and ${b.name} dispersed into ${fragments.length === 4 ? "four" : fragments.length} fragments`,
  };
}

export function mergeCollisions(bodies, { fragmentLimit = 4 } = {}) {
  const events = [];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i],
          b = bodies[j];
        if (
          Math.hypot(
            a.position[0] - b.position[0],
            a.position[1] - b.position[1],
            a.position[2] - b.position[2],
          ) >
          a.radius + b.radius
        )
          continue;
        events.push(
          resolveContact(
            bodies,
            a,
            b,
            events.length < MAX_BODIES * 4,
            fragmentLimit,
          ),
        );
        changed = true;
        break outer;
      }
  }
  return events;
}

export function step(bodies, dt, { fragmentLimit = 4 } = {}) {
  initializeRotations(bodies);
  const events = mergeCollisions(bodies, { fragmentLimit });
  const before = accelerations(bodies);
  for (let i = 0; i < bodies.length; i++)
    for (let k = 0; k < 3; k++) {
      bodies[i].velocity[k] += (before[i][k] * dt) / 2;
    }
  // Continuous contact detection during Verlet's linear drift. Resolve earliest
  // contact first, then drift the remaining time with the merged momentum.
  // This catches fast spheres even when both step endpoints miss the collision.
  let remaining = dt;
  while (remaining > 0) {
    const contact = firstContact(bodies, remaining);
    const travel = contact?.time ?? remaining;
    for (const body of bodies)
      for (let k = 0; k < 3; k++) body.position[k] += body.velocity[k] * travel;
    advanceRotations(bodies, travel);
    remaining -= travel;
    if (contact) {
      events.push(
        resolveContact(
          bodies,
          contact.a,
          contact.b,
          events.length < MAX_BODIES * 4,
          fragmentLimit,
        ),
      );
      initializeRotations(bodies);
    } else break;
  }
  const after = accelerations(bodies);
  for (let i = 0; i < bodies.length; i++)
    for (let k = 0; k < 3; k++) {
      bodies[i].velocity[k] += (after[i][k] * dt) / 2;
    }
  events.push(...mergeCollisions(bodies, { fragmentLimit }));
  initializeRotations(bodies);
  advanceRotations(bodies, 0);
  return events;
}

export function energy(bodies) {
  let total = 0;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    total += 0.5 * a.mass * a.velocity.reduce((s, v) => s + v * v, 0);
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      total -=
        (G * a.mass * b.mass) /
        Math.hypot(...a.position.map((v, k) => v - b.position[k]));
    }
  }
  return total;
}

export function recordTrails(bodies, time) {
  for (const body of bodies) {
    if (time - (body.lastTrailTime ?? 0) < (body.trailInterval ?? 21600))
      continue;
    body.trail.push([...body.position]);
    const parent = bodies.find((b) => b.id === body.parentId);
    if (parent) {
      body.relativeTrail ??= [];
      body.relativeTrail.push(
        body.position.map((v, k) => v - parent.position[k]),
      );
      if (body.relativeTrail.length > 600) body.relativeTrail.shift();
    }
    if (body.trail.length > 600) body.trail.shift();
    body.lastTrailTime = time;
  }
}

export class Simulation {
  constructor(bodies, { fragmentLimit = 4 } = {}) {
    initializeRotations(bodies);
    this.bodies = bodies;
    this.time = 0;
    this.pending = 0;
    this.limited = false;
    this.events = [];
    this.fragmentLimit = fragmentLimit;
    this.collisionLimit = fragmentLimit;
    this.fragmentBudget = new FragmentBudget();
  }
  advance(realSeconds, timeScale, budgetMs = 9) {
    // No hidden-tab catch-up or unbounded debt. Slow simulated time when work is
    // excessive, instead of increasing the physics step and destabilizing orbits.
    this.pending += Math.min(realSeconds, 0.1) * timeScale;
    const start = performance.now();
    // Low requested rates use a fixed one-second ceiling. Render cadence and
    // accumulated debt never choose the physical step size.
    const maximum = timeScale <= 3600 ? 1 : BASE_STEP;
    let count = 0,
      exhausted = false;
    this.collisionLimit = this.fragmentBudget.limit(
      this.fragmentLimit,
      this.bodies.length,
    );
    const collisions = { fragmentLimit: this.collisionLimit };
    while (this.pending > 0) {
      this.events.push(...mergeCollisions(this.bodies, collisions));
      const dt = safeStep(this.bodies, maximum);
      // Accumulating fractional frame durations can miss a quantum by a few
      // floating-point ulps. Consume that quantum without retaining negative debt.
      if (this.pending + dt * 1e-12 < dt) break;
      const stepStart = performance.now(),
        bodyCount = this.bodies.length;
      this.events.push(...step(this.bodies, dt, collisions));
      this.fragmentBudget.observeStep(performance.now() - stepStart, bodyCount);
      this.time += dt;
      this.pending = Math.max(0, this.pending - dt);
      recordTrails(this.bodies, this.time);
      count++;
      if (count >= 2048 || performance.now() - start >= budgetMs) {
        exhausted = true;
        break;
      }
    }
    const nextStep = safeStep(this.bodies, maximum);
    this.limited = exhausted && this.pending + nextStep * 1e-12 >= nextStep;
    if (this.limited) this.pending = Math.min(this.pending, BASE_STEP);
  }
}
