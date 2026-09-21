#!/usr/bin/env node
/** Prepare an OPAL Uranus cloud mosaic with an explicitly approximate gap fill. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "uranus-opal-2014a-globalmap.tif",
  url: "https://archive.stsci.edu/hlsps/opal/cycle22/uranus/hlsp_opal_hst_wfc3-uvis_uranus-2014a_f467m-f547m-f658n_v1_globalmap.tif",
  sha256: "1e7944240bb74b2e84703b7c63dcb3d95cda62e6a4a8928522b3cc28d8b927a6",
  dimensions: "721x361 TIFF, 8-bit RGB composite",
};
const levels = [
  { name: "preview", width: 512, height: 256 },
  // Native observation is only 721x361; never invent higher-frequency detail.
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
    metadata.width !== 721 ||
    metadata.height !== 361 ||
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
  const { data: observed, info } = await sharp(input)
    .raw().toBuffer({ resolveWithObject: true });
  const composited = Buffer.alloc(info.width * info.height * 3);
  // OPAL's 2014 mosaic has an unobserved southern cap. Feather only the
  // coverage boundary; do not interpret dark no-data pixels as dark clouds.
  for (let y = 0; y < info.height; y++) {
    // Feather before the ragged observation edge, which begins well above
    // the all-black no-data rows in this particular mosaic.
    const fade = Math.max(0, Math.min(1, (225 - y) / 65));
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 3;
      const valid = Math.min(observed[i], observed[i + 1], observed[i + 2]) > 12;
      const blend = valid ? fade : 0;
      const band = 4 * Math.sin(y * 0.135) + 2 * Math.sin(y * 0.043 + x * 0.009);
      const fill = [157 + band, 195 + band, 197 + band];
      for (let c = 0; c < 3; c++)
        composited[i + c] = Math.max(0, Math.min(255, Math.round(
          observed[i + c] * blend + fill[c] * (1 - blend),
        )));
    }
  }
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `uranus-${level.name}.jpg`);
    await sharp(composited, { raw: { width: info.width, height: info.height, channels: 3 } })
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    levelsManifest[level.name] = {
      color: `/assets/surfaces/uranus-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind: "Hubble OPAL observed clouds, approximate southern gap fill",
    };
  }
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-uranus-surface.mjs",
    body: "uranus",
    referenceRadiusMeters: 25362000,
    bodyrefSIradius: 25362000,
    sourceType: "observed-atmosphere-with-approximate-gap-fill",
    atmosphericBands: false,
    sourceOrganization: "NASA/ESA/STScI Hubble OPAL",
    coordinateConvention:
      "Runtime samples the north-at-top cylindrical mosaic; absolute longitude/prime-meridian alignment is unverified.",
    coordinates: {
      longitude: "source absolute longitude alignment unverified",
      latitude: "runtime planetocentric; source alignment unverified",
      projection: "OPAL global cylindrical mosaic",
      northAtTop: true,
      pixelRegistration: "pixel-centered derivative convention",
    },
    heightPolicy:
      "Uranus is an ice giant: no solid terrain or height files are emitted. Atmospheric color and band/brightness appearance are never elevation.",
    provenance: {
      citation: "Hubble OPAL Uranus 2014a WFC3/UVIS F467M/F547M/F658N global color composite, NASA/ESA/STScI; southern missing coverage is synthetic approximation.",
      source,
      sourceMetadata: "https://archive.stsci.edu/hlsp/opal/opal-uranus-cycle-22",
      mapCatalog: "https://archive.stsci.edu/hlsp/opal",
      coverage: "Observed northern and equatorial clouds in a global cylindrical mosaic; the unobserved southern cap is smooth approximate color/bands, not Hubble data.",
      license: "OPAL data use CC BY 4.0; credit NASA/ESA/STScI and the OPAL team.",
      processing:
        "Pinned 721x361 Hubble TIFF; no-data southern rows and the ragged observation edge are blended across a 65-pixel latitude band into a pale synthetic atmospheric fill. Derived JPEGs are capped at native source resolution; color only, no terrain.",
      orientationEvidence:
        "OPAL cylindrical map is used without flip or rotation; absolute prime-meridian alignment remains unverified.",
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
