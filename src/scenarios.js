import { solarSystem } from "./solar.js";

// The sandbox has one canonical starting state. New bodies can be added from
// the preset catalog after it loads.
export function createScenario(id = "solar-system") {
  if (id !== "solar-system")
    throw new Error("Only the Solar System starting state is available.");
  return {
    bodies: solarSystem(),
    focusId: "sun",
    cameraDistance: 1.2e12,
    timeScale: 86400,
  };
}
