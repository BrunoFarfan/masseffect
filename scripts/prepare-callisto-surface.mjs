#!/usr/bin/env node
/** Prepare the pinned USGS Callisto mosaic and an explicitly synthetic DEM. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originalDir = resolve(root, "output/surface-originals");
const outputDir = resolve(root, "assets/surfaces");
const source = {
  file: "callisto-usgs-full.tif",
  url: "https://planetarymaps.usgs.gov/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif",
  sha256: "e1f0bd2e0e05de605d067d6b5f5ededddaf31ca6c064562a1ca770f15a7dbaa3",
  dimensions: "15138x7569 8-bit single-band GeoTIFF; 1000.0051966711 m/pixel",
};
const sourceLabel = {
  file: "callisto-usgs-full.lbl",
  url: "https://planetarymaps.usgs.gov/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.lbl",
  sha256: "208aa459c0a28f8f5104bfabcc8cd642a3a4fc53f5a74d00b66d9a4d8dd43080",
  projection: "SimpleCylindrical",
  longitudeDirection: "PositiveWest",
  longitudeDomain: "0..360",
  centerLongitude: 180,
  latitudeType: "Planetocentric",
  upperLeftCornerMeters: [-7569039.3336036, 3784519.6668018],
  pixelResolutionMeters: 1000.0051966711,
  sourceRadiusMeters: 2409300.0488,
};
const levels = [
  { name: "preview", width: 512, height: 256, includeHeight: false },
  { name: "medium", width: 1024, height: 512, includeHeight: true },
  { name: "near", width: 2048, height: 1024, includeHeight: true },
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
  if (!existsSync(path) || !existsSync(labelPath))
    throw new Error(
      `Missing pinned source files in ${originalDir}; run --download-pinned first`,
    );
  const actual = sha256(await readFile(path));
  const actualLabel = sha256(await readFile(labelPath));
  if (actual !== source.sha256)
    throw new Error(`Callisto source SHA-256 mismatch: ${actual}`);
  if (actualLabel !== sourceLabel.sha256)
    throw new Error(`Callisto label SHA-256 mismatch: ${actualLabel}`);
  return path;
}

// Positive-west 0..360 with a 180W center is converted from label metadata:
// reverse longitude and shift the half-raster seam, yielding east-positive
// -180..180. This is not an eyeballed rotation.
async function normalizeEastPositive(path) {
  const { data, info } = await sharp(path, { limitInputPixels: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || info.width !== 15138 || info.height !== 7569)
    throw new Error(
      `Unexpected Callisto source raster ${info.width}x${info.height}/${info.channels}ch`,
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

// Independent bounded relief. The unit direction vector makes the field
// continuous at the longitude seam and both poles; color never participates.
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
      const sample =
        512 +
        Math.round(
          165 *
            Math.sin(3 * dx - 2 * dy + dz) *
            Math.cos(4 * dy + dx - 2 * dz) +
            50 * Math.sin(7 * dx + 5 * dy - 3 * dz),
        );
      out.writeUInt16LE(
        Math.max(0, Math.min(1023, sample)),
        (y * width + x) * 2,
      );
    }
  return out;
}

async function rebuild() {
  const input = await verifySource();
  const raster = await normalizeEastPositive(input);
  await mkdir(outputDir, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(outputDir, `callisto-${level.name}.jpg`);
    await sharp(raster.data, {
      raw: { width: raster.width, height: raster.height, channels: 1 },
    })
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const descriptor = {
      color: `/assets/surfaces/callisto-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
    };
    if (level.includeHeight) {
      const height = proceduralHeight(level.width, level.height);
      const heightPath = resolve(
        outputDir,
        `callisto-${level.name}.height.bin`,
      );
      await writeFile(heightPath, height);
      let minElevationMeters = Infinity,
        maxElevationMeters = -Infinity;
      for (let i = 0; i < height.length; i += 2) {
        const elevation = -256 + height.readUInt16LE(i) * 0.5;
        minElevationMeters = Math.min(minElevationMeters, elevation);
        maxElevationMeters = Math.max(maxElevationMeters, elevation);
      }
      Object.assign(descriptor, {
        heightUrl: `/assets/surfaces/callisto-${level.name}.height.bin`,
        heightWidth: level.width,
        heightHeight: level.height,
        heightSha256: sha256(height),
        heightOffsetMeters: -256,
        heightScaleMeters: 0.5,
        minElevationMeters,
        maxElevationMeters,
      });
    }
    levelsManifest[level.name] = descriptor;
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-callisto-surface.mjs",
    coordinateConvention:
      "u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; north at top",
    bodies: {
      callisto: {
        body: "callisto",
        referenceRadiusMeters: 2410300,
        bodyrefSIradius: 2410300,
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
          geotransformNote:
            "Source label upper-left projected origin and pixel resolution are retained in provenance; normalized output is generated from that metadata, not eyeballed.",
        },
        heightPolicy:
          "Deterministic bounded procedural relief is independent of imagery and is not Callisto topography; no brightness/albedo inference.",
        provenance: {
          citation:
            "USGS Astrogeology / NASA Voyager and Galileo SSI Callisto Galileo/Voyager Global Mosaic 1km",
          source,
          sourceLabel,
          sourceMetadata:
            "https://astrogeology.usgs.gov/search/map/callisto_galileo_voyager_global_mosaic_1km",
          license:
            "USGS/NASA public-domain planetary imagery; retain product and mission attribution.",
          processing:
            "Pinned full GeoTIFF; decode 8-bit single-band raster; metadata-derived positive-west 0..360 to east-positive -180..180 reversal plus half-raster seam shift; north-up; Lanczos resize to 512/1024/2048; JPEG quality 88 with no legend or map decoration.",
          proceduralHeight:
            "Deterministic direction-vector 3D trigonometric field, little-endian uint16 with height = -256 + sample x 0.5 m; bounded decoded range is recorded per level; not measured relief and not derived from image pixels.",
          canonicalRadiusMeters: 2410300,
          sourceMetadataRadiusMeters: 2409300.0488,
          radiusDifferenceMeters: 999.9512,
        },
        levels: levelsManifest,
      },
    },
  };
  await writeFile(
    resolve(outputDir, "callisto-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`prepared Callisto derivatives in ${outputDir}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  await mkdir(originalDir, { recursive: true });
  if (args.has("--download-pinned")) {
    await download(source.url, resolve(originalDir, source.file));
    await download(sourceLabel.url, resolve(originalDir, sourceLabel.file));
    console.log(
      "downloaded pinned Callisto source and label; rebuild with --offline",
    );
    return;
  }
  if (!args.has("--rebuild") && !args.has("--offline")) {
    console.error(
      "Usage: node scripts/prepare-callisto-surface.mjs --download-pinned | --rebuild [--offline]",
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
