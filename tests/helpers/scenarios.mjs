import { createPlacedBody, PRESETS } from "../../src/presets.js";

// Synthetic states stay in test code so production only exposes the canonical
// Solar System starting state.
export function binaryStars() {
  const sun = {
    ...PRESETS.find((preset) => preset.id === "sun"),
    id: "star-a",
    name: "Star A",
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    trail: [],
    trailInterval: 600,
  };
  const companion = createPlacedBody({
    presetId: "sun",
    primary: sun,
    distance: 1.5e10,
    phase: 0,
    id: "star-b",
    name: "Star B",
  });
  const total = sun.mass + companion.mass;
  for (let axis = 0; axis < 3; axis++) {
    const center =
      (sun.position[axis] * sun.mass +
        companion.position[axis] * companion.mass) /
      total;
    const velocity =
      (sun.velocity[axis] * sun.mass +
        companion.velocity[axis] * companion.mass) /
      total;
    sun.position[axis] -= center;
    companion.position[axis] -= center;
    sun.velocity[axis] -= velocity;
    companion.velocity[axis] -= velocity;
  }
  sun.trail = [[...sun.position]];
  companion.trail = [[...companion.position]];
  return [sun, companion];
}

export function impactFixture() {
  const offset = [1.2e7, 2e6, 0];
  const distance = Math.hypot(...offset);
  const velocity = offset.map((value) => (value / distance) * 11000);
  const makeBody = (id, name, sign, color) => ({
    id,
    name,
    kind: "Planet",
    mass: 6.41691e23,
    radius: 3.3895e6,
    color,
    position: offset.map((value) => sign * value),
    velocity: velocity.map((value) => -sign * value),
    trail: [],
    trailInterval: 20,
  });
  return {
    bodies: [
      makeBody("impact-a", "Cinder", -1, "#dfa493"),
      makeBody("impact-b", "Pearl", 1, "#bacddc"),
    ],
    focusId: "impact-a",
    cameraDistance: 9e7,
    timeScale: 60,
  };
}
