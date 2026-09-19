import test from "node:test";
import assert from "node:assert/strict";
import {
  landmarkDirection,
  landmarkPoint,
  landmarkVisibility,
  SURFACE_LANDMARKS,
  terrainOccluded,
} from "../src/landmarks.js";

const frame = { prime: [1, 0, 0], north: [0, 1, 0], east: [0, 0, 1] };
const body = { id: "moon", radius: 1000, position: [10, 20, 30] };
const state = {
  frame,
  referenceRadiusMeters: 1000,
  exaggeration: 1,
  displacement: 1,
  minElevationMeters: -100,
  maxElevationMeters: 100,
  asset: { height: { width: 4, height: 2 } },
  sample: () => 120,
};

test("landmark direction rotates with the body-fixed frame and includes measured height", () => {
  const site = SURFACE_LANDMARKS.moon[0];
  const direction = landmarkDirection(frame, site);
  const point = landmarkPoint(body, state, site);
  assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-12);
  assert.deepEqual(
    point.position.map((v, i) => Math.round(v - body.position[i])),
    direction.map((v) => Math.round(v * 1170)),
  );
  const rotated = { prime: [0, 0, 1], north: [0, 1, 0], east: [-1, 0, 0] };
  assert.notDeepEqual(landmarkDirection(rotated, site), direction);
});

test("landmark visibility rejects far side, distance, and terrain ridge", () => {
  const site = SURFACE_LANDMARKS.moon[1];
  const point = landmarkPoint(body, state, site);
  const project = () => ({ x: 500, y: 500, z: 10 });
  const camera = point.position.map((v, i) => v + point.direction[i] * 1000);
  const visible = landmarkVisibility(camera, body, state, point, {
    width: 1000,
    height: 1000,
    project,
  });
  assert.equal(visible.visible, true);
  assert.equal(
    landmarkVisibility(
      body.position.map((v, i) => v - point.direction[i] * 2000),
      body,
      state,
      point,
      { width: 1000, height: 1000, project },
    ).reason,
    "hemisphere",
  );
  assert.equal(
    landmarkVisibility(
      body.position.map((v, i) => v + point.direction[i] * 10000),
      body,
      state,
      point,
      { width: 1000, height: 1000, project },
    ).reason,
    "far",
  );
  const occludedState = {
    ...state,
    sample: () => 5000,
    maxElevationMeters: 5000,
  };
  assert.equal(terrainOccluded(camera, body, occludedState, point), true);
});

test("visibility alpha fades at the five-radius scope", () => {
  const site = SURFACE_LANDMARKS.mars[0];
  const mars = { ...body, radius: 1000 };
  const p = landmarkPoint(mars, state, site);
  const camera = p.position.map((v, i) => v + p.direction[i] * 3500);
  const result = landmarkVisibility(camera, mars, state, p, {
    width: 1000,
    height: 1000,
    project: () => ({ x: 100, y: 100, z: 1 }),
  });
  assert.equal(result.visible, true);
  assert.ok(result.alpha > 0 && result.alpha < 1);
});
