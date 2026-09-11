import test from "node:test";
import assert from "node:assert/strict";
import { occluded } from "../src/render.js";
test("the local horizon hides labels and picks below it, without hiding the open sky", () => {
  const moon = { id: "moon", position: [0, 0, 0], radius: 1.737e6 };
  const origin = [0, moon.radius + 2, 0];
  const earth = { id: "earth", position: [3.8e8, 1e8, 0], radius: 6.371e6 };
  assert.equal(occluded(earth, origin, [moon, earth]), false);
  earth.position[1] = -1e8;
  assert.equal(occluded(earth, origin, [moon, earth]), true);
  assert.equal(occluded(moon, origin, [moon]), false);
  assert.equal(occluded(earth, origin, [{ ...moon, ghost: true }]), false);
});
