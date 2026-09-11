import test from "node:test";
import assert from "node:assert/strict";
import { hitAndRun, angularMomentum, fragmentImpact } from "../src/impacts.js";
import { mergeCollisions, step } from "../src/physics.js";
import { ImpactView } from "../src/impact-view.js";
import { length, sub } from "../src/math.js";

const body = (id, x, velocity = [0, 0, 0]) => ({
  id,
  name: id,
  kind: "Planet",
  mass: 1e20,
  radius: 1e5,
  position: [x, 0, 0],
  velocity,
  angularVelocity: [0, 0, 1e-5],
  orientation: [0, 0, 0, 1],
  rotationModel: "free",
  trail: [],
});
const momentum = (bodies) =>
  [0, 1, 2].map((k) => bodies.reduce((s, b) => s + b.mass * b.velocity[k], 0));
const near = (a, b, relative = 1e-10) =>
  assert.ok(
    length(sub(a, b)) <= relative * Math.max(1, length(b)),
    `${a} != ${b}`,
  );

test("unbound glancing contacts separate without sticking, conserve momentum and lose energy", () => {
  const a = body("a", -1e5, [100, 2000, 0]),
    b = body("b", 1e5, [-100, -2000, 0]);
  const p = momentum([a, b]),
    angular = angularMomentum(a, b),
    initial = length(sub(a.velocity, b.velocity));
  assert.equal(hitAndRun(a, b), true);
  assert.ok(a.velocity[0] < 0 && b.velocity[0] > 0);
  assert.ok(length(sub(a.position, b.position)) > a.radius + b.radius);
  assert.ok(length(sub(a.velocity, b.velocity)) < initial);
  near(momentum([a, b]), p);
  // Tiny positional correction may change orbital angular momentum by ~1 ppm.
  near(angularMomentum(a, b), angular, 2e-6);
  const bodies = [a, b];
  for (let i = 0; i < 1000; i++) step(bodies, 1);
  assert.equal(bodies.length, 2);
  assert.ok(
    bodies.every((b) => [...b.position, ...b.velocity].every(Number.isFinite)),
  );
});
test("slow bound contacts merge and carry orbital plus intrinsic angular momentum into spin", () => {
  const a = body("a", -1e5, [10, 2, 3]),
    b = body("b", 1e5, [-10, -2, -3]);
  const angular = angularMomentum(a, b),
    bodies = [a, b];
  const events = mergeCollisions(bodies);
  assert.equal(bodies.length, 1);
  assert.equal(events[0].kind, "merge");
  const merged = bodies[0];
  near(
    merged.angularVelocity.map(
      (v) => v * 0.4 * merged.mass * merged.radius ** 2,
    ),
    angular,
  );
  assert.equal(merged.rotationModel, "free");
  assert.equal(events[0].before.length, 2);
  assert.equal(events[0].before[0].mass, 1e20);
});
test("energetic spent fragments rebound without recursive disruption", () => {
  const a = { ...body("a", -1e5, [5000, 0, 0]), fragmentGeneration: 1 },
    b = body("b", 1e5, [-5000, 0, 0]);
  const bodies = [a, b];
  const events = step(bodies, 1);
  assert.equal(bodies.length, 2);
  assert.equal(events[0].kind, "bounce");
  assert.ok(a.velocity[0] < 0 && b.velocity[0] > 0);
});
test("fresh fragments are compact and preserve angular momentum within their energy budget", () => {
  const a = body("a", -1e5, [5000, 10, 0]),
    b = body("b", 1e5, [-5000, -10, 0]);
  const fragments = fragmentImpact(a, b, { bodyCount: 2 });
  assert.equal(fragments.length, 4);
  assert.ok(fragments.every((f) => length(f.position) < 1.3 * f.radius));
  const angular = fragments.reduce(
    (sum, f) => {
      const r = f.position,
        v = f.velocity,
        spin = f.angularVelocity.map((w) => w * 0.4 * f.mass * f.radius ** 2);
      const orbital = [
        r[1] * v[2] - r[2] * v[1],
        r[2] * v[0] - r[0] * v[2],
        r[0] * v[1] - r[1] * v[0],
      ];
      return sum.map((s, k) => s + spin[k] + orbital[k] * f.mass);
    },
    [0, 0, 0],
  );
  near(angular, angularMomentum(a, b));
});
test("impact presentation is bounded, pause-safe and never mutates physical bodies", () => {
  const bodies = [body("a", -1e5), body("b", 1e5)],
    effects = new ImpactView();
  const events = mergeCollisions(bodies),
    snapshot = structuredClone(bodies);
  effects.capture(events);
  const start = effects.bodies(bodies, 0);
  assert.equal(start.filter((b) => b.ghost).length, 2);
  assert.equal(start.find((b) => !b.ghost).visualAlpha, 0);
  const midpoint = effects.bodies(bodies, 0.25);
  assert.equal(midpoint[0].visualAlpha, 0.5);
  assert.deepEqual(effects.bodies(bodies, 0), midpoint);
  assert.deepEqual(bodies, snapshot);
  assert.deepEqual(effects.bodies(bodies, 0.25), bodies);
  effects.capture(events);
  effects.clear();
  assert.deepEqual(effects.bodies(bodies, 0), bodies);
});
