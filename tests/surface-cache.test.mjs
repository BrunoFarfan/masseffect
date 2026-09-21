import test from "node:test";
import assert from "node:assert/strict";
import { SurfaceAssetCache } from "../src/surface-assets.js";
import { Surfaces } from "../src/surfaces.js";

const manifest = {
  schemaVersion: 1,
  bodies: {
    moon: {
      referenceRadiusMeters: 100,
      levels: {
        preview: { width: 2, height: 1, color: "preview.jpg" },
        medium: {
          width: 4,
          height: 2,
          color: "medium.jpg",
          heightUrl: "medium.bin",
          heightOffsetMeters: -2,
          heightScaleMeters: 0.5,
        },
        near: {
          width: 8,
          height: 4,
          color: "near.jpg",
          heightUrl: "near.bin",
          heightOffsetMeters: -2,
          heightScaleMeters: 0.5,
        },
      },
    },
  },
};
const body = { id: "moon", radius: 100 };
const resource = (url, descriptor) => ({
  data: new Uint8Array(descriptor.width * descriptor.height * 4),
  width: descriptor.width,
  height: descriptor.height,
  bytes: descriptor.width * descriptor.height * 4,
  dispose() {},
});

test("cache progressively loads, limits concurrency, and keeps prior LOD", async () => {
  let active = 0,
    maximum = 0;
  const pending = [];
  const cache = new SurfaceAssetCache({
    manifest,
    maxConcurrent: 2,
    loadImage: async (url, descriptor) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => pending.push(resolve));
      active--;
      return resource(url, descriptor);
    },
    loadHeight: async () => null,
  });
  assert.equal(cache.get(body, 2, 1).loading, true);
  assert.equal(cache.stats().loading, 1);
  pending.shift()?.();
  await Promise.resolve();
  pending.shift()?.();
  await Promise.resolve();
  const preview = cache.peek("moon", "preview");
  assert.ok(preview || cache.stats().loading);
  assert.ok(maximum <= 2);
});

test("cache suppresses repeated failed loads and rejects changed canonical radius", async () => {
  let attempts = 0;
  const cache = new SurfaceAssetCache({
    manifest,
    loadImage: async () => {
      attempts++;
      throw new Error("offline");
    },
  });
  assert.equal(cache.get(body, 1).loading, true);
  await Promise.resolve();
  await Promise.resolve();
  cache.get(body, 1);
  cache.get(body, 1);
  assert.equal(attempts, 1);
  assert.equal(cache.get({ ...body, radius: 101 }, 100), null);
});

test("cache enforces decoded byte budget and disposes evicted resources", async () => {
  let disposed = 0;
  const cache = new SurfaceAssetCache({
    manifest,
    budgetBytes: 8,
    loadImage: async (url, descriptor) => ({
      ...resource(url, descriptor),
      bytes: 8,
      dispose() {
        disposed++;
      },
    }),
    loadHeight: async () => null,
  });
  cache.get(body, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  cache.get(body, 200);
  await new Promise((resolve) => setTimeout(resolve, 0));
  cache.endFrame(10);
  assert.ok(cache.stats().usedBytes <= 8);
  assert.ok(disposed >= 1);
});

test("budget eviction keeps new detail and releases blend references before disposal", async () => {
  const surfaces = Object.create(Surfaces.prototype);
  surfaces.states = new Map();
  let notifications = 0;
  const cache = new SurfaceAssetCache({
    manifest,
    budgetBytes: 8,
    loadImage: async () => ({
      data: new Uint8Array(8),
      bytes: 8,
      dispose() {
        this.data = null;
      },
    }),
    loadHeight: async () => null,
    onEvict: (entry) => {
      assert.ok(entry.color.data);
      surfaces.releaseAsset(entry);
      notifications++;
    },
  });
  cache.get(body, 1, 100);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const previous = cache.peek("moon", "preview");
  const state = {
    asset: { color: {} },
    previousAsset: { color: previous.color },
    blend: 0.2,
    since: 100,
  };
  surfaces.states.set("moon", state);
  cache.get(body, 200, 100);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cache.peek("moon", "medium").level, "medium");
  assert.equal(state.previousAsset, null);
  assert.equal(state.blend, 1);
  assert.equal(previous.color.data, null);
  assert.equal(notifications, 1);
});

test("regional cache selects only the UV-matching tile and keeps global fallback", () => {
  const regional = structuredClone(manifest);
  regional.bodies.moon.levels.near.regions = [
    { id: "west", name: "west", uvBounds: [0, 0, 0.5, 1], heightUrl: "west.bin", width: 2, height: 2 },
    { id: "east", name: "east", uvBounds: [0.5, 0, 1, 1], heightUrl: "east.bin", width: 2, height: 2 },
  ];
  const cache = new SurfaceAssetCache({ manifest: regional, loadImage: async (url, d) => resource(url, d) });
  const result = cache.get(body, 300, 1, { u: 0.75, v: 0.5 });
  assert.equal(result.entry, null);
  assert.ok(cache.queue.some((item) => item.regionId === "east"));
  assert.ok(cache.queue.every((item) => item.regionId === "global" || item.regionId === "east"));
});

test("regional cache chooses the best visible oblique tile and handles wrap", () => {
  const regional = structuredClone(manifest);
  regional.bodies.moon.levels.near.regions = [
    { id: "oblique", uvBounds: [0.58, 0.42, 0.7, 0.58], heightUrl: "oblique.bin", width: 2, height: 2 },
    { id: "wrapped", uvBounds: [0.94, 0.35, 1.06, 0.65], heightUrl: "wrapped.bin", width: 2, height: 2 },
  ];
  const cache = new SurfaceAssetCache({ manifest: regional, maxConcurrent: 1 });
  cache.get(body, 300, 1, { u: 0.5, v: 0.5 });
  assert.ok(cache.queue.some((item) => item.regionId === "oblique"));
  assert.ok(!cache.queue.some((item) => item.regionId === "wrapped"));

  cache.clear();
  cache.get(body, 300, 2, { u: 0.01, v: 0.5 });
  assert.ok(cache.queue.some((item) => item.regionId === "wrapped"));
  assert.ok(!cache.queue.some((item) => item.regionId === "oblique"));

  const groundView = new SurfaceAssetCache({ manifest: regional, maxConcurrent: 1 });
  groundView.get(body, 300, 3, { u: 0.5, v: 0.5 }, 0.99);
  assert.ok(!groundView.queue.some((item) => item.regionId !== "global"));
});

test("regional queue drops tiles left behind as the camera crosses a seam", () => {
  const regional = structuredClone(manifest);
  regional.bodies.moon.levels.near.regions = [
    { id: "west", uvBounds: [0.1, 0.2, 0.3, 0.8], heightUrl: "west.bin", width: 2, height: 2 },
    { id: "east", uvBounds: [0.7, 0.2, 0.9, 0.8], heightUrl: "east.bin", width: 2, height: 2 },
  ];
  const cache = new SurfaceAssetCache({ manifest: regional, maxConcurrent: 1 });
  cache.get(body, 300, 1, { u: 0.2, v: 0.5 });
  cache.get(body, 300, 2, { u: 0.8, v: 0.5 });
  assert.ok(!cache.queue.some((item) => item.regionId === "west"));
  assert.ok(cache.queue.some((item) => item.regionId === "east"));
});

test("center-ray tile wins over the camera subpoint when both are visible", () => {
  const regional = structuredClone(manifest);
  regional.bodies.moon.levels.near.regions = [
    { id: "subpoint", uvBounds: [0.45, 0.4, 0.55, 0.6], heightUrl: "subpoint.bin", width: 2, height: 2 },
    { id: "view", uvBounds: [0.6, 0.4, 0.7, 0.6], heightUrl: "view.bin", width: 2, height: 2 },
  ];
  const cache = new SurfaceAssetCache({ manifest: regional, maxConcurrent: 1 });
  cache.get(body, 300, 1, { u: 0.5, v: 0.5 }, 0.4, { u: 0.65, v: 0.5 });
  assert.ok(cache.queue.some((item) => item.regionId === "view"));
  assert.ok(!cache.queue.some((item) => item.regionId === "subpoint"));
});

test("regional tiles share global assets and evict by their complete key", async () => {
  const regional = structuredClone(manifest);
  regional.bodies.moon.levels.near.regions = [
    { id: "west", uvBounds: [0, 0, 0.5, 1], heightUrl: "west.bin", width: 2, height: 2 },
  ];
  const images = [];
  const disposed = [];
  const cache = new SurfaceAssetCache({
    manifest: regional,
    budgetBytes: 300,
    maxConcurrent: 4,
    loadImage: async (url, descriptor) => {
      images.push(url);
      return resource(url, descriptor);
    },
    loadHeight: async (url) => ({
      data: new Float32Array(4), bytes: 16,
      dispose() { disposed.push(url); this.data = null; },
    }),
  });
  cache.get(body, 300, 1, { u: 0.25, v: 0.5 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(images.filter((url) => url === "near.jpg").length, 1);
  const near = cache.entries.get("moon:near:global");
  const tile = cache.entries.get("moon:near:west");
  assert.ok(near);
  assert.ok(tile);
  assert.equal(tile.color, null);
  assert.equal(tile.height, null);
  const selected = cache.get(body, 300, 2, { u: 0.25, v: 0.5 });
  assert.equal(selected.color, near.color);
  assert.equal(selected.height, near.height);
  assert.equal(selected.region, tile.region);
  assert.equal(near.lastUsed, 2);
  assert.equal(tile.lastUsed, 2);
  tile.lastUsed = 0;
  cache.budgetBytes = cache.usedBytes - tile.bytes;
  cache._evict();
  assert.equal(cache.entries.has("moon:near:west"), false);
  assert.equal(disposed.includes("west.bin"), true);
  assert.ok(cache.usedBytes <= cache.budgetBytes);
  assert.equal(cache.get(body, 300, 3, { u: 0.25, v: 0.5 }).region, null);
});

test("optional 64 ppd grid queues only the viewed low-altitude tile", () => {
  const tiled = structuredClone(manifest);
  tiled.bodies.moon.levels.near.tileGrid = {
    pixelsPerDegree: 64, width: 23040, height: 11520, tilePixels: 1024,
    baseUrl: "/assets/surfaces/terrain64/moon", heightOffsetMeters: -10000,
    heightScaleMeters: 0.5,
  };
  const cache = new SurfaceAssetCache({ manifest: tiled, maxConcurrent: 1 });
  const last = cache._tileDescriptor(tiled.bodies.moon.levels.near.tileGrid, 0.99, 0.99);
  assert.equal(last.id, "tile-11-22");
  assert.equal(last.heightWidth, 512);
  assert.equal(last.heightHeight, 256);
  assert.equal(last.heightUrl, "/assets/surfaces/terrain64/moon/11-22.bin.gz");
  cache.get(body, 300, 1, { u: 0.99, v: 0.99 }, 0.995);
  assert.ok(cache.queue.some((item) => item.regionId === last.id));
  assert.equal(cache.queue.filter((item) => item.regionId.startsWith("tile-")).length, 1);
  cache.get(body, 300, 2, { u: 0.5, v: 0.5 }, 0.5);
  assert.ok(!cache.queue.some((item) => item.regionId.startsWith("tile-")));
  cache.get(body, 300, 3, { u: 0.5, v: 0.5 }, 0.988);
  assert.ok(cache.queue.some((item) => item.regionId.startsWith("tile-")));
});

test("matching color and height grids load one lazy tile over the global fallback", async () => {
  const tiled = structuredClone(manifest);
  tiled.bodies.moon.levels.near.tileGrid = {
    pixelsPerDegree: 64, width: 23040, height: 11520, tilePixels: 1024,
    baseUrl: "/assets/surfaces/terrain64/moon", heightOffsetMeters: -10000,
    heightScaleMeters: 0.5,
  };
  tiled.bodies.moon.levels.near.colorTileGrid = {
    pixelsPerDegree: 64, width: 23040, height: 11520, tilePixels: 1024,
    baseUrl: "/assets/surfaces/color64/moon",
  };
  const images = [], heights = [];
  const cache = new SurfaceAssetCache({
    manifest: tiled, maxConcurrent: 4,
    loadImage: async (url, descriptor) => {
      images.push(url);
      return resource(url, descriptor);
    },
    loadHeight: async (url, descriptor) => {
      heights.push(url);
      return {
        data: new Float32Array((descriptor.heightWidth ?? descriptor.width) * (descriptor.heightHeight ?? descriptor.height)),
        bytes: 16,
        dispose() { this.data = null; },
      };
    },
  });
  const uv = { u: 0.46, v: 0.72 };
  cache.get(body, 300, 1, uv, 0.995);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const selected = cache.get(body, 300, 2, uv, 0.995);
  assert.equal(selected.color, cache.entries.get("moon:near:global").color);
  assert.ok(selected.region?.data);
  assert.ok(selected.colorRegion?.data);
  assert.equal(selected.colorRegion.uvBounds.length, 4);
  assert.equal(images.filter((url) => url.includes("/color64/")).length, 1);
  assert.equal(heights.filter((url) => url.includes("/terrain64/")).length, 1);
  cache.get(body, 300, 3, uv, 0.5);
  assert.ok(!cache.queue.some((item) => item.regionId.startsWith("tile-")));
});

test("color tile can load without optional height pack", async () => {
  const tiled = structuredClone(manifest);
  tiled.bodies.moon.levels.near.colorTileGrid = {
    pixelsPerDegree: 64, width: 23040, height: 11520, tilePixels: 1024,
    baseUrl: "/assets/surfaces/color64/moon",
  };
  const cache = new SurfaceAssetCache({
    manifest: tiled, maxConcurrent: 4,
    loadImage: async (url, descriptor) => resource(url, descriptor),
    loadHeight: async () => ({ data: new Float32Array(8), bytes: 32, dispose() {} }),
  });
  const uv = { u: 0.46, v: 0.72 };
  cache.get(body, 300, 1, uv, 0.995);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const selected = cache.get(body, 300, 2, uv, 0.995);
  assert.ok(selected.colorRegion);
  assert.equal(selected.region, null);
});
