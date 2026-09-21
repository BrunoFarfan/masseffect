#!/usr/bin/env node
/** Optional desktop pack: global 64 ppd relief, split into lazy 16-degree tiles.
 * Originals and derived tiles are intentionally ignored by Git. The normal
 * published app remains small and falls back to its bundled global DEMs.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const destination = resolve(root, "assets/surfaces/terrain64");
const WIDTH = 23040, HEIGHT = 11520, TILE = 1024;
const sources = {
  earth: {
    file: "earth-etopo60s-global.tif",
    url: "https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif",
    bytes: 465969062,
    sha256: "9d27d4b8ea8e76977e2988bca667d7c8fa68b927355feffcddd6b4875a7fd08e",
    organization: "NOAA NCEI",
    product: "ETOPO2022 60 arc-second ice-surface elevation GeoTIFF",
    citation: "NOAA NCEI (2022), ETOPO 2022, doi:10.25921/fd45-gt74",
    note: "Measured source is 60 samples/degree; output is bilinearly resampled to 64, not new measured detail. ETOPO heights use EGM2008; ellipsoidal radius is converted to radial height above the simulation's 6371000 m sphere without a local geoid-undulation correction, so absolute radial heights can differ by tens of meters.",
    encoding: [-30000, 1],
  },
  moon: {
    file: "ldem_64_uint.tif",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_64_uint.tif",
    bytes: 530934146,
    sha256: "0f40bce8b42864deddb6943a38474879e691d5b20647aa5e54c2612b23106499",
    organization: "NASA GSFC/LOLA",
    product: "LDEM 64 pixels/degree lunar global elevation",
    citation: "NASA GSFC Scientific Visualization Studio Moon Kit, LOLA/LDEM 64 ppd",
    note: "Original unsigned 16-bit pixel samples are preserved; 0.5 m scale and -10000 m offset relative to 1737400 m reference radius. Source frame matches the existing Moon Kit LDEM16 preview; absolute ME/PA differences are not claimed resolved.",
    encoding: [-10000, 0.5],
  },
  mars: {
    files: ["megr90n180gb.img", "megr90n000gb.img", "megr00n180gb.img", "megr00n000gb.img"],
    urlPrefix: "https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg064/",
    bytes: 132710400,
    sha256: {
      "megr90n180gb.img": "ba8c17534342b2bf84eee8754652aa896ce98416b839a81cc1ecc296ab7ad927",
      "megr90n000gb.img": "a23d70033211335092ba6c02f51d24e74207323009aadacf04fcd4a84b02497b",
      "megr00n180gb.img": "47869677db4215c4e97b056f2177fe5d7a28018ba3f3abe60f550edeb9d0058b",
      "megr00n000gb.img": "e7efab659ceecb5cfe6a03dd4c9ff910dc814004ec0cff2bbe81d03df00f3c71",
    },
    organization: "NASA PDS Geosciences / MGS MOLA",
    product: "MEGDR 64 pixels/degree planetary-radius tiles, version 2",
    citation: "Smith et al. MGS MOLA Mission Experiment Gridded Data Records, NASA PDS",
    note: "PDS4 SignedMSB2 sample plus 3396000 m radius offset; converted to radial meters above the simulation's 3389500 m reference radius. Planetocentric, positive-east.",
    encoding: [-20000, 1],
  },
};

function download(url, path) {
  const result = spawnSync("curl", ["-fL", "--retry", "3", "--continue-at", "-", "--output", path, url], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Download failed: ${url}`);
}
async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function sourceInfo(body) {
  const source = sources[body];
  const files = source.files || [source.file];
  const result = [];
  for (const file of files) {
    const path = resolve(originals, file);
    if (!existsSync(path)) throw new Error(`Missing ${path}; run --download first`);
    const handle = await open(path, "r");
    const stat = await handle.stat();
    await handle.close();
    if (stat.size !== source.bytes)
      throw new Error(`${file} size mismatch: ${stat.size} instead of ${source.bytes}`);
    const actual = await digest(path);
    const expected = typeof source.sha256 === "string" ? source.sha256 : source.sha256[file];
    if (actual !== expected) throw new Error(`${file} SHA-256 mismatch: ${actual}`);
    result.push({ file, sourceUrl: source.url || source.urlPrefix + file, bytes: stat.size, sha256: actual });
  }
  return result;
}
async function openReaders(body) {
  if (body === "earth") {
    const path = resolve(originals, sources.earth.file);
    const metadata = await sharp(path, { limitInputPixels: false }).metadata();
    if (metadata.width !== 21600 || metadata.height !== 10800 || metadata.channels !== 1)
      throw new Error(`Unexpected ETOPO TIFF ${JSON.stringify(metadata)}`);
    let values = null, sourceStartY = 0, sourceEndY = 0;
    const a = 6378137, b = 6356752.314245, reference = 6371000;
    const sourceY = (y) => {
      const latitude = (90 - (y + 0.5) / 64) * Math.PI / 180;
      const geodetic = Math.atan(Math.tan(latitude) * a * a / (b * b));
      return (90 - geodetic * 180 / Math.PI) * 60 - 0.5;
    };
    async function prepareBand(row) {
      const first = row * TILE, last = Math.min(HEIGHT - 1, first + TILE - 1);
      sourceStartY = Math.max(0, Math.floor(sourceY(first)) - 2);
      sourceEndY = Math.min(10800, Math.ceil(sourceY(last)) + 3);
      const { data, info } = await sharp(path, { limitInputPixels: false })
        .extract({ left: 0, top: sourceStartY, width: 21600, height: sourceEndY - sourceStartY })
        .raw({ depth: "float" }).toBuffer({ resolveWithObject: true });
      // libvips expands the single-channel float TIFF to RGB float. Asking
      // sharp for greyscale here would clamp genuine elevations to 0..255.
      if (info.channels !== 3 || info.depth !== "float")
        throw new Error("ETOPO float decode changed unexpectedly");
      values = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    }
    const sample = (x, y) => {
      const longitude = -180 + (x + 0.5) / 64;
      const planetocentric = (90 - (y + 0.5) / 64) * Math.PI / 180;
      const geodetic = Math.atan(Math.tan(planetocentric) * a * a / (b * b));
      const fy = Math.max(0, Math.min(10799, (90 - geodetic * 180 / Math.PI) * 60 - 0.5));
      const fx = (longitude + 180) * 60 - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const at = (xx, yy) => {
        if (yy < sourceStartY || yy >= sourceEndY) throw new Error("ETOPO sample escaped decoded latitude band");
        return values[((yy - sourceStartY) * 21600 + ((xx % 21600) + 21600) % 21600) * 3];
      };
      const z = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) +
        (at(ix, Math.min(10799, iy + 1)) * (1 - tx) + at(ix + 1, Math.min(10799, iy + 1)) * tx) * ty;
      const c = Math.cos(planetocentric), s = Math.sin(planetocentric);
      const radial = 1 / Math.sqrt(c * c / (a * a) + s * s / (b * b));
      return Math.round(radial - reference + z + 30000);
    };
    return { sample, prepareBand, close: async () => { values = null; } };
  }
  if (body === "moon") {
    const handle = await open(resolve(originals, sources.moon.file), "r");
    return {
      async row(x, y, count) {
        const buffer = Buffer.allocUnsafe(count * 2);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 8 + (y * WIDTH + x) * 2);
        if (bytesRead !== buffer.length) throw new Error("Short LOLA TIFF strip read");
        return buffer;
      },
      close: () => handle.close(),
    };
  }
  const handles = await Promise.all(sources.mars.files.map((file) => open(resolve(originals, file), "r")));
  return {
    async row(x, y, count) {
      const output = Buffer.allocUnsafe(count * 2);
      let written = 0;
      while (written < count) {
        const gx = x + written, halfX = gx < 11520 ? 0 : 1, halfY = y < 5760 ? 0 : 1;
        const span = Math.min(count - written, (halfX ? WIDTH : 11520) - gx);
        const handle = handles[halfY * 2 + halfX];
        const sourceY = y - halfY * 5760, sourceX = gx - halfX * 11520;
        const buffer = Buffer.allocUnsafe(span * 2);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, (sourceY * 11520 + sourceX) * 2);
        if (bytesRead !== buffer.length) throw new Error("Short MOLA radius read");
        for (let i = 0; i < span; i++) output.writeUInt16LE(buffer.readInt16BE(i * 2) + 26500, (written + i) * 2);
        written += span;
      }
      return output;
    },
    close: async () => { await Promise.all(handles.map((handle) => handle.close())); },
  };
}

async function prepare(body) {
  const source = sources[body];
  const originals = await sourceInfo(body);
  const reader = await openReaders(body);
  const target = resolve(destination, body);
  await mkdir(target, { recursive: true });
  const tileSha256 = {};
  let minimum = Infinity, maximum = -Infinity, compressedBytes = 0;
  try {
    for (let row = 0; row < Math.ceil(HEIGHT / TILE); row++) {
      await reader.prepareBand?.(row);
      for (let col = 0; col < Math.ceil(WIDTH / TILE); col++) {
        const x = col * TILE, y = row * TILE;
        const width = Math.min(TILE, WIDTH - x), height = Math.min(TILE, HEIGHT - y);
        const raw = Buffer.allocUnsafe(width * height * 2);
        for (let ty = 0; ty < height; ty++) {
          if (reader.row) {
            const line = await reader.row(x, y + ty, width);
            line.copy(raw, ty * width * 2);
          } else {
            for (let tx = 0; tx < width; tx++) {
              const encoded = reader.sample(x + tx, y + ty);
              if (!(encoded >= 0 && encoded <= 65535)) throw new Error(`${body} sample outside uint16 range at ${x + tx},${y + ty}: ${encoded}`);
              raw.writeUInt16LE(encoded, (ty * width + tx) * 2);
            }
          }
        }
        for (let i = 0; i < raw.length; i += 2) {
          const elevation = source.encoding[0] + raw.readUInt16LE(i) * source.encoding[1];
          minimum = Math.min(minimum, elevation); maximum = Math.max(maximum, elevation);
        }
        const compressed = gzipSync(raw, { level: 6 });
        const name = `${row}-${col}.bin.gz`;
        await writeFile(resolve(target, name), compressed);
        tileSha256[name] = createHash("sha256").update(compressed).digest("hex");
        compressedBytes += compressed.length;
      }
      console.log(`${body}: completed latitude band ${row + 1}/${Math.ceil(HEIGHT / TILE)}`);
    }
  } finally { await reader.close(); }
  return {
    pixelsPerDegree: 64, width: WIDTH, height: HEIGHT, tilePixels: TILE,
    baseUrl: `/assets/surfaces/terrain64/${body}`,
    heightOffsetMeters: source.encoding[0], heightScaleMeters: source.encoding[1],
    minElevationMeters: minimum, maxElevationMeters: maximum,
    compressedBytes, tileCount: Object.keys(tileSha256).length,
    provenance: { organization: source.organization, product: source.product, citation: source.citation, note: source.note, originals,
      processing: "Global, north-up, east-positive -180..180 planetocentric 64 ppd; 1024-sample bounded tiles, little-endian uint16 meter encoding, gzip lossless compression. Earth is resampled from 60 ppd geodetic source; Moon and Mars retain native 64 ppd samples. No color value is used as elevation." },
    tileSha256,
  };
}

const args = process.argv.slice(2);
const selected = args.filter((arg) => ["earth", "moon", "mars"].includes(arg));
const bodies = selected.length ? selected : ["earth", "moon", "mars"];
await mkdir(originals, { recursive: true });
if (args.includes("--download"))
  for (const body of bodies) {
    const source = sources[body];
    for (const file of source.files || [source.file])
      download(source.url || source.urlPrefix + file, resolve(originals, file));
  }
if (!args.includes("--rebuild") && !args.includes("--download"))
  throw new Error("Usage: node scripts/prepare-terrain64.mjs [earth|moon|mars] [--download] [--rebuild]");
const prepared = {};
for (const body of bodies) prepared[body] = await prepare(body);
const indexPath = resolve(destination, "index.json");
const previous = existsSync(indexPath) ? JSON.parse(await readFile(indexPath, "utf8")) : { schemaVersion: 1, bodies: {} };
Object.assign(previous.bodies, prepared);
await writeFile(indexPath, JSON.stringify(previous, null, 2) + "\n");
console.log(`Prepared optional terrain64 pack for ${bodies.join(", ")}`);
