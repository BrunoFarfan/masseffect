#!/usr/bin/env node
/** Offline color mosaics for the optional local 64 ppd terrain pack.
 * Scientific originals are verified and never shipped. The runtime only sees
 * bounded JPEG tiles; color is never interpreted as height.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const destination = resolve(root, "assets/surfaces/color64");
const WIDTH = 23040, HEIGHT = 11520, TILE = 1024;
const rad = Math.PI / 180;
const sources = {
  earth: {
    file: "earth-bmng-january-21600.jpg",
    url: "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/january/world.200401.3x21600x10800.jpg",
    sha256: "c2f2c80a352518cfea23d462dad6f6e778375ddd74bbec5786bcfc85cc49c61d",
    width: 21600, height: 10800,
    organization: "NASA Earth Observatory",
    product: "Blue Marble Next Generation January 2004 unshaded base map, 2 km global JPEG",
    citation: "NASA Earth Observatory, Blue Marble: Next Generation; R. Stöckli et al.",
    note: "Cloud-free visual color composite, not elevation. Source is geodetic equirectangular; output samples at the planetocentric latitude used by the Earth renderer. Native 60 ppd is bilinearly resampled to 64 ppd without claiming additional measured detail.",
  },
  moon: {
    file: "lroc_color_poles_full.tif",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles.tif",
    sha256: "15a6b44b26dc963123ea6e14c4e1e193daa00162d8b40ac36bf3cc0e0740d287",
    width: 27360, height: 13680,
    organization: "NASA GSFC Scientific Visualization Studio / LROC",
    product: "CGI Moon Kit 2019 full-resolution LROC WAC color mosaic",
    citation: "NASA SVS CGI Moon Kit (4720), LROC WAC Hapke-normalized color mosaic",
    note: "76 ppd source is downsampled to 64 ppd in the same east-positive -180..180 frame as LOLA. Polar imagery above 70 degrees uses lower-resolution LOLA albedo fill; this is not full-resolution observed color there.",
  },
  mars: {
    file: "mars_viking_mdim21_clrmosaic_1km.jpg",
    url: "https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/5ea881c6-01b3-41fa-a7af-42d2131b54f1/download/mars_viking_mdim21_clrmosaic_1km.jpg",
    sha256: "fdfcd335559c3dc67052b7e8a9565d850e336ac0d1f3ea7f5eb7826ffb44ecb2",
    width: 21339, height: 10670,
    organization: "USGS Astrogeology / NASA Ames",
    product: "Viking MDIM2.1 colorized global mosaic 1 km JPEG",
    citation: "USGS Astrogeology, Mars Viking Colorized Global Mosaic 232m and 1km ancillary JPEG",
    note: "The 1km JPEG has about 59 pixels/degree. Fine brightness structure incorporates higher-resolution monochrome Viking data; color itself is lower-resolution and baked illumination remains. PAM geotransform (-10670000,5335000; 1000,-1000 m) is explicitly reprojected to the planetocentric east-positive runtime grid.",
  },
};

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function sourceCoordinate(body, x, y) {
  const lon = (-180 + (x + 0.5) / 64) * rad;
  const lat = (90 - (y + 0.5) / 64) * rad;
  if (body === "mars")
    return [(lon * 3396190 + 10670000) / 1000 - 0.5,
      (5335000 - lat * 3396190) / 1000 - 0.5];
  if (body === "earth") {
    const a = 6378137, b = 6356752.314245;
    const geodetic = Math.atan(Math.tan(lat) * a * a / (b * b));
    return [(x + 0.5) * 60 / 64 - 0.5,
      (90 - geodetic / rad) * 60 - 0.5];
  }
  return [(x + 0.5) * 76 / 64 - 0.5, (y + 0.5) * 76 / 64 - 0.5];
}

async function prepare(body) {
  const source = sources[body];
  const path = resolve(originals, source.file);
  if (!existsSync(path)) throw new Error(`Missing ${path}; run --download first`);
  const metadata = await sharp(path, { limitInputPixels: false }).metadata();
  if (metadata.width !== source.width || metadata.height !== source.height)
    throw new Error(`Unexpected ${body} color dimensions ${metadata.width}x${metadata.height}`);
  const sourceBytes = (await stat(path)).size;
  const sourceSha256 = await sha256(path);
  if (sourceSha256 !== source.sha256)
    throw new Error(`${body} source SHA-256 mismatch: ${sourceSha256}`);
  const target = resolve(destination, body);
  await mkdir(target, { recursive: true });
  const xIndices = new Int32Array(WIDTH), xWeights = new Float32Array(WIDTH);
  for (let x = 0; x < WIDTH; x++) {
    const sx = Math.max(0, Math.min(source.width - 1, sourceCoordinate(body, x, 0)[0]));
    xIndices[x] = Math.floor(sx);
    xWeights[x] = sx - xIndices[x];
  }
  const tileSha256 = {};
  let compressedBytes = 0;
  for (let row = 0; row < Math.ceil(HEIGHT / TILE); row++) {
    const y0 = row * TILE, bandHeight = Math.min(TILE, HEIGHT - y0);
    const yCoordinates = new Float64Array(bandHeight);
    for (let y = 0; y < bandHeight; y++)
      yCoordinates[y] = Math.max(0, Math.min(source.height - 1, sourceCoordinate(body, 0, y0 + y)[1]));
    const sourceTop = Math.floor(Math.min(...yCoordinates));
    const sourceBottom = Math.min(source.height, Math.ceil(Math.max(...yCoordinates)) + 2);
    const { data, info } = await sharp(path, { limitInputPixels: false })
      .extract({ left: 0, top: sourceTop, width: source.width, height: sourceBottom - sourceTop })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`Expected RGB ${body} source, got ${info.channels}`);
    for (let col = 0; col < Math.ceil(WIDTH / TILE); col++) {
      const x0 = col * TILE, tileWidth = Math.min(TILE, WIDTH - x0);
      const rgb = Buffer.allocUnsafe(tileWidth * bandHeight * 3);
      for (let y = 0; y < bandHeight; y++) {
        const sy = yCoordinates[y] - sourceTop;
        const iy = Math.floor(sy), fy = sy - iy;
        const row0 = iy * source.width * 3;
        const row1 = Math.min(iy + 1, info.height - 1) * source.width * 3;
        for (let x = 0; x < tileWidth; x++) {
          const gx = x0 + x, ix = xIndices[gx], fx = xWeights[gx];
          const ix1 = Math.min(ix + 1, source.width - 1);
          const a = row0 + ix * 3, b = row0 + ix1 * 3;
          const c = row1 + ix * 3, d = row1 + ix1 * 3;
          const out = (y * tileWidth + x) * 3;
          for (let channel = 0; channel < 3; channel++)
            rgb[out + channel] = Math.round(
              ((data[a + channel] * (1 - fx) + data[b + channel] * fx) * (1 - fy)) +
              ((data[c + channel] * (1 - fx) + data[d + channel] * fx) * fy));
        }
      }
      const encoded = await sharp(rgb, { raw: { width: tileWidth, height: bandHeight, channels: 3 } })
        .jpeg({ quality: 87, mozjpeg: true }).toBuffer();
      const name = `${row}-${col}.jpg`;
      await writeFile(resolve(target, name), encoded);
      tileSha256[name] = createHash("sha256").update(encoded).digest("hex");
      compressedBytes += encoded.length;
    }
    console.log(`${body}: color latitude band ${row + 1}/${Math.ceil(HEIGHT / TILE)}`);
  }
  return {
    pixelsPerDegree: 64, width: WIDTH, height: HEIGHT, tilePixels: TILE,
    baseUrl: `/assets/surfaces/color64/${body}`,
    compressedBytes, tileCount: Object.keys(tileSha256).length, tileSha256,
    provenance: {
      sourceUrl: source.url, sourceOrganization: source.organization,
      sourceProductName: source.product, attribution: source.citation,
      sourceBytes, sourceSha256, originalDimensions: [source.width, source.height],
      derivedDimensions: [WIDTH, HEIGHT], projection: "equirectangular",
      longitudeConvention: "east-positive -180..180, pixel-centered",
      latitudeConvention: "planetocentric -90..90, north-up, pixel-centered",
      operations: "Source RGB decode; coordinate-aware bilinear resampling; 1024-pixel JPEG tiles at quality 87; SHA-256 each tile",
      note: source.note,
    },
  };
}

const args = process.argv.slice(2);
const selected = args.filter((arg) => Object.hasOwn(sources, arg));
const bodies = selected.length ? selected : Object.keys(sources);
await mkdir(originals, { recursive: true });
if (args.includes("--download"))
  for (const body of bodies) {
    const source = sources[body], path = resolve(originals, source.file);
    if (existsSync(path)) continue;
    const result = spawnSync("curl", ["-fL", "--retry", "3", "--continue-at", "-", "--output", path, source.url], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Download failed: ${source.url}`);
  }
if (!args.includes("--rebuild") && !args.includes("--download"))
  throw new Error("Usage: node scripts/prepare-color64.mjs [earth|moon|mars] [--download] [--rebuild]");
await mkdir(destination, { recursive: true });
const indexPath = resolve(destination, "index.json");
for (const body of bodies) {
  const prepared = await prepare(body);
  const index = existsSync(indexPath)
    ? JSON.parse(await readFile(indexPath, "utf8"))
    : { schemaVersion: 1, bodies: {} };
  index.bodies[body] = prepared;
  await writeFile(indexPath, JSON.stringify(index, null, 2) + "\n");
}
console.log(`Prepared optional color64 pack for ${bodies.join(", ")}`);
