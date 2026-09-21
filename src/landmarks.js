import { add, dot, length, mul, sub, unit } from "./math.js";
import { intersectTerrain } from "./surface-ray.js";

// Names and coordinates are intentionally a small, stable orientation aid, not
// a claim that the renderer is showing a surveyed outline of each feature.
export const SURFACE_LANDMARKS = Object.freeze({
  // Longitudes below are normalized to the renderer's planetocentric,
  // east-positive [-180, 180] convention.  See docs/landmark-provenance.md.
  sun: Object.freeze([
    Object.freeze({ name: "North pole", latitude: 90, longitude: 0 }),
  ]),
  mercury: Object.freeze([
    Object.freeze({ name: "Caloris Planitia", latitude: 31.65, longitude: 161.98 }),
  ]),
  venus: Object.freeze([
    Object.freeze({ name: "Aphrodite Terra", latitude: -5.8, longitude: 104.8 }),
  ]),
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
    Object.freeze({ name: "Apollo 11 landing site", latitude: 0.67408, longitude: 23.47297 }),
    Object.freeze({ name: "Apollo 17 landing site", latitude: 20.1911, longitude: 30.7769 }),
    Object.freeze({ name: "Mare Tranquillitatis", latitude: 8.3487, longitude: 30.8346 }),
    Object.freeze({ name: "Mare Imbrium", latitude: 34.7244, longitude: -14.9086 }),
    Object.freeze({ name: "Mare Serenitatis", latitude: 27.2879, longitude: 18.3596 }),
    Object.freeze({ name: "Mare Crisium", latitude: 16.1774, longitude: 59.1037 }),
    Object.freeze({ name: "Mare Orientale", latitude: -19.8655, longitude: -94.6703 }),
    Object.freeze({ name: "Oceanus Procellarum", latitude: 20.6714, longitude: -56.6774 }),
    Object.freeze({ name: "Mare Fecunditatis", latitude: -7.835, longitude: 53.6691 }),
    Object.freeze({ name: "Mare Humorum", latitude: -24.4785, longitude: -38.5716 }),
    Object.freeze({ name: "Aristarchus crater", latitude: 23.7299, longitude: -47.4901 }),
    Object.freeze({ name: "Plato crater", latitude: 51.6192, longitude: -9.3825 }),
    Object.freeze({ name: "Clavius crater", latitude: -58.6228, longitude: -14.7275 }),
    Object.freeze({ name: "Kepler crater", latitude: 8.121, longitude: -38.0087 }),
    Object.freeze({ name: "Eratosthenes crater", latitude: 14.4737, longitude: -11.3162 }),
    Object.freeze({ name: "Shackleton crater", latitude: -89.67, longitude: 129.78 }),
  ]),
  mars: Object.freeze([
    Object.freeze({ name: "Olympus Mons", latitude: 18.4, longitude: -134 }),
    Object.freeze({
      name: "Valles Marineris",
      latitude: -13.9,
      longitude: -59.2,
    }),
    Object.freeze({ name: "Hellas basin", latitude: -42.4, longitude: 70.5 }),
    Object.freeze({ name: "Jezero crater", latitude: 18.4082, longitude: 77.6873 }),
    Object.freeze({ name: "Gale crater", latitude: -5.3672, longitude: 137.811 }),
    Object.freeze({ name: "Gusev crater", latitude: -14.5308, longitude: 175.5244 }),
    Object.freeze({ name: "Arsia Mons", latitude: -8.2571, longitude: -120.0925 }),
    Object.freeze({ name: "Pavonis Mons", latitude: 1.4801, longitude: -112.9624 }),
    Object.freeze({ name: "Ascraeus Mons", latitude: 11.9216, longitude: -104.0808 }),
    Object.freeze({ name: "Elysium Mons", latitude: 25.0232, longitude: 147.2138 }),
    Object.freeze({ name: "Utopia Planitia", latitude: 46.7363, longitude: 117.5168 }),
    Object.freeze({ name: "Isidis Planitia", latitude: 13.9357, longitude: 88.3772 }),
    Object.freeze({ name: "Argyre Planitia", latitude: -49.8406, longitude: -43.3098 }),
    Object.freeze({ name: "Acidalia Planitia", latitude: 49.76, longitude: -20.74 }),
    Object.freeze({ name: "Syrtis Major Planum", latitude: 9.2007, longitude: 67.103 }),
    Object.freeze({ name: "Noctis Labyrinthus", latitude: -6.3625, longitude: -101.1889 }),
    Object.freeze({ name: "Arabia Terra", latitude: 21.249, longitude: 5.7185 }),
    Object.freeze({ name: "Terra Cimmeria", latitude: -32.6795, longitude: 147.7458 }),
    Object.freeze({ name: "Elysium Planitia", latitude: 2.979, longitude: 154.7372 }),
    Object.freeze({ name: "Schiaparelli crater", latitude: -2.7138, longitude: 16.7716 }),
    Object.freeze({ name: "Vastitas Borealis", latitude: 87.7297, longitude: 32.5298 }),
  ]),
  jupiter: Object.freeze([
    Object.freeze({ name: "North pole", latitude: 90, longitude: 0 }),
  ]),
  saturn: Object.freeze([
    Object.freeze({ name: "North pole", latitude: 90, longitude: 0 }),
  ]),
  uranus: Object.freeze([
    Object.freeze({ name: "North pole", latitude: 90, longitude: 0 }),
  ]),
  neptune: Object.freeze([
    Object.freeze({ name: "North pole", latitude: 90, longitude: 0 }),
  ]),
  phobos: Object.freeze([
    Object.freeze({ name: "Stickney crater", latitude: 1, longitude: -49 }),
  ]),
  deimos: Object.freeze([
    Object.freeze({ name: "Voltaire crater", latitude: 22, longitude: -3.5 }),
  ]),
  io: Object.freeze([
    Object.freeze({ name: "Prometheus eruptive center", latitude: -0.64, longitude: -153.94 }),
  ]),
  europa: Object.freeze([
    Object.freeze({ name: "Pwyll crater", latitude: -25.2, longitude: 88.6 }),
  ]),
  ganymede: Object.freeze([
    Object.freeze({ name: "Galileo Regio", latitude: 45, longitude: -127 }),
  ]),
  callisto: Object.freeze([
    Object.freeze({ name: "Valhalla", latitude: 14.7, longitude: -56 }),
  ]),
  titan: Object.freeze([
    Object.freeze({ name: "Xanadu", latitude: -15, longitude: -100 }),
  ]),
  enceladus: Object.freeze([
    Object.freeze({ name: "South pole", latitude: -90, longitude: 0 }),
  ]),
  rhea: Object.freeze([
    Object.freeze({ name: "Tirawa crater", latitude: 34.2, longitude: -151.7 }),
  ]),
  iapetus: Object.freeze([
    Object.freeze({ name: "Cassini Regio", latitude: -28.1, longitude: -92.6 }),
  ]),
  titania: Object.freeze([
    Object.freeze({ name: "Gertrude crater", latitude: -15.8, longitude: -72.9 }),
  ]),
  oberon: Object.freeze([
    Object.freeze({ name: "Hamlet crater", latitude: -46.1, longitude: 44.4 }),
  ]),
  ariel: Object.freeze([
    Object.freeze({ name: "South pole", latitude: -90, longitude: 0 }),
  ]),
  umbriel: Object.freeze([
    Object.freeze({ name: "South pole", latitude: -90, longitude: 0 }),
  ]),
  miranda: Object.freeze([
    Object.freeze({ name: "Verona Rupes", latitude: -18.3, longitude: -12.2 }),
  ]),
  triton: Object.freeze([
    Object.freeze({ name: "South pole", latitude: -90, longitude: 0 }),
  ]),
});

export function nearbyLandmarkBodies(bodies, cameraPosition) {
  return bodies
    .filter(
      (body) =>
        !body.ghost &&
        SURFACE_LANDMARKS[body.id]?.length &&
        length(sub(cameraPosition, body.position)) < body.radius * 5,
    )
    .sort(
      (a, b) =>
        length(sub(cameraPosition, a.position)) / a.radius -
        length(sub(cameraPosition, b.position)) / b.radius,
    );
}

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
