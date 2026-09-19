#!/usr/bin/env node
/** Prepare the pinned USGS/NASA Voyager 2 Triton color mosaic and synthetic relief. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif",
  url: "https://planetarymaps.usgs.gov/mosaic/Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif",
  sha256: "f20ed332e85df469725629b81d3a73ad026897fe561ec59d6245d249a09507db",
  dimensions: "14138x7069 8-bit three-band GeoTIFF; 600 m/pixel",
};
const levels = [
  { name: "preview", width: 512, height: 256, includeHeight: false },
  { name: "medium", width: 1024, height: 512, includeHeight: true },
  { name: "near", width: 2048, height: 1024, includeHeight: true },
];
const heightOffsetMeters = -512;
const heightScaleMeters = 1;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Download failed ${response.status}: ${url}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function verifySource() {
  const path = resolve(originals, source.file);
  if (!existsSync(path))
    throw new Error(
      `Missing pinned Triton source in ${originals}; run --download first`,
    );
  const actual = sha256(await readFile(path));
  if (actual !== source.sha256)
    throw new Error(`Triton source SHA-256 mismatch: ${actual}`);
  return path;
}

function proceduralHeight(width, height) {
  const bytes = Buffer.alloc(width * height * 2);
  let min = Infinity,
    max = -Infinity;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const lon = -Math.PI + ((x + 0.5) / width) * 2 * Math.PI;
      const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
      const c = Math.cos(lat);
      const dx = c * Math.cos(lon),
        dy = c * Math.sin(lon),
        dz = Math.sin(lat);
      const relief =
        180 * Math.sin(3 * dx - 2 * dy + dz) * Math.cos(4 * dy + dx - 2 * dz) +
        55 * Math.sin(8 * dx + 5 * dy - 3 * dz);
      const sample = Math.round(
        (relief - heightOffsetMeters) / heightScaleMeters,
      );
      if (sample < 0 || sample > 65535)
        throw new Error(`Triton procedural height overflow: ${sample}`);
      bytes.writeUInt16LE(sample, (y * width + x) * 2);
      min = Math.min(min, heightOffsetMeters + sample * heightScaleMeters);
      max = Math.max(max, heightOffsetMeters + sample * heightScaleMeters);
    }
  return { bytes, min, max };
}

async function rebuild() {
  const input = await verifySource();
  const metadata = await sharp(input, { limitInputPixels: false }).metadata();
  if (
    metadata.width !== 14138 ||
    metadata.height !== 7069 ||
    metadata.channels !== 3 ||
    metadata.depth !== "uchar"
  )
    throw new Error(
      `Unexpected Triton source raster: ${JSON.stringify(metadata)}`,
    );
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `triton-${level.name}.jpg`);
    await sharp(input, { limitInputPixels: false })
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const entry = {
      color: `/assets/surfaces/triton-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind: "USGS/NASA Voyager 2 synthesized color mosaic",
    };
    if (level.includeHeight) {
      const relief = proceduralHeight(level.width, level.height);
      const heightPath = resolve(assets, `triton-${level.name}.height.bin`);
      await writeFile(heightPath, relief.bytes);
      Object.assign(entry, {
        heightUrl: `/assets/surfaces/triton-${level.name}.height.bin`,
        heightWidth: level.width,
        heightHeight: level.height,
        heightSha256: sha256(relief.bytes),
        heightEncoding:
          "little-endian uint16; radial height = heightOffsetMeters + sample * heightScaleMeters",
        heightOffsetMeters,
        heightScaleMeters,
        minElevationMeters: relief.min,
        maxElevationMeters: relief.max,
      });
    }
    levelsManifest[level.name] = entry;
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-triton-surface.mjs",
    bodies: {
      triton: {
        body: "triton",
        referenceRadiusMeters: 1352600,
        bodyrefSIradius: 1352600,
        sourceType: "mapped-imagery-plus-explicit-procedural-height",
        sourceOrganization:
          "USGS Astrogeology Science Center / NASA JPL / Lunar and Planetary Institute",
        coordinates: {
          longitude: "east-positive -180..180",
          latitude: "planetocentric",
          projection: "equirectangular",
          northAtTop: true,
          pixelRegistration: "pixel-centered",
          sourceLongitude: "east-positive -180..180",
          sourceRadiusMeters: 1350000,
          sourceResolutionMeters: 600,
        },
        heightPolicy:
          "No reliable complete global Triton DEM is bundled. Deterministic bounded relief is generated from a seamless 3D direction-vector field independent of color; it is synthetic and not brightness inference or measured Triton topography.",
        provenance: {
          citation:
            "Triton Voyager 2 Global Color Mosaic 600m, USGS Astrogeology / NASA JPL / Lunar and Planetary Institute",
          source,
          sourceMetadata:
            "https://astrogeology.usgs.gov/search/map/triton_voyager_2_global_color_mosaic_600m",
          coverage:
            "Global mapped color mosaic assembled from Voyager 2 imagery; gaps were filled by neighboring pixels in the official product and coverage is uneven, especially away from the encounter hemisphere.",
          license:
            "NASA/JPL/USGS/LPI public-domain planetary imagery; retain mission and product attribution.",
          processing:
            "Validated 14138x7069 8-bit RGB GeoTIFF metadata; source is already east-positive -180..180 equirectangular and north-up; Lanczos resize to 512/1024/2048; JPEG quality 88 with 4:4:4 chroma.",
          proceduralHeight:
            "Seamless deterministic 3D direction-vector field, little-endian uint16, height = -512 + sample x 1 m; not measured relief and not derived from image pixels.",
          canonicalRadiusMeters: 1352600,
          sourceMetadataRadiusMeters: 1350000,
          radiusDifferenceMeters: 2600,
        },
        levels: levelsManifest,
      },
    },
  };
  await writeFile(
    resolve(assets, "triton-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      { sourceSha256: source.sha256, levels: levelsManifest },
      null,
      2,
    ),
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  await mkdir(originals, { recursive: true });
  if (args.has("--download")) {
    await download(source.url, resolve(originals, source.file));
    console.log("downloaded pinned Triton source; hash it and rebuild");
    return;
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-triton-surface.mjs --download | --rebuild",
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
