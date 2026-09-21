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
      .then(async (manifest) => {
        // Optional desktop terrain pack. An absent pack is normal: prepared
        // global maps remain immediately usable and web builds stay small.
        const pack = await fetch("/assets/surfaces/terrain64/index.json")
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null);
        if (pack?.schemaVersion === 1)
          for (const [id, grid] of Object.entries(pack.bodies || {}))
            if (manifest.bodies?.[id]?.levels?.near && grid.pixelsPerDegree === 64)
              manifest.bodies[id].levels.near.tileGrid = grid;
        const colorPack = await fetch("/assets/surfaces/color64/index.json")
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null);
        if (colorPack?.schemaVersion === 1)
          for (const [id, grid] of Object.entries(colorPack.bodies || {}))
            if (manifest.bodies?.[id]?.levels?.near && grid.pixelsPerDegree === 64)
              manifest.bodies[id].levels.near.colorTileGrid = grid;
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
        (entry.region && asset.region === entry.region) ||
        (entry.colorRegion && asset.colorRegion === entry.colorRegion) ||
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
      const surfaceAxes = surfaceFrame(body, sim.time);
      const toCamera = unit(sub(camera.position, body.position));
      const localCamera = [
        dot(toCamera, surfaceAxes.prime),
        dot(toCamera, surfaceAxes.north),
        dot(toCamera, surfaceAxes.east),
      ];
      const surfaceUv = {
        u: ((Math.atan2(localCamera[2], localCamera[0]) / (Math.PI * 2) + 0.5) % 1 + 1) % 1,
        v: 0.5 - Math.asin(clamp(localCamera[1], -1, 1)) / Math.PI,
      };
      // Prefer the surface beneath the center ray over the camera subpoint.
      // At grazing angles those can be far apart, and only one regional DEM
      // can be resident for a body at once. The subpoint still governs the
      // finite-distance horizon test in the cache.
      let viewUv = null;
      const fromCenter = sub(camera.position, body.position);
      const ray = camera.forward;
      const b = dot(fromCenter, ray);
      const discriminant = b * b - (dot(fromCenter, fromCenter) - body.radius * body.radius);
      if (discriminant >= 0) {
        const travel = -b - Math.sqrt(discriminant);
        if (travel > 0) {
          const hit = unit(fromCenter.map((value, i) => value + travel * ray[i]));
          const localHit = [
            dot(hit, surfaceAxes.prime),
            dot(hit, surfaceAxes.north),
            dot(hit, surfaceAxes.east),
          ];
          viewUv = {
            u: ((Math.atan2(localHit[2], localHit[0]) / (Math.PI * 2) + 0.5) % 1 + 1) % 1,
            v: 0.5 - Math.asin(clamp(localHit[1], -1, 1)) / Math.PI,
          };
        }
      }
      const entry = this.cache.get(
        body, pixels, now, surfaceUv,
        Math.min(1, body.radius / Math.max(distance, body.radius)),
        viewUv,
      );
      if (!entry?.color && !entry?.shape) continue;
      let state = this.states.get(body.id);
      if (!state) {
        state = { level: null, asset: null, previousAsset: null, since: now };
        this.states.set(body.id, state);
      }
      if (
        state.level !== entry.level ||
        state.asset?.color !== entry.color ||
        state.asset?.shape !== entry.shape ||
        state.asset?.region !== entry.region ||
        state.asset?.colorRegion !== entry.colorRegion
      ) {
        state.previousAsset = state.asset;
        state.asset = {
          color: entry.color,
          height: entry.height,
          region: entry.region,
          colorRegion: entry.colorRegion,
          shape: entry.shape,
        };
        state.level = entry.level;
        state.since = now;
      }
      state.blend = smooth((now - state.since) / 800);
      if (state.blend === 1) state.previousAsset = null;
      state.frame = surfaceAxes;
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
      state.atmosphericBands =
        this.manifest.bodies[body.id].atmosphericBands === true;
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
      // Keep the reliable 256-step grazing-ray bound. Regional DEMs are most
      // expensive in orbital horizon views; cap the offscreen raster at 85%
      // through 25 km while retaining full source textures and CPU clearance.
      const groundAltitude = Math.max(
        0,
        distance - this.radiusAt(body, camera.position),
      );
      state.quality =
        state.asset.region && groundAltitude < 25000
          ? {
              maxRayIterations: 256,
              resolutionScale: 0.85,
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
          l.tileGrid?.minElevationMeters || 0,
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
          l.tileGrid?.maxElevationMeters || 0,
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
