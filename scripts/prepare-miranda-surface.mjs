#!/usr/bin/env node
/** Build Miranda's official Voyager-mosaicked appearance and explicit synthetic relief. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "miranda-voyager-texture.webp",
  url: "https://assets.science.nasa.gov/dynamicimage/assets/science/cds/3d/resources/image/uranus---miranda/preview.webp?w=2048",
  sha256: "c1827aec1d5ccd4318c9c71d24c7fbfe5d5a984e867d32744573a8d814c69085",
  dimensions: "2048x1024 WebP, 8-bit sRGB, 3-channel",
};
const levels = [
  { name: "preview", width: 512, height: 256, includeHeight: false },
  { name: "medium", width: 1024, height: 512, includeHeight: true },
  { name: "near", width: 2048, height: 1024, includeHeight: true },
];
const heightOffsetMeters = -100;
const heightScaleMeters = 0.5;
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
    throw new Error(`Miranda source SHA-256 mismatch: ${actual}`);
  const metadata = await sharp(path).metadata();
  if (
    metadata.width !== 2048 ||
    metadata.height !== 1024 ||
    metadata.channels !== 3
  )
    throw new Error(
      `Unexpected Miranda source raster ${metadata.width}x${metadata.height}/${metadata.channels}ch`,
    );
  return path;
}

// A unit-direction field is continuous at the longitude seam and both poles.
// It is deliberately independent of mapped brightness: Miranda has no global measured DEM.
function proceduralHeight(width, height) {
  const out = Buffer.alloc(width * height * 2);
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
        42 *
          Math.sin(5 * dx - 2 * dy + 3 * dz) *
          Math.cos(3 * dy + 2 * dz - dx) +
        11 * Math.sin(10 * dx + 3 * dy - 4 * dz);
      const sample = Math.round(
        (relief - heightOffsetMeters) / heightScaleMeters,
      );
      if (sample < 0 || sample > 65535)
        throw new Error(`Miranda procedural height exceeds uint16: ${sample}`);
      out.writeUInt16LE(sample, (y * width + x) * 2);
      min = Math.min(min, heightOffsetMeters + sample * heightScaleMeters);
      max = Math.max(max, heightOffsetMeters + sample * heightScaleMeters);
    }
  return { bytes: out, min, max };
}

async function rebuild() {
  const input = await verifySource();
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `miranda-${level.name}.jpg`);
    await sharp(input)
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const entry = {
      color: `/assets/surfaces/miranda-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind: "NASA/JPL/USGS Voyager 2 mapped appearance",
    };
    if (level.includeHeight) {
      const relief = proceduralHeight(level.width, level.height);
      const heightPath = resolve(assets, `miranda-${level.name}.height.bin`);
      await writeFile(heightPath, relief.bytes);
      Object.assign(entry, {
        heightUrl: `/assets/surfaces/miranda-${level.name}.height.bin`,
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
    generatedBy: "scripts/prepare-miranda-surface.mjs",
    body: "miranda",
    referenceRadiusMeters: 235800,
    bodyrefSIradius: 235800,
    sourceType: "mapped-voyager-appearance-plus-explicit-procedural-height",
    sourceOrganization: "NASA/JPL-Caltech / USGS Astrogeology Science Center",
    coordinateConvention:
      "u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; north at top; source longitude registration is not independently verified",
    coordinates: {
      longitude:
        "east-positive -180..180 (runtime normalization; scientific source alignment unverified)",
      latitude: "planetocentric",
      projection: "equirectangular texture supplied for NASA 3-D resource",
      northAtTop: true,
      pixelRegistration: "pixel-centered",
      sourceCoverage:
        "Voyager 2 mapped a limited portion of Miranda; unmapped regions are retained as source gaps/approximate appearance",
    },
    sourceAlignment: {
      longitudeVerified: false,
      latitudeVerified: false,
      poleOrientationVerified: false,
      basis:
        "NASA resource supplies a rendered texture but does not publish a longitude/latitude registration, prime-meridian label alignment, or control-point metadata; do not infer scientific longitude from pixels.",
    },
    heightPolicy:
      "No reliable global Miranda DEM is available. Deterministic restrained relief is generated from a seamless 3D direction-vector field independent of color; it is an appearance approximation, not measured Miranda topography or image-brightness inference.",
    provenance: {
      citation:
        "NASA Uranus–Miranda 3-D resource, mosaicked with Voyager imagery; credit USGS/Tammy Becker and JPL/Caltech",
      source,
      sourceMetadata: "https://science.nasa.gov/3d-resources/uranus-miranda/",
      missionReference: "https://pds-imaging.jpl.nasa.gov/volumes/voyager.html",
      mapCatalog: "https://maps.jpl.nasa.gov/tmaps/",
      coverage:
        "Voyager 2 coverage is limited and strongest over Miranda's observed hemisphere; unobserved or weakly constrained regions remain explicitly approximate and are not presented as measured mapping.",
      license:
        "NASA/JPL/Caltech and USGS public mission imagery; retain attribution.",
      processing:
        "Pinned 2048x1024 NASA WebP; resized without reprojection to 512x256, 1024x512 and native 2048x1024 JPEG derivatives; color is never used to derive height.",
      proceduralHeight:
        "Seamless direction-vector field, little-endian uint16, height = -100 + sample x 0.5 m; bounded range is recorded per level; synthetic approximation only.",
      canonicalRadiusMeters: 235800,
      sourceReferenceRadiusMeters: null,
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(assets, "miranda-manifest.json"),
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
      "downloaded pinned Miranda Voyager texture; rebuild with --rebuild",
    );
    if (!args.has("--rebuild")) return;
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-miranda-surface.mjs --download-pinned | --rebuild",
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
