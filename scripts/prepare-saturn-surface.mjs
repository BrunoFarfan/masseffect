#!/usr/bin/env node
/** Build Saturn's NASA/JPL representative atmospheric appearance texture. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "saturn-nasa-texture.webp",
  url: "https://assets.science.nasa.gov/dynamicimage/assets/science/cds/3d/resources/image/saturn/preview.webp?w=2048",
  sha256: "1478734cb7d6d140b15cfc8729e71fb38948583c15dd4d8ce7efbf1c4b7ca32c",
  dimensions: "2048x1024 WebP, 8-bit sRGB, 3-channel",
};
const levels = [
  { name: "preview", width: 512, height: 256 },
  { name: "medium", width: 1024, height: 512 },
  { name: "near", width: 2048, height: 1024 },
];
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
    throw new Error(`Missing ${path}; run --download-pinned first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(`Saturn source SHA-256 mismatch: ${actual}`);
  const metadata = await sharp(path).metadata();
  if (
    metadata.width !== 2048 ||
    metadata.height !== 1024 ||
    metadata.channels !== 3 ||
    metadata.depth !== "uchar"
  )
    throw new Error(
      `Unexpected Saturn source raster ${JSON.stringify(metadata)}`,
    );
  return path;
}

async function rebuild() {
  const input = await verifySource();
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `saturn-${level.name}.jpg`);
    await sharp(input)
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    levelsManifest[level.name] = {
      color: `/assets/surfaces/saturn-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind: "NASA/JPL representative atmospheric cloud appearance",
    };
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-saturn-surface.mjs",
    body: "saturn",
    referenceRadiusMeters: 58232000,
    bodyrefSIradius: 58232000,
    sourceType: "atmospheric-mapped-appearance",
    sourceOrganization: "NASA / JPL-Caltech Solar System Simulator",
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
      "Saturn is a gas giant: no solid terrain or height files are emitted. Cloud-top brightness is atmospheric appearance, never elevation.",
    provenance: {
      citation:
        "NASA Saturn 3-D resource; fictional representative texture from the JPL/Caltech generated planetary-map database",
      source,
      sourceMetadata: "https://science.nasa.gov/3d-resources/saturn/",
      mapCatalog: "https://maps.jpl.nasa.gov/tmaps/",
      coverage:
        "Representative global-looking cloud appearance. JPL explicitly cautions that gas-giant maps are atmospheric illustrations whose appearance changes daily and must not be used for scientific analysis.",
      license:
        "NASA/JPL-Caltech generated planetary-map resource; retain NASA/JPL attribution and representative/fictional qualification.",
      processing:
        "Pinned 2048x1024 NASA WebP; verified 8-bit sRGB 3-channel metadata; resized without reprojection to 512x256, 1024x512, and native-capped 2048x1024 JPEG derivatives.",
      orientationEvidence:
        "NASA labels this an image texture for 3-D models, while the public source metadata does not specify prime meridian, longitude sign, or pole orientation. Pixel order is preserved without flip or rotate; alignment is explicitly unverified.",
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(assets, "saturn-manifest.json"),
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
    await download(source.url, resolve(originals, source.file));
    console.log(
      "downloaded pinned Saturn atmospheric texture; rebuild with --rebuild",
    );
    if (!args.has("--rebuild")) return;
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-saturn-surface.mjs --download-pinned | --rebuild",
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
