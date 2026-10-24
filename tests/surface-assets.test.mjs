import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import sharp from "sharp";
import { getSurfaceDefinition } from "../src/surface-definition.js";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(resolve(root, "assets/surfaces/manifest.json"), "utf8"),
);
const localAsset = (url) => resolve(root, url.replace(/^\//, ""));
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("surface manifest covers bounded Moon and Mars levels", async () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.coordinateConvention, /east longitude/);
  for (const body of ["moon", "mars"]) {
    const entry = manifest.bodies[body];
    assert.ok(entry);
    assert.ok(entry.referenceRadiusMeters > 3e6 || body === "moon");
    for (const [name, level] of Object.entries(entry.levels)) {
      const image = await sharp(localAsset(level.color)).metadata();
      assert.equal(image.width, level.width, `${body}/${name} width`);
      assert.equal(image.height, level.height, `${body}/${name} height`);
      assert.equal(
        checksum(await readFile(localAsset(level.color))),
        level.colorSha256,
      );
      {
        assert.ok(level.heightUrl);
        assert.ok(level.heightWidth && level.heightHeight);
        assert.equal(
          level.heightWidth,
          name === "preview" ? level.width : level.width / 2,
        );
        assert.equal(
          level.heightHeight,
          name === "preview" ? level.height : level.height / 2,
        );
        const bytes = await stat(localAsset(level.heightUrl));
        assert.equal(
          bytes.size,
          (level.heightWidth ?? level.width) *
            (level.heightHeight ?? level.height) *
            2,
        );
        assert.equal(level.heightScaleMeters > 0, true);
        assert.ok(Number.isFinite(level.minElevationMeters));
        assert.ok(Number.isFinite(level.maxElevationMeters));
        const heightBytes = await readFile(localAsset(level.heightUrl));
        assert.equal(checksum(heightBytes), level.heightSha256);
        let min = Infinity,
          max = -Infinity;
        for (let i = 0; i < heightBytes.length; i += 2) {
          const value =
            heightBytes.readUInt16LE(i) * level.heightScaleMeters +
            level.heightOffsetMeters;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
        assert.equal(min, level.minElevationMeters);
        assert.equal(max, level.maxElevationMeters);
        if (body === "moon") {
          assert.ok(min < -8000);
          assert.ok(max > 8000);
        } else {
          assert.ok(min < -15000);
          assert.ok(max > 25000);
        }
      }
      for (const region of level.regions || []) {
        const regionBytes = await readFile(localAsset(region.heightUrl));
        assert.equal(
          regionBytes.length,
          region.width * region.height * 2,
          `${body}/${name}/${region.id} dimensions`,
        );
        assert.equal(checksum(regionBytes), region.heightSha256);
        assert.ok(region.uvBounds.every(Number.isFinite));
      }
    }
  }
});

test("source provenance records download checksums and honest Mars color status", () => {
  for (const body of ["moon", "mars"]) {
    const provenance = manifest.bodies[body].provenance;
    assert.ok(provenance.sources.length > 0);
    for (const source of provenance.sources) {
      assert.match(source.url, /^https:\/\//);
      assert.match(source.sha256, /^[a-f0-9]{64}$/);
      assert.ok(source.dimensions);
      assert.ok(source.operations);
    }
  }
  assert.match(
    manifest.bodies.mars.provenance.colorNote,
    /not a calibrated albedo/,
  );
  assert.equal(
    manifest.bodies.mars.provenance.sources[1].sha256,
    "fdfcd335559c3dc67052b7e8a9565d850e336ac0d1f3ea7f5eb7826ffb44ecb2",
  );
  assert.match(
    manifest.bodies.mars.provenance.sources[1].labelUrl,
    /\.aux\.xml$/,
  );
  assert.equal(manifest.bodies.mars.referenceRadiusMeters, 3389500);
  assert.match(manifest.bodies.mars.provenance.datum, /planetary-radius/);
  assert.match(manifest.bodies.mars.provenance.sources[0].labelUrl, /\.lbl$/);
  assert.equal(
    manifest.bodies.moon.provenance.sources[0].sha256,
    "918649a7f8ed2f1329b2cd95bb0d25483befdcb60ae1a66db681a637cc21344f",
  );
});

test("Venus keeps measured Magellan height while Uranus remains atmospheric", () => {
  const venus = manifest.bodies.venus;
  for (const level of ["medium", "near"]) {
    assert.ok(venus.levels[level].heightUrl);
    assert.ok(venus.levels[level].maxElevationMeters > 10000);
    assert.ok(venus.levels[level].minElevationMeters < -2000);
  }
  assert.equal(manifest.bodies.uranus.atmosphericBands, false);
  assert.match(manifest.bodies.uranus.sourceType, /observed-atmosphere/);
  assert.match(
    manifest.bodies.uranus.provenance.coverage,
    /unobserved southern cap/,
  );
  assert.ok(
    getSurfaceDefinition("venus").atmosphere.upperAltitudeMeters > 60000,
  );
  assert.match(manifest.bodies.uranus.heightPolicy, /no solid terrain/);
  for (const level of Object.values(manifest.bodies.uranus.levels))
    assert.equal(level.heightUrl, undefined);
});

test("global terrain keeps only the higher-resolution Olympus regional supplement", () => {
  for (const body of ["earth", "moon"]) {
    assert.equal(manifest.bodies[body].levels.near.region, undefined);
    assert.deepEqual(manifest.bodies[body].levels.near.regions || [], []);
  }
  const mars = manifest.bodies.mars.levels.near;
  assert.deepEqual(
    mars.regions.map((region) => region.id),
    ["olympus"],
  );
  assert.deepEqual(mars.region, mars.regions[0]);
});

test("Olympus regional MOLA128 crop preserves exact tile bounds and radial conversion", async () => {
  const region = manifest.bodies.mars.levels.near.region;
  const bytes = await readFile(localAsset(region.heightUrl));
  assert.equal(bytes.length, 1024 * 1024 * 2);
  assert.equal(checksum(bytes), region.heightSha256);
  assert.deepEqual(region.uvBounds, [
    222 / 360 - 0.5,
    (90 - 22) / 180,
    230 / 360 - 0.5,
    (90 - 14) / 180,
  ]);
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < bytes.length; i += 2) {
    const elevation = bytes.readUInt16LE(i) - 20000;
    min = Math.min(min, elevation);
    max = Math.max(max, elevation);
  }
  assert.equal(min, 2918);
  assert.equal(max, 27862);
  assert.equal(region.minElevationMeters, min);
  assert.equal(region.maxElevationMeters, max);
  const source = manifest.bodies.mars.provenance.sources[2];
  assert.deepEqual(source.byteRange, [64880640, 88473599]);
  assert.match(source.operations, /SignedMSB2/);
  assert.match(source.checksumScope, /not full original/);
});
