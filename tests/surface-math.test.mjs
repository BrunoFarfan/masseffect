import test from "node:test";
import assert from "node:assert/strict";
import {
  localVectorFromLatLon,
  latLonFromLocalVector,
  uvFromLocalVector,
  bilinearSample,
  decodeHeightUnsigned16LE,
  ellipsoidDirectionalRadius,
} from "../src/surface-math.js";
import {
  surfaceFrame,
  isCanonicalSurfaceBody,
} from "../src/surface-definition.js";

const close = (a, b, e = 1e-9) =>
  assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test("surface coordinates are east-positive with north at the top", () => {
  assert.deepEqual(
    localVectorFromLatLon(0, 0).map((v) => Math.abs(Math.round(v))),
    [1, 0, 0],
  );
  close(localVectorFromLatLon(0, 90)[2], 1);
  const point = localVectorFromLatLon(23, 41);
  close(latLonFromLocalVector(point).latitude, 23);
  close(latLonFromLocalVector(point).longitude, 41);
  close(uvFromLocalVector(localVectorFromLatLon(90, 0)).v, 0);
  close(uvFromLocalVector(localVectorFromLatLon(-90, 0)).v, 1);
  close(uvFromLocalVector(localVectorFromLatLon(0, 0)).u, 0.5);
});

test("bilinear maps wrap longitude and clamp polar rows at pixel centers", () => {
  const map = new Float32Array([0, 10, 20, 30]);
  close(bilinearSample(map, 2, 2, 0.25, 0.25), 0);
  close(bilinearSample(map, 2, 2, 0.75, 0.25), 10);
  close(bilinearSample(map, 2, 2, 1.25, 0.25), 0);
  close(bilinearSample(map, 2, 2, 0.5, 1), 25);
});

test("height decoding uses unsigned little-endian sample units", () => {
  assert.equal(
    decodeHeightUnsigned16LE(new Uint8Array([0x34, 0x12]), 0, -10, 0.5),
    2320,
  );
  assert.equal(ellipsoidDirectionalRadius([1, 0, 0], [2, 3, 4]), 2);
});

test("surface frames expose orthonormal prime, north, east axes and quaternion", () => {
  const frame = surfaceFrame("mars", 0);
  for (const axis of [frame.prime, frame.north, frame.east, frame.quaternion])
    assert.ok(axis.every(Number.isFinite));
  close(
    frame.prime.reduce((s, v) => s + v * v, 0),
    1,
  );
  close(
    frame.north.reduce((s, v) => s + v * v, 0),
    1,
  );
  close(
    frame.prime.reduce((s, v, i) => s + v * frame.north[i], 0),
    0,
    1e-7,
  );
  close(
    frame.east.reduce((s, v, i) => s + v * frame.prime[i], 0),
    0,
    1e-7,
  );
});

test("J2000 frame agrees with the NAIF pck00011 analytic constants", () => {
  const moon = surfaceFrame("moon", 0);
  const mars = surfaceFrame("mars", 0);
  const expectedMoonNorth = [-0.0226086714, 0.9996245303, -0.015480519];
  const expectedMarsNorth = [0.4461552708, 0.8932319932, -0.0555164899];
  for (const [actual, expected] of [
    [moon.north, expectedMoonNorth],
    [mars.north, expectedMarsNorth],
  ])
    actual.forEach((value, i) => close(value, expected[i], 1e-8));
  assert.equal(moon.longitudeDeg, 41.19526398074522);
  close(mars.longitudeDeg, 176.6320597319176, 1e-12);
});

test("canonical surface guard rejects altered radius or mass while allowing ID-only metadata", () => {
  const definition = { referenceRadiusMeters: 10, canonicalMassKg: 20 };
  assert.equal(
    isCanonicalSurfaceBody({ radius: 10, mass: 20 }, definition),
    true,
  );
  assert.equal(
    isCanonicalSurfaceBody({ radius: 11, mass: 20 }, definition),
    false,
  );
  assert.equal(
    isCanonicalSurfaceBody({ radius: 10, mass: 21 }, definition),
    false,
  );
  assert.equal(isCanonicalSurfaceBody({ radius: 10 }, definition), true);
});
