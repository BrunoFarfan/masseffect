// Every state vector and calculation is SI: m, kg, s, m/s, m/s².
// The force evaluator is deliberately separate from the integrator.
export const G = 6.6743e-11;
export const BASE_STEP = 1800;
export const MAX_BODIES = 128;

function mergePair(bodies, a, b) {
  if (b.mass > a.mass) [a, b] = [b, a];
  const mass = a.mass + b.mass;
  a.position = a.position.map(
    (v, k) => (v * a.mass + b.position[k] * b.mass) / mass,
  );
  a.velocity = a.velocity.map(
    (v, k) => (v * a.mass + b.velocity[k] * b.mass) / mass,
  );
  a.radius = Math.cbrt(a.radius ** 3 + b.radius ** 3);
  a.mass = mass;
  a.trail = [];
  a.orbit = null;
  bodies.splice(bodies.indexOf(b), 1);
  return {
    survivor: a.id,
    removed: b.id,
    text: `${a.name} absorbed ${b.name}`,
  };
}

export function accelerations(bodies) {
  const result = bodies.map(() => [0, 0, 0]);
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i],
        b = bodies[j];
      const d = b.position.map((v, k) => v - a.position[k]);
      // Overlaps are merged before integrating. A 1 m floor guards coincident input.
      const r2 = Math.max(
        1,
        d.reduce((s, v) => s + v * v, 0),
      );
      const factor = G / (r2 * Math.sqrt(r2));
      for (let k = 0; k < 3; k++) {
        result[i][k] += d[k] * factor * b.mass;
        result[j][k] -= d[k] * factor * a.mass;
      }
    }
  return result;
}

export function mergeCollisions(bodies) {
  const events = [];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i],
          b = bodies[j];
        if (
          Math.hypot(...a.position.map((v, k) => v - b.position[k])) >
          a.radius + b.radius
        )
          continue;
        events.push(mergePair(bodies, a, b));
        changed = true;
        break outer;
      }
  }
  return events;
}

// Tight encounters use smaller power-of-two steps. With a fixed step, Verlet is
// symplectic; changing steps near encounters sacrifices strict symplecticity.
export function safeStep(bodies, maximum = BASE_STEP) {
  let limit = maximum;
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i],
        b = bodies[j];
      const r = Math.hypot(...a.position.map((v, k) => v - b.position[k]));
      const speed = Math.hypot(...a.velocity.map((v, k) => v - b.velocity[k]));
      limit = Math.min(
        limit,
        0.025 * Math.sqrt(r ** 3 / (G * (a.mass + b.mass))),
        (0.1 * r) / Math.max(speed, 1),
      );
    }
  return (
    maximum /
    2 ** Math.max(0, Math.ceil(Math.log2(maximum / Math.max(0.01, limit))))
  );
}

export function step(bodies, dt) {
  const events = mergeCollisions(bodies);
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
    let contact = null,
      travel = remaining;
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i],
          b = bodies[j];
        const p = a.position.map((v, k) => v - b.position[k]);
        const v = a.velocity.map((v, k) => v - b.velocity[k]);
        const A = v.reduce((s, x) => s + x * x, 0),
          B = p.reduce((s, x, k) => s + x * v[k], 0);
        const C = p.reduce((s, x) => s + x * x, 0) - (a.radius + b.radius) ** 2;
        const discriminant = B * B - A * C;
        if (C > 0 && (B >= 0 || A === 0 || discriminant < 0)) continue;
        const time = C <= 0 ? 0 : C / (-B + Math.sqrt(discriminant));
        if (time >= 0 && time <= travel) {
          travel = time;
          contact = [a, b];
        }
      }
    for (const body of bodies)
      for (let k = 0; k < 3; k++) body.position[k] += body.velocity[k] * travel;
    remaining -= travel;
    if (contact) events.push(mergePair(bodies, ...contact));
    else break;
  }
  const after = accelerations(bodies);
  for (let i = 0; i < bodies.length; i++)
    for (let k = 0; k < 3; k++) {
      bodies[i].velocity[k] += (after[i][k] * dt) / 2;
    }
  return events.concat(mergeCollisions(bodies));
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
    if (body.trail.length > 600) body.trail.shift();
    body.lastTrailTime = time;
  }
}

export class Simulation {
  constructor(bodies) {
    this.bodies = bodies;
    this.time = 0;
    this.pending = 0;
    this.limited = false;
    this.events = [];
  }
  advance(realSeconds, timeScale, budgetMs = 9) {
    // No hidden-tab catch-up or unbounded debt. Slow simulated time when work is
    // excessive, instead of increasing the physics step and destabilizing orbits.
    this.pending += Math.min(realSeconds, 0.1) * timeScale;
    const start = performance.now();
    let count = 0,
      exhausted = false;
    while (this.pending > 0) {
      this.events.push(...mergeCollisions(this.bodies));
      const dt = safeStep(this.bodies);
      if (this.pending < dt) break;
      this.events.push(...step(this.bodies, dt));
      this.time += dt;
      this.pending -= dt;
      recordTrails(this.bodies, this.time);
      count++;
      if (count >= 2048 || performance.now() - start >= budgetMs) {
        exhausted = true;
        break;
      }
    }
    this.limited = exhausted && this.pending >= safeStep(this.bodies);
    if (this.limited) this.pending = Math.min(this.pending, BASE_STEP);
  }
}
