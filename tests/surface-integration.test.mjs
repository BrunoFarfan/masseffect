import test from "node:test";
import assert from "node:assert/strict";
import { Surfaces } from "../src/surfaces.js";
import { Camera } from "../src/camera.js";
import { intersectTerrain } from "../src/surface-ray.js";
import { surfaceFrame } from "../src/surface-definition.js";
import { solarSystem } from "../src/solar.js";
import { sub, length, add, mul } from "../src/math.js";

function fixture(height = -4000) {
  const body = solarSystem().find((b) => b.id === "moon");
  body.position = [0, 0, 0];
  const surfaces = Object.create(Surfaces.prototype);
  surfaces.enabled = true;
  const asset = {
    height: { data: new Float32Array(8).fill(height), width: 4, height: 2 },
  };
  const state = {
    asset,
    previousAsset: null,
    blend: 0,
    frame: surfaceFrame(body, 0),
    referenceRadiusMeters: body.radius,
    minElevationMeters: height,
    maxElevationMeters: height,
    exaggeration: 1,
    displacement: 1,
  };
  surfaces.states = new Map([[body.id, state]]);
  return { body, surfaces, state };
}

test("first cached DEM activation uses current height, while a real LOD transition blends", () => {
  const { surfaces, state } = fixture();
  assert.equal(surfaces.sample(state, [1, 0, 0]), -4000);
  // GPU binding uses state.previousAsset || state.asset: no previous map means
  // current-to-current, not a new zero-to-current transition.
  const previous = state.previousAsset || state.asset;
  assert.equal(
    previous.height.data[0] * (1 - state.blend) +
      state.asset.height.data[0] * state.blend,
    surfaces.sample(state, [1, 0, 0]),
  );
  state.previousAsset = { height: null };
  state.blend = 0.5;
  assert.equal(surfaces.sample(state, [1, 0, 0]), -2000);
});

test("ellipsoid shape and sea level stay independent of terrain exaggeration", () => {
  const { surfaces, state } = fixture();
  state.referenceRadiusMeters = 1000;
  state.baseRadiiMeters = [1100, 900, 1100];
  state.asset.height.data.fill(120);
  state.exaggeration = 3;
  assert.ok(Math.abs(surfaces.sample(state, [1, 0, 0]) - 160) < 1e-9);
  state.asset.height.data.fill(80);
  state.waterSurface = true;
  assert.ok(Math.abs(surfaces.sample(state, [1, 0, 0]) - 100) < 1e-9);
  state.asset.height = null;
  assert.ok(Math.abs(surfaces.sample(state, [0, 1, 0]) + 100) < 1e-9);
});

test("gas giant grazing contacts retain oblate shape even when terrain displacement is zero", () => {
  const { body, surfaces, state } = fixture();
  state.asset.height = null;
  state.baseRadiiMeters = [71492000, 66854000, 71492000];
  state.referenceRadiusMeters = 69911000;
  state.displacement = 0;
  const world = (local) =>
    local.map(
      (_, i) =>
        state.frame.prime[i] * local[0] +
        state.frame.north[i] * local[1] +
        state.frame.east[i] * local[2],
    );
  const hit = surfaces.contact(
    body,
    world([71000000, 0, -100000000]),
    world([0, 0, 200000000]),
    0,
  );
  assert.ok(hit > 0 && hit < 0.5);
  const radial = world([Math.SQRT1_2, Math.SQRT1_2, 0]);
  const camera = new Camera();
  camera.terrain = surfaces;
  camera.position = mul(radial, 70000000);
  const localRadius = surfaces.radiusAt(body, camera.position);
  camera.position = mul(radial, localRadius + 2);
  const before = [...camera.position];
  camera.move(mul(radial, 100), [body]);
  assert.ok(
    length(sub(camera.position, before)) > 99,
    "departure from mid-latitude ground",
  );
  camera.position = before;
  camera.move(world([0, 0, 100]), [body]);
  assert.ok(length(sub(camera.position, before)) > 99, "tangent ground travel");
});

test("terrain-clearance includes negative relief and visual exaggeration without changing physical radius", () => {
  const { body, surfaces, state } = fixture();
  const originalRadius = body.radius;
  const camera = new Camera();
  camera.terrain = surfaces;
  state.exaggeration = 3;
  camera.position = mul(state.frame.prime, body.radius - 13000);
  camera.keepOutside([body]);
  assert.ok(
    Math.abs(length(camera.position) - (body.radius - 12000 + 2)) < 1e-6,
  );
  assert.equal(body.radius, originalRadius);
  surfaces.enabled = false;
  camera.keepOutside([body]);
  assert.ok(Math.abs(length(camera.position) - body.radius - 2) < 1e-6);
});

test("grazing sweep exhaustion cannot report an intersecting path as clear", () => {
  const result = intersectTerrain(
    [1737410, 0, 0],
    [-100, 20000, 0],
    1737400,
    -8000,
    10000,
    () => 0,
    {
      maxDistance: 1,
      tolerance: 0.05,
      slopeBound: 4,
      steps: 128,
      conservative: true,
    },
  );
  assert.ok(result && result.distance >= 0 && result.distance < 0.4);
});

test("terrain contact permits departing and tangent movement from the clearance margin", () => {
  const { body, surfaces, state } = fixture(2000);
  const camera = new Camera();
  camera.terrain = surfaces;
  camera.position = mul(state.frame.prime, body.radius + 2002);
  const before = [...camera.position];
  camera.move(mul(state.frame.prime, 100), [body]);
  assert.ok(length(sub(camera.position, before)) > 99);
  camera.move(mul(state.frame.north, 100), [body]);
  assert.ok(
    length(camera.position) >= surfaces.radiusAt(body, camera.position) + 1.99,
  );
});
