#!/usr/bin/env node
/** Offline native imagery tiles and stereographic polar replacements.
 * Originals stay in output/. Only pinned sources are accepted. No albedo value
 * is ever interpreted as elevation. Each science DEM is read in bounded windows.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { fromFile } from "geotiff";
const root = resolve(import.meta.dirname, ".."),
  originals = resolve(root, "output/surface-originals"),
  dest = resolve(root, "assets/surfaces/detail");
const TILE = 512,
  CAP = 70,
  RAD = Math.PI / 180;
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function fileHash(path) {
  const h = createHash("sha256");
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest("hex");
}
async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function verified(path, sha) {
  if (!sha || (await fileHash(path)) !== sha)
    throw new Error(`Invalid pinned source: ${path}`);
}
const mod = (x, n) => ((x % n) + n) % n;
export function polarToUV(u, v, pole, cap = CAP) {
  const t = Math.tan(((90 - cap) * RAD) / 2),
    a = (2 * u - 1) * t,
    b = (1 - 2 * v) * t,
    r2 = a * a + b * b;
  const north = (pole * (1 - r2)) / (1 + r2),
    prime = (2 * a) / (1 + r2),
    east = (2 * b) / (1 + r2);
  return [
    mod(Math.atan2(east, prime) / (2 * Math.PI) + 0.5, 1),
    0.5 - Math.asin(north) / Math.PI,
  ];
}
// At the cap rim, one projected pixel spans 2*sin(cap angle)/size radians.
// Bound that minimum ground spacing by the native equatorial 2*pi/width.
export function polarSize(width, cap = CAP) {
  return Math.max(
    1,
    Math.floor((width * Math.sin((90 - cap) * RAD)) / Math.PI),
  );
}
export function bilinear(
  data,
  width,
  height,
  channels,
  x,
  y,
  c = 0,
  wrap = true,
) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  let out = 0;
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const xx = wrap
          ? mod(x0 + dx, width)
          : Math.max(0, Math.min(width - 1, x0 + dx)),
        yy = Math.max(0, Math.min(height - 1, y0 + dy));
      out +=
        data[(yy * width + xx) * channels + c] *
        (dx ? fx : 1 - fx) *
        (dy ? fy : 1 - fy);
    }
  return out;
}
// NoData never contributes an artificial cliff along a valid DEM boundary.
export function validBilinear(data, width, height, x, y, floor, wrap = false) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  let total = 0,
    weight = 0;
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const xx = wrap
          ? mod(x0 + dx, width)
          : Math.max(0, Math.min(width - 1, x0 + dx)),
        yy = Math.max(0, Math.min(height - 1, y0 + dy));
      const value = data[yy * width + xx],
        w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      if (Number.isFinite(value) && value > floor) {
        total += value * w;
        weight += w;
      }
    }
  return weight ? total / weight : null;
}
export function demSourceCoordinate(
  u,
  v,
  { origin, resolution, radius, centerLongitude },
) {
  const lon = (u - 0.5) * 2 * Math.PI,
    lat = (0.5 - v) * Math.PI,
    delta = mod(lon - centerLongitude * RAD + Math.PI, 2 * Math.PI) - Math.PI;
  return [
    (radius * delta - origin[0]) / resolution[0] - 0.5,
    (radius * lat - origin[1]) / resolution[1] - 0.5,
  ];
}
function pixels(tile, w, h) {
  const out = new Float64Array(w * h * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u =
          tile.uvBounds[0] +
          ((x + 0.5) / w) * (tile.uvBounds[2] - tile.uvBounds[0]),
        v =
          tile.uvBounds[1] +
          ((y + 0.5) / h) * (tile.uvBounds[3] - tile.uvBounds[1]);
      const p = tile.pole ? polarToUV(u, v, tile.pole) : [u, v];
      out[(y * w + x) * 2] = p[0];
      out[(y * w + x) * 2 + 1] = p[1];
    }
  return out;
}
async function manifest(body) {
  const p =
    body === "moon" || body === "mars"
      ? "manifest.json"
      : `${body}-manifest.json`;
  const m = await json(resolve(root, "assets/surfaces", p));
  return m.bodies?.[body] || m;
}
function sourceXY(mode, u, v, w, h) {
  if (mode === "west180") return [mod(0.5 - u, 1) * w - 0.5, v * h - 0.5];
  if (mode === "west") return [(1 - u) * w - 0.5, v * h - 0.5];
  if (mode === "east360") return [mod(u + 0.5, 1) * w - 0.5, v * h - 0.5];
  if (mode === "rhea") {
    const lat = (0.5 - v) * Math.PI,
      lon = (u - 0.5) * 2 * Math.PI;
    return [
      (764000 * Math.cos(lat) * -lon + 2400593.43335) / 833.3947 - 0.5,
      (1200505.06535 - 764000 * lat) / 833.3947 - 0.5,
    ];
  }
  return [u * w - 0.5, v * h - 0.5];
}
async function colorSource(body) {
  if (body === "venus") {
    const m = await manifest(body),
      level = m.levels.near,
      path = resolve(root, level.color.slice(1));
    await verified(path, level.colorSha256);
    const rgb = await sharp(path)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer();
    return {
      width: 8192,
      height: 4096,
      channels: 3,
      provenance: {
        ...m.provenance,
        appearance:
          "Constant illustrative ochre ground from existing base; no visible imagery or radar reprojection is claimed.",
      },
      async prepare() {},
      sample(u, v, c) {
        return rgb[c];
      },
    };
  }

  const normalized = resolve(originals, `${body}-normalized.tif`),
    metaPath = resolve(originals, `${body}-normalized.json`);
  let path,
    meta,
    mode = "canonical",
    provenance;
  if (existsSync(normalized) && existsSync(metaPath)) {
    meta = await json(metaPath);
    await verified(normalized, meta.sha256);
    path = normalized;
    provenance = meta;
  } else {
    const m = await manifest(body);
    let source = body === "titan" ? m.appearance.source : m.provenance.source;
    if (!source) throw new Error(`No native imagery source for ${body}`);
    path = resolve(originals, source.file);
    await verified(path, source.sha256);
    provenance = m.provenance;
    mode = ["europa", "ganymede", "callisto"].includes(body)
      ? "west180"
      : ["iapetus", "io"].includes(body)
        ? "west"
        : body === "rhea"
          ? "rhea"
          : "canonical";
  }
  const metadata = await sharp(path, { limitInputPixels: false }).metadata();
  let data,
    w = metadata.width,
    h = metadata.height,
    c;
  if (body === "rhea" && mode === "rhea") {
    const f = await fromFile(path);
    try {
      const image = await f.getImage();
      const raw = await image.readRasters({ interleave: true, samples: [0] });
      data = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++)
        data[i] = raw[i] < 0 ? 0 : Math.min(255, Math.round(raw[i] / 256));
      c = 1;
    } finally {
      await f.close();
    }
  } else {
    let image = sharp(path, { limitInputPixels: false });
    if (metadata.channels === 1) image = image.greyscale();
    else image = image.removeAlpha().toColourspace("srgb");
    const out = await image.raw().toBuffer({ resolveWithObject: true });
    data = out.data;
    c = out.info.channels;
  }
  return {
    width: w,
    height: h,
    channels: c,
    provenance,
    sourceBytes: (await stat(path)).size,
    async prepare() {},
    sample(u, v, k) {
      const [x, y] = sourceXY(mode, u, v, w, h);
      return bilinear(data, w, h, c, x, y, k, mode !== "rhea");
    },
  };
}
async function oldPack(body, kind) {
  const pack = (
      await json(resolve(root, `assets/surfaces/${kind}64/index.json`))
    ).bodies[body],
    cache = new Map();
  if (!pack) throw new Error(`Missing ${kind}64 ${body}`);
  return {
    width: pack.width,
    height: pack.height,
    channels: kind === "color" ? 3 : 1,
    provenance: pack.provenance,
    encoding: pack,
    async prepare(uv) {
      if (cache.pole !== uv[1] < 0.5) {
        cache.clear();
        cache.pole = uv[1] < 0.5;
      }
      const needed = new Set();
      for (let i = 0; i < uv.length; i += 2) {
        const x = mod(Math.floor(uv[i] * pack.width - 0.5), pack.width),
          y = Math.max(
            0,
            Math.min(
              pack.height - 1,
              Math.floor(uv[i + 1] * pack.height - 0.5),
            ),
          );
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++)
            needed.add(
              `${Math.floor(Math.min(pack.height - 1, y + dy) / pack.tilePixels)}-${Math.floor(mod(x + dx, pack.width) / pack.tilePixels)}`,
            );
      }
      for (const id of needed) {
        if (cache.has(id)) continue;
        const suffix = kind === "color" ? ".jpg" : ".bin.gz",
          bytes = await readFile(
            resolve(root, pack.baseUrl.slice(1), id + suffix),
          );
        if (hash(bytes) !== pack.tileSha256[id + suffix])
          throw new Error(`Corrupt existing ${body} ${kind} tile ${id}`);
        if (kind === "color") {
          const r = await sharp(bytes)
            .removeAlpha()
            .toColourspace("srgb")
            .raw()
            .toBuffer({ resolveWithObject: true });
          cache.set(id, { data: r.data, width: r.info.width });
        } else
          cache.set(id, {
            data: gunzipSync(bytes),
            width: Math.min(
              pack.tilePixels,
              pack.width - Number(id.split("-")[1]) * pack.tilePixels,
            ),
          });
      }
    },
    sample(u, v, c = 0) {
      const xx = u * pack.width - 0.5,
        yy = v * pack.height - 0.5,
        x0 = Math.floor(xx),
        y0 = Math.floor(yy),
        fx = xx - x0,
        fy = yy - y0;
      let value = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const x = mod(x0 + dx, pack.width),
            y = Math.max(0, Math.min(pack.height - 1, y0 + dy)),
            r = cache.get(
              `${Math.floor(y / pack.tilePixels)}-${Math.floor(x / pack.tilePixels)}`,
            );
          const i = (y % pack.tilePixels) * r.width + (x % pack.tilePixels);
          value +=
            (kind === "color"
              ? r.data[i * 3 + c]
              : r.data.readUInt16LE(i * 2)) *
            (dx ? fx : 1 - fx) *
            (dy ? fy : 1 - fy);
        }
      return value;
    },
  };
}
async function science(body) {
  if (["earth", "moon", "mars"].includes(body)) return oldPack(body, "terrain");
  if (!["mercury", "enceladus", "titan", "venus"].includes(body)) return null;
  const m = await manifest(body);
  if (body === "titan") {
    // Existing science base is already at its source's 4 ppd; never claim new relief.
    const source = m.provenance.source,
      path = resolve(originals, source.extractedFile);
    await verified(path, source.extractedSha256);
    const bytes = await readFile(path);
    if (bytes.length < 65536 + 1440 * 720 * 4)
      throw new Error("Truncated Titan scientific cube");
    const samples = new Float32Array(1440 * 720);
    for (let i = 0; i < samples.length; i++) {
      const v = bytes.readFloatLE(65536 + i * 4);
      if (!Number.isFinite(v) || Math.abs(v) > 10000)
        throw new Error("Invalid Titan elevation");
      samples[i] = v;
    }
    return {
      provenance: m.provenance,
      width: 1440,
      height: 720,
      encoding: { heightOffsetMeters: -1800, heightScaleMeters: 0.05 },
      async prepare() {},
      sample(u, v) {
        return (
          (bilinear(samples, 1440, 720, 1, u * 1440 - 0.5, v * 720 - 0.5) +
            1800) /
          0.05
        );
      },
    };
  }

  const path = resolve(originals, `${body}-dem.tif`),
    source = m.provenance.source || m.provenance;
  await verified(path, source.sha256);
  const file = await fromFile(path),
    image = await file.getImage(),
    w = image.getWidth(),
    h = image.getHeight();
  let raster, left, top, rw, rh;
  const keys = image.getGeoKeys(),
    geo = {
      origin: image.getOrigin(),
      resolution: image.getResolution(),
      radius: keys.GeogSemiMajorAxisGeoKey,
      centerLongitude: keys.ProjCenterLongGeoKey,
    };
  if (
    keys.ProjCoordTransGeoKey !== 17 ||
    !Number.isFinite(geo.radius) ||
    !Number.isFinite(geo.centerLongitude) ||
    geo.resolution[0] <= 0 ||
    geo.resolution[1] >= 0
  )
    throw new Error(`Invalid ${body} DEM georeferencing`);
  const xy = (u, v) => demSourceCoordinate(u, v, geo);
  return {
    provenance: m.provenance,
    width: w,
    height: h,
    encoding: {
      heightOffsetMeters:
        body === "mercury" ? -10000 : body === "venus" ? -4000 : -5000,
      heightScaleMeters: 0.5,
    },
    close: () => file.close(),
    async prepare(uv) {
      let minX = w,
        maxX = 0,
        minY = h,
        maxY = 0;
      for (let i = 0; i < uv.length; i += 2) {
        const [x, y] = xy(uv[i], uv[i + 1]);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      left = Math.max(0, Math.floor(minX));
      top = Math.max(0, Math.floor(minY));
      const right = Math.min(w, Math.ceil(maxX) + 2),
        bottom = Math.min(h, Math.ceil(maxY) + 2);
      rw = right - left;
      rh = bottom - top;
      raster = await image.readRasters({
        window: [left, top, right, bottom],
        interleave: true,
        samples: [0],
      });
    },
    sample(u, v) {
      const [x, y] = xy(u, v);
      let value =
        validBilinear(
          raster,
          rw,
          rh,
          x - left,
          y - top,
          body === "mercury" || body === "venus" ? -32768 : -1e30,
          rw === w,
        ) ?? 0;
      if (body === "venus") return value * 2 + 8000;
      if (body === "mercury") {
        if (!Number.isFinite(value) || value <= -32768) value = 0;
        return value + 20000;
      }
      const lat = (0.5 - v) * Math.PI,
        lon = (u - 0.5) * 2 * Math.PI,
        a = Math.cos(lat) * Math.cos(lon),
        b = Math.cos(lat) * Math.sin(lon),
        c = Math.sin(lat),
        radius =
          1 /
          Math.sqrt(
            (a * a) / 256200 ** 2 +
              (b * b) / 251400 ** 2 +
              (c * c) / 248600 ** 2,
          );
      if (!Number.isFinite(value) || value < -1e30) value = 0;
      return (radius + value * 1000 - 252100 + 5000) / 0.5;
    },
  };
}
function tileGrid(width, height, polarOnly = false) {
  const tiles = [];
  if (!polarOnly) {
    const nx = Math.ceil(width / TILE),
      ny = Math.ceil(height / TILE);
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const bounds = [x / nx, y / ny, (x + 1) / nx, (y + 1) / ny];
        if (bounds[3] <= 20 / 180 || bounds[1] >= 160 / 180) continue;
        tiles.push({
          id: `e-${y}-${x}`,
          uvBounds: bounds,
          width: Math.floor(width / nx),
          height: Math.floor(height / ny),
        });
      }
  }
  const size = polarSize(width),
    n = Math.ceil(size / TILE);
  for (const pole of [1, -1])
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        tiles.push({
          id: `${pole > 0 ? "n" : "s"}-${y}-${x}`,
          projection: "polar-stereographic",
          pole,
          capLatitude: CAP,
          uvBounds: [x / n, y / n, (x + 1) / n, (y + 1) / n],
          width: Math.floor(size / n),
          height: Math.floor(size / n),
        });
  return tiles;
}
export function sourceIdentity(provenance) {
  return (
    provenance?.sha256 ||
    provenance?.source?.sha256 ||
    JSON.stringify(
      provenance?.originals?.map((s) => s.sha256) ||
        provenance?.sources?.map((s) => s.sha256) ||
        provenance ||
        null,
    )
  );
}
export async function buildBody(body, { polarOnly = false } = {}) {
  const legacy = ["earth", "moon", "mars"].includes(body),
    color = legacy ? await oldPack(body, "color") : await colorSource(body),
    height = await science(body);
  const prior = polarOnly ? await json(resolve(dest, `${body}.json`)) : null;
  if (
    prior &&
    (sourceIdentity(prior.provenance) !== sourceIdentity(color.provenance) ||
      sourceIdentity(prior.heightProvenance) !==
        sourceIdentity(height?.provenance))
  ) {
    await height?.close?.();
    throw new Error(`Changed ${body} master: full rebuild required`);
  }

  const width = Math.min(
      23040,
      color.width,
      body === "earth" ? 21600 : body === "mars" ? 21339 : 23040,
    ),
    sourceRatio = width / color.width,
    tiles = tileGrid(
      width,
      Math.round(color.height * sourceRatio),
      polarOnly ||
        legacy ||
        [
          "venus",
          "ariel",
          "umbriel",
          "titania",
          "oberon",
          "miranda",
          "triton",
        ].includes(body),
    );
  await mkdir(resolve(dest, body), { recursive: true });
  let totalBytes = 0;
  try {
    for (const tile of tiles) {
      tile.blendBorder = 0.025;
      const uv = pixels(tile, tile.width, tile.height);
      await color.prepare(uv);
      const rgb = Buffer.alloc(tile.width * tile.height * color.channels);
      for (let i = 0; i < uv.length / 2; i++)
        for (let c = 0; c < color.channels; c++)
          rgb[i * color.channels + c] = Math.max(
            0,
            Math.min(
              255,
              Math.round(color.sample(uv[i * 2], uv[i * 2 + 1], c)),
            ),
          );
      const jpg = await sharp(rgb, {
        raw: {
          width: tile.width,
          height: tile.height,
          channels: color.channels,
        },
      })
        .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
        .toBuffer();
      tile.colorUrl = `/assets/surfaces/detail/${body}/${tile.id}.jpg`;
      tile.colorSha256 = hash(jpg);
      tile.colorBytes = jpg.length;
      await writeFile(resolve(root, tile.colorUrl.slice(1)), jpg);
      totalBytes += jpg.length;
      if (height) {
        const ratio = Math.min(1, height.width / color.width);
        tile.heightWidth = Math.max(2, Math.floor(tile.width * ratio));
        tile.heightHeight = Math.max(2, Math.floor(tile.height * ratio));
        const huv = pixels(tile, tile.heightWidth, tile.heightHeight);
        await height.prepare(huv);
        const bytes = Buffer.alloc(tile.heightWidth * tile.heightHeight * 2);
        tile.heightOffsetMeters = height.encoding.heightOffsetMeters;
        tile.heightScaleMeters = height.encoding.heightScaleMeters;
        let min = Infinity,
          max = -Infinity;
        for (let i = 0; i < huv.length / 2; i++) {
          const value = height.sample(huv[i * 2], huv[i * 2 + 1]);
          if (!Number.isFinite(value) || value < -0.5 || value > 65535.5)
            throw new Error(`Invalid ${body} science sample ${value}`);
          const n = Math.max(0, Math.min(65535, Math.round(value)));
          bytes.writeUInt16LE(n, i * 2);
          const elevation =
            tile.heightOffsetMeters + n * tile.heightScaleMeters;
          min = Math.min(min, elevation);
          max = Math.max(max, elevation);
        }
        const gz = gzipSync(bytes, { level: 9 });
        tile.heightUrl = `/assets/surfaces/detail/${body}/${tile.id}.bin.gz`;
        tile.heightSha256 = hash(gz);
        tile.heightBytes = gz.length;
        tile.minElevationMeters = min;
        tile.maxElevationMeters = max;
        await writeFile(resolve(root, tile.heightUrl.slice(1)), gz);
        totalBytes += gz.length;
      }
    }
  } finally {
    await height?.close?.();
  }
  if (polarOnly) {
    tiles.unshift(...prior.tiles.filter((t) => !t.pole));
    totalBytes = tiles.reduce(
      (n, t) => n + (t.colorBytes || 0) + (t.heightBytes || 0),
      0,
    );
  }
  const result = {
    heightProvenance: height?.provenance,
    terrainKind: height
      ? body === "titan"
        ? "coarse"
        : "measured"
      : ["dione", "mimas", "tethys"].includes(body)
        ? "none"
        : "procedural",
    effectivePixelsPerDegree: width / 360,
    heightEffectivePixelsPerDegree: height
      ? Math.min(width, height.width) / 360
      : null,
    tiles,
    totalBytes,
    sourceWidth: color.width,
    sourceHeight: color.height,
    sourceBytes: color.sourceBytes || 0,
    heightPolicy: height
      ? "Scientific elevation only; resolution bounded by source; no image-derived relief. Enceladus NoData uses reference triaxial ellipsoid, Mercury NoData uses datum zero, Titan is a sparse-observation interpolation."
      : "No measured DEM bundled in this detail pack; existing base shape and relief are not promoted into detail.",
    provenance: color.provenance,
    processing:
      "Pixel-centered canonical east-positive imagery sampled bilinearly at native resolution (maximum 64 ppd); 512-pixel bounded JPEG tiles; 70-degree stereographic polar replacement, square equatorial ground spacing; little-endian uint16 scientific heights in lossless gzip. Polar imagery remains limited by native polar observations/fill.",
  };
  await writeFile(
    resolve(dest, `${body}.json`),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(`${body}: ${tiles.length} tiles, ${totalBytes} bytes`);
  return result;
}
export async function assembleIndex() {
  const index = { schemaVersion: 1, bodies: {} };
  for (const file of (await readdir(dest))
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .sort()) {
    index.bodies[file.slice(0, -5)] = await json(resolve(dest, file));
  }
  await writeFile(
    resolve(dest, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
  );
  return index;
}
export async function main(args = process.argv.slice(2)) {
  if (args.includes("--index-only")) return assembleIndex();
  if (!args.includes("--rebuild"))
    throw new Error(
      "Usage: node scripts/prepare-detail-maps.mjs --rebuild [--bodies=europa,...]",
    );
  await mkdir(dest, { recursive: true });
  const selected = args
    .find((a) => a.startsWith("--bodies="))
    ?.slice(9)
    .split(",") || [
    "earth",
    "moon",
    "mars",
    "mercury",
    "enceladus",
    "europa",
    "titan",
    "io",
    "ganymede",
    "callisto",
    "dione",
    "mimas",
    "tethys",
    "rhea",
    "iapetus",
    "ariel",
    "umbriel",
    "titania",
    "oberon",
    "miranda",
    "triton",
    "venus",
  ];
  let index = { schemaVersion: 1, bodies: {} };
  if (existsSync(resolve(dest, "index.json")))
    index = await json(resolve(dest, "index.json"));
  for (const body of selected) {
    const pack = await buildBody(body, {
      polarOnly: args.includes("--polar-only"),
    });
    if (existsSync(resolve(dest, "index.json")))
      index = await json(resolve(dest, "index.json"));
    const normalizedMeta = resolve(originals, `${body}-normalized.json`);
    if (existsSync(normalizedMeta))
      pack.provenance = await json(normalizedMeta);
    index.bodies[body] = pack;
    await writeFile(
      resolve(dest, "index.json"),
      JSON.stringify(index, null, 2) + "\n",
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
