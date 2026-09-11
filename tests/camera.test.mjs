import test from "node:test";
import assert from "node:assert/strict";
import { Camera } from "../src/camera.js";
import { length, sub } from "../src/math.js";

function camera() {
  const c = new Camera();
  c.position = [0, 0, 0];
  c.yaw = c.pitch = 0;
  c.speed = () => 100;
  return c;
}
function advance(c, seconds, keys, fps = 60, bodies = []) {
  for (let i = 0; i < Math.round(seconds * fps); i++)
    c.update(1 / fps, bodies, new Set(keys));
}

test("all four WASD diagonals move on both axes without a speed bonus", () => {
  const straight = camera();
  advance(straight, 1, ["KeyW"]);
  for (const forward of ["KeyW", "KeyS"])
    for (const sideways of ["KeyA", "KeyD"]) {
      const c = camera();
      advance(c, 1, [forward, sideways]);
      assert.equal(Math.sign(c.position[0]), sideways === "KeyA" ? -1 : 1);
      assert.equal(Math.sign(c.position[2]), forward === "KeyW" ? -1 : 1);
      assert.ok(
        Math.abs(length(c.position) - length(straight.position)) < 1e-9,
      );
    }
});

test("releasing one diagonal key preserves the remaining direction", () => {
  const c = camera();
  advance(c, 1, ["KeyW", "KeyD"]);
  advance(c, 1, ["KeyW"]);
  assert.ok(Math.abs(c.motion[0]) < 0.0001);
  assert.ok(c.motion[2] < -0.999);
  const before = [...c.position];
  advance(c, 0.1, ["KeyW"]);
  assert.ok(c.position[2] < before[2] - 9);
});

test("three-axis movement is normalized; opposing keys cancel; either Shift boosts", () => {
  const c = camera();
  advance(c, 1, ["KeyW", "KeyD", "KeyE"]);
  assert.ok(c.position[0] > 0 && c.position[1] > 0 && c.position[2] < 0);
  assert.ok(length(c.motion) <= 1);
  for (const shift of ["ShiftLeft", "ShiftRight"]) {
    const boosted = camera();
    advance(boosted, 1, ["KeyW", "KeyD", "KeyE", shift]);
    assert.ok(
      Math.abs(length(boosted.position) / length(c.position) - 4) < 1e-10,
    );
  }
  const still = camera();
  advance(still, 1, ["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE"]);
  assert.deepEqual(still.position, [0, 0, 0]);
});

test("acceleration and braking are smooth and settle promptly", () => {
  const c = camera();
  c.update(1 / 60, [], new Set(["KeyW"]));
  assert.ok(length(c.position) > 0 && length(c.position) < 0.2);
  advance(c, 0.5, ["KeyW"]);
  const speed = length(c.motion);
  c.update(1 / 60, [], new Set());
  assert.ok(length(c.motion) > 0 && length(c.motion) < speed);
  advance(c, 0.5, []);
  assert.ok(length(c.motion) < 0.001);
});

test("movement easing and wheel travel agree at 30, 60 and 120 fps", () => {
  const results = [30, 60, 120].map((fps) => {
    const c = camera();
    c.travel(0.4);
    advance(c, 1, ["KeyW", "KeyD"], fps);
    advance(c, 0.5, [], fps);
    return c.position;
  });
  for (const result of results.slice(1))
    assert.ok(length(sub(result, results[0])) < 0.00001);
});

test("wheel input eases through frames, is bounded and is cancelled by stop/focus/home", () => {
  const c = camera();
  c.travel(0.5);
  assert.deepEqual(c.position, [0, 0, 0]);
  c.update(1 / 60, [], new Set());
  assert.ok(c.position[2] < 0 && c.position[2] > -50);
  for (let i = 0; i < 100; i++) c.travel(0.5);
  assert.equal(c.wheelMotion, 6);
  c.stop();
  const before = [...c.position];
  advance(c, 1, []);
  assert.deepEqual(c.position, before);
  c.travel(0.5);
  c.focus({ id: "test", radius: 1, position: [0, 0, 0] });
  assert.equal(c.wheelMotion, 0);
  c.travel(0.5);
  c.home();
  assert.equal(c.wheelMotion, 0);
});

test("surface contact retains diagonal and vertical travel without penetrating", () => {
  const b = { radius: 100, position: [0, 0, 0] };
  for (const sideways of ["KeyA", "KeyD", "KeyQ", "KeyE"]) {
    const c = camera();
    c.position = [0, 0, 101.01];
    advance(c, 1, ["KeyW", sideways], 60, [b]);
    assert.ok(length(c.position) >= 101 - 1e-10);
    assert.ok(Math.hypot(c.position[0], c.position[1]) > 30);
  }
});

test("surface sweeps block tunneling and keep finite state after large diagonal moves", () => {
  const c = camera(),
    bodies = [{ radius: 6e6, position: [0, 0, 0] }];
  c.position = [0, 0, 2e7];
  c.move([0, 0, -4e7], bodies);
  assert.ok(c.position[2] >= 6000600);
  c.move([2e7, 1e7, -4e7], bodies);
  assert.ok(c.position.every(Number.isFinite));
  assert.ok(length(c.position) >= 6000600);
  assert.ok(c.position[0] > 1e7);
});
