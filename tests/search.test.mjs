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
    ["Mars", "Olympus Mons", "Valles Marineris", "Marslet"],
  );
  assert.equal(rankSearch("olympus", bodies, landmarks)[0].type, "landmark");
  assert.deepEqual(
    rankSearch("", bodies, landmarks, 3).map((r) => r.name),
    ["Sun", "Mars", "Marslet"],
  );
});

test("exact body search unfolds its moons and every landmark with paths", () => {
  const family = [
    { id: "sun", name: "Sun" },
    { id: "earth", name: "Earth", parentId: "sun", kind: "Planet" },
    { id: "moon", name: "Moon", parentId: "earth", kind: "Moon" },
    { id: "mars", name: "Mars", parentId: "sun", kind: "Planet" },
    { id: "phobos", name: "Phobos", parentId: "mars", kind: "Moon" },
  ];
  const sites = {
    moon: [{ name: "Tycho" }, { name: "Copernicus" }],
    mars: [{ name: "Olympus Mons" }, { name: "Hellas" }],
    phobos: [{ name: "Stickney" }],
  };
  assert.deepEqual(
    rankSearch("mars", family, sites).map((item) => item.path.join(" › ")),
    [
      "Sun › Mars", "Sun › Mars › Olympus Mons", "Sun › Mars › Hellas",
      "Sun › Mars › Phobos", "Sun › Mars › Phobos › Stickney",
    ],
  );
  assert.deepEqual(
    rankSearch("moon", family, sites).map((item) => item.name),
    ["Moon", "Tycho", "Copernicus"],
  );
  assert.deepEqual(rankSearch("stickney", family, sites)[0].path,
    ["Sun", "Mars", "Phobos", "Stickney"]);
});

test("search limits results and matches words inside names", () => {
  const result = rankSearch("mar", bodies, landmarks, 1);
  assert.equal(result.length, 1);
  assert.equal(
    rankSearch("valles", bodies, landmarks)[0].site.name,
    "Valles Marineris",
  );
});

test("search includes POIs for canonical bodies beyond Moon and Mars", () => {
  const result = rankSearch(
    "caloris",
    [{ id: "mercury", name: "Mercury" }],
    { mercury: [{ name: "Caloris Planitia" }] },
  );
  assert.deepEqual(
    result.map(({ type, bodyId, name }) => ({ type, bodyId, name })),
    [{ type: "landmark", bodyId: "mercury", name: "Caloris Planitia" }],
  );
});

test("partial parent names unfold their moons and sites", () => {
  const family = [
    { id: "saturn", name: "Saturn" },
    { id: "titan", name: "Titan", parentId: "saturn" },
    { id: "rhea", name: "Rhea", parentId: "saturn" },
  ];
  const sites = { titan: [{ name: "Xanadu" }] };
  assert.deepEqual(
    rankSearch("sa", family, sites).map((item) => item.name),
    ["Saturn", "Titan", "Xanadu", "Rhea"],
  );
});
