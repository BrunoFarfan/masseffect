import {
  SURFACE_DEFINITIONS,
  getSurfaceDefinition,
  isCanonicalSurfaceBody,
} from "./surface-definition.js";
import { validateShape } from "./surface-shape.js";

const ORDER = ["preview", "medium", "near"];
const DEFAULT_THRESHOLDS = { medium: 48, near: 240 };

async function defaultLoadImage(url, descriptor) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`surface image ${response.status}: ${url}`);
  const blob = await response.blob();
  if (typeof createImageBitmap !== "function")
    throw new Error("Image bitmap decoding unavailable");
  const bitmap = await createImageBitmap(blob);
  if (
    bitmap.width !== descriptor.width ||
    bitmap.height !== descriptor.height
  ) {
    bitmap.close();
    throw new Error("Surface color dimensions disagree with manifest");
  }
  let source = bitmap;
  let canvas;
  if (typeof OffscreenCanvas !== "undefined")
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }
  if (canvas) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    source = context.getImageData(0, 0, bitmap.width, bitmap.height);
  }
  const width = bitmap.width,
    height = bitmap.height;
  bitmap.close?.();
  return {
    source,
    data: source?.data ?? source,
    width,
    height,
    bytes: width * height * 4,
    dispose() {
      this.source = this.data = null;
    },
  };
}

async function defaultLoadHeight(url, descriptor) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`surface height ${response.status}: ${url}`);
  const buffer = url.endsWith(".gz")
    ? await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
    : await response.arrayBuffer();
  const raw = new DataView(buffer);
  const width = descriptor.heightWidth ?? descriptor.width;
  const height = descriptor.heightHeight ?? descriptor.height;
  const count = width * height;
  if (buffer.byteLength !== count * 2)
    throw new Error("Invalid surface height byte length");
  const decoded = new Float32Array(count);
  const offset = descriptor.heightOffsetMeters ?? 0;
  const scale = descriptor.heightScaleMeters ?? 1;
  for (let i = 0; i < count; i++)
    decoded[i] = offset + raw.getUint16(i * 2, true) * scale;
  return {
    data: decoded,
    width,
    height,
    bytes: decoded.byteLength,
    dispose() {
      this.data = null;
    },
  };
}

async function loadOptionalRegion(loadHeight, descriptor) {
  if (!descriptor?.region?.heightUrl) return null;
  try {
    const loaded = await loadHeight(
      descriptor.region.heightUrl,
      descriptor.region,
    );
    return {
      ...loaded,
      name: descriptor.region.name,
      uvBounds: descriptor.region.uvBounds,
      blendBorder: descriptor.region.blendBorder ?? 0.08,
      minElevationMeters: descriptor.region.minElevationMeters,
      maxElevationMeters: descriptor.region.maxElevationMeters,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function targetLevel(radius, thresholds) {
  if (radius >= thresholds.near) return "near";
  if (radius >= thresholds.medium) return "medium";
  return "preview";
}

const TAU = Math.PI * 2;

function longitudeIntervals(u0, u1) {
  const start = ((u0 % 1) + 1) % 1;
  const span = u1 - u0;
  if (Math.abs(span) >= 1) return [[0, 1]];
  const width = ((span % 1) + 1) % 1;
  if (width === 0) return [[start, start]];
  const end = start + width;
  return end <= 1 ? [[start, end]] : [[start, 1], [0, end - 1]];
}

function closestLongitude(u, lo, hi) {
  const candidates = [lo, hi];
  if (u >= lo && u <= hi) candidates.push(u);
  return candidates.reduce((best, value) => {
    const wrapped = (((value - u + 0.5) % 1) + 1) % 1;
    const distance = Math.abs(wrapped - 0.5);
    return distance < best.distance ? { value, distance } : best;
  }, { value: lo, distance: Infinity }).value;
}

// Return the greatest dot product between the camera direction and a tile.
// Unlike comparing tile centers, this keeps a tile at the visible limb (and
// tiles crossing longitude zero) eligible for an oblique camera view.
function regionVisibility(surfaceUv, region) {
  const bounds = region?.uvBounds;
  if (!bounds || bounds.length !== 4) return -Infinity;
  const [u0, v0, u1, v1] = bounds;
  const cameraLat = (0.5 - clamp01(surfaceUv.v)) * Math.PI;
  const cameraU = ((surfaceUv.u % 1) + 1) % 1;
  const latA = (0.5 - clamp01(v0)) * Math.PI;
  const latB = (0.5 - clamp01(v1)) * Math.PI;
  const latMin = Math.min(latA, latB), latMax = Math.max(latA, latB);
  let best = -Infinity;
  for (const [lo, hi] of longitudeIntervals(u0, u1)) {
    const lonU = closestLongitude(cameraU, lo, hi);
    const delta = (lonU - cameraU) * TAU;
    const optimum = Math.atan2(
      Math.sin(cameraLat),
      Math.cos(cameraLat) * Math.cos(delta),
    );
    const latitudes = [
      latMin,
      latMax,
      Math.max(latMin, Math.min(latMax, optimum)),
    ];
    for (const latitude of latitudes) {
      best = Math.max(
        best,
        Math.sin(cameraLat) * Math.sin(latitude) +
          Math.cos(cameraLat) * Math.cos(latitude) * Math.cos(delta),
      );
    }
  }
  return best;
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));

export class SurfaceAssetCache {
  constructor({
    manifest = { schemaVersion: 1, bodies: SURFACE_DEFINITIONS },
    loadImage = defaultLoadImage,
    loadHeight = defaultLoadHeight,
    maxConcurrent = 2,
    budgetBytes = 96 * 1024 * 1024,
    thresholds = {},
    onEvict = () => {},
  } = {}) {
    this.manifest = manifest;
    this.loadImage = loadImage;
    this.loadHeight = loadHeight;
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.budgetBytes = budgetBytes;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.entries = new Map();
    this.inFlight = new Map();
    this.failures = new Set();
    this.queue = [];
    this.usedBytes = 0;
    this.frame = 0;
    this._id = 0;
    this.generation = 0;
    this.onEvict = onEvict;
  }

  _key(bodyId, level, regionId = "global") {
    return `${bodyId}:${level}:${regionId}`;
  }

  _tileDescriptor(grid, u, v, colorGrid = null) {
    if (!grid || grid.pixelsPerDegree !== 64 || !grid.baseUrl) return null;
    const width = grid.width, height = grid.height, tile = grid.tilePixels;
    if (!(width === 23040 && height === 11520 && tile === 1024)) return null;
    const col = Math.min(Math.ceil(width / tile) - 1, Math.floor((((u % 1) + 1) % 1) * width / tile));
    const row = Math.min(Math.ceil(height / tile) - 1, Math.floor(Math.max(0, Math.min(1 - 1e-12, v)) * height / tile));
    const x = col * tile, y = row * tile;
    const regionWidth = Math.min(tile, width - x), regionHeight = Math.min(tile, height - y);
    return {
      id: `tile-${row}-${col}`,
      name: `Global 64 ppd tile ${row}/${col}`,
      heightUrl: `${grid.baseUrl}/${row}-${col}.bin.gz`,
      ...(colorGrid?.baseUrl && colorGrid.width === width && colorGrid.height === height && colorGrid.tilePixels === tile
        ? { colorUrl: `${colorGrid.baseUrl}/${row}-${col}.jpg`, width: regionWidth, height: regionHeight }
        : {}),
      heightWidth: regionWidth,
      heightHeight: regionHeight,
      heightOffsetMeters: grid.heightOffsetMeters,
      heightScaleMeters: grid.heightScaleMeters,
      uvBounds: [x / width, y / height, (x + regionWidth) / width, (y + regionHeight) / height],
      minElevationMeters: grid.minElevationMeters,
      maxElevationMeters: grid.maxElevationMeters,
      blendBorder: 0.025,
    };
  }

  _colorTileDescriptor(grid, u, v) {
    if (!grid || grid.pixelsPerDegree !== 64 || !grid.baseUrl) return null;
    const width = grid.width, height = grid.height, tile = grid.tilePixels;
    if (!(width === 23040 && height === 11520 && tile === 1024)) return null;
    const col = Math.min(Math.ceil(width / tile) - 1, Math.floor((((u % 1) + 1) % 1) * width / tile));
    const row = Math.min(Math.ceil(height / tile) - 1, Math.floor(Math.max(0, Math.min(1 - 1e-12, v)) * height / tile));
    const x = col * tile, y = row * tile;
    const regionWidth = Math.min(tile, width - x), regionHeight = Math.min(tile, height - y);
    return {
      id: `tile-${row}-${col}`,
      name: `Global 64 ppd color tile ${row}/${col}`,
      colorUrl: `${grid.baseUrl}/${row}-${col}.jpg`,
      width: regionWidth,
      height: regionHeight,
      uvBounds: [x / width, y / height, (x + regionWidth) / width, (y + regionHeight) / height],
      blendBorder: 0.025,
    };
  }

  _enqueue(bodyId, level, regionId = "global") {
    const key = this._key(bodyId, level, regionId);
    if (
      this.entries.has(key) ||
      this.inFlight.has(key) ||
      this.failures.has(key) ||
      this.queue.some((item) => item.key === key)
    )
      return;
    this.queue.push({
      key,
      bodyId,
      level,
      regionId,
      generation: this.generation,
      order: this._id++,
    });
    this._pump();
  }

  _pump() {
    while (this.inFlight.size < this.maxConcurrent && this.queue.length) {
      const request = this.queue.shift();
      const promise = this._load(request).finally(() => {
        this.inFlight.delete(request.key);
        this._pump();
      });
      this.inFlight.set(request.key, promise);
    }
  }

  async _load({ key, bodyId, level, regionId, generation }) {
    const definition = this.manifest.bodies?.[bodyId];
    const descriptor = definition?.levels?.[level];
    if (!descriptor) {
      this.failures.add(key);
      return;
    }
    const regionDescriptor =
      regionId === "global"
        ? null
        : descriptor?.regions?.find((region) => region.id === regionId) ||
          (descriptor?.region?.id === regionId ||
          descriptor?.region?.name === regionId
            ? descriptor.region
            : null) ||
          (regionId.startsWith("tile-")
            ? (() => {
                const [, row, col] = regionId.split("-").map(Number);
                const grid = descriptor?.tileGrid;
                const colorGrid = descriptor?.colorTileGrid;
                return Number.isInteger(row) && Number.isInteger(col) && grid
                  ? this._tileDescriptor(grid,
                    (col * grid.tilePixels + Math.min(grid.tilePixels, grid.width - col * grid.tilePixels) / 2) / grid.width,
                    (row * grid.tilePixels + Math.min(grid.tilePixels, grid.height - row * grid.tilePixels) / 2) / grid.height,
                    colorGrid)
                  : Number.isInteger(row) && Number.isInteger(col) && colorGrid
                    ? this._colorTileDescriptor(colorGrid,
                      (col * colorGrid.tilePixels + 0.5) / colorGrid.width,
                      (row * colorGrid.tilePixels + 0.5) / colorGrid.height)
                    : null;
              })()
            : null);
    let color = null,
      height = null,
      region = null,
      colorRegion = null,
      shape = null;
    const start = performance.now();
    try {
      if (regionId === "global") {
        if (descriptor.geometry) {
          const response = await fetch(descriptor.geometry);
          if (!response.ok) throw new Error(`Shape asset ${response.status}`);
          shape = validateShape(await response.json());
        } else color = await this.loadImage(descriptor.color, descriptor);
        if (descriptor.heightUrl)
          height = await this.loadHeight(descriptor.heightUrl, descriptor);
      } else {
        if (!regionDescriptor) throw new Error("Unknown surface region");
        const [loadedHeight, loadedColor] = await Promise.all([
          regionDescriptor.heightUrl
            ? loadOptionalRegion(this.loadHeight, { region: regionDescriptor })
            : null,
          regionDescriptor.colorUrl
            ? this.loadImage(regionDescriptor.colorUrl, regionDescriptor)
                .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
            : null,
        ]);
        region = loadedHeight;
        colorRegion = loadedColor?.data ? loadedColor : null;
        if (colorRegion) {
          colorRegion.uvBounds = regionDescriptor.uvBounds;
          colorRegion.blendBorder = regionDescriptor.blendBorder;
        }
        if (!region?.data && !colorRegion?.data)
          throw new Error(region?.error || loadedColor?.error || "Empty surface region");
      }
      if (generation !== this.generation) {
        color?.dispose?.();
        height?.dispose?.();
        region?.dispose?.();
        colorRegion?.dispose?.();
        return;
      }
      const bytes =
        (shape
          ? shape.vertices.length * 3 * 8 + shape.indices.length * 8
          : (color?.bytes ?? 0)) +
        (height?.bytes ?? 0) +
        (region?.bytes ?? 0) + (colorRegion?.bytes ?? 0);
      const entry = {
        bodyId,
        level,
        regionId,
        descriptor,
        color,
        height,
        shape,
        region: region?.data ? region : null,
        colorRegion: colorRegion?.data ? colorRegion : null,
        regionalFailure: region?.error || null,
        bytes,
        lastUsed: this.frame,
        loadedAt: this.frame,
        latencyMs: performance.now() - start,
      };
      if (bytes > this.budgetBytes)
        throw new Error("Surface LOD exceeds cache budget");
      this.entries.set(key, entry);
      this.usedBytes += bytes;
      this._evict();
    } catch (error) {
      color?.dispose?.();
      height?.dispose?.();
      region?.dispose?.();
      colorRegion?.dispose?.();
      this.failures.add(key);
    }
  }

  _evict() {
    while (this.usedBytes > this.budgetBytes) {
      const candidates = [...this.entries.values()].sort(
        (a, b) =>
          a.lastUsed - b.lastUsed ||
          ORDER.indexOf(a.level) - ORDER.indexOf(b.level),
      );
      const victim = candidates[0];
      if (!victim) break;
      this.entries.delete(this._key(victim.bodyId, victim.level, victim.regionId));
      this.usedBytes -= victim.bytes;
      this.onEvict(victim);
      victim.color?.dispose?.();
      victim.height?.dispose?.();
      victim.region?.dispose?.();
      victim.colorRegion?.dispose?.();
    }
  }

  _best(bodyId, target) {
    const targetIndex = ORDER.indexOf(target);
    for (let i = targetIndex; i >= 0; i--) {
      const entry = this.entries.get(this._key(bodyId, ORDER[i], "global"));
      if (entry) return entry;
    }
    return null;
  }

  get(body, projectedRadiusPx = 0, now = Date.now(), surfaceUv = null, visibleDot = 0, viewUv = null) {
    this.frame = now;
    const definition =
      this.manifest.bodies?.[body?.id] ?? getSurfaceDefinition(body);
    if (
      !definition ||
      !definition.levels ||
      !isCanonicalSurfaceBody(body, {
        ...definition,
        referenceRadiusMeters:
          definition.canonicalRadiusMeters ?? definition.referenceRadiusMeters,
      })
    )
      return null;
    const target = targetLevel(Math.max(0, projectedRadiusPx), this.thresholds);
    const targetIndex = ORDER.indexOf(target);
    const globalEntry = this._best(body.id, target);
    // Once a better level exists, do not redownload lower, stale levels merely
    // to reconstruct a hierarchy that is no longer used by the view.
    for (
      let i = globalEntry ? ORDER.indexOf(globalEntry.level) + 1 : 0;
      i <= targetIndex;
      i++
    )
      this._enqueue(body.id, ORDER[i], "global");
    let regionalId = null;
    const nearDescriptor = definition.levels.near;
    const regions = nearDescriptor?.regions ||
      (nearDescriptor?.region ? [nearDescriptor.region] : []);
    // At terrain scale choose a single nearby global tile directly by UV;
    // never enqueue the entire pack. At higher altitude keep the coherent
    // lower-resolution globe and its existing curated regional DEMs.
    // Measure against canonical radius with headroom for high terrain and
    // oblate Earth: a 15 km-above-ground camera can exceed R+0.01R.
    if (target === "near" && surfaceUv && visibleDot > 0.975 && (nearDescriptor?.tileGrid || nearDescriptor?.colorTileGrid)) {
      const uv = viewUv || surfaceUv;
      const tile = nearDescriptor.tileGrid
        ? this._tileDescriptor(nearDescriptor.tileGrid, uv.u, uv.v, nearDescriptor.colorTileGrid)
        : this._colorTileDescriptor(nearDescriptor.colorTileGrid, uv.u, uv.v);
      regionalId = tile?.id || null;
      if (regionalId) this._enqueue(body.id, "near", regionalId);
    }
    if (!regionalId && target === "near" && surfaceUv && regions.length) {
      const matching = regions
        .map((region, index) => ({
          region,
          index,
          visibility: regionVisibility(surfaceUv, region),
          viewScore: regionVisibility(viewUv || surfaceUv, region),
        }))
        // A surface point is visible from finite distance when its radial
        // direction makes dot >= radius / camera distance. Callers without
        // distance retain the far-field geometric-horizon default.
        .filter(({ visibility }) => visibility >= visibleDot - 1e-9)
        .sort(
          (a, b) =>
            b.viewScore - a.viewScore ||
            b.visibility - a.visibility ||
            (a.region.priority ?? 0) - (b.region.priority ?? 0) ||
            a.index - b.index,
        )[0]?.region;
      if (matching) {
        regionalId = matching.id || matching.name;
        this._enqueue(body.id, "near", regionalId);
      }
    }
    // The camera can move across several regional tiles while an image is in
    // flight. Drop obsolete queued tile work; completed tiles remain useful
    // cache entries for a later view and are evicted by normal LRU pressure.
    this.queue = this.queue.filter(
      (item) =>
        item.bodyId !== body.id ||
        item.level !== "near" ||
        item.regionId === "global" ||
        item.regionId === regionalId,
    );
    const regionalEntry = regionalId
      ? this.entries.get(this._key(body.id, target, regionalId))
      : null;
    // Regional color and height are optional layers over the stable global
    // map. Keep that fallback while tiles load or evict.
    const entry =
      regionalEntry && globalEntry?.level === "near"
        ? { ...globalEntry, region: regionalEntry.region, colorRegion: regionalEntry.colorRegion, regionId: regionalId }
        : globalEntry;
    const loading =
      [...this.inFlight.keys()].some((key) => key.startsWith(`${body.id}:`)) ||
      this.queue.some((item) => item.bodyId === body.id);
    const failed = this.failures.has(
      this._key(body.id, target, regionalId || "global"),
    );
    if (entry) {
      globalEntry.lastUsed = now;
      if (regionalEntry && entry.region === regionalEntry.region)
        regionalEntry.lastUsed = now;
      return { ...entry, targetLevel: target, loading, failed };
    }
    return {
      bodyId: body.id,
      targetLevel: target,
      loading,
      failed,
      entry: null,
    };
  }

  peek(bodyOrId, level = "near") {
    const bodyId = typeof bodyOrId === "string" ? bodyOrId : bodyOrId?.id;
    return this._best(bodyId, ORDER.includes(level) ? level : "preview");
  }

  update(now = Date.now()) {
    this.frame = now;
    for (const [key, entry] of this.entries) {
      if (entry.level !== "preview" && now - entry.lastUsed > 5000) {
        this.entries.delete(key);
        this.usedBytes -= entry.bytes;
        this.onEvict(entry);
        entry.color?.dispose?.();
        entry.height?.dispose?.();
        entry.region?.dispose?.();
        entry.colorRegion?.dispose?.();
      }
    }
    this._pump();
    this._evict();
    return this.stats();
  }
  endFrame(now = Date.now()) {
    return this.update(now);
  }

  clear(bodyId = null) {
    this.generation++;
    for (const [key, entry] of this.entries)
      if (!bodyId || entry.bodyId === bodyId) {
        this.entries.delete(key);
        this.usedBytes -= entry.bytes;
        this.onEvict(entry);
        entry.color?.dispose?.();
        entry.height?.dispose?.();
        entry.region?.dispose?.();
        entry.colorRegion?.dispose?.();
      }
    this.queue = bodyId
      ? this.queue.filter((item) => item.bodyId !== bodyId)
      : [];
    for (const key of [...this.failures])
      if (!bodyId || key.startsWith(`${bodyId}:`)) this.failures.delete(key);
  }

  stats() {
    return {
      usedBytes: this.usedBytes,
      budgetBytes: this.budgetBytes,
      entries: this.entries.size,
      queued: this.queue.length,
      loading: this.inFlight.size,
      failed: this.failures.size,
    };
  }
}

export function createSurfaceAssetCache(options) {
  return new SurfaceAssetCache(options);
}

export { defaultLoadImage, defaultLoadHeight, targetLevel };
