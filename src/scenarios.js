import { solarSystem } from "./solar.js";
import { PRESETS, createPlacedBody } from "./presets.js";
import { add, sub, mul, length } from "./math.js";
import { G } from "./physics.js";
import { impactScenario } from "./impact-scenario.js";

// Illustrative initial conditions only. Every subsequent motion comes from the
// same ordinary N-body gravity and collision solver as the canonical system.
export const SCENARIOS = Object.freeze(
  [
    {
      id: "planetary-impact",
      name: "Planetary impact",
      description:
        "Two worlds meet in a high-energy collision. Pause, rewind, revisit.",
    },
    {
      id: "solar-system",
      name: "Solar System",
      description: "The Sun, eight planets and 17 moons.",
    },
    {
      id: "binary-stars",
      name: "Binary stars",
      description:
        "Two Sun-like stars circle their shared center every eight days.",
    },
    {
      id: "three-body-chaos",
      name: "Three-body chaos",
      description:
        "Three nearby stars begin a changing gravitational encounter.",
    },
    {
      id: "rogue-jupiter",
      name: "Rogue Jupiter",
      description: "A gas giant approaches Earth and disturbs its solar orbit.",
    },
    {
      id: "heavy-moon",
      name: "A heavier Moon",
      description:
        "A Moon with twenty times its usual mass orbits close to Earth.",
    },
    {
      id: "second-sun",
      name: "A second Sun",
      description:
        "Earth starts between two stars in a deliberately unstable system.",
    },
  ].map(Object.freeze),
);

function central(presetId, id, name) {
  return {
    ...PRESETS.find((item) => item.id === presetId),
    id,
    name,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    trail: [],
    trailInterval: 600,
  };
}

function barycenter(bodies) {
  const total = bodies.reduce((sum, body) => sum + body.mass, 0);
  const center = bodies.reduce(
    (sum, body) => add(sum, mul(body.position, body.mass / total)),
    [0, 0, 0],
  );
  const velocity = bodies.reduce(
    (sum, body) => add(sum, mul(body.velocity, body.mass / total)),
    [0, 0, 0],
  );
  for (const body of bodies) {
    body.position = sub(body.position, center);
    body.velocity = sub(body.velocity, velocity);
    body.trail = [[...body.position]];
  }
  return bodies;
}

export function createScenario(id) {
  if (id === "planetary-impact") return impactScenario();
  if (id === "solar-system")
    return {
      bodies: solarSystem(),
      focusId: "sun",
      cameraDistance: 1.2e12,
      timeScale: 86400,
    };
  if (!SCENARIOS.some((scenario) => scenario.id === id))
    throw new Error("Choose a known scenario.");
  let bodies,
    focusId,
    cameraDistance,
    timeScale = 21600;
  if (id === "heavy-moon") {
    const earth = central("earth", "earth", "Earth");
    const moon = createPlacedBody({
      presetId: "moon",
      primary: earth,
      distance: 6e7,
      phase: 0,
      id: "heavy-moon",
      name: "Heavy Moon",
    });
    moon.mass *= 20;
    moon.radius *= Math.cbrt(20);
    moon.velocity = [0, 0, Math.sqrt((G * (earth.mass + moon.mass)) / 6e7)];
    moon.trailInterval = (2 * Math.PI * 6e7) / length(moon.velocity) / 500;
    bodies = [earth, moon];
    focusId = "earth";
    cameraDistance = 2e8;
    timeScale = 3600;
  } else if (id === "binary-stars" || id === "three-body-chaos") {
    const first = central("sun", "star-a", "Star A");
    const second = createPlacedBody({
      presetId: "sun",
      primary: first,
      distance: 1.5e10,
      phase: 0,
      id: "star-b",
      name: "Star B",
    });
    bodies = [first, second];
    focusId = "star-a";
    cameraDistance = 5e10;
    if (id === "three-body-chaos") {
      second.velocity = mul(second.velocity, 0.35);
      bodies.push(
        createPlacedBody({
          presetId: "sun",
          primary: first,
          distance: 1.3e10,
          phase: 1.2,
          inclination: 0.25,
          speedMode: "stationary",
          id: "star-c",
          name: "Star C",
        }),
      );
      timeScale = 10800;
    }
  } else {
    const sun = central("sun", "sun", "Sun");
    const earth = createPlacedBody({
      presetId: "earth",
      primary: sun,
      distance: 1.495978707e11,
      phase: 0,
      id: "earth",
    });
    bodies = [sun, earth];
    if (id === "rogue-jupiter") {
      const rogue = createPlacedBody({
        presetId: "jupiter",
        primary: earth,
        distance: 5e9,
        phase: 0.7,
        inclination: 0.08,
        speedMode: "stationary",
        id: "rogue-jupiter",
        name: "Rogue Jupiter",
      });
      const offset = sub(rogue.position, earth.position);
      rogue.velocity = add(earth.velocity, mul(offset, -4500 / length(offset)));
      bodies.push(rogue);
      focusId = "earth";
      cameraDistance = 2e10;
    } else {
      bodies.push(
        createPlacedBody({
          presetId: "sun",
          primary: sun,
          distance: 2.5e11,
          phase: 0.35,
          speedMode: "stationary",
          id: "second-sun",
          name: "Second Sun",
        }),
      );
      focusId = "sun";
      cameraDistance = 7e11;
      timeScale = 86400;
    }
  }
  return { bodies: barycenter(bodies), focusId, cameraDistance, timeScale };
}
