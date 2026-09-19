import test from "node:test";
import assert from "node:assert/strict";
import { Camera } from "../src/camera.js";
import { surfaceFrame, SURFACE_DEFINITIONS } from "../src/surface-definition.js";
import { landmarkDirection } from "../src/landmarks.js";
import { between } from "../src/rotation.js";
import { add, mul, dot, sub } from "../src/math.js";

// A frame can match SPICE perfectly yet produce mirrored geography if the
// camera ignores the world basis reflection. Test the final screen convention:
// looking down on longitude zero with north up, east MUST appear to the right.
test("all canonical surface frames project east right and north up", () => {
  for (const id of Object.keys(SURFACE_DEFINITIONS)) {
    for (const time of [0, 86400 * 365.25]) {
      const frame = surfaceFrame(id, time), camera = new Camera();
      camera.position = mul(frame.prime, 3);
      camera.frameRotation = between([0, 1, 0], frame.north);
      camera.lookAt([0, 0, 0]);
      const point = (latitude, longitude) => camera.project(
        landmarkDirection(frame, { latitude, longitude }), 1000, 800,
      );
      assert.ok(point(0, 20).x > point(0, 0).x, `${id}: east must be right`);
      assert.ok(point(0, -20).x < point(0, 0).x, `${id}: west must be left`);
      assert.ok(point(20, 0).y < point(0, 0).y, `${id}: north must be up`);
      // The same basis drives GPU rays and CPU picking/labels.
      const projected = point(12, 17), focal = 800 * 0.95;
      const ray = add(camera.forward, add(
        mul(camera.right, (projected.x - 500) / focal),
        mul(camera.up, (400 - projected.y) / focal),
      ));
      const target = landmarkDirection(frame, { latitude: 12, longitude: 17 });
      const delta = sub(target, camera.position);
      const scale = dot(delta, camera.forward);
      const recovered = add(camera.position, mul(ray, scale));
      recovered.forEach((v, i) => assert.ok(Math.abs(v - target[i]) < 1e-12));
    }
  }
});

test("mouse look and lateral travel remain screen-relative after parity correction", () => {
  const camera = new Camera();
  camera.position = [0, 0, 0];
  camera.yaw = camera.pitch = 0;
  const right = camera.right, up = camera.up;
  camera.rotate(20, 10);
  assert.ok(dot(camera.forward, right) > 0, "positive mouse X looks right");
  assert.ok(dot(camera.forward, up) > 0, "positive look Y looks up");
  camera.speed = () => 1;
  const before = [...camera.position], viewRight = camera.right;
  camera.update(0.1, [], new Set(["KeyD"]));
  assert.ok(dot(sub(camera.position, before), viewRight) > 0);
});
