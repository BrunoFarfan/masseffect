#!/usr/bin/env node
/** Build browser-ready Mercury levels from the pinned USGS DEM. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { fromFile } from "geotiff";

const root = resolve(import.meta.dirname, "..");
const originalDir = resolve(root, "output/surface-originals");
const original = resolve(originalDir, "mercury-dem.tif");
const outputDir = resolve(root, "assets/surfaces");
const sourceUrl =
  "https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif";
const sourceSha256 =
  "defce776241dcaf44cb0f081ee508c17dbea28aa5a22880bf7a5e8c25f96cbea";
const referenceRadiusMeters = 2439400;
const heightScaleMeters = 0.5;
const heightOffsetMeters = -10000;
const oldFiles = [
  "mercury-preview.procedural.jpg",
  "mercury-medium.procedural.jpg",
  "mercury-near.procedural.jpg",
  "mercury-preview.height.f32.bin",
  "mercury-medium.height.f32.bin",
  "mercury-near.height.f32.bin",
  "mercury/preview.procedural.jpg",
  "mercury/medium.procedural.jpg",
  "mercury/near.procedural.jpg",
  "mercury/preview.height.f32.bin",
  "mercury/medium.height.f32.bin",
  "mercury/near.height.f32.bin",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download() {
  await mkdir(originalDir, { recursive: true });
  const response = await fetch(sourceUrl);
  if (!response.ok)
    throw new Error(`Download failed ${response.status}: ${sourceUrl}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== sourceSha256)
    throw new Error("Mercury DEM checksum mismatch");
  await writeFile(original, bytes);
  console.log(`downloaded mercury-dem.tif (${bytes.length} bytes)`);
}

async function verifySource() {
  if (!existsSync(original))
    throw new Error(`Missing ${original}; run with --download first`);
  const bytes = await readFile(original);
  const actual = sha256(bytes);
  if (actual !== sourceSha256)
    throw new Error(
      `Mercury DEM sha256 mismatch: expected ${sourceSha256}, got ${actual}`,
    );
  const metadata = bytes.toString("latin1");
  if (!/<Item name="SCALE"[^>]*>0\.5<\/Item>/.test(metadata))
    throw new Error("Mercury DEM missing GDAL SCALE=0.5");
  if (!/<Item name="OFFSET"[^>]*>0<\/Item>/.test(metadata))
    throw new Error("Mercury DEM missing GDAL OFFSET=0");
  return bytes;
}

function writeU16(values) {
  const output = Buffer.alloc(values.length * 2);
  for (let i = 0; i < values.length; i++)
    output.writeUInt16LE(values[i], i * 2);
  return output;
}

async function buildLevel(image, name, width, height) {
  const raster = await image.readRasters({
    width,
    height,
    samples: [0],
    interleave: true,
  });
  const encoded = new Uint16Array(width * height);
  let min = Infinity,
    max = -Infinity;
  const halfWidth = width / 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // Source 0..360 -> runtime canonical -180..180 by a half-raster rotation.
      const sourceValue = Number(raster[y * width + ((x + halfWidth) % width)]);
      const sample =
        Number.isFinite(sourceValue) && sourceValue > -32768
          ? Math.max(0, Math.min(65535, Math.round(sourceValue + 20000)))
          : 0;
      encoded[y * width + x] = sample;
      const elevation = sample * heightScaleMeters + heightOffsetMeters;
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
    }
  if (min > -4000 || max < 3000)
    throw new Error(`Unexpected Mercury range at ${name}: ${min}..${max}`);
  const heightBytes = writeU16(encoded);
  const heightPath = resolve(outputDir, `mercury-${name}.height.bin`);
  await writeFile(heightPath, heightBytes);
  // Neutral fallback: no height-derived tint is presented as albedo/imagery.
  const colorBytes = Buffer.alloc(width * height * 3, 144);
  const colorPath = resolve(outputDir, `mercury-${name}.jpg`);
  await sharp(colorBytes, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toFile(colorPath);
  return {
    width,
    height,
    color: `/assets/surfaces/mercury-${name}.jpg`,
    colorSha256: sha256(await readFile(colorPath)),
    heightUrl: `/assets/surfaces/mercury-${name}.height.bin`,
    heightWidth: width,
    heightHeight: height,
    heightSha256: sha256(heightBytes),
    heightScaleMeters,
    heightOffsetMeters,
    minElevationMeters: min,
    maxElevationMeters: max,
  };
}

async function rebuild() {
  const sourceBytes = await verifySource();
  await mkdir(outputDir, { recursive: true });
  const tiff = await fromFile(original);
  try {
    const image = await tiff.getImage();
    if (image.getWidth() !== 23040 || image.getHeight() !== 11520)
      throw new Error("Unexpected Mercury DEM dimensions");
    const keys = image.getGeoKeys();
    if (
      keys.ProjCoordTransGeoKey !== 17 ||
      keys.ProjCenterLongGeoKey !== 180 ||
      keys.GeogAngularUnitsGeoKey !== 9102 ||
      keys.GeogSemiMajorAxisGeoKey !== referenceRadiusMeters
    )
      throw new Error(
        `Unexpected Mercury GeoTIFF georeferencing: ${JSON.stringify(keys)}`,
      );
    const origin = image.getOrigin(),
      resolution = image.getResolution();
    if (
      Math.abs(origin[0] + Math.PI * referenceRadiusMeters) > 2000 ||
      Math.abs(origin[1] - (Math.PI * referenceRadiusMeters) / 2) > 2000 ||
      resolution[0] <= 0 ||
      resolution[1] >= 0
    )
      throw new Error(
        `Unexpected north-up equirectangular origin/resolution: ${origin} / ${resolution}`,
      );
    const levels = {};
    for (const [name, width, height] of [
      ["preview", 512, 256],
      ["medium", 1024, 512],
      ["near", 2048, 1024],
    ])
      levels[name] = await buildLevel(image, name, width, height);
    const manifest = {
      schemaVersion: 1,
      body: "mercury",
      referenceRadiusMeters,
      sourceType: "real-dem",
      coordinates: {
        longitude: "east-positive -180..180",
        latitude: "planetocentric",
        projection: "equirectangular",
        northAtTop: true,
        pixelRegistration: "area-centered",
        sourceLongitude:
          "east-positive 0..360; output columns rotated 180 degrees",
      },
      colorType: "constant neutral fallback; not imagery",
      provenance: {
        url: sourceUrl,
        sha256: sourceSha256,
        dimensions: "23040x11520 signed 16-bit GeoTIFF",
        datum: "Mercury spherical radius 2439400 m; GDAL SCALE=0.5, OFFSET=0",
        operations:
          "Verified GeoTIFF GeoKeys/origin/resolution; source 0..360 raster rotated to canonical -180..180; area-resampled signed samples exported as uint16 little-endian with scale 0.5 and offset -10000",
        attribution: "USGS Astrogeology Science Center / NASA MESSENGER MDIS",
      },
      levels,
    };
    await writeFile(
      resolve(root, "assets/surfaces/mercury-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    for (const file of oldFiles) {
      const path = resolve(outputDir, file);
      if (existsSync(path)) await unlink(path);
    }
    console.log(
      JSON.stringify(
        { sourceBytes: sourceBytes.length, sourceSha256, levels },
        null,
        2,
      ),
    );
  } finally {
    await tiff.close();
  }
}

const args = new Set(process.argv.slice(2));
if (args.has("--download")) await download();
if (args.has("--download") || args.has("--rebuild")) await rebuild();
else {
  console.error(
    "Usage: node scripts/prepare-mercury-surface.mjs --download [--rebuild]",
  );
  process.exitCode = 2;
}
