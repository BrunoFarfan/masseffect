// Merge independently prepared body products; never publish source originals.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { SURFACE_PCK } from "../src/surface-pck.js";
const dir = new URL("../assets/surfaces/", import.meta.url);
const base = JSON.parse(await readFile(new URL("manifest.json", dir), "utf8"));
const bodies = Object.fromEntries(
  Object.entries(base.bodies).filter(([id]) => ["moon", "mars"].includes(id)),
);
for (const file of (await readdir(dir))
  .filter((name) => name.endsWith("-manifest.json"))
  .sort()) {
  const product = JSON.parse(await readFile(new URL(file, dir), "utf8"));
  for (const [id, body] of Object.entries(
    product.bodies || { [product.body || product.bodyId]: product },
  )) {
    if (!id || id === "undefined" || bodies[id])
      throw new Error(`Duplicate/invalid surface product: ${file}`);
    body.canonicalRadiusMeters = SURFACE_PCK[id]?.referenceRadiusMeters;
    body.canonicalMassKg = SURFACE_PCK[id]?.canonicalMassKg;
    body.referenceRadiusMeters ||= body.canonicalRadiusMeters;
    if (body.geometry) {
      const geometry = `/assets/surfaces/${body.geometry.split("/").at(-1)}`;
      body.levels = Object.fromEntries(
        ["preview", "medium", "near"].map((level) => [level, { geometry }]),
      );
    }
    if (
      !body.levels ||
      !Object.values(body.levels).every(
        (level) => level.color || level.geometry,
      )
    )
      throw new Error(`Incomplete prepared product: ${file}`);
    bodies[id] = body;
  }
}
await writeFile(
  new URL("manifest.json", dir),
  JSON.stringify({ ...base, bodies }, null, 2) + "\n",
);
console.log(`Assembled ${Object.keys(bodies).length} prepared bodies`);
