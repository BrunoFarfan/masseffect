#!/usr/bin/env node
/** Prepare the pinned USGS Magellan Venus topography and radar derivatives. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { fromFile } from "geotiff";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "venus-dem.tif",
  url: "https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_Topography_Global_4641m_v02.tif",
  sha256: "92dd2c8850b128f9dcceb400f1367e3df96229f5309840fee4275b74f192ea11",
};
const radarSource = {
  file: "venus-radar.jpg",
  url: "https://astrogeology.usgs.gov/ckan/dataset/dbef2da4-5ed3-4d99-b7bb-5391ee8d5f10/resource/433a4e88-fcf7-47c5-8c3b-9b8b608a98c9/download/full.jpg",
  sha256: "5c5f4a18143bcc26fe0ab92bd9270d2549cb5c8b30c8d39743b74a7574566f4d",
};
const pageUrl =
  "https://astrogeology.usgs.gov/search/map/venus_magellan_global_topography_4641m";
const levels = [
  { name: "preview", width: 512, height: 256, heightOutput: false },
  { name: "medium", width: 1024, height: 512, heightOutput: true },
  { name: "near", width: 2048, height: 1024, heightOutput: true },
];
const heightOffsetMeters = -4000;
const heightScaleMeters = 0.5;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${response.status}: ${url}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}
async function verified(file, expected) {
  const path = resolve(originals, file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; run --download first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== expected)
    throw new Error(`${file} SHA-256 mismatch: ${actual}`);
  return { path, bytes };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--download") && !args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-venus-surface.mjs --download | --rebuild",
    );
    process.exitCode = 2;
    return;
  }
  await mkdir(originals, { recursive: true });
  if (args.has("--download")) {
    await download(pageUrl, resolve(originals, "venus-source.html"));
    await download(source.url, resolve(originals, source.file));
    await download(radarSource.url, resolve(originals, radarSource.file));
  }
  const dem = await verified(source.file, source.sha256);
  const radar = await verified(radarSource.file, radarSource.sha256);
  const image = await (await fromFile(dem.path)).getImage();
  const width = image.getWidth(),
    height = image.getHeight();
  if (width !== 8192 || height !== 4096)
    throw new Error(`Unexpected source raster ${width}x${height}`);
  const keys = image.getGeoKeys();
  if (
    keys.ProjCoordTransGeoKey !== 17 ||
    keys.ProjCenterLongGeoKey !== 0 ||
    keys.GeogAngularUnitsGeoKey !== 9102
  )
    throw new Error(
      `Unexpected GeoTIFF projection metadata: ${JSON.stringify(keys)}`,
    );
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  if (!(originX < 0 && originY > 0 && resX > 0 && resY < 0))
    throw new Error("Source geotransform is not north-up west-to-east");
  await mkdir(assets, { recursive: true });
  await writeFile(resolve(assets, "venus-radar.jpg"), radar.bytes);
  const levelsManifest = {};
  for (const level of levels) {
    const raster = await image.readRasters({
      width: level.width,
      height: level.height,
      samples: [0],
      interleave: true,
    });
    let min = Infinity,
      max = -Infinity;
    const encoded = level.heightOutput
      ? Buffer.alloc(level.width * level.height * 2)
      : null;
    const gray = Buffer.alloc(level.width * level.height * 3);
    for (let i = 0; i < raster.length; i++) {
      const value = Number(raster[i]);
      const valid = Number.isFinite(value) && value !== -32768;
      const elevation = valid ? value : 0;
      if (valid) {
        min = Math.min(min, elevation);
        max = Math.max(max, elevation);
      }
      if (encoded)
        encoded.writeUInt16LE(
          Math.max(
            0,
            Math.min(
              65535,
              Math.round((elevation - heightOffsetMeters) / heightScaleMeters),
            ),
          ),
          i * 2,
        );
      // Unmeasured visible appearance; do not imply elevation is albedo.
      gray[i * 3] = 150;
      gray[i * 3 + 1] = 125;
      gray[i * 3 + 2] = 95;
    }
    const colorPath = resolve(assets, `venus-${level.name}.jpg`);
    await sharp(gray, {
      raw: { width: level.width, height: level.height, channels: 3 },
    })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const entry = {
      color: `/assets/surfaces/venus-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind:
        "constant illustrative ochre ground, not measured visible color or radar backscatter",
    };
    if (encoded) {
      const heightPath = resolve(assets, `venus-${level.name}.height.bin`);
      await writeFile(heightPath, encoded);
      Object.assign(entry, {
        heightUrl: `/assets/surfaces/venus-${level.name}.height.bin`,
        heightWidth: level.width,
        heightHeight: level.height,
        heightSha256: sha256(encoded),
        heightEncoding:
          "little-endian uint16; elevation = heightOffsetMeters + sample * heightScaleMeters",
        heightOffsetMeters,
        heightScaleMeters,
        minElevationMeters: min,
        maxElevationMeters: max,
      });
    }
    levelsManifest[level.name] = entry;
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-venus-surface.mjs",
    body: "venus",
    referenceRadiusMeters: 6051800,
    bodyrefSIradius: 6051800,
    sourceType: "real-magellan-altimetry-with-separate-radar-appearance",
    coordinates: {
      longitude: "east-positive -180..180",
      latitude: "planetocentric",
      projection: "simple cylindrical / equirectangular",
      northAtTop: true,
      pixelRegistration: "pixel-centered",
      sourceOriginMeters: [originX, originY],
      sourceResolutionMeters: [resX, resY],
      sourceCoverage: "global; NoData where unmeasured",
    },
    heightPolicy:
      "Measured Magellan altimetry elevations; NoData is encoded as zero only outside measured samples. Height is never inferred from image brightness.",
    provenance: {
      source,
      sourceMetadata: pageUrl,
      sourceGeoTIFF: {
        dimensions: "8192x4096",
        nodata: -32768,
        geotransform:
          "origin (-19009777.2544, 9504888.6272), pixel spacing (4641.0589, -4641.0589) m",
        projection:
          "Simple Cylindrical centered 0 degrees; planetocentric Venus sphere",
      },
      verticalDatum:
        "Venus mean-radius datum; source page describes elevation in meters relative to radius 6051800 m; radius = 6051800 + elevation",
      license:
        "USGS Astrogeology / NASA Magellan public-domain product; retain mission and product attribution",
      processing:
        "GeoTIFF geotransform and GeoKeys validated; north-up eastward source rows decoded and resampled directly to runtime east-positive -180..180; no eye-balled flip; uint16 height encoding with 0.5 m steps",
      coverage:
        "Global map with source NoData gaps; source measured elevation range -2951..11687 m",
    },
    radar: {
      url: "/assets/surfaces/venus-radar.jpg",
      source: radarSource,
      sourceMetadata:
        "https://astrogeology.usgs.gov/search/map/venus_magellan_sar_fmap_left_look_global_mosaic_75m",
      dimensions: "1024x467 grayscale JPEG browse sample",
      sha256: sha256(radar.bytes),
      appearance:
        "Magellan SAR radar backscatter; not visible color, not albedo, not height; black areas are source coverage gaps",
      license: "USGS Astrogeology / NASA Magellan public-domain product",
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(assets, "venus-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        sourceSha256: source.sha256,
        radarSha256: radarSource.sha256,
        levels: levelsManifest,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
