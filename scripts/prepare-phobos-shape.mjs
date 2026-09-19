#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const source = value("--source", "output/surface-originals/m1phobos.tab");
const sourceUrl =
  "https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/data/m1phobos.tab";
const expectedHash =
  "e19d7f585d710747fa4350c078c558003a7e2122162e908d5fdd33b1970f0b1b";
if (args.includes("--download")) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Phobos source ${response.status}`);
  const downloaded = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(downloaded).digest("hex") !== expectedHash)
    throw new Error("Phobos source checksum mismatch");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, downloaded);
}
const output = value("--output", "assets/surfaces/phobos-shape.json");
if (!source)
  throw new Error(
    "Usage: node scripts/prepare-phobos-shape.mjs --source <m1phobos.tab> [--output <file>]",
  );

const bytes = await readFile(source);
const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
if (sourceSha256 !== expectedHash)
  throw new Error("Phobos source checksum mismatch");
const rows = bytes
  .toString("utf8")
  .trim()
  .split(/\r?\n/)
  .map((line, index) => {
    const [latitude, longitude, radiusKm] = line
      .trim()
      .split(/\s+/)
      .map(Number);
    if (![latitude, longitude, radiusKm].every(Number.isFinite))
      throw new Error(`Invalid row ${index + 1}`);
    return { latitude, longitude: ((longitude % 360) + 360) % 360, radiusKm };
  });
const byKey = new Map(
  rows.map((row) => [`${row.latitude}:${row.longitude}`, row.radiusKm]),
);
const latitudes = Array.from({ length: 16 }, (_, i) => -90 + i * 12);
const longitudes = Array.from({ length: 60 }, (_, i) => i * 6);
const radiusAt = (latitude, longitude) => {
  const radiusKm = byKey.get(`${latitude}:${longitude}`);
  if (!Number.isFinite(radiusKm))
    throw new Error(`Missing source sample ${latitude},${longitude}`);
  return radiusKm * 1000;
};
let vertices = [];
for (const latitude of latitudes) {
  const lat = (latitude * Math.PI) / 180;
  for (const longitude of longitudes) {
    const lon = (longitude * Math.PI) / 180;
    const radius = radiusAt(latitude, longitude);
    vertices.push(
      [
        radius * Math.cos(lat) * Math.cos(lon),
        radius * Math.sin(lat),
        radius * Math.cos(lat) * Math.sin(lon),
      ].map((value) => Math.round(value * 1000) / 1000),
    );
  }
}
let indices = [];
const columns = longitudes.length;
for (let row = 0; row < latitudes.length - 1; row++) {
  for (let column = 0; column < columns; column++) {
    const next = (column + 1) % columns;
    const a = row * columns + column;
    const b = (row + 1) * columns + column;
    const c = row * columns + next;
    const d = (row + 1) * columns + next;
    indices.push(a, b, c, c, b, d);
  }
}
// A longitude grid repeats each pole. Collapse those samples into triangle
// fans so the shipped topology is closed and contains no zero-area triangles.
const northStart = (latitudes.length - 1) * columns;
const unique = [
  vertices[0],
  ...vertices.slice(columns, northStart),
  vertices[northStart],
];
const remap = (i) =>
  i < columns ? 0 : i >= northStart ? unique.length - 1 : i - columns + 1;
const triangles = [];
for (let i = 0; i < indices.length; i += 3) {
  const face = indices.slice(i, i + 3).map(remap);
  if (new Set(face).size === 3) triangles.push(...face);
}
vertices = unique;
indices = triangles;
const mesh = {
  schemaVersion: 1,
  bodyId: "phobos",
  units: "m",
  coordinateFrame:
    "Phobos body-fixed planetocentric; +X at east-positive longitude 0, +Y north, +Z east-positive longitude 90; radii are from the PDS body-centered latitude/longitude table",
  source: {
    product: "NASA PDS Small Body Optical Shape Models Bundle V1.0",
    logicalId: "urn:nasa:pds:ast-sat.thomas.shape-models:data:m1phobos_tab",
    citation: "Thomas et al. (2021), https://doi.org/10.26033/g5e0-kh52",
    sourceFile: "m1phobos.tab",
    sourceUrl,
    sourceSha256,
    sourceSampling:
      "2 degree planetocentric latitude/longitude grid; radius in kilometers",
  },
  reduction: {
    latitudeStepDegrees: 12,
    longitudeStepDegrees: 6,
    method:
      "measured source vertices sampled on a bounded regular subset; no fitted ellipsoid or invented relief",
  },
  vertexCount: vertices.length,
  triangleCount: indices.length / 3,
  vertices,
  indices,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(mesh)}\n`);
await writeFile(
  path.join(path.dirname(output), "phobos-manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      bodyId: "phobos",
      sourceType: "measured-irregular-shape",
      geometry: path.basename(output),
      units: "m",
      coordinateFrame: mesh.coordinateFrame,
      vertexCount: mesh.vertexCount,
      triangleCount: mesh.triangleCount,
      artifactSha256: createHash("sha256")
        .update(`${JSON.stringify(mesh)}\n`)
        .digest("hex"),
      source: mesh.source,
      reduction: mesh.reduction,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    output,
    sourceSha256,
    vertexCount: mesh.vertexCount,
    triangleCount: mesh.triangleCount,
  }),
);
