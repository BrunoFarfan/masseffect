#!/usr/bin/env node
/** Prepare the pinned NOAA ETOPO and NASA Blue Marble Earth surface. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originalDir = resolve(root, "output/surface-originals");
const outputDir = resolve(root, "assets/surfaces");
const earthA = 6378137;
const earthB = 6356752.314245;
const canonicalRadius = 6371000;
const source = {
  file: "earth-etopo60s-stride10.csv",
  url: "https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s.csv?z[0:10:10799][0:10:21599]",
  sha256: "efac6cf1798875d2dd175fb2a73d32bd25832f0e1aad2db74701b8ddafec3690",
  dimensions:
    "2160 longitude samples × 1080 latitude samples; 1/6-degree stride of 60-arcsecond source centers",
};
const colorSource = {
  file: "earth-bmng-january.jpg",
  url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/january/world.200401.3x5400x2700.jpg",
  sha256: "99f5faad74efe985fbf1714c8be7296ca9999759a1215b65f99b7f1df278dde5",
  dimensions: "5400×2700 RGB JPEG; Blue Marble Next Generation January 2004",
};
const andesRegionSource = {
  file: "earth-etopo-andes-60s.csv",
  url: "https://oceanwatch.pifsc.noaa.gov/erddap/griddap/ETOPO_2022_v1_60s.csv?z[3000:1:4200][17100:1:17700]",
  sha256: "59e37f85bcdddb94bc0c018d50459f9f98d0123b64d10d6895ce544bbf7eb407",
  dimensions: "1201 latitude samples × 601 longitude samples at 60 arc-seconds; Andes 285..295E, -40..-20N",
};
const levels = [
  { name: "preview", width: 512, height: 256 },
  { name: "medium", width: 1024, height: 512 },
  { name: "near", width: 2048, height: 1024 },
];
const sourceWidth = 2160;
const sourceHeight = 1080;
const sourceStep = 1 / 6;
const firstLat = -89.99166666666666;
const firstLon = 0.008333333333325754;
const heightOffsetMeters = -30000;
const heightScaleMeters = 1;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function geocentricToGeodetic(latitude) {
  return Math.atan((Math.tan(latitude) * earthA ** 2) / earthB ** 2);
}
function geodeticToGeocentric(latitude) {
  return Math.atan((Math.tan(latitude) * earthB ** 2) / earthA ** 2);
}
function ellipsoidRadius(planetocentricLatitude) {
  const c = Math.cos(planetocentricLatitude);
  const s = Math.sin(planetocentricLatitude);
  return (
    1 / Math.sqrt((c * c) / (earthA * earthA) + (s * s) / (earthB * earthB))
  );
}

async function verifyFile(def) {
  const path = resolve(originalDir, def.file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; download the pinned source first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== def.sha256)
    throw new Error(`${def.file} SHA-256 mismatch: ${actual}`);
  return path;
}

async function readAndesRegion(path) {
  const rows = [];
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let row = [];
  let previousLatitude = null;
  for await (const line of input) {
    if (!line.trim() || line.startsWith("latitude,") || line.startsWith("degrees_")) continue;
    const [latitudeText, longitudeText, zText] = line.split(",");
    const latitude = Number(latitudeText), longitude = Number(longitudeText), z = Number(zText);
    if (![latitude, longitude, z].every(Number.isFinite)) throw new Error("Malformed Andes ETOPO row");
    if (previousLatitude !== null && latitude !== previousLatitude && row.length) {
      rows.push(row);
      row = [];
    }
    row.push({ latitude, longitude, z });
    previousLatitude = latitude;
  }
  if (row.length) rows.push(row);
  if (rows.length !== 1201 || rows.some((r) => r.length !== 601))
    throw new Error(`Unexpected Andes ETOPO dimensions ${rows.length}x${rows[0]?.length}`);
  return rows;
}

async function readDem(path) {
  const values = new Float32Array(sourceWidth * sourceHeight);
  let row = 0;
  let col = 0;
  let headerRows = 0;
  const input = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    if (headerRows < 2) {
      headerRows++;
      continue;
    }
    if (!line.trim()) continue;
    const fields = line.split(",");
    if (fields.length !== 3) throw new Error(`Malformed ETOPO row ${row + 1}`);
    const latitude = Number(fields[0]);
    const longitude = Number(fields[1]);
    const z = Number(fields[2]);
    if (!Number.isFinite(z))
      throw new Error(`Invalid ETOPO height at row ${row + 1}`);
    if (col === 0 && Math.abs(latitude - (firstLat + row * sourceStep)) > 1e-5)
      throw new Error(
        `Unexpected ETOPO latitude at row ${row + 1}: ${latitude}`,
      );
    if (Math.abs(longitude - (firstLon + col * sourceStep)) > 1e-5)
      throw new Error(
        `Unexpected ETOPO longitude at row ${row + 1}, column ${col + 1}: ${longitude}`,
      );
    values[row * sourceWidth + col] = z;
    col++;
    if (col === sourceWidth) {
      row++;
      col = 0;
    }
  }
  if (row !== sourceHeight || col !== 0)
    throw new Error(
      `Expected ${sourceWidth * sourceHeight} ETOPO rows, got ${row * sourceWidth + col}`,
    );
  return values;
}

function sampleDem(dem, geodeticLatitude, longitude) {
  const fy = Math.max(
    0,
    Math.min(
      sourceHeight - 1,
      ((geodeticLatitude * 180) / Math.PI - firstLat) / sourceStep,
    ),
  );
  const y0 = Math.floor(fy);
  const y1 = Math.min(sourceHeight - 1, y0 + 1);
  const ty = fy - y0;
  let normalizedLongitude = (longitude * 180) / Math.PI;
  if (normalizedLongitude < 0) normalizedLongitude += 360;
  const fx =
    ((normalizedLongitude - firstLon) / sourceStep + sourceWidth) % sourceWidth;
  const x0 = Math.floor(fx);
  const x1 = (x0 + 1) % sourceWidth;
  const tx = fx - x0;
  const at = (y, x) => dem[y * sourceWidth + x];
  return (
    (at(y0, x0) * (1 - tx) + at(y0, x1) * tx) * (1 - ty) +
    (at(y1, x0) * (1 - tx) + at(y1, x1) * tx) * ty
  );
}

function sampleColor(rgb, width, height, x, y) {
  const fx = ((x % width) + width) % width;
  const fy = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(fx);
  const x1 = (x0 + 1) % width;
  const tx = fx - x0;
  const y0 = Math.floor(fy);
  const y1 = Math.min(height - 1, y0 + 1);
  const ty = fy - y0;
  const out = [];
  for (let channel = 0; channel < 3; channel++) {
    const at = (yy, xx) => rgb[(yy * width + xx) * 3 + channel];
    out[channel] = Math.round(
      (at(y0, x0) * (1 - tx) + at(y0, x1) * tx) * (1 - ty) +
        (at(y1, x0) * (1 - tx) + at(y1, x1) * tx) * ty,
    );
  }
  return out;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--rebuild") && !args.has("--download")) {
    console.error(
      "Usage: node scripts/prepare-earth-surface.mjs --rebuild | --download",
    );
    process.exitCode = 2;
    return;
  }
  if (args.has("--download")) {
    await mkdir(originalDir, { recursive: true });
    for (const item of [source, colorSource]) {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error(`Earth source ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (sha256(bytes) !== item.sha256)
        throw new Error(`Earth source checksum: ${item.file}`);
      await writeFile(resolve(originalDir, item.file), bytes);
    }
  }
  const demPath = await verifyFile(source);
  const colorPath = await verifyFile(colorSource);
  const andesPath = await verifyFile(andesRegionSource);
  const dem = await readDem(demPath);
  const andes = await readAndesRegion(andesPath);
  const color = await sharp(colorPath)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    color.info.width !== 5400 ||
    color.info.height !== 2700 ||
    color.info.channels !== 3
  )
    throw new Error(
      `Unexpected Blue Marble dimensions ${color.info.width}x${color.info.height}/${color.info.channels}ch`,
    );
  await mkdir(outputDir, { recursive: true });
  const levelManifest = {};
  for (const level of levels) {
    const height = Buffer.alloc(level.width * level.height * 2);
    const rgb = Buffer.alloc(level.width * level.height * 3);
    let minElevationMeters = Infinity;
    let maxElevationMeters = -Infinity;
    for (let y = 0; y < level.height; y++)
      for (let x = 0; x < level.width; x++) {
        const planetocentric =
          Math.PI / 2 - ((y + 0.5) * Math.PI) / level.height;
        const geodetic = geocentricToGeodetic(planetocentric);
        const longitude = -Math.PI + ((x + 0.5) * 2 * Math.PI) / level.width;
        const z = sampleDem(dem, geodetic, longitude);
        const radialElevation =
          ellipsoidRadius(planetocentric) - canonicalRadius + z;
        const sample = Math.round(
          (radialElevation - heightOffsetMeters) / heightScaleMeters,
        );
        if (sample < 0 || sample > 65535)
          throw new Error("Earth elevation exceeds uint16 encoding range");
        height.writeUInt16LE(sample, (y * level.width + x) * 2);
        const colorPixel = sampleColor(
          color.data,
          color.info.width,
          color.info.height,
          ((x + 0.5) * color.info.width) / level.width - 0.5,
          (((geodetic * -180) / Math.PI + 90) * color.info.height) / 180 - 0.5,
        );
        rgb.set(colorPixel, (y * level.width + x) * 3);
        minElevationMeters = Math.min(
          minElevationMeters,
          sample * heightScaleMeters + heightOffsetMeters,
        );
        maxElevationMeters = Math.max(
          maxElevationMeters,
          sample * heightScaleMeters + heightOffsetMeters,
        );
      }
    const outputColor = resolve(outputDir, `earth-${level.name}.jpg`);
    await sharp(rgb, {
      raw: { width: level.width, height: level.height, channels: 3 },
    })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(outputColor);
    const outputHeight = resolve(outputDir, `earth-${level.name}.height.bin`);
    await writeFile(outputHeight, height);
    levelManifest[level.name] = {
      color: `/assets/surfaces/earth-${level.name}.jpg`,
      width: level.width,
      height: level.height,
      colorSha256: sha256(await readFile(outputColor)),
      heightUrl: `/assets/surfaces/earth-${level.name}.height.bin`,
      heightWidth: level.width,
      heightHeight: level.height,
      heightSha256: sha256(height),
      heightOffsetMeters,
      heightScaleMeters,
      minElevationMeters,
      maxElevationMeters,
    };
  }
  const andesHeight = Buffer.alloc(601 * 1201 * 2);
  let andesMin = Infinity, andesMax = -Infinity;
  for (let y = 0; y < andes.length; y++) for (let x = 0; x < andes[y].length; x++) {
    // ERDDAP returns latitude south-to-north; runtime textures are
    // north-at-top, so reverse rows while retaining source sample spacing.
    const samplePoint = andes[andes.length - 1 - y][x];
    const planetocentric = Math.atan((Math.tan(samplePoint.latitude * Math.PI / 180) * earthB ** 2) / earthA ** 2);
    const elevation = ellipsoidRadius(planetocentric) - canonicalRadius + samplePoint.z;
    const encoded = Math.round((elevation - heightOffsetMeters) / heightScaleMeters);
    if (encoded < 0 || encoded > 65535) throw new Error("Andes elevation exceeds uint16 encoding range");
    andesHeight.writeUInt16LE(encoded, (y * 601 + x) * 2);
    const radial = encoded * heightScaleMeters + heightOffsetMeters;
    andesMin = Math.min(andesMin, radial); andesMax = Math.max(andesMax, radial);
  }
  const andesHeightPath = resolve(outputDir, "earth-andes.height.bin");
  await writeFile(andesHeightPath, andesHeight);
  // Himalaya: retain native 1/6-degree samples from the verified global
  // ETOPO extraction. Source rows are south-to-north; export north-at-top.
  const himalayaWidth = 181, himalayaHeight = 61;
  const himalayaLonMin = 70, himalayaLatMin = 25, himalayaLatMax = 35;
  const himalayaHeightBytes = Buffer.alloc(himalayaWidth * himalayaHeight * 2);
  let himalayaMin = Infinity, himalayaMax = -Infinity;
  for (let y = 0; y < himalayaHeight; y++) for (let x = 0; x < himalayaWidth; x++) {
    const latitude = himalayaLatMax - y * sourceStep;
    const longitude = himalayaLonMin + x * sourceStep;
    const sourceY = Math.round((latitude - firstLat) / sourceStep);
    const sourceX = Math.round((longitude - firstLon) / sourceStep);
    if (sourceY < 0 || sourceY >= sourceHeight || sourceX < 0 || sourceX >= sourceWidth)
      throw new Error(`Himalaya source index out of bounds ${latitude},${longitude}`);
    const z = dem[sourceY * sourceWidth + sourceX];
    const planetocentric = geodeticToGeocentric(latitude * Math.PI / 180);
    const elevation = ellipsoidRadius(planetocentric) - canonicalRadius + z;
    const encoded = Math.round((elevation - heightOffsetMeters) / heightScaleMeters);
    if (encoded < 0 || encoded > 65535) throw new Error("Himalaya elevation exceeds uint16 encoding range");
    himalayaHeightBytes.writeUInt16LE(encoded, (y * himalayaWidth + x) * 2);
    const radial = encoded * heightScaleMeters + heightOffsetMeters;
    himalayaMin = Math.min(himalayaMin, radial); himalayaMax = Math.max(himalayaMax, radial);
  }
  await writeFile(resolve(outputDir, "earth-himalaya.height.bin"), himalayaHeightBytes);
  const toUv = (longitude) => (longitude + 180) / 360;
  const toV = (latitude) => 0.5 - latitude / 180;
  const southPlanetocentric = geodeticToGeocentric(-20 * Math.PI / 180) * 180 / Math.PI;
  const northPlanetocentric = geodeticToGeocentric(-40 * Math.PI / 180) * 180 / Math.PI;
  levelManifest.near.region = {
    id: "andes",
    name: "Andes ETOPO2022 60-arcsecond regional relief",
    heightUrl: "/assets/surfaces/earth-andes.height.bin",
    heightSha256: sha256(andesHeight), width: 601, height: 1201,
    heightScaleMeters, heightOffsetMeters,
    uvBounds: [toUv(-75), toV(southPlanetocentric), toUv(-65), toV(northPlanetocentric)],
    blendBorder: 0.04, minElevationMeters: andesMin, maxElevationMeters: andesMax,
  };
  levelManifest.near.regions = [
    levelManifest.near.region,
    {
      id: "himalaya",
      name: "Himalaya ETOPO2022 native regional relief",
      heightUrl: "/assets/surfaces/earth-himalaya.height.bin",
      heightSha256: sha256(himalayaHeightBytes),
      width: himalayaWidth, height: himalayaHeight,
      heightScaleMeters, heightOffsetMeters,
      uvBounds: [
        toUv(himalayaLonMin),
        toV(geodeticToGeocentric(himalayaLatMax * Math.PI / 180) * 180 / Math.PI),
        toUv(himalayaLonMin + (himalayaWidth - 1) * sourceStep),
        toV(geodeticToGeocentric(himalayaLatMin * Math.PI / 180) * 180 / Math.PI),
      ],
      blendBorder: 0.06,
      minElevationMeters: himalayaMin, maxElevationMeters: himalayaMax,
    },
  ];
  const sampleChecks = {
    everest: sampleDem(
      dem,
      (27.9881 * Math.PI) / 180,
      (86.925 * Math.PI) / 180,
    ),
    andes: sampleDem(
      dem,
      (-32.6532 * Math.PI) / 180,
      (-70.0111 * Math.PI) / 180,
    ),
    pacific: sampleDem(dem, 0, (-150 * Math.PI) / 180),
  };
  if (
    !(
      sampleChecks.everest > 5000 &&
      sampleChecks.everest < 9500 &&
      sampleChecks.andes > 3000 &&
      sampleChecks.andes < 8000 &&
      sampleChecks.pacific < 0
    )
  )
    throw new Error(
      `Unexpected ETOPO validation samples: ${JSON.stringify(sampleChecks)}`,
    );
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-earth-surface.mjs",
    body: "earth",
    referenceRadiusMeters: canonicalRadius,
    bodyrefSIradius: canonicalRadius,
    sourceType:
      "NASA cloud-free mapped imagery + NOAA ETOPO measured radial height",
    sourceOrganization: "NASA Earth Observatory / NOAA NCEI",
    coordinates: {
      longitude: "east-positive -180..180",
      latitude: "planetocentric",
      sourceLatitude: "geodetic",
      projection: "equirectangular",
      northAtTop: true,
      pixelRegistration: "pixel-centered",
      operation:
        "sample geodetic sources at planetocentric target latitude; longitude wrap at ±180",
    },
    baseRadiiMeters: [earthA, earthB, earthA],
    waterSurface: true,
    heightPolicy:
      "ETOPO orthometric heights are treated as an explicit datum approximation to radial relief; bathymetry is retained in the height asset. Visible ocean surface uses the reference ellipsoid, not a spherical sea or exposed seabed. Geoid undulations remain omitted.",
      provenance: {
      sources: [source, colorSource, andesRegionSource],
      metadata:
        "/output/surface-originals/earth-etopo.das and /output/surface-originals/earth-color-source.html",
      datum:
        "ETOPO z is EGM2008 orthometric height (EPSG:3855). Geoid undulations were not downloaded, so this product intentionally ignores the geoid-to-ellipsoid correction (approximately 100 m).",
      ellipsoid: {
        semiMajorAxisMeters: earthA,
        semiMinorAxisMeters: earthB,
        inverseFlattening: 298.257223563,
      },
      canonicalReference:
        "WGS84 ellipsoid radial surface relative to canonical simulation radius 6371000 m; z added as a bounded datum approximation.",
      processing:
        "Stream global and bounded regional CSVs; bilinear DEM sampling; geodetic-to-planetocentric latitude conversion; Blue Marble bilinear color sampling; JPEG quality 88; Andes regional tile retains native 60-arcsecond samples (601x1201), Himalaya tile retains native 1/6-degree ETOPO samples (181x61); little-endian uint16 heights at 1 m/sample with -30000 m offset; reject rather than clamp out-of-range elevations.",
      validationSamples: sampleChecks,
      license:
        "NASA public-domain imagery and NOAA NCEI ETOPO data; retain source attribution and caveat that ETOPO is not intended for legal use.",
    },
    levels: levelManifest,
  };
  await writeFile(
    resolve(outputDir, "earth-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`prepared Earth derivatives in ${outputDir}`);
}
main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
