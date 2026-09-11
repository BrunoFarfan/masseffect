import test from "node:test";
import assert from "node:assert/strict";
import { solarSystem } from "../src/solar.js";
import { addMoons } from "../src/moons.js";
import { G, energy, safeStep, step } from "../src/physics.js";
import { sub, length, dot, cross } from "../src/math.js";

test("canonical moons have SI circular relative states and no overlaps", () => {
  const bodies = solarSystem(),
    moons = bodies.filter((b) => b.kind === "Moon");
  assert.equal(bodies.length, 26);
  assert.equal(moons.length, 17);
  assert.equal(new Set(bodies.map((b) => b.id)).size, bodies.length);
  assert.deepEqual(
    Object.fromEntries(
      ["earth", "mars", "jupiter", "saturn", "uranus", "neptune"].map((id) => [
        id,
        moons.filter((moon) => moon.parentId === id).length,
      ]),
    ),
    { earth: 1, mars: 2, jupiter: 4, saturn: 4, uranus: 5, neptune: 1 },
  );
  for (const moon of moons) {
    const parent = bodies.find((b) => b.id === moon.parentId);
    const r = sub(moon.position, parent.position),
      v = sub(moon.velocity, parent.velocity);
    assert.ok(moon.mass > 1e15 && moon.mass < 2e23, moon.name);
    assert.ok(moon.radius > 5e3 && moon.radius < 3e6, moon.name);
    assert.ok(length(v) > 900 && length(v) < 18000, moon.name);
    assert.ok(Math.abs(dot(r, v) / (length(r) * length(v))) < 1e-9, moon.name);
    assert.ok(
      Math.abs(
        (length(v) ** 2 * length(r)) / (G * (parent.mass + moon.mass)) - 1,
      ) < 1e-9,
      moon.name,
    );
    assert.ok(moon.trailInterval > 0);
  }
  for (let i = 0; i < bodies.length; i++) {
    assert.equal("orbit" in bodies[i], false);
    for (let j = i + 1; j < bodies.length; j++)
      assert.ok(
        length(sub(bodies[i].position, bodies[j].position)) >
          bodies[i].radius + bodies[j].radius,
      );
  }
});

test("moon addition preserves subsystem barycenters and planet masses", () => {
  const planet = {
    id: "earth",
    mass: 5.97217e24,
    position: [1e11, 2e10, -3e10],
    velocity: [100, -200, 300],
  };
  const initial = structuredClone(planet),
    bodies = [planet];
  addMoons(bodies);
  assert.equal(planet.mass, initial.mass);
  const mass = bodies.reduce((sum, body) => sum + body.mass, 0);
  for (let k = 0; k < 3; k++) {
    const position = bodies.reduce(
      (sum, body) => sum + (body.position[k] * body.mass) / mass,
      0,
    );
    const velocity = bodies.reduce(
      (sum, body) => sum + (body.velocity[k] * body.mass) / mass,
      0,
    );
    assert.ok(Math.abs(position - initial.position[k]) < 5e-5);
    assert.ok(Math.abs(velocity - initial.velocity[k]) < 1e-12);
  }
  const canonical = solarSystem(),
    total = canonical.reduce((sum, body) => sum + body.mass, 0);
  for (let k = 0; k < 3; k++) {
    assert.ok(
      Math.abs(
        canonical.reduce(
          (sum, body) => sum + (body.position[k] * body.mass) / total,
          0,
        ),
      ) < 1e-5,
    );
    assert.ok(
      Math.abs(
        canonical.reduce(
          (sum, body) => sum + (body.velocity[k] * body.mass) / total,
          0,
        ),
      ) < 1e-12,
    );
  }
});

test("Triton is retrograde and Uranian regular moons use the tilted plane", () => {
  const bodies = solarSystem();
  // World XYZ swaps ecliptic Y/Z, reversing the cross-product sign.
  const angularMomentum = (id) => {
    const moon = bodies.find((b) => b.id === id),
      parent = bodies.find((b) => b.id === moon.parentId);
    return cross(
      sub(moon.position, parent.position),
      sub(moon.velocity, parent.velocity),
    );
  };
  assert.ok(angularMomentum("moon")[1] < 0);
  assert.ok(angularMomentum("triton")[1] > 0);
  const h = angularMomentum("titania");
  assert.ok(Math.abs(h[1]) / length(h) < 0.2);
});

test("all 26 gravitating bodies remain stable through two Phobos periods", () => {
  const bodies = solarSystem(),
    initialEnergy = energy(bodies);
  const initial = new Map(
    bodies
      .filter((b) => b.kind === "Moon")
      .map((moon) => {
        const parent = bodies.find((b) => b.id === moon.parentId);
        return [moon.id, length(sub(moon.position, parent.position))];
      }),
  );
  assert.equal(safeStep(bodies), 56.25);
  const period =
    2 *
    Math.PI *
    Math.sqrt(
      initial.get("phobos") ** 3 /
        (G * bodies.find((b) => b.id === "mars").mass),
    );
  for (let time = 0; time < 2 * period; ) {
    const dt = safeStep(bodies);
    assert.equal(step(bodies, dt).length, 0);
    time += dt;
  }
  assert.equal(bodies.length, 26);
  assert.ok(Math.abs((energy(bodies) - initialEnergy) / initialEnergy) < 1e-8);
  for (const moon of bodies.filter((b) => b.kind === "Moon")) {
    const parent = bodies.find((b) => b.id === moon.parentId);
    assert.ok(
      Math.abs(
        length(sub(moon.position, parent.position)) / initial.get(moon.id) - 1,
      ) < 0.01,
      moon.name,
    );
    assert.ok([...moon.position, ...moon.velocity].every(Number.isFinite));
  }
});
