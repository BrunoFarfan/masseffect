#!/usr/bin/env node
/** Build Ariel's official NASA/USGS Voyager-mosaicked appearance and explicit synthetic relief. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "ariel-voyager-texture.webp",
  url: "https://assets.science.nasa.gov/dynamicimage/assets/science/cds/3d/resources/image/uranus---ariel/preview.webp?w=2048",
  sha256: "f7b83b95e4f52502e3104e0a11c5ae9ae2bfd2ae78bb2b80bd0ad237a1ce10c4",
  dimensions: "2048x1024 WebP, 8-bit sRGB, 3-channel",
};
const levels = [
  { name: "preview", width: 512, height: 256, includeHeight: false },
  { name: "medium", width: 1024, height: 512, includeHeight: true },
  { name: "near", width: 2048, height: 1024, includeHeight: true },
];
const heightOffsetMeters = -500;
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
    throw new Error(`Missing ${path}; run --download-pinned first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(`Ariel source SHA-256 mismatch: ${actual}`);
  const metadata = await sharp(path).metadata();
  if (
    metadata.width !== 2048 ||
    metadata.height !== 1024 ||
    metadata.channels !== 3 ||
    metadata.depth !== "uchar"
  )
    throw new Error(
      `Unexpected Ariel source raster ${JSON.stringify(metadata)}`,
    );
  return path;
}

// Independent relief: the unit direction vector makes the field seamless at the
// longitude seam and both poles; no color pixel participates in this calculation.
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
        120 * Math.sin(3 * dx - 4 * dy + dz) * Math.cos(2 * dy + 3 * dz - dx) +
        28 * Math.sin(8 * dx + 5 * dy - 2 * dz);
      const sample = Math.round(
        (relief - heightOffsetMeters) / heightScaleMeters,
      );
      if (sample < 0 || sample > 65535)
        throw new Error(`Ariel procedural height exceeds uint16: ${sample}`);
      bytes.writeUInt16LE(sample, (y * width + x) * 2);
      min = Math.min(min, heightOffsetMeters + sample * heightScaleMeters);
      max = Math.max(max, heightOffsetMeters + sample * heightScaleMeters);
    }
  return { bytes, min, max };
}

async function rebuild() {
  const input = await verifySource();
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `ariel-${level.name}.jpg`);
    await sharp(input)
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const entry = {
      color: `/assets/surfaces/ariel-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind: "NASA/JPL/USGS Voyager 2 mapped appearance",
    };
    if (level.includeHeight) {
      const relief = proceduralHeight(level.width, level.height);
      const heightPath = resolve(assets, `ariel-${level.name}.height.bin`);
      await writeFile(heightPath, relief.bytes);
      Object.assign(entry, {
        heightUrl: `/assets/surfaces/ariel-${level.name}.height.bin`,
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
    generatedBy: "scripts/prepare-ariel-surface.mjs",
    body: "ariel",
    referenceRadiusMeters: 578900,
    bodyrefSIradius: 578900,
    sourceType: "mapped-voyager-appearance-plus-explicit-procedural-height",
    sourceOrganization: "NASA/JPL-Caltech / USGS Astrogeology Science Center",
    coordinateConvention:
      "Runtime samples u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; source prime-meridian and east-west alignment are unverified",
    coordinates: {
      longitude:
        "runtime east-positive -180..180 convention; source alignment unverified",
      latitude:
        "runtime planetocentric convention; source alignment unverified",
      projection:
        "2:1 image texture supplied for NASA 3-D resource; exact source projection metadata is not published",
      northAtTop: "unverified from source metadata",
      pixelRegistration: "pixel-centered derivative convention",
      sourceCoverage:
        "Voyager 2 mapped southern hemisphere; unmapped regions remain explicit source/approximation gaps",
    },
    heightPolicy:
      "No global measured Ariel DEM is available. Deterministic restrained relief is generated from a seamless 3D direction-vector field independent of color; it is an appearance approximation, not measured Ariel topography or image-brightness inference.",
    provenance: {
      citation:
        "NASA Uranus–Ariel 3-D resource, USGS mosaic using Voyager imagery; credit USGS/Tammy Becker and JPL/Caltech",
      source,
      sourceMetadata: "https://science.nasa.gov/3d-resources/uranus-ariel/",
      missionReference:
        "https://www.jpl.nasa.gov/images/pia00041-ariel-highest-resolution-color-picture/",
      coverage:
        "Voyager 2's mapped coverage is concentrated in the encountered southern hemisphere; the official texture's unmapped/low-confidence regions are retained rather than replaced with invented imagery.",
      license:
        "NASA/JPL/Caltech and USGS public mission imagery; retain attribution.",
      processing:
        "Pinned 2048x1024 NASA WebP; verified 8-bit sRGB 3-channel metadata; resized without reprojection to 512x256, 1024x512 and native 2048x1024 JPEG derivatives; color is never used to derive height.",
      orientationEvidence:
        "NASA labels this asset an image texture for 3D models, but the published source metadata does not specify prime meridian, east/west sign, or pole orientation. The script validates dimensions/channels and preserves the supplied pixel order without a flip or rotate; alignment is explicitly unverified.",
      proceduralHeight:
        "Seamless direction-vector field, little-endian uint16, height = -500 + sample x 1 m; bounded range is recorded per level; synthetic approximation only.",
      canonicalRadiusMeters: 578900,
      sourceReferenceRadiusMeters: null,
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(assets, "ariel-manifest.json"),
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
      "downloaded pinned Ariel Voyager texture; rebuild with --rebuild",
    );
    if (!args.has("--rebuild")) return;
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-ariel-surface.mjs --download-pinned | --rebuild",
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
