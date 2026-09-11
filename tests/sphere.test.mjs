import test from "node:test";
import assert from "node:assert/strict";
import { SphereSurface, sphereRasterBounds } from "../src/sphere.js";
import { Camera } from "../src/camera.js";
import { add, mul, sub, dot } from "../src/math.js";

test("sampled sphere surfaces stay inside analytic bounds off-axis, at poles and with screen offsets", () => {
  const width = 960,
    height = 600,
    focal = height * 0.95;
  for (const [yaw, pitch, cx, cy, depth, radius, offset] of [
    [0, 0, 0, 0, 3, 1, 0],
    [1.2, 0.7, 4, -2, 9, 1.5, 150],
    [-2, -0.9, -4, 3, 7, 2, -170],
    [0.3, Math.PI / 2 - 1e-6, 1, -1, 4, 1, 110],
    [-0.7, -Math.PI / 2 + 1e-6, -1, 1, 4, 1, -110],
    [0, 0, 2, 0, 1.00001, 1, 0],
  ]) {
    const camera = new Camera();
    camera.position = [0, 0, 0];
    camera.yaw = yaw;
    camera.pitch = pitch;
    const center = add(
      add(mul(camera.right, cx), mul(camera.up, cy)),
      mul(camera.forward, depth),
    );
    const bounds = sphereRasterBounds(
      dot(center, camera.right),
      dot(center, camera.up),
      dot(center, camera.forward),
      radius,
      width,
      height,
      focal,
      offset,
    );
    for (let latitude = -90; latitude <= 90; latitude += 5) {
      for (let longitude = 0; longitude < 360; longitude += 5) {
        const lat = (latitude * Math.PI) / 180,
          lon = (longitude * Math.PI) / 180;
        const point = add(
          center,
          mul(
            [
              Math.cos(lat) * Math.cos(lon),
              Math.sin(lat),
              Math.cos(lat) * Math.sin(lon),
            ],
            radius,
          ),
        );
        const delta = sub(point, camera.position),
          z = dot(delta, camera.forward);
        if (z <= 0) continue;
        const x = width / 2 + offset + (focal * dot(delta, camera.right)) / z;
        const y = height / 2 - (focal * dot(delta, camera.up)) / z;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        assert.ok(
          x >= bounds.left &&
            x < bounds.right &&
            y >= bounds.top &&
            y < bounds.bottom,
        );
      }
    }
  }
});

test("bounds retain every ray hit and antialiased edge pixel from the original full raster", () => {
  const width = 160,
    height = 100,
    focal = height * 0.95;
  const cases = [
    [0, 0, 3, 1, 0],
    [3, -1, 6, 1.5, 20],
    [-4, 2, 6, 2, -20],
    [0, 0, 1.00001, 1, 40],
    [3, 0, 1.01, 1, -50],
    [0, 0, 0.9, 1, 0],
    [0, 2, 1, 1, 30],
    [100, 0, 4, 1, 0],
  ].flatMap((values) => [
    values,
    values.map((value, index) => (index < 4 ? value * 1e6 : value)),
  ]);
  for (const [cx, cy, depth, radius, offset] of cases) {
    const bounds = sphereRasterBounds(
      cx,
      cy,
      depth,
      radius,
      width,
      height,
      focal,
      offset,
    );
    const C = cx * cx + cy * cy + depth * depth - radius * radius;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const sx = (x + 0.5 - width / 2 - offset) / focal,
          sy = -(y + 0.5 - height / 2) / focal;
        const A = 1 + sx * sx + sy * sy,
          B = depth + cx * sx + cy * sy,
          D = B * B - A * C;
        const gradient =
          (2 * Math.hypot(B * cx - C * sx, B * cy - C * sy)) / focal;
        const coverage = Math.max(
          0,
          Math.min(1, 0.5 + D / Math.max(gradient, 1)),
        );
        const t = C / (B + Math.sqrt(Math.max(0, D)));
        if (coverage === 0 || B <= 0 || t < 0) continue;
        assert.ok(
          x >= bounds.left &&
            x < bounds.right &&
            y >= bounds.top &&
            y < bounds.bottom,
          `Lost pixel ${x},${y} for ${JSON.stringify([cx, cy, depth, radius, offset])}`,
        );
      }
  }
});

test("camera-plane crossings retain full coverage and bounded raster pixel counts shrink", (t) => {
  for (const depth of [-2, 0, 1])
    assert.deepEqual(sphereRasterBounds(4, 2, depth, 1, 960, 600, 570, 150), {
      left: 0,
      right: 960,
      top: 0,
      bottom: 600,
    });
  const close = sphereRasterBounds(0, 0, 3e6, 1e6, 960, 600, 570),
    distant = sphereRasterBounds(0, 0, 1e7, 1e6, 960, 600, 570);
  const area = (bounds) =>
    (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
  assert.ok(area(close) < 960 * 600 * 0.3);
  assert.ok(area(distant) < 960 * 600 * 0.03);
  t.diagnostic(
    `Analytic candidates at 960x600: three radii ${area(close)} pixels (${((100 * area(close)) / (960 * 600)).toFixed(1)}% of full raster); ten radii ${area(distant)} (${((100 * area(distant)) / (960 * 600)).toFixed(1)}%). Pixel counts only, not a frame-time benchmark.`,
  );
});

test("moving a bounded sphere offscreen clears old pixel alpha everywhere", () => {
  const savedDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (width, height) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData() {},
      }),
    }),
  };
  try {
    const surface = new SphereSurface(),
      ctx = { drawImage() {} };
    const camera = {
      position: [0, 0, 0],
      forward: [0, 0, 1],
      right: [1, 0, 0],
      up: [0, 1, 0],
      screenOffsetX: 12,
    };
    const body = {
      position: [0, 0, 3],
      radius: 1,
      color: "#c2d4df",
      kind: "Planet",
    };
    surface.draw(ctx, body, camera, 160, 100, null);
    assert.ok(
      surface.pixels.data.some((value, index) => index % 4 === 3 && value > 0),
    );
    body.position = [100, 0, 3];
    surface.draw(ctx, body, camera, 160, 100, null);
    assert.ok(
      surface.pixels.data.every(
        (value, index) => index % 4 !== 3 || value === 0,
      ),
    );
  } finally {
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
  }
});
