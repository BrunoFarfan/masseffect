import test from "node:test";
import assert from "node:assert/strict";
import * as assets from "../scripts/published-asset.mjs";

test("release smoke validation accepts TTF fonts and rejects HTML fallback responses", () => {
  assert.equal(typeof assets.publishedAssetMime, "function");
  const expected = assets.publishedAssetMime(
    "assets/fonts/instrument-sans-variable.ttf",
  );
  assert.match("font/ttf", expected);
  assert.doesNotMatch("text/html; charset=utf-8", expected);
  assert.match(
    "text/plain; charset=utf-8",
    assets.publishedAssetMime("assets/fonts/OFL-Instrument-Sans.txt"),
  );
  assert.match("text/javascript", assets.publishedAssetMime("src/entry.js"));
});
