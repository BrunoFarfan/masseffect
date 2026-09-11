import test from "node:test";
import assert from "node:assert/strict";
import {
  initializeRotations,
  advanceRotations,
  synchronize,
  rotateVector,
  conjugate,
  axisAngle,
  IDENTITY,
} from "../src/rotation.js";
import { Camera } from "../src/camera.js";
import { Simulation, step } from "../src/physics.js";
import { History } from "../src/history.js";
import { solarSystem } from "../src/solar.js";
import { add, sub, mul, length, dot, unit } from "../src/math.js";
const near = (a, b, tolerance = 1e-8) =>
  assert.ok(length(sub(a, b)) < tolerance, `${a} != ${b}`);

test("quaternions rotate both camera and texture frames without changing lengths", () => {
  const q = axisAngle([0, 1, 0], Math.PI / 2);
  near(rotateVector(q, [1, 0, 0]), [0, 0, -1]);
  near(rotateVector(conjugate(q), rotateVector(q, [1, 2, 3])), [1, 2, 3]);
});
test("canonical axial spin is SI, tilted and retrograde where expected", () => {
  const sim = new Simulation(solarSystem()),
    earth = sim.bodies.find((b) => b.id === "earth"),
    venus = sim.bodies.find((b) => b.id === "venus");
  assert.equal(earth.rotationPeriod, 86164.1);
  assert.ok(earth.angularVelocity[1] < 0 && venus.angularVelocity[1] > 0);
  const initial = [...earth.orientation];
  advanceRotations([earth], earth.rotationPeriod);
  assert.ok(Math.abs(Math.abs(dot(initial, earth.orientation)) - 1) < 1e-10);
});
test("synchronous orientation keeps local +X pointed at the actual parent", () => {
  const bodies = solarSystem();
  initializeRotations(bodies);
  for (const moon of bodies.filter((b) => b.kind === "Moon")) {
    const parent = bodies.find((b) => b.id === moon.parentId);
    near(
      rotateVector(moon.orientation, [1, 0, 0]),
      unit(sub(parent.position, moon.position)),
    );
  }
});
test("surface frame keeps Earth fixed over a moving, rotating Moon and detaches continuously", () => {
  const earth = {
    id: "earth",
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    radius: 6.371e6,
    mass: 5.97e24,
    kind: "Planet",
  };
  const moon = {
    id: "moon",
    parentId: "earth",
    kind: "Moon",
    position: [3.84e8, 0, 0],
    velocity: [0, 0, 1000],
    radius: 1.737e6,
    mass: 7.34e22,
  };
  initializeRotations([earth, moon]);
  const c = new Camera();
  c.position = add(
    moon.position,
    rotateVector(moon.orientation, mul([0.6, 0.8, 0], moon.radius * 1.01)),
  );
  c.lookAt(earth.position);
  for (let i = 0; i < 240; i++) c.update(1 / 60, [earth, moon], new Set());
  assert.equal(c.surface.id, "moon");
  assert.equal(c.surface.blend, 1);
  const local = rotateVector(
    conjugate(moon.orientation),
    sub(c.position, moon.position),
  );
  for (let i = 1; i <= 600; i++) {
    const angle = i / 600;
    moon.position = [3.84e8 * Math.cos(angle), 0, 3.84e8 * Math.sin(angle)];
    moon.velocity = [-1000 * Math.sin(angle), 0, 1000 * Math.cos(angle)];
    synchronize(moon, earth);
    c.update(1 / 60, [earth, moon], new Set());
  }
  near(
    rotateVector(conjugate(moon.orientation), sub(c.position, moon.position)),
    local,
    0.001,
  );
  const p = c.project(earth.position, 1200, 800);
  assert.ok(Math.abs(p.x - 600) < 0.01 && Math.abs(p.y - 400) < 0.01);
  c.position = add(
    moon.position,
    mul(unit(sub(c.position, moon.position)), moon.radius * 1.8),
  );
  const view = [...c.forward],
    position = [...c.position];
  c.update(1 / 60, [earth, moon], new Set());
  assert.equal(c.surface, null);
  assert.equal(c.followId, null);
  near(c.forward, view);
  near(c.position, position, 0.001);
});
test("nearby moons do not steal surface attachment and thresholds have hysteresis", () => {
  const body = {
    id: "a",
    kind: "Planet",
    radius: 1000,
    position: [0, 0, 0],
    orientation: [...IDENTITY],
  };
  const c = new Camera();
  c.position = [0, 0, 1300];
  c.update(0.016, [body], new Set());
  assert.equal(c.surface.id, "a");
  c.position = [0, 0, 1400];
  c.update(
    0.016,
    [body, { ...body, id: "b", position: [0, 0, 2600] }],
    new Set(),
  );
  assert.equal(c.surface.id, "a");
});
test("history restores axial phase and reconstructs spin using physical elapsed seconds", () => {
  const b = {
    id: "earth",
    name: "Earth",
    kind: "Planet",
    mass: 1e20,
    radius: 1e5,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    trail: [],
  };
  const sim = new Simulation([b]),
    history = new History(sim),
    initial = [...b.orientation];
  step(sim.bodies, 1000);
  sim.time = 1000;
  history.capture(sim);
  const end = [...b.orientation];
  history.seek(sim, 500);
  assert.notDeepEqual(sim.bodies[0].orientation, initial);
  assert.notDeepEqual(sim.bodies[0].orientation, end);
  history.seek(sim, 0);
  near(sim.bodies[0].orientation, initial);
  history.seek(sim, 1000);
  near(sim.bodies[0].orientation, end);
});

test("release is respected near a surface until the observer leaves its capture zone", () => {
  const b = {
    id: "moon",
    kind: "Moon",
    radius: 1000,
    position: [0, 0, 0],
    orientation: [...IDENTITY],
  };
  const c = new Camera();
  c.position = [0, 0, 1100];
  c.update(0.016, [b], new Set());
  assert.equal(c.surface.id, b.id);
  c.release();
  c.update(0.016, [b], new Set());
  assert.equal(c.surface, null);
  c.position = [0, 0, 1800];
  c.update(0.016, [b], new Set());
  c.position = [0, 0, 1100];
  c.update(0.016, [b], new Set());
  assert.equal(c.surface.id, b.id);
});
test("ground clearance is meters, with walkable speed and a continuous boosted departure", () => {
  const b = {
    id: "moon",
    kind: "Moon",
    radius: 1.737e6,
    position: [1.5e11, 0, 0],
    orientation: [...IDENTITY],
  };
  const c = new Camera();
  c.position = add(b.position, [0, b.radius, 0]);
  for (let i = 0; i < 180; i++) c.update(1 / 60, [b], new Set());
  assert.ok(length(sub(c.position, b.position)) - b.radius < 2.01);
  assert.ok(c.speed([b]) > 1 && c.speed([b]) < 5);
  for (let i = 0; i < 480; i++)
    c.update(1 / 60, [b], new Set(["KeyE", "ShiftLeft"]));
  assert.equal(c.surface, null);
  assert.equal(c.followId, null);
  assert.ok(length(sub(c.position, b.position)) > b.radius * 1.7);
});
test("collision rebasing does not jump the camera when its followed ID survives fragmentation", () => {
  const c = new Camera(),
    b = {
      id: "a",
      radius: 1e5,
      position: [0, 0, 0],
      orientation: [...IDENTITY],
    };
  c.position = [0, 0, 1e7];
  c.followId = b.id;
  c.previousTarget = [...b.position];
  const position = [...c.position],
    view = [...c.forward];
  b.position = [1e6, 2e6, 0];
  c.followSurvivors(
    [
      {
        kind: "fragment",
        survivor: "a",
        removed: "b",
        before: [{ id: "a" }, { id: "b" }],
      },
    ],
    [b],
  );
  c.update(0.016, [b], new Set());
  near(c.position, position);
  near(c.forward, view);
});
test("an escaped moon keeps a free spin rather than continuing an artificial tidal lock", () => {
  const bodies = solarSystem();
  initializeRotations(bodies);
  const moon = bodies.find((b) => b.id === "moon"),
    earth = bodies.find((b) => b.id === "earth");
  moon.velocity = add(earth.velocity, [1e5, 0, 0]);
  const omega = [...moon.angularVelocity];
  advanceRotations(bodies, 10);
  assert.equal(moon.rotationModel, "free");
  near(moon.angularVelocity, omega);
});
