#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_URL =
  "https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/data/m2deimos.tab";
const SOURCE_SHA256 =
  "9a4dbc132c7546acb2ef26a386d306f155519f0988c8052acb2276ddeb7ca2fd";
const LABEL_SHA256 =
  "74b4c557e6827940430b2d670ec972d9a5d5dc63ef0a95b2b6ebd141ab78f634";

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const source = value("--source", "output/surface-originals/m2deimos.tab");
const output = value("--output", "assets/surfaces/deimos-shape.json");

if (args.includes("--download")) {
  const response = await fetch(SOURCE_URL);
  if (!response.ok)
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, Buffer.from(await response.arrayBuffer()));
}

const bytes = await readFile(source);
const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
if (sourceSha256 !== SOURCE_SHA256) {
  throw new Error(`Unexpected m2deimos.tab SHA-256: ${sourceSha256}`);
}

const rows = bytes
  .toString("utf8")
  .trim()
  .split(/\r?\n/)
  .map((line, index) => {
    const [latitude, longitude, radiusKm] = line
      .trim()
      .split(/\s+/)
      .map(Number);
    if (![latitude, longitude, radiusKm].every(Number.isFinite)) {
      throw new Error(`Invalid row ${index + 1}`);
    }
    return { latitude, longitude, radiusKm };
  });
if (rows.length !== 2701)
  throw new Error(`Expected 2701 source rows, got ${rows.length}`);

const byKey = new Map(
  rows.map((row) => [`${row.latitude}:${row.longitude}`, row.radiusKm]),
);
const latitudes = Array.from({ length: 17 }, (_, index) => -80 + index * 10);
const longitudes = Array.from({ length: 72 }, (_, index) => index * 5);
const radiusAt = (latitude, longitude) => {
  const radiusKm = byKey.get(`${latitude}:${longitude}`);
  if (!Number.isFinite(radiusKm))
    throw new Error(`Missing source sample ${latitude},${longitude}`);
  return radiusKm * 1000;
};
const point = (latitude, longitude, radius) => {
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  return [
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.sin(lon),
  ].map((coordinate) => Math.round(coordinate * 1000) / 1000);
};

const vertices = [point(-90, 0, radiusAt(-90, 0))];
for (const latitude of latitudes) {
  for (const longitude of longitudes)
    vertices.push(point(latitude, longitude, radiusAt(latitude, longitude)));
}
vertices.push(point(90, 0, radiusAt(90, 0)));

const indices = [];
const columns = longitudes.length;
const southPole = 0;
const firstRing = 1;
const lastRing = firstRing + (latitudes.length - 1) * columns;
const northPole = vertices.length - 1;
for (let column = 0; column < columns; column++) {
  const next = (column + 1) % columns;
  indices.push(southPole, firstRing + column, firstRing + next);
}
for (let row = 0; row < latitudes.length - 1; row++) {
  for (let column = 0; column < columns; column++) {
    const next = (column + 1) % columns;
    const a = firstRing + row * columns + column;
    const b = firstRing + (row + 1) * columns + column;
    const c = firstRing + row * columns + next;
    const d = firstRing + (row + 1) * columns + next;
    indices.push(a, b, c, c, b, d);
  }
}
for (let column = 0; column < columns; column++) {
  const next = (column + 1) % columns;
  indices.push(lastRing + column, northPole, lastRing + next);
}

const radii = rows.map(({ radiusKm }) => radiusKm * 1000);
const mesh = {
  schemaVersion: 1,
  bodyId: "deimos",
  units: "m",
  coordinateFrame:
    "Deimos body-fixed planetocentric; +X at planetocentric east-positive longitude 0, +Y north, +Z at east-positive longitude 90; source longitude is planetocentric (+East), radius converted from km to m",
  source: {
    product: "NASA PDS Small Body Optical Shape Models Bundle V1.0",
    logicalId: "urn:nasa:pds:ast-sat.thomas.shape-models:data:m2deimos_tab",
    citation:
      "Thomas et al. (2021), https://doi.org/10.26033/g5e0-kh52; Thomas (1993), https://doi.org/10.1006/icar.1993.1130",
    sourceUrl: SOURCE_URL,
    sourceFile: "m2deimos.tab",
    sourceLabel: "m2deimos.xml",
    sourceSha256,
    sourceLabelSha256: LABEL_SHA256,
    sourceSampling:
      "5 degree planetocentric latitude/longitude grid; radius in kilometers",
    sourceDescription:
      "Derived solely from Viking Orbiter data; approximately 400 m uncertainty in much of longitude 200-355 degrees",
  },
  reduction: {
    latitudeStepDegrees: 10,
    longitudeStepDegrees: 5,
    method:
      "measured source vertices sampled on a bounded regular subset; duplicated source pole longitudes collapsed to one vertex; no fitted ellipsoid or invented relief",
    sourceRows: rows.length,
    selectedSourceVertices: 17 * 72 + 2,
    boundingBoxMeters: {
      x: [
        Math.min(...vertices.map(([x]) => x)),
        Math.max(...vertices.map(([x]) => x)),
      ],
      y: [
        Math.min(...vertices.map(([, y]) => y)),
        Math.max(...vertices.map(([, y]) => y)),
      ],
      z: [
        Math.min(...vertices.map(([, , z]) => z)),
        Math.max(...vertices.map(([, , z]) => z)),
      ],
    },
    sourceRadiusMeters: { min: Math.min(...radii), max: Math.max(...radii) },
  },
  vertexCount: vertices.length,
  triangleCount: indices.length / 3,
  vertices,
  indices,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(mesh)}\n`);
console.log(
  JSON.stringify({
    output,
    sourceSha256,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
  }),
);
