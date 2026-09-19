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
  const buffer = await response.arrayBuffer();
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

  _key(bodyId, level) {
    return `${bodyId}:${level}`;
  }

  _enqueue(bodyId, level) {
    const key = this._key(bodyId, level);
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

  async _load({ key, bodyId, level, generation }) {
    const definition = this.manifest.bodies?.[bodyId];
    const descriptor = definition?.levels?.[level];
    if (!descriptor) {
      this.failures.add(key);
      return;
    }
    let color = null,
      height = null,
      region = null,
      shape = null;
    const start = performance.now();
    try {
      if (descriptor.geometry) {
        const response = await fetch(descriptor.geometry);
        if (!response.ok) throw new Error(`Shape asset ${response.status}`);
        shape = validateShape(await response.json());
      } else color = await this.loadImage(descriptor.color, descriptor);
      if (descriptor.heightUrl)
        height = await this.loadHeight(descriptor.heightUrl, descriptor);
      region = await loadOptionalRegion(this.loadHeight, descriptor);
      if (generation !== this.generation) {
        color?.dispose?.();
        height?.dispose?.();
        region?.dispose?.();
        return;
      }
      const bytes =
        (shape
          ? shape.vertices.length * 3 * 8 + shape.indices.length * 8
          : (color?.bytes ?? descriptor.width * descriptor.height * 4)) +
        (height?.bytes ?? 0) +
        (region?.bytes ?? 0);
      const entry = {
        bodyId,
        level,
        descriptor,
        color,
        height,
        shape,
        region: region?.data ? region : null,
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
      this.entries.delete(this._key(victim.bodyId, victim.level));
      this.usedBytes -= victim.bytes;
      this.onEvict(victim);
      victim.color?.dispose?.();
      victim.height?.dispose?.();
      victim.region?.dispose?.();
    }
  }

  _best(bodyId, target) {
    const targetIndex = ORDER.indexOf(target);
    for (let i = targetIndex; i >= 0; i--) {
      const entry = this.entries.get(this._key(bodyId, ORDER[i]));
      if (entry) return entry;
    }
    return null;
  }

  get(body, projectedRadiusPx = 0, now = Date.now()) {
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
    const entry = this._best(body.id, target);
    // Once a better level exists, do not redownload lower, stale levels merely
    // to reconstruct a hierarchy that is no longer used by the view.
    for (
      let i = entry ? ORDER.indexOf(entry.level) + 1 : 0;
      i <= targetIndex;
      i++
    )
      this._enqueue(body.id, ORDER[i]);
    const loading =
      [...this.inFlight.keys()].some((key) => key.startsWith(`${body.id}:`)) ||
      this.queue.some((item) => item.bodyId === body.id);
    const failed = this.failures.has(this._key(body.id, target));
    if (entry) {
      entry.lastUsed = now;
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
