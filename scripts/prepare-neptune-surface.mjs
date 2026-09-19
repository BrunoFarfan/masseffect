#!/usr/bin/env node
/** Prepare NASA/JPL's representative Neptune atmospheric appearance texture. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "neptune-nasa-texture.webp",
  url: "https://assets.science.nasa.gov/dynamicimage/assets/science/cds/3d/resources/image/neptune/preview.webp?w=2048",
  sha256: "b7a227bcf7d0d38a810432d9983aed60c47f7708e547ff3c912280e40e9b7f9d",
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
    throw new Error(`Neptune source SHA-256 mismatch: ${actual}`);
  await writeFile(resolve(originals, source.file), bytes);
}

async function verifySource() {
  const path = resolve(originals, source.file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; run --download-pinned first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(`Neptune source SHA-256 mismatch: ${actual}`);
  const metadata = await sharp(path).metadata();
  if (
    metadata.width !== 2048 ||
    metadata.height !== 1024 ||
    metadata.channels !== 3 ||
    metadata.depth !== "uchar"
  )
    throw new Error(
      `Unexpected Neptune source raster ${JSON.stringify(metadata)}`,
    );
  return path;
}

async function rebuild() {
  const input = await verifySource();
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `neptune-${level.name}.jpg`);
    await sharp(input)
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    levelsManifest[level.name] = {
      color: `/assets/surfaces/neptune-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind: "NASA/JPL representative atmospheric cloud appearance",
    };
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-neptune-surface.mjs",
    body: "neptune",
    referenceRadiusMeters: 24622000,
    bodyrefSIradius: 24622000,
    sourceType: "mapped-representative-atmospheric-appearance",
    sourceOrganization: "NASA/JPL-Caltech",
    coordinateConvention:
      "Runtime samples the supplied 2:1 texture with east-positive -180..180 and north-at-top conventions; source longitude alignment and prime meridian are unverified.",
    coordinates: {
      longitude: "east-positive -180..180; source alignment unverified",
      latitude: "planetocentric; source alignment unverified",
      projection:
        "2:1 image texture; exact source projection metadata is not published",
      northAtTop: "unverified from source metadata",
      pixelRegistration: "pixel-centered derivative convention",
    },
    heightPolicy:
      "Neptune is a gas giant: no solid terrain or height files are emitted. Cloud-top brightness is atmospheric appearance, never elevation.",
    provenance: {
      citation:
        "NASA Neptune 3-D resource; representative texture from NASA/JPL planetary map resources.",
      source,
      sourceMetadata: "https://science.nasa.gov/3d-resources/neptune/",
      mapCatalog: "https://maps.jpl.nasa.gov/tmaps/neptune.html",
      coverage:
        "Representative global-looking atmospheric cloud appearance. JPL cautions that gas-giant maps are representative atmospheric illustrations whose appearance changes daily and are not for scientific analysis.",
      license:
        "NASA/JPL-Caltech public mission imagery/resource; retain NASA/JPL attribution and representative-appearance qualification.",
      processing:
        "Pinned 2048x1024 NASA WebP; verified 8-bit sRGB 3-channel metadata; resized without reprojection to 512x256, 1024x512 and native-capped 2048x1024 JPEG derivatives; color only.",
      alignmentStatus:
        "The NASA visualization resource does not publish a cartographic geotransform or prime-meridian convention. Runtime adopts north-up east-positive lookup; absolute imagery alignment is unverified, not a scientific coordinate product.",
      canonicalRadiusMeters: 24622000,
      sourceReferenceRadiusMeters: null,
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(assets, "neptune-manifest.json"),
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
      "downloaded pinned Neptune representative atmospheric texture; rebuild with --rebuild",
    );
    if (!args.has("--rebuild")) return;
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-neptune-surface.mjs --download-pinned [--rebuild]",
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
