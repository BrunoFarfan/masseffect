import test from "node:test";
import assert from "node:assert/strict";
import { Camera } from "../src/camera.js";

test("surface LOD can be measured after accelerated follow translation without double movement", () => {
  const camera = new Camera();
  const body = {
    id: "deimos",
    position: [0, 0, 0],
    radius: 6200,
    orientation: [0, 0, 0, 1],
  };
  camera.position = [0, 0, body.radius * 3];
  camera.followId = body.id;
  camera.previousTarget = [0, 0, 0];
  // A large orbital translation must not masquerade as camera altitude.
  body.position = [32000000, -5000000, 11000000];
  camera.followTranslation([body]);
  const measuredDistance = Math.hypot(
    ...camera.position.map((v, i) => v - body.position[i]),
  );
  assert.equal(measuredDistance, body.radius * 3);
  const before = [...camera.position];
  camera.update(0, [body], new Set());
  assert.deepEqual(camera.position, before);
});
