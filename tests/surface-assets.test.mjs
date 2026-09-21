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
      if (name !== "preview") {
        assert.ok(level.heightUrl);
        assert.ok(level.heightWidth && level.heightHeight);
        assert.equal(level.heightWidth, level.width / 2);
        assert.equal(level.heightHeight, level.height / 2);
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
      } else assert.equal(level.heightUrl, undefined);
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
  assert.match(manifest.bodies.uranus.provenance.coverage, /unobserved southern cap/);
  assert.ok(getSurfaceDefinition("venus").atmosphere.upperAltitudeMeters > 60000);
  assert.match(manifest.bodies.uranus.heightPolicy, /no solid terrain/);
  for (const level of Object.values(manifest.bodies.uranus.levels))
    assert.equal(level.heightUrl, undefined);
});

test("Earth near level carries native 60-arcsecond Andes relief", async () => {
  const region = manifest.bodies.earth.levels.near.region;
  assert.equal(region.name, "Andes ETOPO2022 60-arcsecond regional relief");
  const geocentric = (latitude) =>
    Math.atan(
      (6356752.314245 ** 2 / 6378137 ** 2) *
        Math.tan((latitude * Math.PI) / 180),
    ) * (180 / Math.PI);
  assert.deepEqual(region.uvBounds, [
    (-75 + 180) / 360,
    0.5 - geocentric(-20) / 180,
    (-65 + 180) / 360,
    0.5 - geocentric(-40) / 180,
  ]);
  const bytes = await readFile(localAsset(region.heightUrl));
  assert.equal(bytes.length, 601 * 1201 * 2);
  assert.equal(checksum(bytes), region.heightSha256);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < bytes.length; i += 2) {
    const elevation = bytes.readUInt16LE(i) + region.heightOffsetMeters;
    min = Math.min(min, elevation); max = Math.max(max, elevation);
  }
  assert.equal(min, region.minElevationMeters);
  assert.equal(max, region.maxElevationMeters);
  assert.ok(max > 9000);
});

test("Earth Himalaya tile preserves native ETOPO samples and bounds", async () => {
  const region = manifest.bodies.earth.levels.near.regions.find((tile) => tile.id === "himalaya");
  assert.ok(region);
  const geocentric = (latitude) => Math.atan((6356752.314245 ** 2 / 6378137 ** 2) * Math.tan(latitude * Math.PI / 180)) * 180 / Math.PI;
  assert.deepEqual(region.uvBounds, [70 / 360 + 0.5, 0.5 - geocentric(35) / 180, 100 / 360 + 0.5, 0.5 - geocentric(25) / 180]);
  const bytes = await readFile(localAsset(region.heightUrl));
  assert.equal(bytes.length, 181 * 61 * 2);
  assert.equal(checksum(bytes), region.heightSha256);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < bytes.length; i += 2) {
    const elevation = bytes.readUInt16LE(i) + region.heightOffsetMeters;
    min = Math.min(min, elevation); max = Math.max(max, elevation);
  }
  assert.equal(min, region.minElevationMeters);
  assert.equal(max, region.maxElevationMeters);
  assert.ok(max > 7000);
});

test("Tycho regional DEM preserves verified native LOLA samples and coverage", async () => {
  const region = manifest.bodies.moon.levels.near.region;
  const bytes = await readFile(localAsset(region.heightUrl));
  assert.equal(bytes.length, 896 * 896 * 2);
  assert.equal(checksum(bytes), region.heightSha256);
  assert.deepEqual(region.uvBounds, [0.45, 0.7, 176 / 360, 140 / 180]);
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < bytes.length; i += 2) {
    const h = bytes.readUInt16LE(i) * 0.5 - 10000;
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  assert.equal(min, -5387);
  assert.equal(max, 2095.5);
  assert.equal(region.minElevationMeters, min);
  assert.equal(region.maxElevationMeters, max);
  assert.match(
    manifest.bodies.moon.provenance.sources[2].checksumScope,
    /not full original/,
  );
});

test("Mare Orientale LOLA16 tile is aligned to its wrapped longitude bounds", async () => {
  const region = manifest.bodies.moon.levels.near.regions.find(
    (tile) => tile.id === "mare-orientale",
  );
  assert.ok(region);
  assert.deepEqual(region.uvBounds, [80 / 360, 80 / 180, 120 / 360, 120 / 180]);
  const bytes = await readFile(localAsset(region.heightUrl));
  assert.equal(bytes.length, 641 * 641 * 2);
  assert.equal(checksum(bytes), region.heightSha256);
  // Source fixtures from the verified LOLA16 TIFF at (1280,1280),
  // (1600,1600), and (1920,1920). A shifted tile can have a valid checksum
  // and elevation range of its own, but must fail these geographic samples.
  assert.equal(bytes.readUInt16LE(0), 22173);
  assert.equal(bytes.readUInt16LE((320 * 641 + 320) * 2), 22115);
  assert.equal(bytes.readUInt16LE((640 * 641 + 640) * 2), 21058);
});

test("Copernicus and Hellas regional tiles are native verified DEM crops", async () => {
  const copernicus = manifest.bodies.moon.levels.near.regions.find((tile) => tile.id === "copernicus");
  const hellas = manifest.bodies.mars.levels.near.regions.find((tile) => tile.id === "hellas");
  assert.ok(copernicus); assert.ok(hellas);
  assert.deepEqual(copernicus.uvBounds, [-25 / 360 + 0.5, 75 / 180, -15 / 360 + 0.5, 85 / 180]);
  assert.deepEqual(hellas.uvBounds, [60 / 360 + 0.5, 110 / 180, 90 / 360 + 0.5, 140 / 180]);
  const inside = (bounds, longitude, latitude) => {
    const u = (longitude + 180) / 360, v = (90 - latitude) / 180;
    return bounds[0] <= u && u <= bounds[2] && bounds[1] <= v && v <= bounds[3];
  };
  assert.ok(inside(copernicus.uvBounds, -20.08, 9.62));
  assert.ok(inside(hellas.uvBounds, 70.5, -42.4));
  for (const [region, width, height] of [[copernicus, 161, 161], [hellas, 481, 481]]) {
    const bytes = await readFile(localAsset(region.heightUrl));
    assert.equal(bytes.length, width * height * 2);
    assert.equal(checksum(bytes), region.heightSha256);
    assert.ok(region.maxElevationMeters > region.minElevationMeters);
  }
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
