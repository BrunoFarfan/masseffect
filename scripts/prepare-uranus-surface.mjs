#!/usr/bin/env node
/** Prepare JPL's representative Uranus atmospheric appearance texture. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "uranus-jpl-texture.jpg",
  url: "https://maps.jpl.nasa.gov/tmaps/pix/ura0fss1.jpg",
  sha256: "07020f4707f67a6572f8e823c4bbb00d71028d4550be684b8297ebea8f896aa2",
  dimensions: "720x360 JPEG, 8-bit sRGB, 3-channel",
};
const levels = [
  { name: "preview", width: 512, height: 256 },
  // The source is 720x360; native cap means never upscale it.
  { name: "medium", width: 720, height: 360 },
  { name: "near", width: 720, height: 360 },
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function downloadPinned() {
  const response = await fetch(source.url);
  if (!response.ok)
    throw new Error(`Download failed ${response.status}: ${source.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(`Uranus source SHA-256 mismatch: ${actual}`);
  await writeFile(resolve(originals, source.file), bytes);
}

async function verifySource() {
  const path = resolve(originals, source.file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; run --download-pinned first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(`Uranus source SHA-256 mismatch: ${actual}`);
  const metadata = await sharp(path).metadata();
  if (
    metadata.width !== 720 ||
    metadata.height !== 360 ||
    metadata.channels !== 3 ||
    metadata.depth !== "uchar"
  )
    throw new Error(
      `Unexpected Uranus source raster ${JSON.stringify(metadata)}`,
    );
  return path;
}

async function rebuild() {
  const input = await verifySource();
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `uranus-${level.name}.jpg`);
    await sharp(input)
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    levelsManifest[level.name] = {
      color: `/assets/surfaces/uranus-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind: "NASA/JPL representative atmospheric appearance",
    };
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-uranus-surface.mjs",
    body: "uranus",
    referenceRadiusMeters: 25362000,
    bodyrefSIradius: 25362000,
    sourceType: "mapped-representative-atmospheric-appearance",
    sourceOrganization: "NASA/JPL/Caltech Solar System Simulator",
    coordinateConvention:
      "Runtime samples the supplied 2:1 texture with east-positive -180..180 and north-at-top conventions; source longitude alignment and prime meridian are unverified.",
    coordinates: {
      longitude: "runtime east-positive -180..180; source alignment unverified",
      latitude: "runtime planetocentric; source alignment unverified",
      projection:
        "2:1 image texture; exact source projection metadata is not published",
      northAtTop: "unverified from source metadata",
      pixelRegistration: "pixel-centered derivative convention",
    },
    heightPolicy:
      "Uranus is an ice giant: no solid terrain or height files are emitted. Atmospheric color and band/brightness appearance are never elevation.",
    provenance: {
      citation:
        "NASA/JPL/Caltech Solar System Simulator Uranus texture map; JPL identifies it as a fictional plain solid-blue representative texture.",
      source,
      sourceMetadata: "https://science.nasa.gov/resource/uranus-3d-model/",
      mapCatalog: "https://maps.jpl.nasa.gov/tmaps/uranus.html",
      coverage:
        "Global representative atmospheric appearance; JPL states that Uranus maps are representative, atmospheric dynamics change daily, and textures are not for scientific analysis.",
      license:
        "NASA/JPL/Caltech public resource; retain NASA/JPL attribution and fictional/representative qualification.",
      processing:
        "Pinned 720x360 JPL JPEG; verified 8-bit sRGB 3-channel metadata; resized without reprojection to 512x256 preview and native-capped 720x360 medium and near JPEG derivatives; color only.",
      orientationEvidence:
        "JPL publishes a rendered texture but no cartographic geotransform, prime meridian, longitude sign, or pole-orientation metadata. Pixel order is preserved without flip or rotate; absolute imagery alignment is unverified.",
      canonicalRadiusMeters: 25362000,
      sourceReferenceRadiusMeters: null,
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(assets, "uranus-manifest.json"),
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
      "downloaded pinned Uranus JPL atmospheric texture; rebuild with --rebuild",
    );
    if (!args.has("--rebuild")) return;
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-uranus-surface.mjs --download-pinned [--rebuild]",
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
