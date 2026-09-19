#!/usr/bin/env node
/** Build Enceladus DEM derivatives from the pinned USGS/ASC Cassini product. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fromFile } from "geotiff";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "enceladus-dem.tif",
  url: "https://asc-astropedia.s3.us-west-2.amazonaws.com/Enceladus/Cassini/Enceladus_Cassini_DEM_global_200m_schenk2024.tif",
  metadataUrl:
    "https://astrogeology.usgs.gov/search/map/enceladus-cassini-global-dem-200m-schenk",
  sha256: "7c08c46238cde6528c9143f0c667d42cd3bc6ac60c572595a7e6cad2d6775f91",
  dimensions: "8049x4025 32-bit floating-point GeoTIFF; 200 m/pixel",
};
const levels = [
  { name: "preview", width: 512, height: 256, heightOutput: false },
  { name: "medium", width: 1024, height: 512, heightOutput: true },
  { name: "near", width: 2048, height: 1024, heightOutput: true },
];
const ellipsoid = { a: 256200, b: 251400, c: 248600 };
const runtimeRadiusMeters = 252100;
const heightOffsetMeters = -5000;
const heightScaleMeters = 0.5;
const noDataThreshold = -1e30;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${response.status}: ${url}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function verifySource() {
  const path = resolve(originals, source.file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; run with --download first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(
      `Enceladus DEM SHA-256 mismatch: expected ${source.sha256}, got ${actual}`,
    );
  return { path, bytes };
}

function ellipsoidRadius(latitude, longitude) {
  const cosLat = Math.cos(latitude);
  const x = cosLat * Math.cos(longitude);
  const y = cosLat * Math.sin(longitude);
  const z = Math.sin(latitude);
  return (
    1 /
    Math.sqrt(
      (x * x) / ellipsoid.a ** 2 +
        (y * y) / ellipsoid.b ** 2 +
        (z * z) / ellipsoid.c ** 2,
    )
  );
}

function encodeHeight(value, latitude, longitude) {
  const valid = Number.isFinite(value) && value >= noDataThreshold;
  // The DEM stores elevations in kilometres relative to the triaxial shape.
  const radialHeight =
    ellipsoidRadius(latitude, longitude) +
    (valid ? value * 1000 : 0) -
    runtimeRadiusMeters;
  const sample = Math.round(
    (radialHeight - heightOffsetMeters) / heightScaleMeters,
  );
  if (sample < 0 || sample > 65535)
    throw new Error("Enceladus elevation exceeds encoding range");
  return {
    sample,
    valid,
    elevation: heightOffsetMeters + sample * heightScaleMeters,
  };
}

function writeU16(values) {
  const bytes = Buffer.alloc(values.length * 2);
  for (let i = 0; i < values.length; i++) bytes.writeUInt16LE(values[i], i * 2);
  return bytes;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--download") && !args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-enceladus-surface.mjs --download [--rebuild]",
    );
    process.exitCode = 2;
    return;
  }
  await mkdir(originals, { recursive: true });
  if (args.has("--download")) {
    await download(
      source.metadataUrl,
      resolve(originals, "enceladus-source.html"),
    );
    await download(source.url, resolve(originals, source.file));
  }
  const verified = await verifySource();
  const tiff = await fromFile(verified.path);
  try {
    const image = await tiff.getImage();
    if (image.getWidth() !== 8049 || image.getHeight() !== 4025)
      throw new Error(
        `Unexpected Enceladus DEM dimensions ${image.getWidth()}x${image.getHeight()}`,
      );
    const dir = image.getFileDirectory();
    if (
      image.getBitsPerSample() !== 32 ||
      image.getSampleFormat() !== 3 ||
      image.getSamplesPerPixel() !== 1
    )
      throw new Error("Unexpected Enceladus GeoTIFF sample format");
    const noData = image.getGDALNoData?.();
    if (!Number.isFinite(Number(noData)) || Number(noData) > -1e30)
      throw new Error(`Unexpected GDAL NoData ${noData}`);
    const metadata = image.getGDALMetadata?.() || "";
    if (/<Item name="(?:SCALE|OFFSET)"/i.test(String(metadata)))
      throw new Error(
        "Unexpected GDAL SCALE/OFFSET metadata; source values must remain explicitly interpreted as kilometres",
      );
    const keys = image.getGeoKeys();
    const origin = image.getOrigin();
    const resolution = image.getResolution();
    if (
      keys.ProjCoordTransGeoKey !== 17 ||
      keys.ProjCenterLongGeoKey !== 180 ||
      origin[0] !== -805000 ||
      origin[1] !== 402600 ||
      resolution[0] !== 200 ||
      resolution[1] !== -200
    )
      throw new Error(
        `Unexpected Enceladus georeferencing: ${JSON.stringify({ keys, origin, resolution })}`,
      );
    await mkdir(assets, { recursive: true });
    const levelsManifest = {};
    for (const level of levels) {
      const raster = await image.readRasters({
        width: level.width,
        height: level.height,
        samples: [0],
        interleave: true,
      });
      const color = Buffer.alloc(level.width * level.height * 3);
      color.fill(220);
      const colorPath = resolve(assets, `enceladus-${level.name}.jpg`);
      await sharp(color, {
        raw: { width: level.width, height: level.height, channels: 3 },
      })
        .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
        .toFile(colorPath);
      const entry = {
        color: `/assets/surfaces/enceladus-${level.name}.jpg`,
        width: level.width,
        height: level.height,
        colorSha256: sha256(await readFile(colorPath)),
        colorKind:
          "constant soft-ice fallback; no mapped color source was downloaded",
      };
      if (level.heightOutput) {
        const encoded = new Uint16Array(level.width * level.height);
        let min = Infinity,
          max = -Infinity,
          validCount = 0;
        const halfWidth = Math.floor(level.width / 2);
        for (let y = 0; y < level.height; y++)
          for (let x = 0; x < level.width; x++) {
            // Source is 0..360 east-positive (center longitude 180); shift the seam to -180..180.
            const sourceValue = Number(
              raster[y * level.width + ((x + halfWidth) % level.width)],
            );
            const latitude = Math.PI / 2 - ((y + 0.5) / level.height) * Math.PI;
            const longitude =
              -Math.PI + ((x + 0.5) / level.width) * 2 * Math.PI;
            const sample = encodeHeight(sourceValue, latitude, longitude);
            encoded[y * level.width + x] = sample.sample;
            if (sample.valid) validCount++;
            min = Math.min(min, sample.elevation);
            max = Math.max(max, sample.elevation);
          }
        const heightBytes = writeU16(encoded);
        const heightPath = resolve(
          assets,
          `enceladus-${level.name}.height.bin`,
        );
        await writeFile(heightPath, heightBytes);
        Object.assign(entry, {
          heightUrl: `/assets/surfaces/enceladus-${level.name}.height.bin`,
          heightWidth: level.width,
          heightHeight: level.height,
          heightSha256: sha256(heightBytes),
          heightEncoding:
            "little-endian uint16; radial height = heightOffsetMeters + sample * heightScaleMeters",
          heightOffsetMeters,
          heightScaleMeters,
          minElevationMeters: min,
          maxElevationMeters: max,
          noDataPolicy:
            "Source NoData is filled with the reference triaxial ellipsoid (zero relief); filled samples are not measured terrain.",
          validSampleFraction: validCount / encoded.length,
        });
      }
      levelsManifest[level.name] = entry;
    }
    const manifest = {
      schemaVersion: 1,
      generatedBy: "scripts/prepare-enceladus-surface.mjs",
      body: "enceladus",
      referenceRadiusMeters: runtimeRadiusMeters,
      bodyrefSIradius: runtimeRadiusMeters,
      sourceType: "real-cassini-dem-with-explicit-radial-height-conversion",
      coordinates: {
        longitude: "east-positive -180..180",
        latitude: "planetocentric",
        projection: "simple cylindrical / equirectangular",
        northAtTop: true,
        pixelRegistration: "pixel-centered",
        sourceLongitude:
          "east-positive 0..360 centered at 180 degrees; output columns half-raster shifted to -180..180",
      },
      baseRadiiMeters: [ellipsoid.a, ellipsoid.c, ellipsoid.b],
      heightPolicy:
        "Measured Schenk 2024 DEM elevations relative to the Thomas et al. 2016 triaxial ellipsoid, converted to physical radial height as ellipsoidRadius(direction) + DEM elevation - runtime canonical radius. Source NoData is explicitly filled and labeled; no color or brightness inference.",
      provenance: {
        source,
        sourceGeoTIFF: {
          dimensions: "8049x4025",
          sampleType: "32-bit IEEE floating point",
          gdalNoData: -3.40282265508890445e38,
          gdalScale: "absent (1.0 implied)",
          gdalOffset: "absent (0.0 implied)",
          originMeters: origin.slice(0, 2),
          resolutionMeters: resolution.slice(0, 2),
          elevationUnits: "kilometres",
        },
        referenceShape: {
          model: "Thomas et al. 2016 triaxial ellipsoid",
          semiAxesMeters: ellipsoid,
          radialFormula:
            "R=1/sqrt((x/a)^2+(y/b)^2+(z/c)^2) for unit direction (x,y,z)",
        },
        runtimeDatum: "canonical spherical radius 252100 m",
        processing:
          "Validated GeoTIFF tags/georeferencing; converted source km to metres; computed triaxial radial surface radius by pixel direction; shifted source 0..360 seam by half raster; encoded radial heights as uint16 little-endian at 0.5 m steps; filled NoData with reference triaxial ellipsoid (zero relief) and labeled it.",
        attribution:
          "USGS Astrogeology Science Center / NASA Cassini / Lunar and Planetary Institute; Schenk and McKinnon (2024); Thomas et al. (2016)",
      },
      levels: levelsManifest,
    };
    await writeFile(
      resolve(assets, "enceladus-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    console.log(
      JSON.stringify(
        { sourceSha256: source.sha256, levels: levelsManifest },
        null,
        2,
      ),
    );
  } finally {
    await tiff.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
