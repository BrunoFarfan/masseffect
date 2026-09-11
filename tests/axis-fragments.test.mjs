import test from "node:test";
import assert from "node:assert/strict";
import { Camera } from "../src/camera.js";
import { solarSystem } from "../src/solar.js";
import {
  initializeRotations,
  rotateVector,
  axisAngle,
  IDENTITY,
} from "../src/rotation.js";
import { dot, cross, sub, length, unit } from "../src/math.js";
import { fragmentImpact, angularMomentum } from "../src/impacts.js";
import { impactScenario } from "../src/impact-scenario.js";
import { FragmentBudget } from "../src/fragment-budget.js";
import { Simulation, step } from "../src/physics.js";
import { History } from "../src/history.js";
const near = (a, b, eps = 1e-10) =>
  assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test("Venus and Uranus retain retrograde SI spin and Uranus agrees with its moon plane", () => {
  const bodies = solarSystem();
  initializeRotations(bodies);
  const sun = bodies[0],
    venus = bodies.find((b) => b.id === "venus"),
    uranus = bodies.find((b) => b.id === "uranus"),
    ariel = bodies.find((b) => b.id === "ariel");
  near(venus.rotationPeriod, 243.018 * 86400);
  near(uranus.rotationPeriod, 17.24 * 3600);
  for (const b of [venus, uranus]) {
    const orbit = unit(
      cross(sub(b.position, sun.position), sub(b.velocity, sun.velocity)),
    );
    assert.ok(dot(unit(b.angularVelocity), orbit) < 0);
    const obliquity =
      (Math.acos(dot(unit(b.angularVelocity), orbit)) * 180) / Math.PI;
    assert.ok(Math.abs(obliquity - (b.id === "venus" ? 177.36 : 97.77)) < 0.02);
    near(length(b.angularVelocity) * b.rotationPeriod, 2 * Math.PI);
    near(
      dot(unit(b.angularVelocity), rotateVector(b.orientation, [0, 1, 0])),
      1,
    );
  }
  const moonPole = unit(
    cross(
      sub(ariel.position, uranus.position),
      sub(ariel.velocity, uranus.velocity),
    ),
  );
  assert.ok(dot(unit(uranus.angularVelocity), moonPole) > 0.9999);
});
test("F/G/H level the frame even if look, wheel or movement interrupts travel", () => {
  const body = {
    id: "moon",
    kind: "Moon",
    radius: 1e6,
    position: [0, 0, 0],
    orientation: [...IDENTITY],
  };
  for (const action of ["focus", "closer", "home"])
    for (const interrupt of ["look", "wheel", "keys", "none"]) {
      const c = new Camera();
      c.position = [0, 0, body.radius + 2];
      c.frameRotation = axisAngle([1, 0, 0], 1.2);
      c.surface = { id: body.id, orientation: [...IDENTITY], blend: 1 };
      c.followId = body.id;
      if (action === "home") c.home(false, true);
      else c.focus(body, action === "focus" ? [body] : null);
      c.update(0.05, [body], new Set());
      if (interrupt === "look") c.rotate(20, 10);
      if (interrupt === "wheel") c.travel(0.2);
      for (let i = 0; i < 60; i++)
        c.update(1 / 60, [body], new Set(interrupt === "keys" ? ["KeyD"] : []));
      assert.equal(c.surface, null);
      assert.equal(c.leveling, null);
      assert.ok(
        length(sub(c.frameRotation, IDENTITY)) < 1e-10,
        `${action}/${interrupt}`,
      );
      near(dot(c.forward, c.right), 0);
    }
});
test("4 through 64 fragments conserve mass, volume, COM, momentum and bounded spin without overlap", () => {
  for (const count of [4, 8, 16, 32, 64]) {
    const { bodies: inputs } = impactScenario();
    inputs.forEach((b, i) => (b.position = [(i ? 1 : -1) * b.radius, 0, 0]));
    initializeRotations(inputs);
    const output = fragmentImpact(...inputs, {
      bodyCount: 2,
      fragmentLimit: count,
    });
    assert.equal(output.length, count);
    const mass = inputs.reduce((s, b) => s + b.mass, 0),
      volume = inputs.reduce((s, b) => s + b.radius ** 3, 0);
    near(
      output.reduce((s, b) => s + b.mass, 0),
      mass,
    );
    near(
      output.reduce((s, b) => s + b.radius ** 3, 0),
      volume,
    );
    for (let k = 0; k < 3; k++) {
      near(
        output.reduce((s, b) => s + b.position[k] / count, 0),
        0,
        1e-8,
      );
      near(
        output.reduce((s, b) => s + b.velocity[k] / count, 0),
        0,
        1e-8,
      );
    }
    const angular = output.reduce(
      (sum, b) => {
        const orbital = cross(b.position, b.velocity);
        return sum.map(
          (s, k) =>
            s +
            b.mass * (orbital[k] + 0.4 * b.radius ** 2 * b.angularVelocity[k]),
        );
      },
      [0, 0, 0],
    );
    const expected = angularMomentum(...inputs);
    assert.ok(length(sub(angular, expected)) / length(expected) < 1e-10);
    for (let i = 0; i < count; i++)
      for (let j = i + 1; j < count; j++)
        assert.ok(
          length(sub(output[i].position, output[j].position)) >
            output[i].radius + output[j].radius,
        );
    assert.equal(new Set(output.map((b) => b.id)).size, count);
  }
});
test("larger impacts obey capacity and minimum mass; CPU budget only limits prospective debris", () => {
  const inputs = impactScenario().bodies;
  assert.equal(
    fragmentImpact(...inputs, { bodyCount: 120, fragmentLimit: 64 }).length,
    8,
  );
  assert.equal(
    fragmentImpact(...inputs, { bodyCount: 128, fragmentLimit: 64 }),
    null,
  );
  const tiny = inputs.map((b) => ({ ...b, mass: 2e14, radius: 2000 }));
  assert.equal(
    fragmentImpact(...tiny, { bodyCount: 2, fragmentLimit: 64 }).length,
    4,
  );
  const budget = new FragmentBudget();
  assert.equal(budget.limit(64, 26), 64);
  for (let i = 0; i < 100; i++) budget.observeStep(20, 32);
  assert.ok(budget.limit(64, 26) < 64);
  assert.equal(budget.limit(64, 126), 4);
});
test("recorded rewind retains larger fragment outcomes and policy for reconstruction", () => {
  const sim = new Simulation(impactScenario().bodies, { fragmentLimit: 32 }),
    history = new History(sim);
  step(sim.bodies, 820, { fragmentLimit: 32 });
  sim.time = 820;
  history.capture(sim);
  assert.equal(sim.bodies.length, 32);
  const after = structuredClone(sim.bodies.map((b) => b.position));
  history.seek(sim, 0);
  assert.equal(sim.bodies.length, 2);
  history.seek(sim, 820);
  assert.equal(sim.bodies.length, 32);
  assert.deepEqual(
    sim.bodies.map((b) => b.position),
    after,
  );
  assert.equal(sim.collisionLimit, 32);
});
