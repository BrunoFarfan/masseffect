import test from "node:test";
import assert from "node:assert/strict";
import { projectSaturnRings, drawRingFaces } from "../src/rings.js";
import { Camera } from "../src/camera.js";
import { axisAngle, IDENTITY } from "../src/rotation.js";
const body = {
  id: "saturn",
  kind: "Planet",
  radius: 5.8232e7,
  position: [0, 0, 0],
  orientation: IDENTITY,
};
const faces = (r) => [...r.back, ...r.front].flatMap((b) => b.faces);
const area = (r) =>
  faces(r).reduce(
    (sum, p) =>
      sum +
      Math.abs(
        p.reduce((s, a, i) => {
          const b = p[(i + 1) % p.length];
          return s + a[0] * b[1] - a[1] * b[0];
        }, 0),
      ) /
        2,
    0,
  );
function view(position) {
  const camera = new Camera();
  camera.position = position;
  camera.lookAt(body.position);
  return camera;
}

test("Saturn's real equatorial annuli change from face-on to edge-on with the camera", () => {
  const face = projectSaturnRings(body, view([0, 5e8, 0]), 1000, 700),
    edge = projectSaturnRings(body, view([0, 0, 5e8]), 1000, 700);
  assert.ok(area(face) > 50000);
  assert.ok(area(edge) < area(face) * 1e-8);
  // Exactly face-on vertices lie on the depth split: do not draw them twice.
  assert.equal(face.back.flatMap((b) => b.faces).length, 0);
  assert.equal(face.front.length, 3);
});
test("ring projection follows body orientation, preserves the central hole and Cassini division", () => {
  const camera = view([0, 5e8, 0]),
    rings = projectSaturnRings(body, camera, 1000, 700),
    focal = 700 * 0.95;
  for (const band of rings.front) {
    const radii = band.faces
      .flat()
      .map((p) => Math.hypot(p[0] - 500, p[1] - 350));
    assert.ok(Math.min(...radii) > (body.radius * focal) / 5e8);
  }
  const outerB = Math.max(
    ...rings.front[1].faces
      .flat()
      .map((p) => Math.hypot(p[0] - 500, p[1] - 350)),
  );
  const innerA = Math.min(
    ...rings.front[2].faces
      .flat()
      .map((p) => Math.hypot(p[0] - 500, p[1] - 350)),
  );
  assert.ok(innerA - outerB > 5);
  const tilted = { ...body, orientation: axisAngle([1, 0, 0], Math.PI / 2) };
  assert.ok(area(projectSaturnRings(tilted, camera, 1000, 700)) < 1e-5);
});
test("near-plane and off-axis ring crossings produce only finite viewport-clipped polygons", () => {
  for (const position of [
    [0, 6e7, 0],
    [0, 0, 6e7],
    [1e8, 1e3, 0],
    [0, 1, 1.3e8],
    [0, -8e7, 0],
  ]) {
    const camera = view(position);
    camera.rotate(0.9, 80);
    camera.screenOffsetX = -180;
    const r = projectSaturnRings(body, camera, 1000, 700);
    for (const p of faces(r).flat()) {
      assert.ok(p.every(Number.isFinite));
      assert.ok(
        p[0] >= -1e-4 &&
          p[0] <= 1000 + 1e-4 &&
          p[1] >= -1e-4 &&
          p[1] <= 700 + 1e-4,
        JSON.stringify(p),
      );
    }
  }
});
test("ring material stays purely visual and preserves drawing alpha", () => {
  const original = structuredClone(body),
    camera = view([0, 3e8, 5e8]),
    r = projectSaturnRings(body, camera, 1000, 700);
  const ctx = {
    globalAlpha: 0.6,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
  };
  drawRingFaces(ctx, r.back);
  drawRingFaces(ctx, r.front);
  assert.equal(ctx.globalAlpha, 0.6);
  assert.deepEqual(body, original);
  assert.equal(
    faces(projectSaturnRings({ ...body, kind: "Star" }, camera, 1000, 700))
      .length,
    0,
  );
  assert.equal(
    faces(projectSaturnRings(body, view([0, 0, 1e13]), 1000, 700)).length,
    0,
  );
});
