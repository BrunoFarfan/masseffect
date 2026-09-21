import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const pack = resolve(root, "assets/surfaces/color64");
const indexPath = resolve(pack, "index.json");

test("optional color64 pack has complete checksum-verified tiles and source provenance", {
  skip: !existsSync(indexPath),
}, async () => {
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  assert.deepEqual(Object.keys(index.bodies).sort(), ["earth", "mars", "moon"]);
  for (const [body, grid] of Object.entries(index.bodies)) {
    assert.equal(grid.pixelsPerDegree, 64);
    assert.equal(grid.width, 23040);
    assert.equal(grid.height, 11520);
    assert.equal(grid.tilePixels, 1024);
    assert.equal(grid.tileCount, 276);
    assert.equal(Object.keys(grid.tileSha256).length, 276);
    assert.match(grid.provenance.sourceUrl, /^https:\/\//);
    assert.match(grid.provenance.sourceSha256, /^[a-f0-9]{64}$/);
    assert.match(grid.provenance.latitudeConvention, /planetocentric/);
    assert.match(grid.provenance.longitudeConvention, /east-positive/);
    for (const name of ["0-0.jpg", "5-11.jpg", "11-22.jpg"]) {
      const path = resolve(pack, body, name);
      const bytes = await readFile(path);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), grid.tileSha256[name]);
      const [row, col] = name.replace(".jpg", "").split("-").map(Number);
      const image = await sharp(bytes).metadata();
      assert.equal(image.width, Math.min(1024, 23040 - col * 1024));
      assert.equal(image.height, Math.min(1024, 11520 - row * 1024));
    }
  }
  assert.match(index.bodies.mars.provenance.note, /monochrome Viking data/);
  assert.match(index.bodies.moon.provenance.note, /lower-resolution LOLA albedo/);
});
