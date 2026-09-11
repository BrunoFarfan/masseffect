import test from "node:test";
import assert from "node:assert/strict";
import { fragmentImpact } from "../src/impacts.js";

const G = 6.6743e-11;
const sphere = (id, changes = {}) => ({
  id,
  name: id,
  kind: "Asteroid",
  mass: 1e19,
  radius: 1e5,
  color: "#c8b8a8",
  parentId: "sun",
  position: [0, 0, 0],
  velocity: [0, 0, 0],
  trail: [],
  ...changes,
});
const pair = () => [
  sphere("a", { position: [1e9, -2e9, 3e9], velocity: [1e4, 300, -500] }),
  sphere("b", {
    mass: 2e19,
    position: [1e9 + 2e5, -2e9, 3e9],
    velocity: [-2e4, 500, 200],
  }),
];
const approximately = (actual, expected, tolerance = 1e-13) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} differs from ${expected}`,
  );
function center(bodies, field) {
  const total = bodies.reduce((sum, body) => sum + body.mass, 0);
  return [0, 1, 2].map((k) =>
    bodies.reduce((sum, body) => sum + body[field][k] * (body.mass / total), 0),
  );
}

test("four fragments conserve mass, volume, COM and momentum with bounded ejection energy", () => {
  const inputs = pair(),
    snapshot = structuredClone(inputs);
  const fragments = fragmentImpact(...inputs, { bodyCount: 26 });
  assert.equal(fragments.length, 4);
  const mass = inputs.reduce((sum, b) => sum + b.mass, 0);
  const volume = inputs.reduce((sum, b) => sum + b.radius ** 3, 0);
  approximately(
    fragments.reduce((sum, b) => sum + b.mass, 0),
    mass,
  );
  approximately(
    fragments.reduce((sum, b) => sum + b.radius ** 3, 0),
    volume,
  );
  for (const field of ["position", "velocity"])
    center(fragments, field).forEach((value, k) =>
      approximately(value, center(inputs, field)[k]),
    );
  const [a, b] = inputs;
  const relativeSpeed = Math.hypot(
    ...a.velocity.map((value, k) => value - b.velocity[k]),
  );
  const relativeEnergy = 0.5 * a.mass * (b.mass / mass) * relativeSpeed ** 2;
  const threshold =
    2 * 0.6 * G * (a.mass ** 2 / a.radius + b.mass ** 2 / b.radius);
  const comVelocity = center(inputs, "velocity");
  const ejection = fragments.reduce(
    (sum, f) =>
      sum +
      0.5 *
        f.mass *
        f.velocity.reduce(
          (norm, value, k) => norm + (value - comVelocity[k]) ** 2,
          0,
        ),
    0,
  );
  assert.ok(ejection > 0);
  assert.ok(ejection <= 0.25 * (relativeEnergy - threshold) * (1 + 1e-13));
  fragments.forEach((f, i) => {
    assert.equal(f.mass, mass / 4);
    assert.equal(f.kind, "Fragment");
    assert.equal(f.fragmentGeneration, 1);
    assert.equal(f.parentId, "sun");
    assert.equal(f.color, b.color);
    assert.deepEqual(f.trail, []);
    assert.equal(f.trailInterval, 100);
    for (const other of fragments.slice(i + 1))
      assert.ok(
        Math.hypot(...f.position.map((value, k) => value - other.position[k])) >
          f.radius + other.radius,
      );
  });
  assert.deepEqual(inputs, snapshot);
  assert.equal(fragments[0].id, b.id);
  assert.equal(new Set(fragments.map((f) => f.id)).size, 4);
  assert.deepEqual(fragments, fragmentImpact(...inputs, { bodyCount: 26 }));
  assert.notEqual(fragments[0].position, inputs[0].position);
});

test("low energy, tiny impacts, small mass ratio, and stars fall back to merging", () => {
  const [a, b] = pair();
  const cases = [
    [a, { ...b, velocity: [...a.velocity] }],
    [
      { ...a, mass: 1e14 },
      { ...b, mass: 1e14 },
    ],
    [
      { ...a, radius: 1000 },
      { ...b, radius: 1000 },
    ],
    [a, { ...b, mass: a.mass / 21 }],
    [{ ...a, kind: "Star" }, b],
    [a, { ...b, kind: "Star" }],
    [{ ...a, fragmentGeneration: 1 }, b],
    [a, { ...b, fragmentGeneration: 2 }],
  ];
  for (const inputs of cases)
    assert.equal(fragmentImpact(...inputs, { bodyCount: 2 }), null);
});

test("threshold is strict and disruption requires excess relative kinetic energy", () => {
  const a = sphere("a"),
    b = sphere("b");
  const threshold =
    2 * 0.6 * G * (a.mass ** 2 / a.radius + b.mass ** 2 / b.radius);
  const criticalSpeed = Math.sqrt((2 * threshold) / (a.mass / 2));
  b.velocity = [criticalSpeed * 0.999, 0, 0];
  assert.equal(fragmentImpact(a, b, { bodyCount: 2 }), null);
  b.velocity = [criticalSpeed * 1.001, 0, 0];
  assert.equal(fragmentImpact(a, b, { bodyCount: 2 }).length, 4);
});

test("body cap accounts for two removed and four new bodies", () => {
  const inputs = pair();
  assert.equal(fragmentImpact(...inputs, { bodyCount: 126 }).length, 4);
  assert.equal(fragmentImpact(...inputs, { bodyCount: 127 }), null);
  assert.equal(fragmentImpact(...inputs, { bodyCount: 2, maxBodies: 3 }), null);
  assert.equal(
    fragmentImpact(...inputs, { bodyCount: 2, maxBodies: 4 }).length,
    4,
  );
});

test("minimum allowed fragment mass and comparable mass ratio include their boundaries", () => {
  const [a, b] = pair();
  const small = fragmentImpact(
    { ...a, mass: 2e14, radius: 2000 },
    { ...b, mass: 2e14, radius: 2000 },
    { bodyCount: 2 },
  );
  assert.ok(
    small.every(
      (fragment) => fragment.mass === 1e14 && fragment.radius >= 1000,
    ),
  );
  assert.equal(
    fragmentImpact(a, { ...b, mass: a.mass * 0.05 }, { bodyCount: 2 }).length,
    4,
  );
});

test("invalid and overflowing states return null without introducing nonfinite fragments", () => {
  const [a, b] = pair();
  for (const changes of [
    { mass: NaN },
    { mass: 0 },
    { radius: Infinity },
    { radius: -1 },
    { position: [0, NaN, 0] },
    { velocity: [Infinity, 0, 0] },
    { position: [1, 2] },
    { id: b.id },
    { mass: 1e308, radius: 1e300 },
    { fragmentGeneration: NaN },
    { fragmentGeneration: -1 },
  ])
    assert.equal(
      fragmentImpact({ ...a, ...changes }, b, { bodyCount: 2 }),
      null,
    );
  assert.equal(fragmentImpact(null, b, { bodyCount: 2 }), null);
  assert.equal(fragmentImpact(a, b), null);
  assert.equal(fragmentImpact(a, b, { bodyCount: NaN }), null);
  assert.equal(fragmentImpact(a, b, { bodyCount: 1 }), null);
  assert.equal(fragmentImpact(a, b, { bodyCount: 2.5 }), null);
  assert.equal(
    fragmentImpact(a, b, { bodyCount: 2, maxBodies: Infinity }),
    null,
  );
  const huge = [a, b].map((body) => ({
    ...body,
    position: [1e100, 1e100, 1e100],
  }));
  assert.equal(fragmentImpact(...huge, { bodyCount: 2 }), null);
});

test("fragments only keep a common external parent, and cannot fragment a second time", () => {
  const [a, b] = pair();
  for (const [parentA, parentB] of [
    ["sun", "earth"],
    [a.id, a.id],
    [b.id, b.id],
    [undefined, undefined],
  ]) {
    const fragments = fragmentImpact(
      { ...a, parentId: parentA },
      { ...b, parentId: parentB },
      { bodyCount: 2 },
    );
    assert.ok(fragments.every((f) => f.parentId === undefined));
  }
  const fragments = fragmentImpact(a, b, { bodyCount: 2 });
  assert.equal(
    fragmentImpact(fragments[0], fragments[1], { bodyCount: 4 }),
    null,
  );
  const others = fragmentImpact(
    { ...a, id: "c" },
    { ...b, id: "d" },
    { bodyCount: 2 },
  );
  assert.equal(new Set([...fragments, ...others].map((f) => f.id)).size, 8);
});
