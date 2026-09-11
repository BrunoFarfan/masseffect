import test from "node:test";
import assert from "node:assert/strict";
import { Simulation, BASE_STEP } from "../src/physics.js";
import { createScenario } from "../src/scenarios.js";

const inert = () => [
  {
    id: "traveler",
    name: "Traveler",
    mass: 1,
    radius: 1,
    position: [0, 0, 0],
    velocity: [3, -2, 1],
    trail: [],
  },
];
const physicalState = (sim) =>
  sim.bodies.map((body) => ({
    id: body.id,
    mass: body.mass,
    radius: body.radius,
    position: [...body.position],
    velocity: [...body.velocity],
  }));
function run(factory, rate, fps, duration = 2) {
  const sim = new Simulation(factory());
  for (let frame = 0; frame < duration * fps; frame++)
    sim.advance(1 / fps, rate, Infinity);
  return sim;
}

for (const [name, factory] of [
  ["inert body", inert],
  ["binary stars", () => createScenario("binary-stars").bodies],
]) {
  test(`${name}: 30/60/120 fps produce identical physical states at 1/60/3600x`, () => {
    for (const rate of [1, 60, 3600]) {
      const reference = run(factory, rate, 60);
      assert.equal(reference.time, rate * 2);
      for (const fps of [30, 120]) {
        const sim = run(factory, rate, fps);
        assert.equal(sim.time, reference.time, `${rate}x at ${fps} fps`);
        assert.deepEqual(physicalState(sim), physicalState(reference));
        assert.ok(sim.pending >= 0 && sim.pending < 1e-10);
        assert.equal(sim.limited, false);
      }
    }
  });
}

test("real-time mode advances at each whole second despite fractional frame accumulation", () => {
  for (const fps of [30, 60, 120]) {
    const sim = new Simulation(inert());
    for (let frame = 1; frame < fps; frame++) {
      sim.advance(1 / fps, 1, Infinity);
      assert.equal(sim.time, 0);
    }
    sim.advance(1 / fps, 1, Infinity);
    assert.equal(sim.time, 1);
    assert.deepEqual(sim.bodies[0].position, [3, -2, 1]);
    assert.ok(sim.pending >= 0 && sim.pending < 1e-12);
  }
});

test("budget limits preserve bounded debt and use the configured low-rate quantum", () => {
  const fast = new Simulation(inert());
  fast.advance(0.1, 1e8, 0);
  assert.equal(fast.time, BASE_STEP);
  assert.equal(fast.limited, true);
  assert.equal(fast.pending, BASE_STEP);
  fast.advance(0, 1e8, 0);
  assert.equal(fast.time, 2 * BASE_STEP);
  assert.equal(fast.pending, 0);
  assert.equal(fast.limited, false);

  const slow = new Simulation(inert());
  slow.advance(0.1, 3600, 0);
  assert.equal(slow.time, 1);
  assert.equal(slow.pending, 359);
  assert.equal(slow.limited, true);
  slow.advance(0, 3600, Infinity);
  assert.equal(slow.time, 360);
  assert.equal(slow.pending, 0);
  assert.equal(slow.limited, false);
});
