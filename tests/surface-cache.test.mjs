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
