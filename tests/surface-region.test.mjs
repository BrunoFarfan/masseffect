import test from "node:test";
import assert from "node:assert/strict";
import { sampleAssetHeight } from "../src/surface-math.js";
import { Surfaces } from "../src/surfaces.js";

const asset = {
  height: { width: 2, height: 2, data: new Float32Array([0, 0, 0, 0]) },
  region: {
    width: 2,
    height: 2,
    data: new Float32Array([100, 100, 100, 100]),
    uvBounds: [0.45, 0.7, 0.4888888888888889, 0.7777777777777778],
    blendBorder: 0.08,
  },
};

test("regional DEM is bounded, global outside, and smoothly blended at seams", () => {
  assert.equal(sampleAssetHeight(asset, 0.2, 0.74), 0);
  assert.equal(sampleAssetHeight(asset, 0.47, 0.74), 100);
  assert.equal(sampleAssetHeight(asset, 0.45, 0.74), 0);
  assert.ok(sampleAssetHeight(asset, 0.451, 0.74) > 0);
  assert.equal(sampleAssetHeight(asset, 0.46, 0.74), 100);
});

test("regional interpolation and exaggeration remain the same CPU surface path", () => {
  const state = {
    asset,
    previousAsset: null,
    blend: 1,
    exaggeration: 2,
    displacement: 0.5,
    frame: { prime: [1, 0, 0], north: [0, 1, 0], east: [0, 0, 1] },
    referenceRadiusMeters: 10,
  };
  const surfaces = Object.create(Surfaces.prototype);
  surfaces.enabled = true;
  surfaces.states = new Map([["moon", state]]);
  surfaces.manifest = { bodies: { moon: { referenceRadiusMeters: 10 } } };
  const body = { id: "moon", radius: 10, mass: undefined };
  // Regional center is 100 m, then the established exaggeration/displacement
  // path applies it as 100 * 2 * .5 = 100 m.
  const longitude = (0.46944444444444444 * 2 - 1) * Math.PI;
  const latitude = ((0.7388888888888889 * 2 - 1) * -Math.PI) / 2;
  const direction = [
    Math.cos(latitude) * Math.cos(longitude),
    Math.sin(latitude),
    Math.cos(latitude) * Math.sin(longitude),
  ];
  assert.equal(surfaces.sample(state, direction), 100);
  assert.equal(
    state.exaggeration *
      state.displacement *
      sampleAssetHeight(asset, 0.46944444444444444, 0.7388888888888889),
    100,
  );
});

test("disabling measured surfaces removes the orientation provider", () => {
  const surfaces = Object.create(Surfaces.prototype);
  surfaces.enabled = false;
  surfaces.states = new Map();
  assert.equal(surfaces.orientation({ id: "moon" }), null);
});

test("regional pixels are area-centered, not stretched edge-to-edge", () => {
  const map = {
    ...asset,
    region: {
      width: 4,
      height: 2,
      data: new Float32Array([0, 10, 20, 30, 0, 10, 20, 30]),
      uvBounds: [0.2, 0.2, 0.8, 0.8],
      blendBorder: 0.01,
    },
  };
  assert.ok(
    Math.abs(sampleAssetHeight(map, 0.2 + 0.6 * 0.375, 0.5) - 10) < 1e-12,
  );
  assert.ok(
    Math.abs(sampleAssetHeight(map, 0.2 + 0.6 * 0.5, 0.5) - 15) < 1e-12,
  );
});
