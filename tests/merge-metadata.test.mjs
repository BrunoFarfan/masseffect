import test from "node:test";
import assert from "node:assert/strict";
import { mergeCollisions, step } from "../src/physics.js";
import { PRESETS } from "../src/presets.js";
import { stellarColor } from "../src/thermal.js";

function body(presetId, id, extra = {}) {
  return {
    ...PRESETS.find((preset) => preset.id === presetId),
    id,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    trail: [],
    relativeTrail: [[1, 2, 3]],
    ...extra,
  };
}

test("stellar mergers retain radiative power and consistent radius/temperature", () => {
  for (const pair of [
    ["sun", "sun"],
    ["white-dwarf", "red-dwarf"],
  ]) {
    const bodies = pair.map((preset, i) =>
      body(preset, String(i), {
        velocity: [i ? -400 : 800, i ? 50 : -100, 20],
      }),
    );
    const [a, b] = bodies;
    const luminosity = a.luminosity + b.luminosity;
    const mass = a.mass + b.mass;
    const volume = a.radius ** 3 + b.radius ** 3;
    const velocity = a.velocity.map(
      (value, k) => (value * a.mass + b.velocity[k] * b.mass) / mass,
    );
    const events = mergeCollisions(bodies);
    assert.equal(events.length, 1);
    assert.equal(bodies.length, 1);
    const merged = bodies[0];
    assert.equal(merged.mass, mass);
    assert.deepEqual(merged.velocity, velocity);
    assert.ok(Math.abs(merged.radius ** 3 / volume - 1) < 1e-14);
    assert.equal(merged.kind, "Star");
    assert.equal(merged.luminosity, luminosity);
    const implied =
      4 *
      Math.PI *
      5.670374419e-8 *
      merged.radius ** 2 *
      merged.effectiveTemperature ** 4;
    assert.ok(Math.abs(implied / luminosity - 1) < 1e-14);
    assert.equal(merged.color, stellarColor(merged.effectiveTemperature));
  }
});

test("a heavier nonstellar survivor inherits the absorbed star's radiative metadata", () => {
  const planet = body("jupiter", "planet", { mass: 1e32 });
  const star = body("sun", "sun");
  mergeCollisions([planet, star]);
  assert.equal(planet.kind, "Star");
  assert.equal(planet.luminosity, star.luminosity);
  assert.ok(Number.isFinite(planet.effectiveTemperature));
});

test("invalid luminosities cannot poison a merger's temperature", () => {
  for (const luminosity of [NaN, Infinity, -1, undefined]) {
    const a = body("sun", "a", { luminosity });
    const b = body("sun", "b");
    mergeCollisions([a, b]);
    assert.equal(a.luminosity, b.luminosity);
    assert.ok(Number.isFinite(a.effectiveTemperature));
  }
  const a = body("sun", "a", { luminosity: NaN });
  const b = body("sun", "b", { luminosity: -1 });
  mergeCollisions([a, b]);
  assert.equal(a.luminosity, 0);
  assert.equal(a.effectiveTemperature, undefined);
});

test("giant child absorbing Earth reparents the Moon and inherits Earth's parent", () => {
  const sun = body("sun", "sun", { position: [1.5e11, 0, 0] });
  const earth = body("earth", "earth", { parentId: "sun" });
  const giant = body("blue-giant", "giant", { parentId: "earth" });
  const moon = body("moon", "moon", {
    parentId: "earth",
    position: [1e10, 0, 0],
  });
  const bodies = [sun, earth, giant, moon];
  const events = step(bodies, 0.1);
  assert.equal(events.length, 1);
  assert.equal(events[0].removed, "earth");
  assert.equal(events[0].survivor, "giant");
  assert.equal(giant.parentId, "sun");
  assert.equal(moon.parentId, "giant");
  assert.deepEqual(moon.relativeTrail, []);
  for (const b of bodies)
    assert.ok(
      [b.mass, b.radius, ...b.position, ...b.velocity].every(Number.isFinite),
    );
});

test("ancestor mergers detach the survivor if reparenting would form a cycle", () => {
  const ancestor = body("earth", "ancestor");
  const parent = body("moon", "parent", {
    parentId: "ancestor",
    position: [1e10, 0, 0],
  });
  const giant = body("blue-giant", "giant", { parentId: "parent" });
  const bodies = [ancestor, parent, giant];
  mergeCollisions(bodies);
  assert.equal(giant.parentId, undefined);
  assert.equal(parent.parentId, "giant");
  assert.deepEqual(parent.relativeTrail, []);
});

test("sibling merge preserves the shared parent and moves the removed body's children", () => {
  const parent = body("sun", "parent", { position: [1e11, 0, 0] });
  const a = body("earth", "a", { parentId: "parent" });
  const b = body("moon", "b", { parentId: "parent" });
  const child = body("asteroid", "child", {
    parentId: "b",
    position: [1e8, 0, 0],
  });
  mergeCollisions([parent, a, b, child]);
  assert.equal(a.parentId, "parent");
  assert.equal(child.parentId, "a");
  assert.deepEqual(child.relativeTrail, []);
});
