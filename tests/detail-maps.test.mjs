import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  polarToUV,
  polarSize,
  bilinear,
  validBilinear,
  demSourceCoordinate,
  sourceIdentity,
} from "../scripts/prepare-detail-maps.mjs";

test("polar inverse agrees with renderer prime/north/east stereographic contract", () => {
  for (const pole of [1, -1])
    for (const [u, v] of [
      [0.5, 0.5],
      [0.2, 0.7],
      [0.7, 0.1],
      [0, 0.5],
      [1, 0.5],
    ]) {
      const [eu, ev] = polarToUV(u, v, pole),
        lat = (0.5 - ev) * Math.PI,
        lon = (eu - 0.5) * 2 * Math.PI;
      const p = [
        Math.cos(lat) * Math.cos(lon),
        Math.sin(lat),
        Math.cos(lat) * Math.sin(lon),
      ];
      const denominator = (1 + pole * p[1]) * Math.tan((10 * Math.PI) / 180);
      assert.ok(Math.abs(0.5 + (0.5 * p[0]) / denominator - u) < 1e-12);
      assert.ok(Math.abs(0.5 - (0.5 * p[2]) / denominator - v) < 1e-12);
    }
});
test("polar tile density is bounded by native equatorial ground spacing", () => {
  assert.equal(polarSize(23040), 2508);
  for (const width of [1024, 5760, 19631, 23040])
    assert.ok(polarSize(width) <= (width * Math.sin(Math.PI / 9)) / Math.PI);
  const north = polarToUV(0, 0.5, 1),
    south = polarToUV(0, 0.5, -1);
  assert.ok(Math.abs(north[1] - 20 / 180) < 1e-12);
  assert.ok(Math.abs(south[1] - 160 / 180) < 1e-12);
});
test("bilinear interpolation wraps longitude and clamps pole rows", () => {
  const samples = Uint8Array.from([0, 100, 20, 120]);
  assert.equal(bilinear(samples, 2, 2, 1, -0.5, 0), 50);
  assert.equal(bilinear(samples, 2, 2, 1, 0.5, -1), 50);
  assert.equal(bilinear(samples, 2, 2, 1, 0.5, 1.5), 70);
});
test("Enceladus DEM uses its actual projected origin rather than rounded global extent", () => {
  const geo = {
    origin: [-805000, 402600],
    resolution: [200, -200],
    radius: 256200,
    centerLongitude: 180,
  };
  const [x, y] = demSourceCoordinate(0.5, 0, geo);
  assert.ok(Math.abs(x - 0.11981075147516096) < 1e-10);
  assert.ok(Math.abs(y - 0.3099053757375805) < 1e-10);
  const center = demSourceCoordinate(0, 0.5, geo);
  assert.equal(center[0], 4024.5);
  assert.equal(center[1], 2012.5);
});
test("DEM interpolation excludes NoData without inventing boundary cliffs", () => {
  assert.equal(
    validBilinear(
      Float32Array.from([100, -32768, 200, -32768]),
      2,
      2,
      0.5,
      0.5,
      -32768,
    ),
    150,
  );
  assert.equal(
    validBilinear(
      Float32Array.from([-32768, -32768, -32768, -32768]),
      2,
      2,
      0.5,
      0.5,
      -32768,
    ),
    null,
  );
});
test("source identity changes when a normalized master or scientific source changes", () => {
  assert.notEqual(
    sourceIdentity({ sha256: "master-a", source: { sha256: "original" } }),
    sourceIdentity({ sha256: "master-b", source: { sha256: "original" } }),
  );
  assert.notEqual(
    sourceIdentity({ source: { sha256: "dem-a" } }),
    sourceIdentity({ source: { sha256: "dem-b" } }),
  );
  assert.equal(
    sourceIdentity({ source: { sha256: "dem-a" }, note: "old" }),
    sourceIdentity({ source: { sha256: "dem-a" }, note: "new" }),
  );
});
test("published detail descriptors reference bounded, checksum verified assets", async () => {
  const index = JSON.parse(
    await readFile(
      new URL("../assets/surfaces/detail/index.json", import.meta.url),
    ),
  );
  assert.equal(index.schemaVersion, 1);
  for (const [body, pack] of Object.entries(index.bodies)) {
    assert.ok(pack.tiles.length > 0, body);
    assert.ok(
      pack.tiles.some((t) => t.pole === 1) &&
        pack.tiles.some((t) => t.pole === -1),
      body,
    );
    assert.ok(pack.provenance, body);
    let total = 0;
    for (const tile of pack.tiles) {
      assert.ok(tile.width <= 512 && tile.height <= 512, `${body}/${tile.id}`);
      assert.ok(tile.uvBounds.every((x) => x >= 0 && x <= 1));
      if (tile.projection === "polar-stereographic") {
        assert.equal(tile.capLatitude, 70);
        const capPixels = tile.width / (tile.uvBounds[2] - tile.uvBounds[0]);
        assert.ok(
          capPixels <=
            Math.floor(
              (pack.effectivePixelsPerDegree * 360 * Math.sin(Math.PI / 9)) /
                Math.PI,
            ) +
              1e-8,
          `${body} native cap spacing`,
        );
      }
      for (const kind of ["color", "height"])
        if (tile[`${kind}Url`]) {
          const bytes = await readFile(
            new URL(`..${tile[`${kind}Url`]}`, import.meta.url),
          );
          assert.equal(
            createHash("sha256").update(bytes).digest("hex"),
            tile[`${kind}Sha256`],
          );
          total += bytes.length;
          if (kind === "height")
            assert.equal(
              gunzipSync(bytes).length,
              tile.heightWidth * tile.heightHeight * 2,
            );
        }
    }
    assert.equal(total, pack.totalBytes);
    if (pack.terrainKind === "procedural")
      assert.ok(pack.tiles.every((t) => !t.heightUrl));
  }
});
