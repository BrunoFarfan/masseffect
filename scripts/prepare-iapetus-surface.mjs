#!/usr/bin/env node
/** Prepare the pinned USGS Iapetus Cassini/Voyager mosaic and explicit procedural relief. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "iapetus-usgs-full.tif",
  url: "https://planetarymaps.usgs.gov/mosaic/Iapetus_Cassini_Voyager_mosaic_global_783m.tif",
  sha256: "eb8acdbed3af495102b6ec6d3efce1f03dc6bc39bb43323c23231ce590494d6e",
  dimensions:
    "5760x2880 unsigned 8-bit single-band GeoTIFF; 802.851456 m/pixel",
};
const sourceLabel = {
  file: "iapetus-usgs-full.lbl",
  url: "https://planetarymaps.usgs.gov/mosaic/Iapetus_Cassini_Voyager_mosaic_global_783m.lbl",
  sha256: "18bcb9ada17a7e44432a4535afcc027efb46c5e226be1b03caba5b49cfcc6abd",
  projection: "SimpleCylindrical",
  longitudeDirection: "PositiveWest",
  longitudeDomain: "-180..180",
  centerLongitude: 0,
  latitudeType: "Planetocentric",
  upperLeftCornerMeters: [-2312212.193042, 1156106.096521],
  pixelResolutionMeters: 802.851456,
  sourceRadiusMeters: 736000,
};
const levels = [
  { name: "preview", width: 512, height: 256, includeHeight: false },
  { name: "medium", width: 1024, height: 512, includeHeight: true },
  { name: "near", width: 2048, height: 1024, includeHeight: true },
];
const heightOffsetMeters = -256;
const heightScaleMeters = 0.5;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Download failed ${response.status}: ${url}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

async function verifySource() {
  const tifPath = resolve(originals, source.file);
  const labelPath = resolve(originals, sourceLabel.file);
  if (!existsSync(tifPath) || !existsSync(labelPath))
    throw new Error(
      `Missing pinned Iapetus source files in ${originals}; run --download-pinned first`,
    );
  const tifHash = sha256(await readFile(tifPath));
  const labelHash = sha256(await readFile(labelPath));
  if (tifHash !== source.sha256)
    throw new Error(`Iapetus source SHA-256 mismatch: ${tifHash}`);
  if (labelHash !== sourceLabel.sha256)
    throw new Error(`Iapetus label SHA-256 mismatch: ${labelHash}`);
  return tifPath;
}

// The label's source axis is positive-west. Reverse longitude into the runtime
// east-positive -180..180 convention, with a seam wrap rather than a visual flip.
async function normalizeEastPositive(path) {
  const { data, info } = await sharp(path, { limitInputPixels: false })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || info.width !== 5760 || info.height !== 2880)
    throw new Error(
      `Unexpected Iapetus source raster ${info.width}x${info.height}/${info.channels}ch`,
    );
  const normalized = Buffer.allocUnsafe(data.length);
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      // Pixel centers are paired across the positive-west/east axis; wrapping
      // keeps the global seam continuous and avoids introducing a half-pixel shift.
      const sourceX = (info.width - 1 - x + info.width) % info.width;
      normalized[y * info.width + x] = data[y * info.width + sourceX];
    }
  return { data: normalized, width: info.width, height: info.height };
}

// Independent bounded relief. Unit direction vectors make this continuous at
// the longitude seam and poles; imagery brightness never participates.
function proceduralHeight(width, height) {
  const out = Buffer.alloc(width * height * 2);
  let min = Infinity,
    max = -Infinity;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const lon = -Math.PI + ((x + 0.5) / width) * Math.PI * 2;
      const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
      const c = Math.cos(lat),
        dx = c * Math.cos(lon),
        dy = c * Math.sin(lon),
        dz = Math.sin(lat);
      const relief =
        120 * Math.sin(4 * dx - 3 * dy + dz) * Math.cos(3 * dy + 2 * dz - dx) +
        36 * Math.sin(9 * dx + 5 * dy - 4 * dz);
      const sample = Math.round(
        (relief - heightOffsetMeters) / heightScaleMeters,
      );
      if (sample < 0 || sample > 65535)
        throw new Error(
          `Procedural Iapetus height exceeds uint16 at ${x},${y}: ${sample}`,
        );
      out.writeUInt16LE(sample, (y * width + x) * 2);
      min = Math.min(min, heightOffsetMeters + sample * heightScaleMeters);
      max = Math.max(max, heightOffsetMeters + sample * heightScaleMeters);
    }
  return { bytes: out, min, max };
}

async function rebuild() {
  const input = await verifySource();
  const raster = await normalizeEastPositive(input);
  await mkdir(assets, { recursive: true });
  const levelsManifest = {};
  for (const level of levels) {
    const colorPath = resolve(assets, `iapetus-${level.name}.jpg`);
    await sharp(raster.data, {
      raw: { width: raster.width, height: raster.height, channels: 1 },
    })
      .resize(level.width, level.height, { fit: "fill", kernel: "lanczos3" })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(colorPath);
    const entry = {
      color: `/assets/surfaces/iapetus-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(colorPath)),
      colorKind: "USGS Cassini/Voyager grayscale mapped imagery",
    };
    if (level.includeHeight) {
      const relief = proceduralHeight(level.width, level.height);
      const heightPath = resolve(assets, `iapetus-${level.name}.height.bin`);
      await writeFile(heightPath, relief.bytes);
      Object.assign(entry, {
        heightUrl: `/assets/surfaces/iapetus-${level.name}.height.bin`,
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
    generatedBy: "scripts/prepare-iapetus-surface.mjs",
    coordinateConvention:
      "u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; north at top",
    bodies: {
      iapetus: {
        body: "iapetus",
        referenceRadiusMeters: 734300,
        bodyrefSIradius: 734300,
        sourceType: "mapped-imagery-plus-explicit-procedural-height",
        sourceOrganization:
          "USGS Astrogeology Science Center / NASA Cassini and Voyager",
        coordinates: {
          longitude: "east-positive -180..180",
          latitude: "planetocentric",
          projection:
            "equirectangular (normalized from source Simple Cylindrical)",
          northAtTop: true,
          pixelRegistration: "pixel-centered",
          sourceLongitude: "positive-west -180..180",
          sourcePrimeCenter: "0 degrees",
          sourceGeotransform: {
            upperLeftCornerMeters: sourceLabel.upperLeftCornerMeters,
            pixelResolutionMeters: sourceLabel.pixelResolutionMeters,
          },
        },
        heightPolicy:
          "No reliable complete global Iapetus DEM is bundled. Deterministic bounded relief is generated from a seamless 3D direction-vector field independent of color; it is synthetic and not brightness inference or measured Iapetus topography.",
        provenance: {
          citation:
            "USGS Astrogeology Science Center, Iapetus Cassini-Voyager Global Mosaic 803m; imagery from NASA Cassini and Voyager",
          source,
          sourceLabel,
          sourceMetadata:
            "https://astrogeology.usgs.gov/search/map/iapetus_cassini_voyager_global_mosaic_803m",
          coverage:
            "Global mapped mosaic; poles are filled by Voyager imagery and coverage is not a global DEM.",
          license:
            "USGS/NASA public-domain planetary imagery; retain product and mission attribution.",
          processing:
            "Validated 5760x2880 unsigned-8-bit raster and ISIS label metadata; reversed source positive-west longitude into east-positive -180..180 using pixel-center seam wrap; north-up; Lanczos resize to 512/1024/2048; JPEG quality 88 with no legend or map decoration.",
          proceduralHeight:
            "Seamless deterministic 3D direction-vector field, little-endian uint16, height = -256 + sample x 0.5 m; not measured relief and not derived from image pixels.",
          canonicalRadiusMeters: 734300,
          sourceMetadataRadiusMeters: 736000,
          radiusDifferenceMeters: -1700,
        },
        levels: levelsManifest,
      },
    },
  };
  await writeFile(
    resolve(assets, "iapetus-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        sourceSha256: source.sha256,
        labelSha256: sourceLabel.sha256,
        levels: levelsManifest,
      },
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
    await download(sourceLabel.url, resolve(originals, sourceLabel.file));
    console.log("downloaded pinned Iapetus source and label");
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-iapetus-surface.mjs --download-pinned | --rebuild",
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
