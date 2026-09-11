import { G } from "./physics.js";
import { add, mul, sub, length } from "./math.js";

// SI throughout: kg, m, W, K. Solar/planet values follow solar.js and NASA/JPL:
// https://ssd.jpl.nasa.gov/planets/phys_par.html
// https://ssd.jpl.nasa.gov/sats/phys_par/
// Stellar classes are illustrative examples, not a stellar evolution model.
// https://science.nasa.gov/universe/stars/types/
// Proxima is rounded from ESO's table (0.123 solar mass, 0.145 solar radius):
// https://www.eso.org/public/news/eso0307/ ; temperature ~3050 K is approximate.
// Generic stellar luminosities use Stefan-Boltzmann, consistent with R and T.
const star = (id, name, mass, radius, effectiveTemperature, color) => ({
  id,
  name,
  kind: "Star",
  mass,
  radius,
  effectiveTemperature,
  color,
  luminosity:
    4 * Math.PI * 5.670374419e-8 * radius ** 2 * effectiveTemperature ** 4,
});

export const PRESETS = Object.freeze(
  [
    {
      id: "moon",
      name: "Moon",
      kind: "Moon",
      mass: 7.3458e22,
      radius: 1.7374e6,
      color: "#c8c7c2",
      albedo: 0.12,
    },
    {
      id: "mars",
      name: "Mars",
      kind: "Planet",
      mass: 6.41691e23,
      radius: 3.3895e6,
      color: "#df9e8b",
      albedo: 0.25,
    },
    {
      id: "earth",
      name: "Earth",
      kind: "Planet",
      mass: 5.97217e24,
      radius: 6.371e6,
      color: "#a4cfca",
      albedo: 0.3,
    },
    {
      id: "super-earth",
      name: "Super-Earth",
      kind: "Planet",
      mass: 2.986085e25,
      radius: 9.5565e6,
      color: "#b9c5a8",
      albedo: 0.3,
    },
    {
      id: "neptune",
      name: "Neptune",
      kind: "Planet",
      mass: 1.024092e26,
      radius: 2.4622e7,
      color: "#a2b1dd",
      albedo: 0.29,
    },
    {
      id: "jupiter",
      name: "Jupiter",
      kind: "Planet",
      mass: 1.898125e27,
      radius: 6.9911e7,
      color: "#dfbba0",
      albedo: 0.5,
    },
    // Small bodies, super-Earth and their albedos are illustrative spherical examples.
    {
      id: "asteroid",
      name: "Asteroid",
      kind: "Asteroid",
      mass: 1e18,
      radius: 5e4,
      color: "#a99d91",
      albedo: 0.1,
    },
    {
      id: "comet",
      name: "Comet",
      kind: "Comet",
      mass: 1e14,
      radius: 3.5e3,
      color: "#c3d6d9",
      albedo: 0.04,
    },
    star("red-dwarf", "Red dwarf", 3.97694e29, 1.73925e8, 3200, "#e59d7e"),
    star(
      "proxima",
      "Proxima Centauri",
      2.4458181e29,
      1.008765e8,
      3050,
      "#df8b72",
    ),
    {
      ...star("sun", "Sun", 1.98847e30, 6.957e8, 5772, "#f5d9a0"),
      luminosity: 3.828e26,
    },
    star("blue-giant", "Blue giant", 1.98847e31, 4.1742e9, 25000, "#adceff"),
    star("white-dwarf", "White dwarf", 1.193082e30, 8.3484e6, 10000, "#e3ecff"),
  ].map(Object.freeze),
);

let serial = 0;
// Sample once per placement attempt. Reusing these three draws keeps preview,
// exact-field inspection and release consistent without making retries identical.
export function randomPlacement(rng = Math.random) {
  return { phase: rng() * 2 * Math.PI, samples: [rng(), rng(), rng()] };
}
const vectorIsFinite = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

export function createPlacedBody(
  {
    presetId,
    primary,
    distance,
    inclination = 0,
    phase = 0.7,
    speedMode = "circular",
    name,
    id,
  },
  rng = Math.random,
) {
  const preset = PRESETS.find((item) => item.id === presetId);
  if (!preset) throw new Error("Choose a known body preset.");
  if (
    !primary ||
    !Number.isFinite(primary.mass) ||
    primary.mass <= 0 ||
    !Number.isFinite(primary.radius) ||
    primary.radius <= 0 ||
    !vectorIsFinite(primary.position) ||
    !vectorIsFinite(primary.velocity)
  )
    throw new Error(
      "Choose a primary body with valid mass, radius, position and velocity.",
    );
  if (!Number.isFinite(distance) || distance <= primary.radius + preset.radius)
    throw new Error(
      "Distance must be finite and greater than the two bodies' combined radii.",
    );
  if (!Number.isFinite(inclination) || !Number.isFinite(phase))
    throw new Error("Orbital angles must be finite numbers.");
  if (!["circular", "stationary", "random"].includes(speedMode))
    throw new Error("Choose circular, stationary or random velocity.");
  if (name !== undefined && (typeof name !== "string" || !name.trim()))
    throw new Error("Give the body a nonempty name.");
  if (
    id !== undefined &&
    (typeof id !== "string" || !id.trim() || id === primary.id)
  )
    throw new Error("Give the body a unique nonempty ID.");
  const plane = (x, y) => [
    x,
    y * Math.sin(inclination),
    y * Math.cos(inclination),
  ];
  const relativePosition = mul(
    plane(Math.cos(phase), Math.sin(phase)),
    distance,
  );
  const circularSpeed = Math.sqrt(
    (G * (primary.mass + preset.mass)) / distance,
  );
  let relativeVelocity = [0, 0, 0];
  if (speedMode === "circular")
    relativeVelocity = mul(
      plane(-Math.sin(phase), Math.cos(phase)),
      circularSpeed,
    );
  if (speedMode === "random") {
    const draw = () => {
      const value = rng();
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error("Random values must lie between zero and one.");
      return value;
    };
    const azimuth = draw() * Math.PI * 2,
      vertical = draw() * 2 - 1;
    const horizontal = Math.sqrt(Math.max(0, 1 - vertical ** 2));
    relativeVelocity = mul(
      [
        horizontal * Math.cos(azimuth),
        vertical,
        horizontal * Math.sin(azimuth),
      ],
      circularSpeed * (0.3 + draw() * 1.5),
    );
  }
  const body = {
    ...preset,
    id: id ?? `placed-${presetId}-${++serial}`,
    name: name?.trim() ?? preset.name,
    parentId: primary.id,
    position: add(primary.position, relativePosition),
    velocity: add(primary.velocity, relativeVelocity),
    trail: [],
    trailInterval: (2 * Math.PI * distance) / circularSpeed / 500,
  };
  if (
    !vectorIsFinite(body.position) ||
    !vectorIsFinite(body.velocity) ||
    !Number.isFinite(body.trailInterval) ||
    body.trailInterval <= 0 ||
    length(sub(body.position, primary.position)) <= primary.radius + body.radius
  )
    throw new Error("These values exceed the supported numeric range.");
  body.trail.push([...body.position]);
  return body;
}
