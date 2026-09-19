#!/usr/bin/env node
/** Prepare the pinned USGS Europa mapped mosaic and an explicitly procedural DEM. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originalDir = resolve(root, "output/surface-originals");
const outputDir = resolve(root, "assets/surfaces");
const source = {
  file: "europa-usgs-full.tif",
  url: "https://planetarymaps.usgs.gov/mosaic/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif",
  sha256: "a323f0c9ccb47d5af9902ea8297fe81f9a9708795645b80801f103c3f7c9a624",
  dimensions: "19631x9816 8-bit single-band GeoTIFF; 499.97456657942 m/pixel",
};
const label = {
  url: "https://astrogeology.usgs.gov/ckan/dataset/4080036f-afc5-422e-abe9-1c0c8e4f98ea/resource/db62f55a-9d03-474e-a349-1fd7d8f0d5fc/download/europa_voyager_galileossi_global_mosaic_500m.lbl",
  projection: "SimpleCylindrical",
  longitudeDirection: "PositiveWest",
  longitudeDomain: "0..360",
  centerLongitude: 180,
  latitudeType: "Planetocentric",
  upperLeftCornerMeters: [-4907750.3455436, 2453875.1727718],
  pixelResolutionMeters: 499.97456657942,
  radiusMeters: 1562089.9658,
};
const levels = [
  { name: "preview", width: 512, height: 256 },
  { name: "medium", width: 1024, height: 512 },
  { name: "near", width: 2048, height: 1024 },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifySource() {
  const path = resolve(originalDir, source.file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; download the pinned USGS GeoTIFF first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(`Europa source SHA-256 mismatch: ${actual}`);
  return path;
}

// Convert the source's positive-west 0..360 raster, whose prime center is 180W,
// to east-positive -180..180. This is a reversal plus a half-raster shift: a
// horizontal flip alone would leave the source's 0/360 seam at the wrong place.
async function normalizeEastPositive(path) {
  const { data, info } = await sharp(path, { limitInputPixels: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || info.width !== 19631 || info.height !== 9816)
    throw new Error(
      `Unexpected Europa source raster ${info.width}x${info.height}/${info.channels}ch`,
    );
  const normalized = Buffer.allocUnsafe(data.length);
  const midpoint = Math.floor(info.width / 2);
  for (let y = 0; y < info.height; y++) {
    const sourceRow = y * info.width;
    const outputRow = sourceRow;
    for (let x = 0; x < info.width; x++) {
      const sourceColumn = (midpoint - x + info.width) % info.width;
      normalized[outputRow + x] = data[sourceRow + sourceColumn];
    }
  }
  return { data: normalized, width: info.width, height: info.height };
}

function proceduralHeight(width, height) {
  // Independent synthetic relief, deliberately tiny relative to Europa's
  // 1,562 km radius. Values encode -96..95.5 m in 0.5 m units.
  const out = Buffer.alloc(width * height * 2);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const lat = (0.5 - v) * Math.PI,
        lon = (u - 0.5) * 2 * Math.PI;
      const dx = Math.cos(lat) * Math.cos(lon),
        dy = Math.sin(lat),
        dz = Math.cos(lat) * Math.sin(lon);
      const n =
        192 +
        Math.round(
          50 * Math.sin(dx * 17 + dy * 8) * Math.cos(dz * 13) +
            26 * Math.sin(dx * 31 + dy * 23 + dz * 19) +
            10 * Math.cos(dx * 67 - dy * 43 + dz * 51),
        );
      out.writeUInt16LE(Math.max(0, Math.min(383, n)), (y * width + x) * 2);
    }
  return out;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--download")) {
    await mkdir(originalDir, { recursive: true });
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Europa source ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== source.sha256)
      throw new Error("Europa source checksum mismatch");
    await writeFile(resolve(originalDir, source.file), bytes);
  }
  if (!args.has("--rebuild") && !args.has("--download")) {
    console.error("Usage: node scripts/prepare-europa-surface.mjs --rebuild");
    process.exitCode = 2;
    return;
  }
  const input = await verifySource();
  const raster = await normalizeEastPositive(input);
  await mkdir(outputDir, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(outputDir, `europa-${level.name}.jpg`);
    await sharp(raster.data, {
      raw: { width: raster.width, height: raster.height, channels: 1 },
    })
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const heightPath = resolve(outputDir, `europa-${level.name}.height.bin`);
    const height = proceduralHeight(level.width, level.height);
    await writeFile(heightPath, height);
    let minElevationMeters = Infinity;
    let maxElevationMeters = -Infinity;
    for (let i = 0; i < height.length; i += 2) {
      const elevation = -96 + height.readUInt16LE(i) * 0.5;
      minElevationMeters = Math.min(minElevationMeters, elevation);
      maxElevationMeters = Math.max(maxElevationMeters, elevation);
    }
    levelsManifest[level.name] = {
      color: `/assets/surfaces/europa-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      heightUrl: `/assets/surfaces/europa-${level.name}.height.bin`,
      heightWidth: level.width,
      heightHeight: level.height,
      heightSha256: sha256(height),
      heightOffsetMeters: -96,
      heightScaleMeters: 0.5,
      minElevationMeters,
      maxElevationMeters,
    };
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-europa-surface.mjs",
    coordinateConvention:
      "u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; north at top",
    bodies: {
      europa: {
        body: "europa",
        referenceRadiusMeters: 1560800,
        bodyrefSIradius: 1560800,
        sourceType: "mapped-imagery-plus-explicit-procedural-height",
        sourceOrganization:
          "USGS Astrogeology Science Center / NASA Voyager and Galileo SSI",
        coordinates: {
          longitude: "east-positive -180..180",
          latitude: "planetocentric",
          projection:
            "equirectangular (normalized from source Simple Cylindrical)",
          northAtTop: true,
          pixelRegistration: "pixel-centered",
          sourceLongitude: "positive-west 0..360",
          sourcePrimeCenter:
            "180W; source raster seam is shifted to runtime -180E before reversal",
        },
        heightPolicy:
          "Deterministic bounded procedural relief is independent of imagery and is not Europa topography; no brightness/albedo inference.",
        provenance: {
          citation:
            "USGS Astrogeology / NASA Voyager and Galileo SSI Europa Voyager-Galileo SSI Global Mosaic 500m",
          source,
          sourceMetadata:
            "https://astrogeology.usgs.gov/search/map/europa_voyager_galileo_ssi_global_mosaic_500m",
          sourceLabel: label,
          license:
            "USGS/NASA public-domain planetary imagery; retain product and mission attribution.",
          processing:
            "Pinned full GeoTIFF; decode 8-bit single-band raster; map source positive-west 0..360 with 180W prime center to east-positive -180..180 using reversal plus half-raster seam shift; Lanczos resize to 512/1024/2048; JPEG quality 88.",
          proceduralHeight:
            "Deterministic sinusoidal synthetic field, 0.5 m encoding, -96..95.5 m range; not measured relief and not derived from image pixels.",
        },
        levels: levelsManifest,
      },
    },
  };
  await writeFile(
    resolve(outputDir, "europa-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`prepared Europa derivatives in ${outputDir}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
