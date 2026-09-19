#!/usr/bin/env node
/** Build pinned Cassini Titan topography and mapped ISS appearance derivatives. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import sharp from "sharp";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const topoZip = {
  file: "titan-topo-corlies.zip",
  url: "https://data.astro.cornell.edu/titan_topo_corlies/titan_topo_corlies.zip",
  sha256: "b398841e75c879240d4aaeabf3156478fcc2ef1342d449b36975644380ad2659",
};
const topo = {
  file: "titan-topo_4PPD_interp.cub",
  sha256: "f0399e3010c73e10b5582d1e73114e46a24304923d446b6f88029928ac6c0ddd",
};
const color = {
  file: "titan-iss-global.jpg",
  url: "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/solar/2023/09/p/i/a/PIA22770-1.jpg?crop=faces%2Cfocalpoint&fit=clip&h=2880&w=5760",
  sha256: "0afa5f3a7b2fe5534762824225954339e3714912adef37ff4a3bf3fb39358b33",
};
const sourcePage =
  "https://astrogeology.usgs.gov/search/map/lorenz_et_al_2013_titan_topographic_map_of_titan";
const levels = [
  { name: "preview", width: 512, height: 256, heightOutput: false },
  { name: "medium", width: 1024, height: 512, heightOutput: true },
  { name: "near", width: 2048, height: 1024, heightOutput: true },
];
const sourceWidth = 1440,
  sourceHeight = 720,
  dataOffset = 65536;
const heightOffsetMeters = -1800,
  heightScaleMeters = 0.05;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download ${response.status}: ${url}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}
async function verified(file, expected) {
  const path = resolve(originals, file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; run --download-pinned first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== expected)
    throw new Error(`${file} SHA-256 mismatch: ${actual}`);
  return { path, bytes, actual };
}

async function downloadPinned() {
  await download(topoZip.url, resolve(originals, topoZip.file));
  const zipBytes = await readFile(resolve(originals, topoZip.file));
  if (sha256(zipBytes) !== topoZip.sha256)
    throw new Error("Corlies archive SHA-256 mismatch");
  await run(
    "unzip",
    ["-p", resolve(originals, topoZip.file), "topo_4PPD_interp.cub"],
    { cwd: originals, encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
  ).then(({ stdout }) => writeFile(resolve(originals, topo.file), stdout));
  await download(color.url, resolve(originals, color.file));
  await download(sourcePage, resolve(originals, "titan-source.html"));
}

function readCube(bytes) {
  const expected = dataOffset + sourceWidth * sourceHeight * 4;
  if (bytes.length < expected)
    throw new Error(
      `Corlies cube is truncated (${bytes.length} < ${expected})`,
    );
  const values = new Float32Array(sourceWidth * sourceHeight);
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const value = bytes.readFloatLE(dataOffset + i * 4);
    if (!Number.isFinite(value) || value < -10000 || value > 10000)
      throw new Error(
        `Invalid interpolated elevation at sample ${i}: ${value}`,
      );
    values[i] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { values, min, max };
}

function sample(values, width, height, x, y) {
  const sx = ((x + 0.5) * sourceWidth) / width - 0.5;
  const sy = ((y + 0.5) * sourceHeight) / height - 0.5;
  const x0 = Math.floor(sx),
    y0 = Math.floor(sy),
    tx = sx - x0,
    ty = sy - y0;
  const ix = (n) => ((n % sourceWidth) + sourceWidth) % sourceWidth;
  const iy = (n) => Math.max(0, Math.min(sourceHeight - 1, n));
  const at = (xx, yy) => values[iy(yy) * sourceWidth + ix(xx)];
  return (
    (1 - ty) * ((1 - tx) * at(x0, y0) + tx * at(x0 + 1, y0)) +
    ty * ((1 - tx) * at(x0, y0 + 1) + tx * at(x0 + 1, y0 + 1))
  );
}

function encodeHeight(values, width, height) {
  const out = Buffer.alloc(width * height * 2);
  let min = Infinity,
    max = -Infinity,
    decodedMin = Infinity,
    decodedMax = -Infinity;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const elevation = sample(values, width, height, x, y);
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
      const encoded = Math.round(
        (elevation - heightOffsetMeters) / heightScaleMeters,
      );
      if (encoded < 0 || encoded > 65535)
        throw new Error(`Titan elevation does not fit uint16: ${elevation}`);
      out.writeUInt16LE(encoded, (y * width + x) * 2);
      const decoded = heightOffsetMeters + encoded * heightScaleMeters;
      decodedMin = Math.min(decodedMin, decoded);
      decodedMax = Math.max(decodedMax, decoded);
    }
  if (
    decodedMin < min - heightScaleMeters ||
    decodedMax > max + heightScaleMeters
  )
    throw new Error("Encoded Titan height range is inconsistent");
  return { out, min, max, decodedMin, decodedMax };
}

async function rebuild() {
  const dem = await verified(topo.file, topo.sha256);
  const appearance = await verified(color.file, color.sha256);
  const grid = readCube(dem.bytes);
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `titan-${level.name}.jpg`);
    await sharp(appearance.path)
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const entry = {
      color: `/assets/surfaces/titan-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind: "Cassini ISS 938-nm near-infrared mapped surface mosaic",
    };
    if (level.heightOutput) {
      const encoded = encodeHeight(grid.values, level.width, level.height);
      const heightPath = resolve(assets, `titan-${level.name}.height.bin`);
      await writeFile(heightPath, encoded.out);
      Object.assign(entry, {
        heightUrl: `/assets/surfaces/titan-${level.name}.height.bin`,
        heightWidth: level.width,
        heightHeight: level.height,
        heightSha256: sha256(encoded.out),
        heightEncoding:
          "little-endian uint16; elevation = heightOffsetMeters + sample * heightScaleMeters",
        heightOffsetMeters,
        heightScaleMeters,
        minElevationMeters: encoded.decodedMin,
        maxElevationMeters: encoded.decodedMax,
        sourceSampleRangeMeters: [grid.min, grid.max],
      });
    }
    levelsManifest[level.name] = entry;
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-titan-surface.mjs",
    body: "titan",
    referenceRadiusMeters: 2575000,
    bodyrefSIradius: 2575000,
    sourceType:
      "real-cassini-topography-corlies-2017-with-cassini-iss-appearance",
    sourceOrganization: "NASA Cassini / Cornell / USGS Astrogeology",
    coordinateConvention:
      "u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; north at top",
    coordinates: {
      longitude: "east-positive -180..180",
      latitude: "planetocentric",
      projection: "equirectangular",
      northAtTop: true,
      pixelRegistration: "pixel-centered",
      sourceDimensions: "1440x720 at 4 pixels/degree",
      sourceGeotransform: {
        upperLeftCornerMeters: [-8083983.3044639, 4039182.762967],
        pixelResolutionMeters: 11235.557059713,
      },
      sourceCoverage:
        "global grid; sparse Cassini observations interpolated across unsampled regions",
    },
    heightPolicy:
      "Corlies et al. (2017) Cassini altimetry, SARtopo and stereophotogrammetry product; the published grid is an interpolation of sparse observations and is not uniformly measured terrain. Never infer height from image brightness.",
    provenance: {
      citation:
        "Corlies et al. 2017, Titan's Topography and Shape at the End of the Cassini Mission, Geophysical Research Letters",
      source: {
        ...topoZip,
        extractedFile: topo.file,
        extractedSha256: dem.actual,
      },
      sourceMetadata: sourcePage,
      sourceProduct:
        "topo_4PPD_interp.cub; Corlies archive 4 pixels/degree, 1440x720, float32 little-endian",
      verticalDatum: "height relative to a 2575 km spherical datum",
      interpolation:
        "Corlies radial-basis-function interpolation of sparse Cassini altimetry, SARtopo and stereophotogrammetry; global coverage does not imply global measurement",
      sourceCoverage:
        "approximately 9% of Titan area directly constrained according to Corlies et al.; broad interpolated regions should not be read as resolved local relief",
      processing:
        "Validated ISIS cube header and dimensions; sampled north-up east-positive grid with longitude seam wrap; bilinear resampling to 1024x512 and 2048x1024; uint16 little-endian at 0.05 m steps; JPEG appearance kept independent",
      noData:
        "Corlies interpolated grid contains finite values across the global raster; underlying sparse-measurement coverage remains explicitly qualified",
    },
    appearance: {
      source: color,
      metadata:
        "https://science.nasa.gov/resource/titan-mosaic-the-surface-under-the-haze/",
      instrument: "Cassini Imaging Science Subsystem",
      wavelengthNm: 938,
      coverage: "global mapped near-infrared mosaic",
      atmosphericTreatment:
        "NASA states haze/radiative-transfer correction was applied; residual atmospheric appearance is separate from terrain",
      license:
        "NASA/JPL-Caltech/University of Arizona public mission imagery; retain attribution",
    },
    levels: levelsManifest,
  };
  await writeFile(
    resolve(assets, "titan-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      { sourceRange: [grid.min, grid.max], levels: levelsManifest },
      null,
      2,
    ),
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  await mkdir(originals, { recursive: true });
  if (args.has("--download-pinned")) await downloadPinned();
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-titan-surface.mjs --download-pinned | --rebuild [--offline]",
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
