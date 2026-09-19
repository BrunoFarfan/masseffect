#!/usr/bin/env node
/** Prepare NASA's representative Jupiter atmospheric appearance texture. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "jupiter-voyager-texture.webp",
  url: "https://assets.science.nasa.gov/dynamicimage/assets/science/cds/3d/resources/image/jupiter/preview.webp?w=2048",
  sha256: "5e5a2dfe105f363611028abc3c6685d15be567fdfec92928df38799db7f37d48",
  dimensions: "2048x1024 WebP, 8-bit sRGB, 3-channel",
};
const levels = [
  { name: "preview", width: 512, height: 256 },
  { name: "medium", width: 1024, height: 512 },
  { name: "near", width: 2048, height: 1024 },
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function downloadPinned() {
  const response = await fetch(source.url);
  if (!response.ok)
    throw new Error(`Download failed ${response.status}: ${source.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(`Jupiter source SHA-256 mismatch: ${actual}`);
  await writeFile(resolve(originals, source.file), bytes);
}

async function verifySource() {
  const path = resolve(originals, source.file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; run --download-pinned first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(`Jupiter source SHA-256 mismatch: ${actual}`);
  const metadata = await sharp(path).metadata();
  if (
    metadata.width !== 2048 ||
    metadata.height !== 1024 ||
    metadata.channels !== 3
  )
    throw new Error(
      `Unexpected Jupiter source raster ${metadata.width}x${metadata.height}/${metadata.channels}ch`,
    );
  return path;
}

async function rebuild() {
  const input = await verifySource();
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `jupiter-${level.name}.jpg`);
    await sharp(input)
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    levelsManifest[level.name] = {
      color: `/assets/surfaces/jupiter-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind:
        "NASA/JPL/Caltech Voyager representative atmospheric appearance",
    };
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-jupiter-surface.mjs",
    body: "jupiter",
    referenceRadiusMeters: 69911000,
    bodyrefSIradius: 69911000,
    sourceType: "mapped-voyager-representative-atmospheric-appearance",
    sourceOrganization: "NASA/JPL/Caltech",
    coordinateConvention:
      "u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; north at top",
    coordinates: {
      longitude: "east-positive -180..180",
      latitude: "planetocentric",
      projection: "equirectangular texture supplied for NASA 3-D resource",
      northAtTop: true,
      pixelRegistration: "pixel-centered",
    },
    heightPolicy:
      "No height products are emitted. Jupiter is represented by color-only atmospheric appearance; cloud brightness and band structure are never interpreted as terrain or elevation.",
    provenance: {
      citation:
        "NASA Jupiter 3-D resource; texture from Voyager images; credit JPL & Caltech.",
      source,
      sourceMetadata: "https://science.nasa.gov/3d-resources/jupiter/",
      missionReference: "https://maps.jpl.nasa.gov/tmaps/jupiter.html",
      alignmentStatus:
        "The NASA visualization resource does not publish a cartographic geotransform or prime-meridian convention. Runtime adopts north-up east-positive lookup; absolute imagery alignment is unverified, not a scientific coordinate product.",
      coverage:
        "Representative global atmospheric appearance; cloud patterns are time-variable and are not a current weather map.",
      license:
        "NASA/JPL/Caltech public mission imagery; retain NASA, JPL and Caltech attribution.",
      processing:
        "Pinned 2048x1024 NASA WebP; resized without reprojection to 512x256, 1024x512 and native-capped 2048x1024 JPEG derivatives; color only.",
      caution:
        "JPL states that gas-giant maps are representative, atmospheric dynamics change daily, and the textures should not be used for scientific analysis.",
      canonicalRadiusMeters: 69911000,
      sourceReferenceRadiusMeters: null,
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(assets, "jupiter-manifest.json"),
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
  if (args.has("--download-pinned")) {
    await downloadPinned();
    console.log(
      "downloaded pinned Jupiter Voyager texture; rebuild with --rebuild",
    );
    if (!args.has("--rebuild")) return;
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-jupiter-surface.mjs --download-pinned [--rebuild]",
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
