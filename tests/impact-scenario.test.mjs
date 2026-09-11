import test from "node:test";
import assert from "node:assert/strict";
import { impactScenario } from "../src/impact-scenario.js";
import { safeStep, step } from "../src/physics.js";

test("impact scenario starts with fresh, symmetric Mars-like bodies in SI", () => {
  const first = impactScenario(),
    second = impactScenario();
  assert.deepEqual(first, second);
  assert.equal(first.focusId, "impact-a");
  assert.equal(first.timeScale, 60);
  assert.equal(first.bodies.length, 2);
  assert.equal(new Set(first.bodies.map((body) => body.id)).size, 2);
  for (let axis = 0; axis < 3; axis++) {
    assert.equal(
      first.bodies[0].position[axis] + first.bodies[1].position[axis],
      0,
    );
    assert.equal(
      first.bodies[0].velocity[axis] + first.bodies[1].velocity[axis],
      0,
    );
  }
  for (const body of first.bodies) {
    assert.equal(body.mass, 6.41691e23);
    assert.equal(body.radius, 3.3895e6);
    assert.ok(Math.abs(Math.hypot(...body.velocity) - 11000) < 1e-9);
    assert.ok(
      body.position.reduce(
        (sum, value, axis) => sum + value * body.velocity[axis],
        0,
      ) < 0,
    );
  }
  first.bodies[0].position[0] = 0;
  first.bodies[0].trail.push([1, 2, 3]);
  assert.equal(second.bodies[0].position[0], -1.2e7);
  assert.deepEqual(second.bodies[0].trail, []);
});

test("ordinary gravity produces the impact with finite states and conserved mass/momentum", (t) => {
  const { bodies, timeScale } = impactScenario();
  const totalMass = bodies.reduce((sum, body) => sum + body.mass, 0);
  let time = 0,
    collisionCount = 0;
  for (let count = 0; count < 2000 && collisionCount === 0; count++) {
    const dt = safeStep(bodies);
    collisionCount += step(bodies, dt).length;
    time += dt;
  }
  assert.equal(collisionCount, 1);
  assert.equal(bodies.length, 4);
  assert.ok(time > 700 && time < 900);
  assert.equal(
    bodies.reduce((s, b) => s + b.mass, 0),
    totalMass,
  );
  assert.ok(
    [...bodies[0].position, ...bodies[0].velocity].every(Number.isFinite),
  );
  for (let k = 0; k < 3; k++) {
    assert.ok(
      Math.abs(
        bodies.reduce((s, b) => s + (b.velocity[k] * b.mass) / totalMass, 0),
      ) < 1e-10,
    );
    assert.ok(
      Math.abs(
        bodies.reduce((s, b) => s + (b.position[k] * b.mass) / totalMass, 0),
      ) < 1e-7,
    );
  }
  t.diagnostic(
    `Impact occurs by ${time.toFixed(2)} simulated seconds (${(time / timeScale).toFixed(2)} real seconds at the scenario rate).`,
  );
});
