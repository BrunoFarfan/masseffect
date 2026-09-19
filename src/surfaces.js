import { SurfaceAssetCache } from "./surface-assets.js";
import {
  getSurfaceDefinition,
  isCanonicalSurfaceBody,
  surfaceFrame,
} from "./surface-definition.js";
import { sampleAssetHeight } from "./surface-math.js";
import { intersectTerrain } from "./surface-ray.js";
import { shapeRadius, shapeIntersection } from "./surface-shape.js";
import { sub, dot, length, unit, clamp } from "./math.js";

const smooth = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};

// Rendering state only. No cache, map, or visual amplitude is stored in bodies,
// snapshots or integrator state. Camera clearance uses exactly this state.
export class Surfaces {
  constructor() {
    this.cache = null;
    this.states = new Map();
    this.time = 0;
    this.exaggeration = 1;
    this.error = null;
    this.enabled = true;
    this.ready = fetch("/assets/surfaces/manifest.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Surface manifest ${r.status}`);
        return r.json();
      })
      .then((manifest) => {
        this.manifest = manifest;
        this.cache = new SurfaceAssetCache({
          manifest,
          onEvict: (entry) => this.releaseAsset(entry),
        });
      })
      .catch((error) => {
        this.error = error.message;
      });
  }
  releaseAsset(entry) {
    const matches = (asset) =>
      asset &&
      ((entry.color && asset.color === entry.color) ||
        (entry.shape && asset.shape === entry.shape));
    for (const [id, state] of this.states) {
      if (matches(state.asset)) this.states.delete(id);
      else if (matches(state.previousAsset)) {
        // Under memory pressure finish the transition before disposing its
        // previous map. CPU clearance and GPU shading never read freed data.
        state.previousAsset = null;
        state.blend = 1;
        state.since = -Infinity;
      }
    }
  }
  prepare(sim, camera, height, now = performance.now()) {
    this.time = sim.time;
    if (!this.cache) return;
    const active = new Set();
    for (const body of sim.bodies) {
      const definition = getSurfaceDefinition(body);
      if (definition?.shapeType === "irregular" && this.shapeEnabled === false)
        continue;
      if (!definition?.levels && !this.manifest.bodies[body.id]) continue;
      if (!isCanonicalSurfaceBody(body, definition)) continue;
      const distance = length(sub(camera.position, body.position));
      const pixels = (body.radius * height * 0.95) / Math.max(1, distance);
      if (pixels < 6) continue;
      active.add(body.id);
      const entry = this.cache.get(body, pixels, now);
      if (!entry?.color && !entry?.shape) continue;
      let state = this.states.get(body.id);
      if (!state) {
        state = { level: null, asset: null, previousAsset: null, since: now };
        this.states.set(body.id, state);
      }
      if (
        state.level !== entry.level ||
        state.asset?.color !== entry.color ||
        state.asset?.shape !== entry.shape
      ) {
        state.previousAsset = state.asset;
        state.asset = {
          color: entry.color,
          height: entry.height,
          region: entry.region,
          shape: entry.shape,
        };
        state.level = entry.level;
        state.since = now;
      }
      state.blend = smooth((now - state.since) / 800);
      if (state.blend === 1) state.previousAsset = null;
      state.frame = surfaceFrame(body, sim.time);
      state.referenceRadiusMeters =
        this.manifest.bodies[body.id].referenceRadiusMeters ||
        definition.referenceRadiusMeters;
      state.exaggeration = this.exaggeration;
      state.displayExposure = definition.displayExposure ?? 1;
      state.baseRadiiMeters =
        this.manifest.bodies[body.id].baseRadiiMeters ||
        definition.radiiMeters ||
        null;
      state.waterSurface = !!this.manifest.bodies[body.id].waterSurface;
      state.emissive = !!definition.emissive;
      const altitude = Math.max(0, distance - state.referenceRadiusMeters);
      state.atmosphere = definition.atmosphere;
      state.atmosphereOpacity = definition.atmosphere
        ? smooth(
            (altitude - definition.atmosphere.lowerAltitudeMeters) /
              (definition.atmosphere.upperAltitudeMeters -
                definition.atmosphere.lowerAltitudeMeters),
          )
        : 0;
      // Surface relief is subpixel from orbit. Start actual displacement before
      // the camera enters the shell and retain it all the way to the ground.
      state.displacement = smooth((0.5 - altitude / body.radius) / 0.3);
      // Keep the reliable 256-step grazing-ray bound. Raster reduction alone
      // supplies the close-range budget win without introducing horizon slits.
      const groundAltitude = Math.max(
        0,
        distance - this.radiusAt(body, camera.position),
      );
      state.quality =
        state.asset.region && groundAltitude < 15000
          ? {
              maxRayIterations: 256,
              resolutionScale:
                0.75 + 0.25 * smooth((groundAltitude - 1000) / 14000),
            }
          : undefined;
      const levels = Object.values(this.manifest.bodies[body.id].levels);
      state.minElevationMeters = Math.min(
        0,
        ...(state.baseRadiiMeters || [state.referenceRadiusMeters]).map(
          (r) => r - state.referenceRadiusMeters,
        ),
        ...levels.flatMap((l) => [
          l.minElevationMeters || 0,
          l.region?.minElevationMeters || 0,
        ]),
      );
      state.maxElevationMeters = Math.max(
        0,
        ...(state.baseRadiiMeters || [state.referenceRadiusMeters]).map(
          (r) => r - state.referenceRadiusMeters,
        ),
        ...levels.flatMap((l) => [
          l.maxElevationMeters || 0,
          l.region?.maxElevationMeters || 0,
        ]),
      );
      state.loading = entry.loading;
      state.failed = entry.failed;
    }
    for (const [id] of this.states) if (!active.has(id)) this.states.delete(id);
    this.cache.endFrame(now);
  }
  state(body) {
    return isCanonicalSurfaceBody(body) ? this.states.get(body.id) : null;
  }
  has(body) {
    return (
      this.enabled &&
      !!(
        this.state(body)?.asset?.height ||
        this.state(body)?.asset?.shape ||
        this.state(body)?.baseRadiiMeters
      )
    );
  }
  local(state, vector) {
    return [
      dot(vector, state.frame.prime),
      dot(vector, state.frame.north),
      dot(vector, state.frame.east),
    ];
  }
  sample(state, direction) {
    const n = unit(direction);
    const u = Math.atan2(n[2], n[0]) / (Math.PI * 2) + 0.5;
    const v = 0.5 - Math.asin(clamp(n[1], -1, 1)) / Math.PI;
    const current = sampleAssetHeight(state.asset, u, v);
    const height = state.previousAsset
      ? sampleAssetHeight(state.previousAsset, u, v) * (1 - state.blend) +
        current * state.blend
      : current;
    const base = state.baseRadiiMeters
      ? 1 / Math.hypot(...n.map((v, i) => v / state.baseRadiiMeters[i])) -
        state.referenceRadiusMeters
      : 0;
    if (!state.asset.height) return base;
    let relief = (height - base) * state.exaggeration;
    if (state.waterSurface) relief = Math.max(0, relief);
    return base + relief * state.displacement;
  }
  radiusAt(body, position) {
    const state = this.state(body);
    if (this.enabled && state?.asset.shape)
      return shapeRadius(
        state.asset.shape,
        this.local(state, sub(position, body.position)),
      );
    if (
      !this.enabled ||
      !state ||
      (!state.asset.height && !state.baseRadiiMeters)
    )
      return body.radius;
    return (
      state.referenceRadiusMeters +
      this.sample(state, this.local(state, sub(position, body.position)))
    );
  }
  contact(body, position, delta, clearance) {
    const state = this.state(body);
    if (state?.asset.shape && length(delta)) {
      const hit = shapeIntersection(
        state.asset.shape,
        this.local(state, sub(position, body.position)),
        this.local(state, delta),
        1,
      );
      return hit === null ? null : Math.max(0, hit - clearance / length(delta));
    }
    if (
      !state ||
      (!state.asset.height && !state.baseRadiiMeters) ||
      !length(delta)
    )
      return null;
    if (!state.asset.height && state.baseRadiiMeters) {
      const origin = this.local(state, sub(position, body.position));
      const direction = this.local(state, delta);
      // A constant axis expansion is not exactly radial clearance. Leave the
      // same sweep/standing margin as DEM contact, so ground travel can depart.
      const axes = state.baseRadiiMeters.map((r) => r + clearance * 0.75);
      const o = origin.map((v, i) => v / axes[i]),
        d = direction.map((v, i) => v / axes[i]);
      const a = dot(d, d),
        b = dot(o, d),
        c = dot(o, o) - 1,
        disc = b * b - a * c;
      if (c < 0) return 0;
      if (disc < 0 || !a) return null;
      const t = (-b - Math.sqrt(disc)) / a;
      return t >= 0 && t <= 1 ? t : null;
    }
    const scale = state.exaggeration * state.displacement;
    const baseOffsets = (
      state.baseRadiiMeters || [state.referenceRadiusMeters]
    ).map((r) => r - state.referenceRadiusMeters);
    const baseMin = Math.min(...baseOffsets),
      baseMax = Math.max(...baseOffsets);
    const hit = intersectTerrain(
      this.local(state, sub(position, body.position)),
      this.local(state, delta),
      state.referenceRadiusMeters + clearance * 0.75,
      baseMin + Math.min(0, state.minElevationMeters - baseMax) * scale,
      baseMax + Math.max(0, state.maxElevationMeters - baseMin) * scale,
      (x, y, z) => this.sample(state, [x, y, z]),
      {
        maxDistance: 1,
        tolerance: 0.05,
        slopeBound: 4,
        steps: 128,
        conservative: true,
      },
    );
    return hit?.distance ?? null;
  }
  orientation(body) {
    if (!this.enabled) return null;
    const s = this.state(body);
    return s?.frame?.quaternion || null;
  }
  description(body) {
    if (!this.enabled) return "Basic sphere · terrain GPU unavailable";
    const definition = getSurfaceDefinition(body);
    if (!definition || !isCanonicalSurfaceBody(body))
      return "Illustrative surface · no measured terrain";
    if (!this.manifest?.bodies[body.id])
      return "Illustrative surface · no measured terrain";
    const s = this.state(body);
    return `${this.manifest.bodies[body.id].sourceType}${s?.asset?.region ? ` + ${s.asset.region.name || "regional DEM"}` : ""} · ${s?.level || "unloaded"}${s?.failed ? " · asset unavailable" : s?.loading ? " · loading" : ""} · ${this.exaggeration}× visual relief · microdetail approximate`;
  }
}
