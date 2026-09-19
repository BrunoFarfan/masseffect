import test from "node:test";
import assert from "node:assert/strict";
import { Camera } from "../src/camera.js";

test("asynchronous terrain orientation activation and loss do not teleport the camera", () => {
  const body = {
    id: "test",
    position: [1e11, 0, 0],
    radius: 1e6,
    orientation: [0, 0, 0, 1],
    kind: "Moon",
  };
  const camera = new Camera();
  camera.position = [1e11 + 1e6 + 1000, 0, 0];
  camera.update(0, [body], new Set());
  camera.surface.blend = 1;
  const original = [...camera.position];
  camera.terrain = {
    orientation: () => [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    radiusAt: () => body.radius,
  };
  camera.update(0, [body], new Set());
  assert.deepEqual(camera.position, original);
  camera.terrain = null;
  camera.update(0, [body], new Set());
  assert.deepEqual(camera.position, original);
});
