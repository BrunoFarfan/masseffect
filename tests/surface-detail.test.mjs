import test from "node:test";
import assert from "node:assert/strict";
import {
  projectDetail,
  detailVector,
  localVectorFromLatLon,
  latLonFromLocalVector,
  sampleAssetHeight,
  stabilizeGlobalPoles,
  detailTexel,
} from "../src/surface-math.js";
import { buildDetailAtlas } from "../src/terrain-gpu.js";
import { SurfaceAssetCache } from "../src/surface-assets.js";

const polar = { projection: "polar-stereographic", pole: 1, capLatitude: 70 };
const flat = (value, extra = {}) => ({
  data: new Float32Array(4).fill(value),
  width: 2,
  height: 2,
  uvBounds: [0, 0, 1, 1],
  blendBorder: 0.02,
  ...extra,
});

test("stereographic registration has exact pole, cap radius, and inverse for both poles", () => {
  for (const pole of [1, -1]) {
    const descriptor = { ...polar, pole };
    const center = projectDetail([0, pole, 0], descriptor);
    assert.deepEqual(center, { u: 0.5, v: 0.5 });
    assert.equal(projectDetail([0, -pole, 0], descriptor), null);
    for (const longitude of [-180, -90, 0, 45, 90, 179.99])
      for (const latitude of [70, 85, 89.999999]) {
        const vector = localVectorFromLatLon(pole * latitude, longitude);
        const uv = projectDetail(vector, descriptor);
        if (latitude === 70)
          assert.ok(Math.abs(Math.hypot(uv.u - 0.5, uv.v - 0.5) - 0.5) < 1e-12);
        const roundtrip = detailVector(uv.u, uv.v, descriptor);
        assert.ok(
          Math.hypot(...roundtrip.map((v, i) => v - vector[i])) < 1e-12,
        );
      }
  }
});

test("latitude preserves submeter angular offsets near the poles", () => {
  const vector = [1e-10, 1, 0];
  const latitude = latLonFromLocalVector(vector).latitude;
  assert.ok(latitude < 90);
  assert.ok(Math.abs(latitude - (90 - (1e-10 * 180) / Math.PI)) < 1e-12);
});

test("polar height is longitude independent at the pole and continuous on every approach", () => {
  const layer = flat(100, { ...polar });
  const asset = { height: flat(0), detailTiles: [{ region: layer }] };
  for (const longitude of [-179, -90, 0, 90, 179]) {
    assert.equal(sampleAssetHeight(asset, longitude / 360 + 0.5, 0), 100);
    assert.equal(sampleAssetHeight(asset, longitude / 360 + 0.5, 1e-9), 100);
  }
  assert.equal(sampleAssetHeight(asset, 0.5, 1), 0);
  assert.equal(sampleAssetHeight(asset, 0.5, 0.5 - 69 / 180), 0);
});

test("resident neighbors interpolate across tile seams without a global stripe", () => {
  const west = flat(100, { uvBounds: [0, 0.25, 0.5, 0.75] });
  const east = flat(300, { uvBounds: [0.5, 0.25, 1, 0.75] });
  const asset = {
    height: flat(0),
    detailTiles: [{ region: west }, { region: east }],
  };
  assert.equal(sampleAssetHeight(asset, 0.5, 0.5), 200);
  assert.ok(
    Math.abs(
      sampleAssetHeight(asset, 0.5 - 1e-8, 0.5) -
        sampleAssetHeight(asset, 0.5 + 1e-8, 0.5),
    ) < 0.001,
  );
  assert.equal(sampleAssetHeight(asset, 0, 0.5), 200);
  assert.deepEqual(detailTexel([west, east], west, 2, 0), [300]);
  const atlas = buildDetailAtlas(asset);
  const cell = atlas.cells;
  assert.equal(atlas.data[cell[1] * atlas.width + cell[0] + west.width], 300);
  // Runtime uploads have metadata and per-tile staging only, with no retained atlas copy.
  const metadata = buildDetailAtlas(asset, "region", true);
  assert.equal(metadata.data, null);
  assert.equal(metadata.count, 2);
});

test("fallback global rows collapse to one longitude independent pole value", () => {
  const height = {
    data: new Float32Array([
      0, 100, 200, 300, 4, 8, 12, 16, 400, 500, 600, 700,
    ]),
    width: 4,
    height: 3,
  };
  stabilizeGlobalPoles(height);
  for (const u of [0, 0.1, 0.5, 0.9, 1]) {
    assert.equal(sampleAssetHeight({ height }, u, 0), 150);
    assert.equal(sampleAssetHeight({ height }, u, 1), 550);
  }
  assert.deepEqual([...height.data.slice(4, 8)], [4, 8, 12, 16]);
});

test("detail cache bounds footprint requests, preserves fallback, and retains projection metadata", async () => {
  const tiles = [];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++)
      tiles.push({
        ...polar,
        id: `north-${row}-${col}`,
        heightUrl: `${row}-${col}.bin`,
        width: 2,
        height: 2,
        uvBounds: [col / 4, row / 4, (col + 1) / 4, (row + 1) / 4],
        heightScaleMeters: 1,
      });
  const levels = Object.fromEntries(
    ["preview", "medium", "near"].map((level) => [
      level,
      { color: `${level}.jpg`, width: 2, height: 2, heightUrl: `${level}.bin` },
    ]),
  );
  levels.near.detailTiles = tiles;
  const manifest = {
    schemaVersion: 1,
    bodies: { moon: { referenceRadiusMeters: 100, levels } },
  };
  const cache = new SurfaceAssetCache({
    manifest,
    maxConcurrent: 2,
    budgetBytes: 4096,
    loadImage: async () => ({
      data: new Uint8Array(16),
      width: 2,
      height: 2,
      bytes: 16,
    }),
    loadHeight: async () => ({
      data: new Float32Array(4).fill(100),
      width: 2,
      height: 2,
      bytes: 16,
    }),
  });
  const body = { id: "moon", radius: 100 };
  const initial = cache.get(body, 300, 0, { u: 0.5, v: 0 }, 0.99);
  assert.equal(initial.entry, null);
  assert.ok(
    cache.queue.filter((item) => item.regionId !== "global").length <= 12,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const loaded = cache.get(body, 300, 1, { u: 0.5, v: 0 }, 0.99);
  assert.ok(loaded.color);
  assert.ok(loaded.detailTiles.length > 1 && loaded.detailTiles.length <= 12);
  assert.equal(loaded.detailTiles[0].region.projection, "polar-stereographic");
  assert.ok(cache.stats().usedBytes <= cache.stats().budgetBytes);
  const same = cache.get(body, 300, 2, { u: 0.5, v: 0 }, 0.99);
  assert.equal(same.detailTiles, loaded.detailTiles);
  const original = loaded.detailTiles[0];
  cache.entries.set(cache._key("moon", "near", original.regionId), {
    ...original,
    region: { ...original.region },
  });
  const replacement = cache.get(body, 300, 2, { u: 0.5, v: 0 }, 0.99);
  assert.notEqual(replacement.detailTiles, loaded.detailTiles);
  cache.get(body, 300, 3, { u: 0.5, v: 1 }, 0.99);
  assert.ok(cache.queue.every((item) => item.regionId === "global"));
  cache.clear();
  assert.equal(cache.stats().usedBytes, 0);
});

test("legacy terrain remains beneath polar caps and curated regions remain above them", () => {
  const cap = flat(100, { ...polar });
  const legacy = flat(30, { id: "tile-0-0" });
  const asset = {
    height: flat(0),
    region: legacy,
    detailTiles: [{ region: cap }],
  };
  assert.equal(sampleAssetHeight(asset, 0.5, 0), 100);
  assert.equal(sampleAssetHeight(asset, 0.5, 0.5 - 60 / 180), 30);
  asset.region = flat(200, { id: "curated" });
  assert.equal(sampleAssetHeight(asset, 0.5, 0.05), 200);
});

test("a visible cap cannot hide legacy fallback or the Olympus center-ray DEM", () => {
  const tileGrid = {
    pixelsPerDegree: 64,
    baseUrl: "/legacy",
    width: 23040,
    height: 11520,
    tilePixels: 1024,
  };
  const curated = {
    id: "olympus",
    heightUrl: "/olympus",
    width: 2,
    height: 2,
    uvBounds: [0.1, 0.35, 0.15, 0.45],
  };
  const near = {
    color: "/global",
    width: 2,
    height: 2,
    tileGrid,
    regions: [curated],
    detailTiles: [
      {
        ...polar,
        id: "north-cap",
        heightUrl: "/cap",
        width: 2,
        height: 2,
        uvBounds: [0, 0, 1, 1],
      },
    ],
  };
  const make = () =>
    new SurfaceAssetCache({
      manifest: {
        bodies: { moon: { referenceRadiusMeters: 100, levels: { near } } },
      },
      maxConcurrent: 1,
      loadImage: () => new Promise(() => {}),
    });
  const cap = make();
  cap.get(
    { id: "moon", radius: 100 },
    300,
    0,
    { u: 0.5, v: 0.5 - 69 / 180 },
    0.99,
  );
  assert.ok(cap.queue.some((item) => item.regionId === "north-cap"));
  assert.ok(cap.queue.some((item) => item.regionId.startsWith("tile-")));
  const outside = make();
  outside.get(
    { id: "moon", radius: 100 },
    300,
    0,
    { u: 0.625, v: 0.5 - 62 / 180 },
    0.9999,
  );
  assert.ok(!outside.queue.some((item) => item.regionId === "north-cap"));
  const olympus = make();
  olympus.get({ id: "moon", radius: 100 }, 300, 0, { u: 0.125, v: 0.4 }, 0.99);
  assert.ok(olympus.queue.some((item) => item.regionId === "olympus"));
  assert.ok(olympus.queue.some((item) => item.regionId.startsWith("tile-")));
});

test("GPU eviction and source replacement dispose texture objects", async () => {
  const { TerrainGPU } = await import("../src/terrain-gpu.js");
  let created = 0;
  const deleted = [];
  const gpu = new TerrainGPU();
  gpu.gl = {
    createTexture: () => ({ id: ++created }),
    deleteTexture: (texture) => deleted.push(texture.id),
    bindTexture() {},
    pixelStorei() {},
    texParameteri() {},
    texImage2D() {},
    texSubImage2D() {},
  };
  const entry = { gpu: null, lastUsed: 1 };
  gpu.cache.set("moon", entry);
  const one = buildDetailAtlas({ region: flat(1) }, "region", true);
  const two = buildDetailAtlas({ region: flat(2) }, "region", true);
  gpu._texture(entry, "region", one);
  gpu._texture(entry, "region", two);
  assert.deepEqual(deleted, [1]);
  assert.equal(entry.gpu.region.source.data, null);
  gpu.retain(new Set());
  assert.deepEqual(deleted, [1, 2]);
  assert.equal(gpu.stats().memoryBytes, 0);
});

test("two asynchronous tile arrivals preserve an unfinished LOD blend and seam clearance", async () => {
  const { Surfaces } = await import("../src/surfaces.js");
  const { surfaceFrame, getSurfaceDefinition } = await import(
    "../src/surface-definition.js"
  );
  const radius = getSurfaceDefinition("moon").referenceRadiusMeters;
  const body = { id: "moon", radius, position: [0, 0, 0] };
  const tiles = [
    {
      id: "A",
      heightUrl: "A",
      width: 2,
      height: 2,
      uvBounds: [0.45, 0.45, 0.5, 0.55],
    },
    {
      id: "B",
      heightUrl: "B",
      width: 2,
      height: 2,
      uvBounds: [0.5, 0.45, 0.55, 0.55],
    },
  ];
  const level = { color: "global", width: 2, height: 2, detailTiles: tiles };
  const manifest = {
    bodies: {
      moon: { referenceRadiusMeters: radius, levels: { near: level } },
    },
  };
  const pending = new Map();
  const cache = new SurfaceAssetCache({
    manifest,
    maxConcurrent: 2,
    loadHeight: (url) => new Promise((resolve) => pending.set(url, resolve)),
  });
  const color = { data: new Uint8Array(16), width: 2, height: 2 };
  const global = {
    bodyId: "moon",
    level: "near",
    regionId: "global",
    color,
    height: flat(100),
    loadedAt: 0,
    lastUsed: 0,
  };
  cache.entries.set("moon:near:global", global);
  const old = { color: { ...color }, height: flat(0) };
  const current = { color, height: global.height };
  const state = { level: "near", asset: current, previousAsset: old, since: 0 };
  const surfaces = Object.assign(Object.create(Surfaces.prototype), {
    cache,
    states: new Map([["moon", state]]),
    manifest,
    enabled: true,
    exaggeration: 1,
  });
  const frame = surfaceFrame(body, 0);
  const camera = {
    position: frame.prime.map((v) => v * (radius + 1000)),
    forward: frame.prime.map((v) => -v),
    right: frame.east,
    up: frame.north,
  };
  const sim = { time: 0, bodies: [body] };
  const direction = localVectorFromLatLon(0, -0.18);
  surfaces.prepare(sim, camera, 800, 0);
  surfaces.prepare(sim, camera, 800, 200);
  const beforeA = surfaces.sample(state, direction);
  pending.get("A")({
    data: new Float32Array(4).fill(200),
    width: 2,
    height: 2,
    bytes: 16,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  surfaces.prepare(sim, camera, 800, 200);
  assert.equal(surfaces.sample(state, direction), beforeA);
  assert.equal(state.since, 0);
  assert.equal(state.previousAsset, old);
  surfaces.prepare(sim, camera, 800, 400);
  const beforeB = surfaces.sample(state, direction);
  pending.get("B")({
    data: new Float32Array(4).fill(300),
    width: 2,
    height: 2,
    bytes: 16,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  surfaces.prepare(sim, camera, 800, 400);
  assert.equal(surfaces.sample(state, direction), beforeB);
  assert.equal(state.since, 0);
  assert.equal(state.previousAsset, old);
  assert.equal(state.blend, 0.5);
  surfaces.prepare(sim, camera, 800, 1200);
  assert.equal(state.blend, 1);
  assert.ok(surfaces.sample(state, direction) > 200);
});

test("Olympus height keeps independently loaded legacy color", () => {
  const grid = {
    pixelsPerDegree: 64,
    baseUrl: "/legacy",
    width: 23040,
    height: 11520,
    tilePixels: 1024,
  };
  const curated = {
    id: "olympus",
    heightUrl: "/olympus",
    width: 2,
    height: 2,
    uvBounds: [0.1, 0.35, 0.15, 0.45],
  };
  const near = {
    color: "/global",
    width: 2,
    height: 2,
    tileGrid: grid,
    colorTileGrid: grid,
    regions: [curated],
  };
  const cache = new SurfaceAssetCache({
    manifest: {
      bodies: { moon: { referenceRadiusMeters: 100, levels: { near } } },
    },
  });
  const color = { data: new Uint8Array(16), width: 2, height: 2 };
  cache.entries.set("moon:near:global", {
    bodyId: "moon",
    level: "near",
    color,
    height: flat(0),
  });
  const legacyId = cache._tileDescriptor(grid, 0.125, 0.4, grid).id;
  const legacyColor = {
    ...color,
    id: legacyId,
    uvBounds: [0.1, 0.35, 0.15, 0.45],
  };
  cache.entries.set(`moon:near:${legacyId}`, {
    regionId: legacyId,
    loadedAt: 0,
    colorRegion: legacyColor,
    region: flat(50),
  });
  const olympus = flat(500, { ...curated });
  cache.entries.set("moon:near:olympus", {
    regionId: "olympus",
    loadedAt: 0,
    region: olympus,
  });
  const selected = cache.get(
    { id: "moon", radius: 100 },
    300,
    1000,
    { u: 0.125, v: 0.4 },
    0.99,
  );
  assert.equal(selected.region, olympus);
  assert.equal(selected.colorRegion, legacyColor);
  assert.ok(selected.fallbackRegion);
  assert.ok(sampleAssetHeight(selected, 0.10005, 0.4) < 60);
  cache.entries.get("moon:near:olympus").loadedAt = 1000;
  const arriving = cache.get(
    { id: "moon", radius: 100 },
    300,
    1000,
    { u: 0.125, v: 0.4 },
    0.99,
  );
  assert.equal(sampleAssetHeight(arriving, 0.125, 0.4), 50);
  const halfway = cache.get(
    { id: "moon", radius: 100 },
    300,
    1400,
    { u: 0.125, v: 0.4 },
    0.99,
  );
  assert.equal(sampleAssetHeight(halfway, 0.125, 0.4), 275);
});

test("adding atlas tiles retains uploaded globals and updates only changed texture kinds", async () => {
  const { TerrainGPU } = await import("../src/terrain-gpu.js");
  let created = 0;
  const deleted = [];
  let fullUploads = 0;
  const gpu = new TerrainGPU();
  gpu.gl = {
    createTexture: () => ({ id: ++created }),
    deleteTexture: (texture) => deleted.push(texture.id),
    bindTexture() {},
    pixelStorei() {},
    texParameteri() {},
    texImage2D() {
      fullUploads++;
    },
    texSubImage2D() {},
  };
  const color = { data: new Uint8Array(16), width: 2, height: 2 };
  const height = flat(100);
  const first = buildDetailAtlas({ region: flat(1) }, "region", true);
  const second = buildDetailAtlas({ region: flat(2) }, "region", true);
  const entry = gpu._prepareEntry("moon", { color, height, region: first });
  const colorTexture = gpu._texture(entry, "color", color);
  const heightTexture = gpu._texture(entry, "height", height);
  gpu._texture(entry, "region", first);
  const updated = gpu._prepareEntry("moon", { color, height, region: second });
  assert.equal(updated, entry);
  assert.equal(gpu._texture(updated, "color", color), colorTexture);
  assert.equal(gpu._texture(updated, "height", height), heightTexture);
  gpu._texture(updated, "region", second);
  assert.equal(fullUploads, 4);
  assert.deepEqual(deleted, [3]);
});

test("GPU shader keeps layer uniforms in constant storage and hoists invariant ray spacing", async () => {
  const {TerrainGPU}=await import("../src/terrain-gpu.js");
  let fragment="";
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,createShader:type=>({type}),
    shaderSource(shader,source){if(shader.type===2)fragment=source;},compileShader(){},
    getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},
    getProgramParameter:()=>true,getUniformLocation:()=>null,createVertexArray(){}};
  new TerrainGPU({canvas:{getContext:()=>gl}});
  for(const prefix of ["CurrentHeight","PreviousHeight","CurrentColor","PreviousColor"])
    assert.ok(fragment.includes(`vec4 detail${prefix}(vec3 p)`));
  assert.ok(!fragment.includes("detailValue("));
  assert.ok(!/\b(bounds|cells|params|edges)\[/.test(fragment));
  const rayLoop=fragment.slice(fragment.indexOf("for (int i = 0; i < 256; i++)"),fragment.indexOf("if (!found) discard;"));
  assert.ok(!rayLoop.includes("tile<12"));
  assert.ok(rayLoop.includes("max(uCellStep, g / 2.0)"));
});
