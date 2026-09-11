import test from "node:test";
import assert from "node:assert/strict";
import {
  G,
  accelerations,
  step,
  energy,
  mergeCollisions,
  Simulation,
  safeStep,
  recordTrails,
} from "../src/physics.js";
import { solarSystem } from "../src/solar.js";
import { Camera } from "../src/camera.js";
import { dot, length, sub } from "../src/math.js";

test("Earth at one orbit retains radius and energy with SI gravity", () => {
  const r = 1.495978707e11,
    m = 1.98847e30,
    dt = 1800;
  const bodies = [
    {
      id: "sun",
      name: "Sun",
      mass: m,
      radius: 6.957e8,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      trail: [],
    },
    {
      id: "earth",
      name: "Earth",
      mass: 5.97217e24,
      radius: 6.371e6,
      position: [r, 0, 0],
      velocity: [0, 0, Math.sqrt((G * m) / r)],
      trail: [],
    },
  ];
  const a = accelerations(bodies);
  assert.ok(Math.abs(a[1][0] + 0.00593026) < 1e-6);
  const initial = energy(bodies),
    period = 2 * Math.PI * Math.sqrt(r ** 3 / (G * m));
  for (let t = 0; t < period; t += dt) step(bodies, dt);
  assert.ok(Math.abs((energy(bodies) - initial) / initial) < 1e-8);
  assert.ok(
    Math.abs(length(sub(bodies[1].position, bodies[0].position)) / r - 1) <
      1e-4,
  );
  assert.ok(
    length(sub(sub(bodies[1].position, bodies[0].position), [r, 0, 0])) / r <
      0.001,
  );
});
test("3D forces conserve pair momentum", () => {
  const bodies = [
    { mass: 8e20, position: [1e7, -3e8, 2e8] },
    { mass: 2e21, position: [-2e7, 1e8, -4e8] },
  ];
  const a = accelerations(bodies);
  for (let k = 0; k < 3; k++)
    assert.ok(
      Math.abs(
        (a[0][k] * bodies[0].mass + a[1][k] * bodies[1].mass) /
          (a[0][k] * bodies[0].mass),
      ) < 1e-14,
    );
});
test("collisions conserve mass, momentum, volume and center of mass", () => {
  const bodies = [
    {
      id: "a",
      name: "A",
      mass: 2,
      radius: 2,
      position: [0, 0, 0],
      velocity: [3, 2, -1],
      trail: [],
    },
    {
      id: "b",
      name: "B",
      mass: 1,
      radius: 1,
      position: [1, 0, 0],
      velocity: [0, -1, 2],
      trail: [],
    },
  ];
  assert.equal(mergeCollisions(bodies).length, 1);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].mass, 3);
  assert.deepEqual(bodies[0].velocity, [2, 1, 0]);
  assert.equal(bodies[0].position[0], 1 / 3);
  assert.ok(Math.abs(bodies[0].radius ** 3 - 9) < 1e-12);
});
test("canonical system stays finite with bounded energy error for ten years", () => {
  const bodies = solarSystem().filter((b) => b.kind !== "Moon"),
    initial = energy(bodies);
  for (let t = 0; t < 315576000; t += 1800) step(bodies, 1800);
  assert.equal(bodies.length, 9);
  assert.ok(Math.abs((energy(bodies) - initial) / initial) < 1e-5);
  for (const b of bodies)
    assert.ok([...b.position, ...b.velocity].every(Number.isFinite));
});
test("camera has orthonormal basis, correct right movement and stable poles", () => {
  const c = new Camera();
  assert.ok(c.project([0, 0, 0], 1000, 700));
  assert.ok(Math.abs(dot(c.forward, c.right)) < 1e-12);
  assert.ok(Math.abs(dot(c.forward, c.up)) < 1e-12);
  c.rotate(100, 1e6);
  assert.ok([...c.forward, ...c.right, ...c.up].every(Number.isFinite));
  assert.ok(Math.abs(length(c.up) - 1) < 1e-12);
  c.position = [0, 0, 1e10];
  c.yaw = 0;
  c.pitch = 0;
  assert.ok(c.project([1e8, 0, 0], 1000, 700).x > 500);
  assert.equal(c.project([0, 0, 2e10], 1000, 700), null);
});
test("camera cannot tunnel through or remain inside a physical sphere", () => {
  const c = new Camera(),
    b = { radius: 6e6, position: [0, 0, 0] };
  c.position = [0, 0, 2e7];
  c.move([0, 0, -4e7], [b]);
  assert.ok(c.position[2] > b.radius);
  c.position = [0, 0, 0];
  c.keepOutside([b]);
  assert.ok(length(c.position) > b.radius);
  assert.ok(
    c.project([0, 0, 0], 1440, 900) === null ||
      Number.isFinite(c.project([0, 0, 0], 1440, 900).x),
  );
});
test("frame budget caps debt while keeping the integrator timestep independent", () => {
  const sim = new Simulation(solarSystem());
  const expected = safeStep(sim.bodies);
  sim.advance(0.1, 31557600, 0);
  assert.equal(sim.time, expected);
  assert.ok(sim.pending <= 1800);
  assert.equal(sim.limited, true);
});

test("swept contact catches a fast small body passing entirely through another", () => {
  const bodies = [
    {
      id: "a",
      name: "A",
      mass: 1e10,
      radius: 1,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      trail: [],
    },
    {
      id: "b",
      name: "B",
      mass: 1e10,
      radius: 1,
      position: [1000, 0, 0],
      velocity: [-1e7, 0, 0],
      trail: [],
    },
  ];
  const events = step(bodies, safeStep(bodies));
  assert.equal(events.length, 1);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].mass, 2e10);
  assert.ok(Math.abs(bodies[0].velocity[0] + 5e6) < 1);
});
test("contact converges without infinitely shrinking gap-based steps", () => {
  const bodies = [
    {
      id: "a",
      name: "A",
      mass: 1e10,
      radius: 100,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      trail: [],
    },
    {
      id: "b",
      name: "B",
      mass: 1e10,
      radius: 100,
      position: [201, 0, 0],
      velocity: [-1, 0, 0],
      trail: [],
    },
  ];
  let time = 0;
  for (let n = 0; n < 100 && bodies.length > 1; n++) {
    const dt = safeStep(bodies);
    time += dt;
    step(bodies, dt);
  }
  assert.equal(bodies.length, 1);
  assert.ok(time < 30);
});
test("a fast near miss is not merged", () => {
  const bodies = [
    {
      id: "a",
      name: "A",
      mass: 1,
      radius: 1,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      trail: [],
    },
    {
      id: "b",
      name: "B",
      mass: 1,
      radius: 1,
      position: [1000, 3, 0],
      velocity: [-1e7, 0, 0],
      trail: [],
    },
  ];
  step(bodies, 0.01);
  assert.equal(bodies.length, 2);
});

test("camera locator provides recovery behind the camera and hides on a visible target", () => {
  const camera = new Camera();
  camera.position = [0, 0, 1e10];
  camera.yaw = 0;
  camera.pitch = 0;
  assert.equal(camera.locator([0, 0, 0], 1440, 900), null);
  const marker = camera.locator([0, 0, 2e10], 1440, 900);
  assert.equal(marker.behind, true);
  assert.ok(Number.isFinite(marker.x) && Number.isFinite(marker.y));
  camera.focus({ id: "earth", radius: 6.371e6, position: [0, 0, 0] });
  camera.release();
  assert.equal(camera.followId, null);
  assert.equal(camera.transition, null);
});
test("trail cadence follows orbital timescale and memory remains bounded", () => {
  const bodies = solarSystem(),
    earth = bodies.find((b) => b.id === "earth"),
    neptune = bodies.find((b) => b.id === "neptune");
  assert.ok(neptune.trailInterval / earth.trailInterval > 160);
  for (let i = 1; i <= 650; i++)
    recordTrails(bodies, i * neptune.trailInterval * 1.001);
  for (const body of bodies) assert.ok(body.trail.length <= 600);
  assert.equal(neptune.trail.length, 600);
  assert.deepEqual(neptune.trail.at(-1), neptune.position);
  assert.notEqual(neptune.trail.at(-1), neptune.position);
});
test("camera follows the final survivor of chained same-step mergers", () => {
  const bodies = [1, 2, 4].map((mass, id) => ({
    id: String(id),
    name: String(id),
    mass,
    radius: 2,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    trail: [],
  }));
  const camera = new Camera();
  camera.focus(bodies[0]);
  const events = mergeCollisions(bodies);
  assert.equal(events.length, 2);
  camera.followSurvivors(events, bodies);
  assert.equal(camera.followId, "2");
  camera.update(0.1, bodies, new Set());
  assert.ok(camera.position.every(Number.isFinite));
});
