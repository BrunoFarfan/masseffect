import test from "node:test";
import assert from "node:assert/strict";
import { History } from "../src/history.js";
import { mergeCollisions, Simulation, energy } from "../src/physics.js";
import { createScenario } from "../src/scenarios.js";
import { solarSystem } from "../src/solar.js";
import { length, sub } from "../src/math.js";

const body = (id = "a") => ({
  id,
  name: id,
  kind: "Star",
  mass: 2,
  radius: 1,
  position: [0, 0, 0],
  velocity: [1, 0, 0],
  color: "#ffffff",
  luminosity: 4,
  effectiveTemperature: 5772,
  albedo: 0.3,
  trail: [[-1, 0, 0]],
  relativeTrail: [[-2, 0, 0]],
  screenCache: { x: 50 },
});
const simulation = () => ({
  time: 0,
  bodies: [body()],
  pending: 7,
  events: ["old"],
  limited: true,
});

test("history reconstructs unchanged bodies and restores independent SI metadata", () => {
  const sim = simulation(),
    history = new History(sim);
  sim.time = 10;
  sim.bodies[0].position[0] = 10;
  history.capture(sim);
  assert.deepEqual(history.rewind(sim, 5), { atStart: false });
  assert.equal(sim.time, 5);
  assert.equal(sim.bodies[0].position[0], 5);
  assert.equal(sim.bodies[0].velocity[0], 1);
  assert.equal(sim.bodies[0].luminosity, 4);
  assert.equal(sim.bodies[0].effectiveTemperature, 5772);
  assert.deepEqual(sim.bodies[0].trail, []);
  assert.deepEqual(sim.bodies[0].relativeTrail, []);
  assert.equal(sim.bodies[0].screenCache, undefined);
  assert.equal(sim.pending, 0);
  assert.deepEqual(sim.events, []);
  assert.equal(sim.limited, false);
  sim.bodies[0].position[0] = 900;
  history.rewind(sim, 0);
  assert.equal(sim.bodies[0].position[0], 5);
  assert.deepEqual(history.rewind(sim, 100), { atStart: true });
  assert.equal(sim.time, 0);
  assert.equal(sim.bodies[0].position[0], 0);
});

test("rewinding across a collision restores both original masses and momentum", () => {
  const sim = simulation();
  sim.bodies[0].velocity = [3, 2, -1];
  sim.bodies.push({
    ...body("b"),
    mass: 1,
    position: [1, 0, 0],
    velocity: [0, -1, 2],
  });
  const original = structuredClone(sim.bodies),
    history = new History(sim);
  assert.equal(mergeCollisions(sim.bodies).length, 1);
  sim.time = 10;
  history.capture(sim);
  history.rewind(sim, 5);
  assert.equal(sim.time, 0); // Snapshot discontinuity, no invented midpoint body.
  assert.equal(sim.bodies.length, 2);
  for (let index = 0; index < 2; index++) {
    assert.equal(sim.bodies[index].mass, original[index].mass);
    assert.deepEqual(sim.bodies[index].position, original[index].position);
    assert.deepEqual(sim.bodies[index].velocity, original[index].velocity);
  }
  for (let axis = 0; axis < 3; axis++)
    assert.equal(
      sim.bodies.reduce(
        (sum, item) => sum + item.mass * item.velocity[axis],
        0,
      ),
      original.reduce((sum, item) => sum + item.mass * item.velocity[axis], 0),
    );
});

test("resuming from a reconstructed state discards the future and preserves the branch point", () => {
  const sim = simulation(),
    history = new History(sim);
  for (const time of [10, 20]) {
    sim.time = time;
    sim.bodies[0].position[0] = time;
    history.capture(sim);
  }
  history.rewind(sim, 5);
  // An explicit velocity edit at the branch point, followed by consistent drift.
  sim.bodies[0].velocity[0] = 85;
  history.capture(sim);
  sim.time = 16;
  sim.bodies[0].position[0] = 100;
  history.capture(sim);
  assert.equal(history.newestTime, 16);
  assert.equal(history.snapshotCount, 4);
  history.rewind(sim, 0.5);
  assert.equal(sim.time, 15.5);
  assert.equal(sim.bodies[0].position[0], 57.5);
  sim.bodies.push(body("created"));
  history.capture(sim);
  assert.equal(history.newestTime, 15.5);
  history.rewind(sim, 0.1);
  assert.equal(sim.time, 15);
  assert.equal(sim.bodies.length, 1);
});

test("metadata changes cannot replay and same-time edits replace snapshots", () => {
  const sim = simulation(),
    history = new History(sim);
  sim.time = 10;
  sim.bodies[0].mass = 20;
  history.capture(sim);
  sim.bodies[0].mass = 30;
  history.capture(sim);
  assert.equal(history.snapshotCount, 2);
  history.rewind(sim, 1);
  assert.equal(sim.time, 0);
  assert.equal(sim.bodies[0].mass, 2);
  history.clear(sim);
  assert.equal(history.snapshotCount, 1);
  assert.equal(history.oldestTime, sim.time);
});

test("history bounds snapshot count and body records while retaining the newest state", () => {
  const sim = simulation(),
    history = new History(sim);
  for (let time = 1; time <= 1000; time++) {
    sim.time = time;
    history.capture(sim);
  }
  assert.equal(history.snapshotCount, 900);
  assert.equal(history.oldestTime, 101);
  sim.bodies = Array.from({ length: 128 }, (_, index) => body(String(index)));
  history.clear(sim);
  for (let time = 1001; time <= 1400; time++) {
    sim.time = time;
    history.capture(sim);
  }
  assert.equal(history.bodyRecordCount, 32000);
  assert.equal(history.snapshotCount, 250);
  assert.equal(history.newestTime, 1400);
  const oldest = history.oldestTime;
  assert.deepEqual(history.rewind(sim, 10000), { atStart: true });
  assert.equal(sim.time, oldest);
  assert.throws(() => history.rewind(sim, -1), /nonnegative/);
});

test("recorded binary motion can rewind and resume an approximately conserved trajectory", (t) => {
  const sim = new Simulation(createScenario("binary-stars").bodies);
  const history = new History(sim);
  const initialEnergy = energy(sim.bodies);
  const separation = length(
    sub(sim.bodies[0].position, sim.bodies[1].position),
  );
  // Each recorded frame spans two physical steps. Rewind to a midpoint between
  // records to exercise reconstruction, then resume with the real Simulation API.
  for (let frame = 0; frame < 240; frame++) {
    sim.advance(0.1, 36000, Infinity);
    history.capture(sim);
  }
  const originalEnd = structuredClone(sim.bodies),
    endTime = sim.time;
  assert.equal(endTime, 864000); // More than one binary orbital period.
  assert.ok(
    Math.abs((energy(sim.bodies) - initialEnergy) / initialEnergy) < 1e-6,
  );
  history.rewind(sim, 433800);
  assert.equal(sim.time, 430200);
  const reconstructedEnergyError = Math.abs(
    (energy(sim.bodies) - initialEnergy) / initialEnergy,
  );
  assert.ok(reconstructedEnergyError < 1e-6);
  sim.advance(0.1, 18000, Infinity);
  history.capture(sim);
  assert.equal(history.newestTime, 432000); // Old future has been discarded.
  while (sim.time < endTime) {
    sim.advance(0.1, 18000, Infinity);
    history.capture(sim);
  }
  assert.equal(sim.time, endTime);
  assert.equal(sim.bodies.length, 2);
  const resumedEnergyError = Math.abs(
    (energy(sim.bodies) - initialEnergy) / initialEnergy,
  );
  assert.ok(resumedEnergyError < 1e-6);
  const maximumPositionError = Math.max(
    ...sim.bodies.map(
      (item, index) =>
        length(sub(item.position, originalEnd[index].position)) / separation,
    ),
  );
  assert.ok(maximumPositionError < 1e-12);
  const totalMass = sim.bodies.reduce((sum, item) => sum + item.mass, 0);
  for (let axis = 0; axis < 3; axis++) {
    const centerVelocity = sim.bodies.reduce(
      (sum, item) => sum + (item.mass / totalMass) * item.velocity[axis],
      0,
    );
    assert.ok(Math.abs(centerVelocity) < 1e-8);
  }
  for (const item of sim.bodies)
    assert.ok([...item.position, ...item.velocity].every(Number.isFinite));
  t.diagnostic(
    `Binary 3600 s recording interval: reconstructed energy error ${reconstructedEnergyError.toExponential(3)}, resumed energy error ${resumedEnergyError.toExponential(3)}, final position error / separation ${maximumPositionError.toExponential(3)}.`,
  );
});

test("Simulation swept collisions can be restored and replayed through recorded history", () => {
  const first = { ...body("target"), mass: 1e10, velocity: [0, 0, 0] };
  const projectile = {
    ...body("projectile"),
    mass: 1e10,
    position: [1000, 0, 0],
    velocity: [-1e7, 0, 0],
  };
  const sim = new Simulation([first, projectile]),
    history = new History(sim);
  const before = structuredClone(sim.bodies);
  sim.advance(0.1, 1, 0);
  const collisionTime = sim.time;
  assert.ok(collisionTime > 0 && collisionTime * 1e7 > 1002);
  assert.equal(sim.bodies.length, 1);
  assert.equal(sim.events.length, 1);
  assert.equal(sim.bodies[0].mass, 2e10);
  assert.ok(Math.abs(sim.bodies[0].velocity[0] + 5e6) < 1e-6);
  const merged = structuredClone(sim.bodies[0]);
  history.capture(sim);
  assert.deepEqual(history.rewind(sim, collisionTime / 2), { atStart: true });
  assert.equal(sim.time, 0);
  assert.equal(sim.bodies.length, 2);
  before.forEach((item, index) => {
    assert.equal(sim.bodies[index].id, item.id);
    assert.equal(sim.bodies[index].mass, item.mass);
    assert.equal(sim.bodies[index].radius, item.radius);
    assert.deepEqual(sim.bodies[index].position, item.position);
    assert.deepEqual(sim.bodies[index].velocity, item.velocity);
  });
  sim.advance(0.1, 1, 0);
  history.capture(sim);
  assert.equal(sim.time, collisionTime);
  assert.equal(sim.bodies.length, 1);
  assert.equal(sim.bodies[0].mass, merged.mass);
  assert.deepEqual(sim.bodies[0].position, merged.position);
  assert.deepEqual(sim.bodies[0].velocity, merged.velocity);
});

test("sparse high-speed moon history reconstructs the saved physical midpoint without crossing Mars", (t) => {
  const sim = new Simulation(solarSystem()),
    history = new History(sim);
  // At 30 days/sec and 60 FPS, one recorded frame spans 43,200 simulated
  // seconds. Phobos travels more than an orbit during this recording gap.
  sim.advance(0.1, 216000, Infinity);
  assert.equal(sim.time, 21600);
  const midpoint = structuredClone(sim.bodies);
  sim.advance(0.1, 216000, Infinity);
  assert.equal(sim.time, 43200);
  history.capture(sim);
  const start = performance.now();
  history.rewind(sim, 21600);
  const replayMs = performance.now() - start;
  assert.equal(sim.time, 21600);
  assert.equal(sim.bodies.length, 26);
  for (let index = 0; index < sim.bodies.length; index++) {
    assert.deepEqual(sim.bodies[index].position, midpoint[index].position);
    assert.deepEqual(sim.bodies[index].velocity, midpoint[index].velocity);
  }
  const phobos = sim.bodies.find((item) => item.id === "phobos"),
    mars = sim.bodies.find((item) => item.id === "mars");
  assert.ok(
    length(sub(phobos.position, mars.position)) > phobos.radius + mars.radius,
  );
  assert.equal(energy(sim.bodies), energy(midpoint));
  sim.advance(0.1, 18000, Infinity);
  history.capture(sim);
  assert.equal(sim.bodies.length, 26);
  assert.equal(sim.events.length, 0);
  t.diagnostic(
    `Canonical 26-body midpoint replay: 384 physical steps in ${replayMs.toFixed(2)} ms; positions and velocities exactly match the saved truth.`,
  );
});

test("bounded reconstruction reports its actual time when the replay step cap is reached", () => {
  const sim = simulation(),
    history = new History(sim);
  sim.time = 1e8;
  sim.bodies[0].position[0] = 1e8;
  history.capture(sim);
  history.rewind(sim, 5e7);
  assert.equal(sim.time, 4096 * 1800);
  assert.equal(sim.bodies[0].position[0], sim.time);
  assert.ok(sim.time < 5e7);
});

test("sustained rewind at the snapshot cap preserves the oldest available past", () => {
  const sim = simulation(),
    history = new History(sim);
  for (let time = 1; time < 900; time++) {
    sim.time = time;
    sim.bodies[0].position[0] = time;
    history.capture(sim);
  }
  assert.equal(history.snapshotCount, 900);
  assert.equal(history.oldestTime, 0);
  for (let frame = 0; frame < 200; frame++) {
    history.rewind(sim, 0.5);
    assert.equal(history.oldestTime, 0);
    assert.ok(history.snapshotCount <= 900);
    assert.equal(sim.bodies[0].position[0], sim.time);
  }
  assert.equal(sim.time, 799);
  assert.deepEqual(history.rewind(sim, 1000), { atStart: true });
  assert.equal(sim.time, 0);
});
