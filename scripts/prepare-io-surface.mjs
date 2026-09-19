#!/usr/bin/env node
/** Prepare the bounded USGS Io image sample and an explicitly procedural DEM. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originalDir = resolve(root, "output/surface-originals");
const outputDir = resolve(root, "assets/surfaces");
const source = {
  file: "io-usgs-full.jpg",
  url: "https://astrogeology.usgs.gov/ckan/dataset/3072a685-011c-40c3-9a7b-fdd121e80308/resource/825edaa2-f3fc-4d1d-85b0-33153260ea4d/download/full.jpg",
  sha256: "f7a0661d04046f10a903c2d6fe2d179f47b3d02d3d87be5e41824321a6766b6a",
  dimensions: "1024x512 RGB JPEG sample; source metadata 11445x5723",
};
const levels = [
  {
    name: "preview",
    width: 512,
    height: 256,
    heightWidth: 512,
    heightHeight: 256,
  },
  {
    name: "medium",
    width: 1024,
    height: 512,
    heightWidth: 1024,
    heightHeight: 512,
  },
  // The official bounded sample is 1024 wide. Do not upsample it to 2048.
  {
    name: "near",
    width: 1024,
    height: 512,
    heightWidth: 1024,
    heightHeight: 512,
  },
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifySource() {
  const path = resolve(originalDir, source.file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; download the pinned USGS sample first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(`Io source SHA-256 mismatch: ${actual}`);
  return path;
}

function proceduralHeight(width, height) {
  // Independent synthetic relief: no source color channel participates.
  // Values encode -64..63.5 m in 0.5 m units and are intentionally labeled.
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
        128 +
        Math.round(
          42 * Math.sin(dx * 17 + dy * 9) * Math.cos(dz * 23 - dy * 7) +
            18 * Math.sin(dx * 41 + dy * 31 + dz * 37),
        );
      out.writeUInt16LE(Math.max(0, Math.min(255, n)), (y * width + x) * 2);
    }
  return out;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--rebuild") && !args.has("--download")) {
    console.error(
      "Usage: node scripts/prepare-io-surface.mjs --rebuild | --download",
    );
    process.exitCode = 2;
    return;
  }
  if (args.has("--download")) {
    await mkdir(originalDir, { recursive: true });
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Io download ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== source.sha256)
      throw new Error("Io source checksum mismatch");
    await writeFile(resolve(originalDir, source.file), bytes);
  }
  const input = await verifySource();
  await mkdir(outputDir, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(outputDir, `io-${level.name}.jpg`);
    // USGS label says positive-west; horizontal flip is the metadata-derived
    // conversion to runtime east-positive, not visual alignment.
    await sharp(input)
      .flop()
      .resize(level.width, level.height, { fit: "fill" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const heightPath = resolve(outputDir, `io-${level.name}.height.bin`);
    const height = proceduralHeight(level.heightWidth, level.heightHeight);
    await writeFile(heightPath, height);
    levelsManifest[level.name] = {
      color: `/assets/surfaces/io-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      heightUrl: `/assets/surfaces/io-${level.name}.height.bin`,
      heightWidth: level.heightWidth,
      heightHeight: level.heightHeight,
      heightSha256: sha256(height),
      heightOffsetMeters: -64,
      heightScaleMeters: 0.5,
      minElevationMeters: -64,
      maxElevationMeters: 63.5,
    };
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-io-surface.mjs",
    body: "io",
    referenceRadiusMeters: 1821460,
    bodyrefSIradius: 1821460,
    sourceType: "mapped-imagery-plus-explicit-procedural-height",
    coordinates: {
      longitude: "east-positive -180..180",
      latitude: "planetocentric",
      sourceLongitude: "positive west -180..180",
      projection: "simple cylindrical",
      northAtTop: true,
      operation:
        "metadata-derived horizontal flip from positive-west source; no visual rotation",
    },
    heightPolicy:
      "Procedural bounded relief is independent of imagery and is not Io topography; no brightness/albedo inference.",
    provenance: {
      citation:
        "USGS Astrogeology / NASA Galileo SSI Voyager-Galileo false-color global mosaic",
      source,
      sourceMetadata:
        "https://astrogeology.usgs.gov/search/map/io_voyager_galileo_ssi_false_color_global_mosaic_1km",
      license:
        "USGS/NASA public-domain planetary imagery; retain product and mission attribution.",
      orientationReference:
        "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc",
      processing:
        "Pinned 1024px sample; decode; metadata-derived positive-west to east-positive horizontal flip; resize to 512 and 1024 only; JPEG quality 88.",
      proceduralHeight:
        "Deterministic sinusoidal synthetic field, 0.5 m encoding, -64..63.5 m range; not measured relief and not derived from image pixels.",
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(outputDir, "io-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`prepared Io derivatives in ${outputDir}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
