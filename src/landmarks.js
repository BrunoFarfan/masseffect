import { add, dot, length, mul, sub, unit } from "./math.js";
import { intersectTerrain } from "./surface-ray.js";

// Names and coordinates are intentionally a small, stable orientation aid, not
// a claim that the renderer is showing a surveyed outline of each feature.
export const SURFACE_LANDMARKS = Object.freeze({
  moon: Object.freeze([
    Object.freeze({
      name: "Tycho crater",
      latitude: -43.31,
      longitude: -11.36,
    }),
    Object.freeze({
      name: "Copernicus crater",
      latitude: 9.62,
      longitude: -20.08,
    }),
    Object.freeze({
      name: "Far side · Tsiolkovskiy",
      latitude: -20.4,
      longitude: 128.9,
    }),
    Object.freeze({ name: "North polar region", latitude: 86, longitude: 0 }),
  ]),
  mars: Object.freeze([
    Object.freeze({ name: "Olympus Mons", latitude: 18.4, longitude: -134 }),
    Object.freeze({
      name: "Valles Marineris",
      latitude: -13.9,
      longitude: -59.2,
    }),
    Object.freeze({ name: "Hellas basin", latitude: -42.4, longitude: 70.5 }),
  ]),
});

const radians = (degrees) => (degrees * Math.PI) / 180;

export function landmarkDirection(frame, landmark) {
  const lat = radians(landmark.latitude),
    lon = radians(landmark.longitude);
  return unit(
    add(
      mul(frame.north, Math.sin(lat)),
      add(
        mul(frame.prime, Math.cos(lat) * Math.cos(lon)),
        mul(frame.east, Math.cos(lat) * Math.sin(lon)),
      ),
    ),
  );
}

export function landmarkPoint(body, state, landmark, liftMeters = 50) {
  if (
    !body?.position ||
    !state?.frame ||
    !Number.isFinite(state.referenceRadiusMeters)
  )
    return null;
  const direction = landmarkDirection(state.frame, landmark);
  const localDirection = [
    dot(direction, state.frame.prime),
    dot(direction, state.frame.north),
    dot(direction, state.frame.east),
  ];
  const elevation =
    typeof state.sample === "function" ? state.sample(localDirection) : 0;
  return {
    direction,
    position: add(
      body.position,
      mul(direction, state.referenceRadiusMeters + elevation + liftMeters),
    ),
    elevation,
  };
}

export function terrainOccluded(
  cameraPosition,
  body,
  state,
  point,
  liftMeters = 50,
) {
  if (!state?.asset?.height || !state.frame || !point?.position) return false;
  const origin = [
    dot(sub(cameraPosition, body.position), state.frame.prime),
    dot(sub(cameraPosition, body.position), state.frame.north),
    dot(sub(cameraPosition, body.position), state.frame.east),
  ];
  const delta = sub(point.position, cameraPosition);
  const direction = [
    dot(delta, state.frame.prime),
    dot(delta, state.frame.north),
    dot(delta, state.frame.east),
  ];
  const distance = length(direction);
  if (!(distance > liftMeters)) return false;
  const scale =
    Number(state.exaggeration ?? 1) * Number(state.displacement ?? 1);
  const hit = intersectTerrain(
    origin,
    unit(direction),
    state.referenceRadiusMeters,
    (state.minElevationMeters || 0) * scale,
    (state.maxElevationMeters || 0) * scale,
    (x, y, z) => state.sample([x, y, z]),
    {
      maxDistance: Math.max(0, distance - liftMeters),
      tolerance: 0.25,
      slopeBound: 4,
      steps: 96,
      conservative: true,
    },
  );
  return !!hit;
}

export function landmarkVisibility(
  cameraPosition,
  body,
  state,
  point,
  { width = Infinity, height = Infinity, project = null } = {},
) {
  if (!point?.position || !body || !state?.frame)
    return { visible: false, reason: "invalid" };
  const fromBody = sub(cameraPosition, body.position);
  const distance = length(fromBody);
  if (!(distance < body.radius * 5))
    return { visible: false, reason: "far", distance };
  if (dot(point.direction, unit(fromBody)) <= 0)
    return { visible: false, reason: "hemisphere", distance };
  const projected = project?.(point.position);
  if (
    !projected ||
    projected.x < 0 ||
    projected.x > width ||
    projected.y < 0 ||
    projected.y > height
  )
    return { visible: false, reason: "offscreen", distance };
  if (terrainOccluded(cameraPosition, body, state, point))
    return { visible: false, reason: "terrain", distance };
  return {
    visible: true,
    distance,
    projected,
    alpha: Math.max(
      0,
      Math.min(1, (body.radius * 5 - distance) / (body.radius * 0.8)),
    ),
  };
}
