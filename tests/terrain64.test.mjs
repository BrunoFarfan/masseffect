import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pack = resolve(root, "assets/surfaces/terrain64");
const indexPath = resolve(pack, "index.json");
const available = existsSync(indexPath);

test("optional 64 ppd pack has complete, checksum-verified lazy tiles", { skip: !available }, async () => {
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  assert.deepEqual(Object.keys(index.bodies).sort(), ["earth", "mars", "moon"]);
  for (const [body, grid] of Object.entries(index.bodies)) {
    assert.equal(grid.pixelsPerDegree, 64);
    assert.equal(grid.width, 23040);
    assert.equal(grid.height, 11520);
    assert.equal(grid.tileCount, 276);
    assert.equal(Object.keys(grid.tileSha256).length, 276);
    assert.ok(grid.provenance.originals.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)));
    for (const name of ["0-0.bin.gz", "7-10.bin.gz", "11-22.bin.gz"]) {
      const compressed = await readFile(resolve(pack, body, name));
      const hash = createHash("sha256").update(compressed).digest("hex");
      assert.equal(hash, grid.tileSha256[name]);
      const raw = gunzipSync(compressed);
      const [row, col] = name.replace(".bin.gz", "").split("-").map(Number);
      const width = Math.min(1024, 23040 - col * 1024);
      const height = Math.min(1024, 11520 - row * 1024);
      assert.equal(raw.length, width * height * 2);
    }
  }
  const moonTile = gunzipSync(await readFile(resolve(pack, "moon/7-10.bin.gz")));
  const tycho = await readFile(resolve(root, "assets/surfaces/moon-tycho.height.bin"));
  const sample = moonTile.readUInt16LE(((8064 - 7168) * 1024 + (10368 - 10240)) * 2);
  assert.equal(sample, tycho.readUInt16LE(0));
  const marsTile = gunzipSync(await readFile(resolve(pack, "mars/4-2.bin.gz")));
  const olympus = await readFile(resolve(root, "assets/surfaces/mars-olympus.height.bin"));
  assert.equal(
    marsTile.readUInt16LE((486 * 1024 + 896) * 2),
    olympus.readUInt16LE((461 * 1024 + 512) * 2),
  );
  // ETOPO around Aconcagua must not pass through an 8-bit grayscale clamp.
  const andes = gunzipSync(await readFile(resolve(pack, "earth/7-6.bin.gz")));
  let maximum = -Infinity;
  for (let y = 650; y < 690; y++)
    for (let x = 870; x < 915; x++)
      maximum = Math.max(maximum, andes.readUInt16LE((y * 1024 + x) * 2) - 30000);
  assert.ok(maximum > 3000, `Andean radial peak unexpectedly flattened: ${maximum} m`);
});
