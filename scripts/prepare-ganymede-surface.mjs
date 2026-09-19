#!/usr/bin/env node
/** Prepare the pinned USGS Ganymede mapped mosaic and an explicit procedural DEM. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originalDir = resolve(root, "output/surface-originals");
const outputDir = resolve(root, "assets/surfaces");
const source = {
  file: "ganymede-usgs-full.tif",
  url: "https://planetarymaps.usgs.gov/mosaic/Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif",
  sha256: "c2c8d9506b8cf8f7a0a90d823d9052e91c8d9885cf7267fdce8de8216f4df888",
  dimensions: "16539x8270 8-bit single-band GeoTIFF; 1000.067192 m/pixel",
};
const sourceLabel = {
  file: "ganymede-usgs-full.lbl",
  url: "https://planetarymaps.usgs.gov/mosaic/Ganymede_Voyager_GalileoSSI_global_mosaic_1km.lbl",
  sha256: "4a9a2acc66ab9e5586ba97e8f8fa828c216333eea8ac910c8bf68b0afb96a599",
  projection: "SimpleCylindrical",
  longitudeDirection: "PositiveWest",
  longitudeDomain: "0..360",
  centerLongitude: 180,
  latitudeType: "Planetocentric",
  upperLeftCornerMeters: [-8270555.675418, 4135277.837709],
  pixelResolutionMeters: 1000.067192,
  sourceRadiusMeters: 2632344.9707,
};
const levels = [
  { name: "preview", width: 512, height: 256 },
  { name: "medium", width: 1024, height: 512 },
  { name: "near", width: 2048, height: 1024 },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Download failed ${response.status}: ${url}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function verifySource() {
  const path = resolve(originalDir, source.file);
  const labelPath = resolve(originalDir, sourceLabel.file);
  if (!existsSync(path) || !existsSync(labelPath)) {
    throw new Error(
      `Missing pinned source files in ${originalDir}; run with --download-pinned first`,
    );
  }
  const bytes = await readFile(path);
  const labelBytes = await readFile(labelPath);
  const actual = sha256(bytes);
  const actualLabel = sha256(labelBytes);
  if (
    source.sha256 === "REPLACE_AFTER_DOWNLOAD" ||
    sourceLabel.sha256 === "REPLACE_AFTER_DOWNLOAD"
  ) {
    throw new Error(
      "Source hashes are not pinned yet; update source.sha256 and sourceLabel.sha256",
    );
  }
  if (actual !== source.sha256)
    throw new Error(`Ganymede source SHA-256 mismatch: ${actual}`);
  if (actualLabel !== sourceLabel.sha256)
    throw new Error(`Ganymede label SHA-256 mismatch: ${actualLabel}`);
  return path;
}

// Convert the source positive-west 0..360 raster, whose prime center is 180W,
// to east-positive -180..180. This is a metadata-derived reversal plus a
// half-raster seam shift; it is not an eyeballed rotation.
async function normalizeEastPositive(path) {
  const { data, info } = await sharp(path, { limitInputPixels: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || info.width !== 16539 || info.height !== 8270)
    throw new Error(
      `Unexpected Ganymede source raster ${info.width}x${info.height}/${info.channels}ch`,
    );
  const normalized = Buffer.allocUnsafe(data.length);
  const midpoint = Math.floor(info.width / 2);
  for (let y = 0; y < info.height; y++) {
    const row = y * info.width;
    for (let x = 0; x < info.width; x++)
      normalized[row + x] =
        data[row + ((midpoint - x + info.width) % info.width)];
  }
  return { data: normalized, width: info.width, height: info.height };
}

// Synthetic relief is independent from color. The direction-vector formulation
// is continuous at both poles and at the longitude seam (no u/v edge artifact).
function proceduralHeight(width, height) {
  const out = Buffer.alloc(width * height * 2);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * Math.PI * 2 - Math.PI;
      const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
      const clat = Math.cos(lat);
      const dx = clat * Math.cos(lon),
        dy = clat * Math.sin(lon),
        dz = Math.sin(lat);
      const n =
        384 +
        Math.round(
          115 *
            Math.sin(3 * dx + 2 * dy - dz) *
            Math.cos(4 * dy - dx + 2 * dz) +
            42 * Math.sin(7 * dx - 5 * dy + 3 * dz),
        );
      out.writeUInt16LE(Math.max(0, Math.min(767, n)), (y * width + x) * 2);
    }
  return out;
}

async function rebuild() {
  const input = await verifySource();
  const raster = await normalizeEastPositive(input);
  await mkdir(outputDir, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(outputDir, `ganymede-${level.name}.jpg`);
    await sharp(raster.data, {
      raw: { width: raster.width, height: raster.height, channels: 1 },
    })
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const height = proceduralHeight(level.width, level.height);
    const heightPath = resolve(outputDir, `ganymede-${level.name}.height.bin`);
    await writeFile(heightPath, height);
    let minElevationMeters = Infinity,
      maxElevationMeters = -Infinity;
    for (let i = 0; i < height.length; i += 2) {
      const elevation = -192 + height.readUInt16LE(i) * 0.5;
      minElevationMeters = Math.min(minElevationMeters, elevation);
      maxElevationMeters = Math.max(maxElevationMeters, elevation);
    }
    levelsManifest[level.name] = {
      color: `/assets/surfaces/ganymede-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      heightUrl: `/assets/surfaces/ganymede-${level.name}.height.bin`,
      heightWidth: level.width,
      heightHeight: level.height,
      heightSha256: sha256(height),
      heightOffsetMeters: -192,
      heightScaleMeters: 0.5,
      minElevationMeters,
      maxElevationMeters,
    };
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-ganymede-surface.mjs",
    coordinateConvention:
      "u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; north at top",
    bodies: {
      ganymede: {
        body: "ganymede",
        referenceRadiusMeters: 2631200,
        bodyrefSIradius: 2631200,
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
            "180W; source raster seam shifted to runtime -180E before reversal",
        },
        heightPolicy:
          "Deterministic bounded procedural relief is independent of imagery and is not Ganymede topography; no brightness/albedo inference.",
        provenance: {
          citation:
            "USGS Astrogeology / NASA Voyager and Galileo SSI Ganymede Voyager-Galileo SSI Global Mosaic 1km",
          source,
          sourceLabel,
          sourceMetadata:
            "https://astrogeology.usgs.gov/search/map/ganymede_voyager_galileo_ssi_global_mosaic_1km",
          license:
            "USGS/NASA public-domain planetary imagery; retain product and mission attribution.",
          processing:
            "Pinned full GeoTIFF; decode 8-bit single-band raster; metadata-derived positive-west 0..360 to east-positive -180..180 reversal plus half-raster seam shift; north-up; Lanczos resize to 512/1024/2048; JPEG quality 88.",
          proceduralHeight:
            "Deterministic direction-vector 3D trigonometric field, little-endian uint16 with height = -192 + sample x 0.5 m, -192..191.5 m; not measured relief and not derived from image pixels.",
        },
        levels: levelsManifest,
      },
    },
  };
  await writeFile(
    resolve(outputDir, "ganymede-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`prepared Ganymede derivatives in ${outputDir}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  await mkdir(originalDir, { recursive: true });
  if (args.has("--download-pinned")) {
    await download(source.url, resolve(originalDir, source.file));
    await download(sourceLabel.url, resolve(originalDir, sourceLabel.file));
    console.log("downloaded pinned Ganymede source and label");
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-ganymede-surface.mjs --download-pinned | --rebuild [--offline]",
    );
    process.exitCode = 2;
    return;
  }
  await rebuild();
}
main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
