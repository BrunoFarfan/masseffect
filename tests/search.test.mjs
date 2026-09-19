import test from "node:test";
import assert from "node:assert/strict";
import { rankSearch } from "../src/search.js";

const bodies = [
  { id: "sun", name: "Sun" },
  { id: "mars", name: "Mars" },
  { id: "created-1", name: "Marslet" },
];
const landmarks = {
  mars: [{ name: "Olympus Mons" }, { name: "Valles Marineris" }],
};

test("search ranking is deterministic and prefers exact and prefix matches", () => {
  assert.deepEqual(
    rankSearch("mars", bodies, landmarks).map((r) => r.name),
    ["Mars", "Marslet"],
  );
  assert.equal(rankSearch("olympus", bodies, landmarks)[0].type, "landmark");
  assert.deepEqual(
    rankSearch("", bodies, landmarks, 3).map((r) => r.name),
    ["Sun", "Mars", "Marslet"],
  );
});

test("search limits results and matches words inside names", () => {
  const result = rankSearch("mar", bodies, landmarks, 1);
  assert.equal(result.length, 1);
  assert.equal(
    rankSearch("valles", bodies, landmarks)[0].site.name,
    "Valles Marineris",
  );
});
