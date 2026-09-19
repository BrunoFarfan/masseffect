#!/usr/bin/env node
/** Prepare the pinned USGS Rhea Voyager mosaic and explicit procedural relief. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fromFile } from "geotiff";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const source = {
  file: "rhea-usgs-full.tif",
  url: "https://planetarymaps.usgs.gov/mosaic/Rhea_Voyager_mosaic_global_833m.tif",
  sha256: "80a9415eab73a1b7754dc7550e2483d03bfeb0bde70f7a0fe0ad8fe40fd998f5",
  dimensions: "5761x2881 signed 16-bit single-band GeoTIFF; 833.3947 m/pixel",
};
const sourceLabel = {
  file: "rhea-usgs-full.lbl",
  url: "https://planetarymaps.usgs.gov/mosaic/Rhea_Voyager_mosaic_global_833m.lbl",
  sha256: "10ceb9f81ad25866419d8dd08a367720c3fdffdc045f8591eca2427b3db1ef36",
  projection: "Sinusoidal",
  longitudeDirection: "PositiveWest",
  longitudeDomain: "-180..180",
  centerLongitude: 0,
  latitudeType: "Planetocentric",
  upperLeftCornerMeters: [-2400593.43335, 1200505.06535],
  pixelResolutionMeters: 833.3947,
  sourceRadiusMeters: 764000,
};
const levels = [
  { name: "preview", width: 512, height: 256, heightOutput: false },
  { name: "medium", width: 1024, height: 512, heightOutput: true },
  { name: "near", width: 2048, height: 1024, heightOutput: true },
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
      `Missing pinned Rhea source files in ${originals}; run --download-pinned first`,
    );
  const tifHash = sha256(await readFile(tifPath));
  const labelHash = sha256(await readFile(labelPath));
  if (tifHash !== source.sha256)
    throw new Error(`Rhea source SHA-256 mismatch: ${tifHash}`);
  if (labelHash !== sourceLabel.sha256)
    throw new Error(`Rhea label SHA-256 mismatch: ${labelHash}`);
  return tifPath;
}

function assertMetadata(image) {
  if (
    image.getWidth() !== 5761 ||
    image.getHeight() !== 2881 ||
    image.getSamplesPerPixel() !== 1 ||
    image.getBitsPerSample() !== 16 ||
    image.getSampleFormat() !== 2
  )
    throw new Error(
      `Unexpected Rhea raster format ${image.getWidth()}x${image.getHeight()}, ${image.getBitsPerSample()} bit, format ${image.getSampleFormat()}, ${image.getSamplesPerPixel()} bands`,
    );
  const keys = image.getGeoKeys();
  const origin = image.getOrigin();
  const resolution = image.getResolution();
  if (
    keys.ProjCoordTransGeoKey !== 24 ||
    keys.ProjCenterLongGeoKey !== 0 ||
    keys.GeogSemiMajorAxisGeoKey !== 764000 ||
    keys.GeogSemiMinorAxisGeoKey !== 764000 ||
    origin[0] !== -2400593.43335 ||
    origin[1] !== 1200505.06535 ||
    resolution[0] !== 833.3947 ||
    resolution[1] !== -833.3947
  )
    throw new Error(
      `Unexpected Rhea georeferencing: ${JSON.stringify({ keys, origin, resolution })}`,
    );
}

// The source is sinusoidal and positive-west. Sample it at runtime's regular
// east-positive equirectangular pixel centers using the label origin/resolution.
// This is a metadata reprojection, not a visual flip or brightness-derived map.
function reproject(sourceSamples, width, height) {
  const out = Buffer.alloc(width * height);
  const sourceWidth = 5761;
  const sourceHeight = 2881;
  const originX = -2400593.43335;
  const originY = 1200505.06535;
  const resolution = 833.3947;
  const radius = 764000;
  const noData = -32767;
  for (let y = 0; y < height; y++) {
    const latitude = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
    const cosLat = Math.cos(latitude);
    const sourceY = (originY - radius * latitude) / resolution - 0.5;
    const y0 = Math.floor(sourceY),
      fy = sourceY - y0;
    for (let x = 0; x < width; x++) {
      const eastLongitude = -Math.PI + ((x + 0.5) / width) * 2 * Math.PI;
      const sourceX =
        (radius * cosLat * -eastLongitude - originX) / resolution - 0.5;
      const x0 = Math.floor(sourceX),
        fx = sourceX - x0;
      let value = 0,
        weight = 0;
      for (let dy = 0; dy <= 1; dy++)
        for (let dx = 0; dx <= 1; dx++) {
          const sx = Math.max(0, Math.min(sourceWidth - 1, x0 + dx));
          const sy = Math.max(0, Math.min(sourceHeight - 1, y0 + dy));
          const sample = sourceSamples[sy * sourceWidth + sx];
          const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
          if (sample !== noData && sample >= 0) {
            value += sample * w;
            weight += w;
          }
        }
      // Preserve the source's 16-bit display values by emitting its high byte.
      out[y * width + x] = weight
        ? Math.max(0, Math.min(255, Math.round(value / weight / 256)))
        : 0;
    }
  }
  return out;
}

function proceduralHeight(width, height) {
  const out = Buffer.alloc(width * height * 2);
  let min = Infinity,
    max = -Infinity;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const lon = -Math.PI + ((x + 0.5) / width) * 2 * Math.PI;
      const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
      const c = Math.cos(lat),
        dx = c * Math.cos(lon),
        dy = c * Math.sin(lon),
        dz = Math.sin(lat);
      const relief =
        110 * Math.sin(4 * dx - 3 * dy + dz) * Math.cos(3 * dy + 2 * dz - dx) +
        32 * Math.sin(9 * dx + 5 * dy - 4 * dz);
      const sample = Math.round(
        (relief - heightOffsetMeters) / heightScaleMeters,
      );
      if (sample < 0 || sample > 65535)
        throw new Error(
          `Procedural Rhea height exceeds uint16 at ${x},${y}: ${sample}`,
        );
      out.writeUInt16LE(sample, (y * width + x) * 2);
      min = Math.min(min, heightOffsetMeters + sample * heightScaleMeters);
      max = Math.max(max, heightOffsetMeters + sample * heightScaleMeters);
    }
  return { bytes: out, min, max };
}

async function rebuild() {
  const input = await verifySource();
  const tiff = await fromFile(input);
  try {
    const image = await tiff.getImage();
    assertMetadata(image);
    const sourceSamples = await image.readRasters({
      samples: [0],
      interleave: true,
    });
    await mkdir(assets, { recursive: true });
    const levelsManifest = {};
    for (const level of levels) {
      const raster = reproject(sourceSamples, level.width, level.height);
      const colorPath = resolve(assets, `rhea-${level.name}.jpg`);
      await sharp(raster, {
        raw: { width: level.width, height: level.height, channels: 1 },
      })
        .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
        .toFile(colorPath);
      const entry = {
        color: `/assets/surfaces/rhea-${level.name}.jpg`,
        width: level.width,
        height: level.height,
        colorSha256: sha256(await readFile(colorPath)),
        colorKind: "USGS Voyager grayscale mapped imagery",
      };
      if (level.heightOutput) {
        const relief = proceduralHeight(level.width, level.height);
        const heightPath = resolve(assets, `rhea-${level.name}.height.bin`);
        await writeFile(heightPath, relief.bytes);
        Object.assign(entry, {
          heightUrl: `/assets/surfaces/rhea-${level.name}.height.bin`,
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
      generatedBy: "scripts/prepare-rhea-surface.mjs",
      bodies: {
        rhea: {
          body: "rhea",
          referenceRadiusMeters: 763500,
          bodyrefSIradius: 763500,
          sourceType: "mapped-imagery-plus-explicit-procedural-height",
          sourceOrganization: "USGS Astrogeology Science Center / NASA Voyager",
          coordinates: {
            longitude: "east-positive -180..180",
            latitude: "planetocentric",
            projection:
              "equirectangular (metadata-reprojected from source sinusoidal)",
            northAtTop: true,
            pixelRegistration: "pixel-centered",
            sourceLongitude: "positive-west -180..180",
            sourceOriginMeters: sourceLabel.upperLeftCornerMeters,
            sourceResolutionMeters: sourceLabel.pixelResolutionMeters,
          },
          heightPolicy:
            "No reliable complete global Rhea DEM is bundled. Deterministic bounded relief is generated from a seamless 3D direction-vector field independent of color; it is synthetic and not brightness inference or measured Rhea topography.",
          provenance: {
            citation:
              "USGS Astrogeology Science Center, Rhea Voyager Global Mosaic 833m; imagery from NASA Voyager 1",
            source,
            sourceLabel,
            sourceMetadata:
              "https://astrogeology.usgs.gov/search/map/rhea_voyager_global_mosaic_833m",
            coverage:
              "Global map mosaic assembled from 25 Voyager 1 images; mapped imagery, not a complete global DEM.",
            license:
              "USGS/NASA public-domain planetary imagery; retain product and mission attribution.",
            processing:
              "Validated signed-16-bit GeoTIFF dimensions, sample format, sinusoidal projection, origin, radius, and resolution; metadata-reprojected source positive-west sinusoidal samples to east-positive -180..180 planetocentric equirectangular north-up pixel centers; grayscale high byte preserved; JPEG quality 88.",
            proceduralHeight:
              "Seamless deterministic 3D direction-vector field, little-endian uint16, height = -256 + sample x 0.5 m; not measured relief and not derived from image pixels.",
          },
          levels: levelsManifest,
        },
      },
    };
    await writeFile(
      resolve(assets, "rhea-manifest.json"),
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
  } finally {
    await tiff.close();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  await mkdir(originals, { recursive: true });
  if (args.has("--download-pinned")) {
    await download(source.url, resolve(originals, source.file));
    await download(sourceLabel.url, resolve(originals, sourceLabel.file));
    console.log("downloaded pinned Rhea source and label");
  }
  if (!args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-rhea-surface.mjs --download-pinned | --rebuild",
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
