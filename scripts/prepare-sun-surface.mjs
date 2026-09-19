#!/usr/bin/env node
/** Build a deterministic, seamless, color-only emissive photosphere appearance. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const assets = resolve(root, "assets/surfaces");
const levels = [
  { name: "preview", width: 512, height: 256 },
  { name: "medium", width: 1024, height: 512 },
  // Procedural generation is intentionally capped at this size. It is not a
  // claim of source imagery resolution, and keeps rebuilds quick and stable.
  { name: "near", width: 1024, height: 512 },
];
const canonicalRadiusMeters = 695700000;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// A small integer hash and smooth trilinear interpolation make the field
// deterministic while sampling a 3-D direction vector avoids a longitude seam.
function hash3(x, y, z) {
  let h =
    Math.imul(x | 0, 374761393) +
    Math.imul(y | 0, 668265263) +
    Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = (x) => x * x * (3 - 2 * x);
function valueNoise(x, y, z, frequency) {
  x = x * frequency + 17.25;
  y = y * frequency - 9.5;
  z = z * frequency + 4.75;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = smooth(x - ix),
    fy = smooth(y - iy),
    fz = smooth(z - iz);
  const at = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  const x00 = at(0, 0, 0) * (1 - fx) + at(1, 0, 0) * fx;
  const x10 = at(0, 1, 0) * (1 - fx) + at(1, 1, 0) * fx;
  const x01 = at(0, 0, 1) * (1 - fx) + at(1, 0, 1) * fx;
  const x11 = at(0, 1, 1) * (1 - fx) + at(1, 1, 1) * fx;
  return (
    (x00 * (1 - fy) + x10 * fy) * (1 - fz) + (x01 * (1 - fy) + x11 * fy) * fz
  );
}

function photospherePixel(x, y, width, height) {
  const longitude = ((x + 0.5) / width) * Math.PI * 2 - Math.PI;
  const latitude = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
  const cosLatitude = Math.cos(latitude);
  const direction = [
    cosLatitude * Math.cos(longitude),
    Math.sin(latitude),
    cosLatitude * Math.sin(longitude),
  ];
  const [dx, dy, dz] = direction;
  const broad = valueNoise(dx, dy, dz, 7);
  const granules = valueNoise(dx, dy, dz, 34);
  const fine = valueNoise(dx, dy, dz, 96);
  const spotField = valueNoise(dx, dy, dz, 4.5);
  const spot = Math.max(0, (spotField - 0.735) / 0.265);
  const facula = Math.max(
    0,
    (valueNoise(dx + 0.17, dy - 0.08, dz + 0.11, 11) - 0.78) / 0.22,
  );
  // Restrained warm-white intensity: subtle granulation and modest sunspots,
  // with no baked lighting or terrain interpretation.
  const intensity =
    0.91 +
    broad * 0.075 +
    granules * 0.036 +
    fine * 0.012 -
    spot * 0.14 +
    facula * 0.012;
  const r = Math.max(0, Math.min(255, Math.round(255 * intensity)));
  const g = Math.max(0, Math.min(255, Math.round(238 * intensity)));
  const b = Math.max(0, Math.min(255, Math.round(202 * intensity)));
  return [r, g, b];
}

function createRaster(width, height) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = photospherePixel(x, y, width, height);
      const offset = (y * width + x) * 3;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
    }
  }
  return data;
}

async function rebuild() {
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `sun-${level.name}.jpg`);
    const raster = createRaster(level.width, level.height);
    await sharp(raster, {
      raw: { width: level.width, height: level.height, channels: 3 },
    })
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    levelsManifest[level.name] = {
      color: `/assets/surfaces/sun-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind:
        "deterministic warm-white solar granulation with restrained sunspots",
    };
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-sun-surface.mjs",
    body: "sun",
    referenceRadiusMeters: canonicalRadiusMeters,
    bodyrefSIradius: canonicalRadiusMeters,
    canonicalRadiusMeters,
    sourceType: "procedural-emissive-approximate-photosphere",
    sourceOrganization:
      "Independent deterministic procedural preparation; no imagery source",
    coordinateConvention:
      "u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; north at top",
    coordinates: {
      longitude: "east-positive -180..180 addressing convention only",
      latitude: "planetocentric addressing convention only",
      projection: "equirectangular procedural raster",
      northAtTop: true,
      pixelRegistration: "pixel-centered",
    },
    heightPolicy:
      "Color-only emissive photosphere. No height products are emitted; brightness and sunspots are never interpreted as terrain or elevation.",
    emissive: true,
    provenance: {
      citation:
        "Procedural visual approximation informed by the qualitative appearance of solar granulation; not solar imagery or a scientific map.",
      source: null,
      sourceMetadata:
        "No mapped full-surface source selected: available solar imagery is observation-specific rather than a stable global photosphere texture.",
      alignmentStatus:
        "Longitude and latitude are addressing conventions only; no physical surface feature alignment is claimed.",
      coverage:
        "Seamless full-sphere appearance generated from direction-vector noise.",
      license: "Original repository-generated procedural output.",
      processing:
        "Deterministic 3-D direction-vector value-noise field; warm-white color-only JPEG derivatives at 512x256, 1024x512, and near capped at 1024x512; no height generation.",
      canonicalRadiusMeters,
      sourceReferenceRadiusMeters: null,
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(assets, "sun-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(JSON.stringify({ levels: levelsManifest }, null, 2));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  // --download is intentionally accepted for parity with mapped products: this
  // product has no external source and therefore has nothing to download.
  if (!args.has("--rebuild") && !args.has("--download")) {
    console.error(
      "Usage: node scripts/prepare-sun-surface.mjs --rebuild [--download]",
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
