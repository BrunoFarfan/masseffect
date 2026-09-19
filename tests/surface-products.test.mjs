import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { SURFACE_PCK } from "../src/surface-pck.js";
import { surfaceFrame } from "../src/surface-definition.js";
import { validateShape, shapeRadius } from "../src/surface-shape.js";

const manifest = JSON.parse(
  await readFile(new URL("../assets/surfaces/manifest.json", import.meta.url)),
);
const file = (url) => new URL(`..${url}`, import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("every prepared product has bounded, checksum-verified game assets", async () => {
  assert.deepEqual(
    Object.keys(manifest.bodies).sort(),
    Object.keys(SURFACE_PCK).sort(),
    "complete canonical coverage",
  );
  for (const [id, product] of Object.entries(manifest.bodies)) {
    assert.ok(SURFACE_PCK[id], id);
    assert.ok(product.sourceType, id);
    assert.ok(product.provenance || product.source, `${id} provenance`);
    for (const [name, level] of Object.entries(product.levels)) {
      if (level.geometry) {
        const bytes = await readFile(file(level.geometry));
        assert.equal(
          hash(bytes),
          product.artifactSha256,
          `${id} shape checksum`,
        );
        const mesh = validateShape(JSON.parse(bytes));
        const edges = new Map();
        for (let i = 0; i < mesh.indices.length; i += 3) {
          const ids = mesh.indices.slice(i, i + 3);
          assert.equal(new Set(ids).size, 3, `${id} degenerate triangle`);
          for (let j = 0; j < 3; j++) {
            const key = [ids[j], ids[(j + 1) % 3]]
              .sort((a, b) => a - b)
              .join(":");
            edges.set(key, (edges.get(key) || 0) + 1);
          }
        }
        assert.ok(
          [...edges.values()].every((n) => n === 2),
          `${id} watertight mesh`,
        );
        for (const n of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ])
          assert.ok(shapeRadius(mesh, n) > 0, id);
        continue;
      }
      const bytes = await readFile(file(level.color)),
        meta = await sharp(bytes).metadata();
      assert.equal(
        hash(bytes),
        level.colorSha256,
        `${id}/${name} color checksum`,
      );
      assert.equal(meta.width, level.width, `${id}/${name} width`);
      assert.equal(meta.height, level.height, `${id}/${name} height`);
      assert.ok(level.width <= 4096 && level.height <= 2048, id);
      if (!level.heightUrl) continue;
      const heights = await readFile(file(level.heightUrl));
      assert.equal(
        hash(heights),
        level.heightSha256,
        `${id}/${name} height checksum`,
      );
      assert.equal(
        heights.length,
        level.heightWidth * level.heightHeight * 2,
        id,
      );
      assert.ok(level.heightScaleMeters > 0, id);
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < heights.length; i += 2) {
        const h =
          heights.readUInt16LE(i) * level.heightScaleMeters +
          level.heightOffsetMeters;
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
      assert.ok(
        min >= level.minElevationMeters - level.heightScaleMeters &&
          max <= level.maxElevationMeters + level.heightScaleMeters,
        `${id}/${name} decoded bounds ${min}..${max}`,
      );
    }
  }
});
test("all canonical PCK frames remain finite orthonormal at past and future epochs", () => {
  for (const id of Object.keys(SURFACE_PCK))
    for (const time of [-315576000, 0, 315576000]) {
      const frame = surfaceFrame(id, time),
        axes = [frame.prime, frame.north, frame.east];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const dot = axes[i].reduce((s, v, k) => s + v * axes[j][k], 0);
          assert.ok(Math.abs(dot - (i === j ? 1 : 0)) < 1e-10, `${id} ${time}`);
        }
    }
});
