// Surface data is deliberately separate from the simulation's orientation. The
// renderer may use this frame for maps without changing SI state or spin.
// Surface axes are returned as [prime, north, east]. This is the analytic
// IAU/PCK body-fixed frame at J2000 TDB (including documented polynomial and
// phase terms), kept separate from simulation orientation and SI spin state.

import { SURFACE_PCK } from "./surface-pck.js";

export const SURFACE_SCHEMA_VERSION = 1;

const DEG = Math.PI / 180;
const MOON_MASS = 4902.8e9 / 6.6743e-11;

function poleInReflectedWorld(ra, dec) {
  const r = ra * DEG,
    d = dec * DEG,
    e = 23.4392911 * DEG;
  const x = Math.cos(d) * Math.cos(r),
    y = Math.cos(d) * Math.sin(r),
    z = Math.sin(d);
  return [
    x,
    z * Math.cos(e) - y * Math.sin(e),
    y * Math.cos(e) + z * Math.sin(e),
  ];
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a) {
  const n = Math.hypot(...a) || 1;
  return a.map((v) => v / n);
}
function rotateAround(axis, vector, angle) {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    k = dot(axis, vector);
  return vector.map(
    (v, i) => v * c + cross(axis, vector)[i] * s + axis[i] * k * (1 - c),
  );
}
function quaternionFromAxes(x, y, z) {
  const trace = x[0] + y[1] + z[2];
  let q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  } else if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  } else {
    const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
    q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
  }
  return norm(q);
}

const SURFACE_OVERRIDES = Object.freeze({
  moon: Object.freeze({
    id: "moon",
    name: "Moon",
    referenceRadiusMeters: 1.7374e6,
    equatorialRadiiMeters: [1.7374e6, 1.7374e6],
    polarRadiusMeters: 1.7374e6,
    defaultExaggeration: 1,
    // Display exposure for visualization imagery, not calibrated reflectance.
    // The LROC composite is contrast-stretched; avoid snow-white regolith.
    displayExposure: 0.6,
    sourceType: "real-dem",
    canonicalMassKg: MOON_MASS,
    datum: "mean Earth / polar axis (IAU_MOON)",
    coordinates:
      "planetocentric east-positive longitude, north-up equirectangular texture",
    orientation: "NAIF pck00011.tpc BODY301 lunar analytic model at J2000 TDB",
    provenance:
      "NASA LROC/LOLA; NAIF pck00011.tpc (https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc) lunar analytic orientation; simplified J2000 visual frame.",
  }),
  mars: Object.freeze({
    id: "mars",
    name: "Mars",
    referenceRadiusMeters: 3.3895e6,
    equatorialRadiiMeters: [3.39619e6, 3.39619e6],
    polarRadiusMeters: 3.3762e6,
    defaultExaggeration: 1,
    sourceType: "real-dem",
    canonicalMassKg: 6.41691e23,
    datum: "IAU 2000 Mars body-fixed frame (IAU_MARS)",
    coordinates:
      "planetocentric east-positive longitude, north-up equirectangular texture",
    orientation: "NAIF pck00011.tpc BODY499 analytic model at J2000 TDB",
    provenance:
      "NASA MOLA; NAIF pck00011.tpc (https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc) Mars analytic orientation; simplified J2000 visual frame.",
  }),
  sun: Object.freeze({
    id: "sun",
    name: "Sun",
    referenceRadiusMeters: 6.957e8,
    sourceType: "atmospheric",
    emissive: true,
    datum: "photosphere",
    coordinates: "not applicable",
    orientation: "not applicable",
    provenance:
      "Explicit procedural emissive photosphere; not measured solar imagery.",
  }),
  venus: Object.freeze({
    id: "venus",
    name: "Venus",
    referenceRadiusMeters: 6.0518e6,
    sourceType: "atmospheric",
    atmosphere: {
      color: [0.82, 0.73, 0.53],
      lowerAltitudeMeters: 15000,
      upperAltitudeMeters: 70000,
    },
    provenance:
      "Measured Magellan topography with independent illustrative ground color and haze; see prepared manifest.",
  }),
});

export const SURFACE_DEFINITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(SURFACE_PCK).map(([id, pck]) => [
      id,
      Object.freeze({
        id,
        name: id[0].toUpperCase() + id.slice(1),
        referenceRadiusMeters: pck.referenceRadiusMeters,
        canonicalMassKg: pck.canonicalMassKg,
        sourceType: ["mercury", "earth", "enceladus", "titan"].includes(id)
          ? "real-dem"
          : "hybrid",
        shapeType: ["phobos", "deimos"].includes(id)
          ? "irregular"
          : "spherical",
        coordinates:
          "planetocentric east-positive longitude, north-up equirectangular texture",
        orientation: `NAIF pck00011.tpc BODY${pck.naifId} analytic model at J2000 TDB`,
        provenance:
          "Prepared product manifest distinguishes measured imagery, elevation and procedural approximation.",
        defaultExaggeration: 1,
        ...SURFACE_OVERRIDES[id],
        ...(id === "titan"
          ? {
              atmosphere: {
                color: [0.73, 0.52, 0.28],
                lowerAltitudeMeters: 10000,
                upperAltitudeMeters: 100000,
              },
            }
          : {}),
        canonicalMassKg: pck.canonicalMassKg,
        ...(["jupiter", "saturn", "uranus", "neptune"].includes(id)
          ? {
              sourceType: "atmospheric",
              shapeType: "oblate",
              radiiMeters: [
                pck.radiiMeters[0],
                pck.radiiMeters[2],
                pck.radiiMeters[1],
              ],
            }
          : {}),
      }),
    ]),
  ),
);

export const SURFACE_MANIFEST = Object.freeze({
  schemaVersion: SURFACE_SCHEMA_VERSION,
  bodies: SURFACE_DEFINITIONS,
});

export function getSurfaceDefinition(bodyOrId) {
  const id = typeof bodyOrId === "string" ? bodyOrId : bodyOrId?.id;
  return SURFACE_DEFINITIONS[id] ?? null;
}

export function isCanonicalSurfaceBody(
  body,
  definition = getSurfaceDefinition(body),
) {
  const radiusOk =
    body &&
    definition &&
    Number.isFinite(body.radius) &&
    Math.abs(body.radius - definition.referenceRadiusMeters) <=
      Math.max(1e-3, definition.referenceRadiusMeters * 1e-6);
  const massOk =
    !Number.isFinite(definition?.canonicalMassKg) ||
    !Number.isFinite(body?.mass) ||
    Math.abs(body.mass - definition.canonicalMassKg) <=
      definition.canonicalMassKg * 1e-6;
  return Boolean(radiusOk && massOk);
}

export function surfaceFrame(bodyOrId, simulationTimeSeconds = 0) {
  const id = typeof bodyOrId === "string" ? bodyOrId : bodyOrId?.id;
  const coefficients = SURFACE_PCK[id];
  if (!coefficients) return null;
  const days = simulationTimeSeconds / 86400;
  const centuries = days / 36525;
  const polynomial = (terms, t) =>
    terms.reduce((sum, coefficient, i) => sum + coefficient * t ** i, 0);
  const phases = coefficients.phases.map(
    (terms) => polynomial(terms, centuries) * DEG,
  );
  const periodic = (terms, fn) =>
    terms.reduce(
      (sum, amplitude, i) => sum + amplitude * fn(phases[i] || 0),
      0,
    );
  const ra =
    polynomial(coefficients.ra, centuries) +
    periodic(coefficients.raTerms, Math.sin);
  const dec =
    polynomial(coefficients.dec, centuries) +
    periodic(coefficients.decTerms, Math.cos);
  const w =
    polynomial(coefficients.pm, days) +
    periodic(coefficients.pmTerms, Math.sin);
  const north = norm(poleInReflectedWorld(ra, dec));
  // The node is a deterministic simplified prime reference. x cross north is
  // west in reflected coordinates, matching localVectorFromLatLon's -sin Z.
  const node = poleInReflectedWorld(ra + 90, 0);
  const x0 = norm(node);
  const longitude = w * DEG;
  // IAU W is measured in the opposite sense after the sandbox's reflected
  // ecliptic transform; negate it for the world-space Rodrigues rotation.
  const x = norm(rotateAround(north, x0, -longitude));
  const east = norm(cross(x, north));
  return {
    x,
    prime: x,
    north,
    y: north,
    east,
    quaternion: quaternionFromAxes(x, north, east),
    longitudeDeg: w,
    convention:
      "local x prime, y north, east-positive; NAIF pck00011.tpc J2000 analytic approximation",
  };
}
