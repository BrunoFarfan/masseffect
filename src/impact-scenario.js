// Illustrative initial conditions using the canonical Mars mass/radius in SI.
// Both planets move solely under the ordinary gravity and collision solver.
export function impactScenario() {
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
