import test from "node:test";
import assert from "node:assert/strict";
import {
  SURFACE_DEFINITIONS,
  surfaceFrame,
} from "../src/surface-definition.js";

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = (a) => Math.hypot(...a);
const close = (a, b, epsilon = 1e-10) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);

// Independent NASA NAIF WebGeocalc output, queried 2026-09-18:
// https://wgc2.jpl.nasa.gov:8443/webgeocalc/api/info
// FRAME_TRANSFORMATION, J2000 -> IAU_MOON/IAU_MARS, NONE, FRAME1,
// MATRIX_ROW_BY_ROW, TDB/SECONDS_PAST_J2000. Kernel sets 2 (naif0012)
// then 3 (pck00011), NOT mission bundles with older Mars overrides.
// Rows are prime/east/north in J2000, rounded by the service to 8 decimals.
const NAIF_ROWS = {
  moon: [
    [
      -0.0756181, -0.90570167, -0.41711676, 0.99701304, -0.07526735,
      -0.01731523, -0.01571284, -0.41718019, 0.90868795,
    ],
    [
      0.78422705, 0.55784711, 0.27165149, -0.62006192, 0.72055667, 0.31035675,
      -0.02260867, -0.4118309, 0.91097978,
    ],
    [
      -0.98731717, 0.15371776, 0.03969454, -0.15657862, -0.90151536,
      -0.40342681, -0.02622863, -0.40452554, 0.91415051,
    ],
  ],
  mars: [
    [
      -0.7371292, -0.67211332, 0.07003026, 0.50752725, -0.61906672, -0.59931001,
      0.44615764, -0.40622665, 0.79744797,
    ],
    [
      -0.70673645, -0.70658829, 0.03544823, 0.54906199, -0.57939613,
      -0.60235459, 0.44615527, -0.40624267, 0.79744114,
    ],
    [
      -0.6740085, -0.73872321, 0.000754, 0.58877715, -0.53781412, -0.60340487,
      0.44615469, -0.40625607, 0.79743463,
    ],
  ],
};

test("Moon and Mars axes match independent NAIF pck00011 transforms", () => {
  const obliquity = (23.4392911 * Math.PI) / 180;
  for (const id of ["moon", "mars"]) {
    [-31557600, 0, 31557600].forEach((time, epoch) => {
      const frame = surfaceFrame(id, time);
      ["prime", "east", "north"].forEach((axis, row) => {
        const [x, y, z] = NAIF_ROWS[id][epoch].slice(row * 3, row * 3 + 3);
        const world = [
          x,
          z * Math.cos(obliquity) - y * Math.sin(obliquity),
          y * Math.cos(obliquity) + z * Math.sin(obliquity),
        ];
        world.forEach((value, i) => close(frame[axis][i], value, 1e-8));
      });
    });
  }
});

test("lunar prime meridian includes the days-squared PCK term at a nonzero epoch", () => {
  // pck00011 BODY301_PM polynomial evaluated at d=36525, plus its 13
  // nutation terms; reference degrees are unwrapped (not a SPICE ephemeris).
  close(
    surfaceFrame("moon", 36525 * 86400).longitudeDeg,
    481304.1473380919,
    1e-8,
  );
});

test("Moon and Mars frames remain orthonormal over +/- ten years", () => {
  for (const id of ["moon", "mars"])
    for (const years of [-10, 0, 10]) {
      const frame = surfaceFrame(id, years * 365.25 * 86400);
      for (const axis of [frame.prime, frame.north, frame.east])
        close(norm(axis), 1, 1e-12);
      close(dot(frame.prime, frame.north), 0, 1e-11);
      close(dot(frame.prime, frame.east), 0, 1e-11);
      close(dot(frame.north, frame.east), 0, 1e-11);
      assert.ok(frame.quaternion.every(Number.isFinite));
    }
});

test("analytic orientation evolves with TDB simulation time without touching physics metadata", () => {
  const moon0 = surfaceFrame("moon", 0),
    moon10 = surfaceFrame("moon", 10 * 365.25 * 86400);
  const mars0 = surfaceFrame("mars", 0),
    mars10 = surfaceFrame("mars", 10 * 365.25 * 86400);
  assert.ok(dot(moon0.north, moon10.north) < 1);
  assert.ok(dot(mars0.north, mars10.north) < 1);
  assert.equal(SURFACE_DEFINITIONS.moon.orientation.includes("BODY301"), true);
  assert.equal(SURFACE_DEFINITIONS.mars.orientation.includes("BODY499"), true);
  assert.equal(SURFACE_DEFINITIONS.sun.emissive, true);
});
