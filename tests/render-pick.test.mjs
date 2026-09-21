import test from "node:test";
import assert from "node:assert/strict";
import { Renderer } from "../src/render.js";

test("surface ray picks a close body whose center has no projected disk", () => {
  const renderer = {
    hits: [], width: 800, height: 600,
    pickCamera: {
      position: [0, 0, 15],
      forward: [0, 0, -1],
      right: [1, 0, 0],
      up: [0, 1, 0],
    },
    pickBodies: [
      { id: "moon", position: [0, 0, 0], radius: 10 },
      { id: "mars", position: [0, 0, -40], radius: 10 },
    ],
  };
  assert.equal(Renderer.prototype.pick.call(renderer, 400, 300), "moon");
  assert.equal(Renderer.prototype.pick.call(renderer, 4000, 300), null);
  renderer.pickCamera = {
    position: [0, 0, 10.1],
    forward: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1],
  };
  assert.equal(Renderer.prototype.pick.call(renderer, 400, 520), "moon");
  renderer.hits = [{ id: "tiny", x: 400, y: 300, r: 13 }];
  assert.equal(Renderer.prototype.pick.call(renderer, 400, 300), "tiny");
});
