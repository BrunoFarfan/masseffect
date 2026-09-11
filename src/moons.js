import { G } from "./physics.js";
import { add, sub, mul, cross, unit } from "./math.js";

// NASA/JPL: https://ssd.jpl.nasa.gov/sats/phys_par/ and /sats/elem/.
// GM is converted to m³/s² here, and mass = GM/G; radii and separations are m.
// Initial conditions only: circularized mean separations, rounded inclinations,
// deterministic illustrative phases/nodes, no epoch-accurate ephemerides.
// Local reference poles use JPL Laplace-plane RA/Dec (J2000 equatorial degrees).
// Uranus uses the opposite of its north pole for its retrograde regular moons.
// Earth uses the ecliptic. Eccentricity, oblateness and tidal forces are omitted.
// parent, name, GM, mean radius, separation, inclination°, color, pole RA/Dec
const moons = [
  ["earth", "Moon", 4902.8e9, 1.7374e6, 3.844e8, 5.16, "#c8c7c2", null],
  [
    "mars",
    "Phobos",
    0.0007087e9,
    1.108e4,
    9.375e6,
    1.1,
    "#b4a295",
    [317.7, 52.9],
  ],
  [
    "mars",
    "Deimos",
    0.0000962e9,
    6.2e3,
    2.3457e7,
    1.8,
    "#c9b7a1",
    [316.6, 53.5],
  ],
  [
    "jupiter",
    "Io",
    5959.91547e9,
    1.82149e6,
    4.218e8,
    0,
    "#dac977",
    [268.1, 64.5],
  ],
  [
    "jupiter",
    "Europa",
    3202.7121e9,
    1.5608e6,
    6.711e8,
    0.5,
    "#d5cabb",
    [268.1, 64.5],
  ],
  [
    "jupiter",
    "Ganymede",
    9887.83275e9,
    2.6312e6,
    1.0704e9,
    0.2,
    "#afa89e",
    [268.2, 64.6],
  ],
  [
    "jupiter",
    "Callisto",
    7179.2834e9,
    2.4103e6,
    1.8827e9,
    0.3,
    "#9d9a92",
    [268.7, 64.8],
  ],
  [
    "saturn",
    "Titan",
    8978.1371e9,
    2.57476e6,
    1.2219e9,
    0.3,
    "#d2ad6a",
    [36.4, 84],
  ],
  [
    "saturn",
    "Enceladus",
    7.21037e9,
    2.521e5,
    2.384e8,
    0,
    "#e5edf0",
    [40.6, 83.5],
  ],
  [
    "saturn",
    "Rhea",
    153.94175e9,
    7.635e5,
    5.272e8,
    0.3,
    "#c7c5bd",
    [40.6, 83.5],
  ],
  [
    "saturn",
    "Iapetus",
    120.51511e9,
    7.343e5,
    3.5617e9,
    7.6,
    "#aba49a",
    [288.7, 78.9],
  ],
  [
    "uranus",
    "Titania",
    226.9e9,
    7.889e5,
    4.36298e8,
    0.1,
    "#b9b1a9",
    [257.3, -15.2],
  ],
  [
    "uranus",
    "Oberon",
    205.3e9,
    7.614e5,
    5.83511e8,
    0.1,
    "#aea199",
    [257.3, -15.2],
  ],
  ["uranus", "Ariel", 83.5e9, 5.789e5, 1.90929e8, 0, "#d0ceca", [257.3, -15.2]],
  [
    "uranus",
    "Umbriel",
    85.1e9,
    5.847e5,
    2.65986e8,
    0.1,
    "#918c89",
    [257.3, -15.2],
  ],
  [
    "uranus",
    "Miranda",
    4.3e9,
    2.358e5,
    1.29846e8,
    4.4,
    "#c8c4bf",
    [257.3, -15.2],
  ],
  [
    "neptune",
    "Triton",
    1428.49546e9,
    1.3526e6,
    3.548e8,
    157.3,
    "#c9c3c8",
    [299.8, 43.1],
  ],
];
const rad = (degrees) => (degrees * Math.PI) / 180;

function referencePole(pole) {
  if (!pole) return [0, 0, 1];
  const [ra, dec] = pole.map(rad),
    epsilon = rad(23.4392911);
  const x = Math.cos(dec) * Math.cos(ra),
    y = Math.cos(dec) * Math.sin(ra),
    z = Math.sin(dec);
  // Equatorial -> ecliptic, still conventional right-handed XYZ.
  return [
    x,
    y * Math.cos(epsilon) + z * Math.sin(epsilon),
    z * Math.cos(epsilon) - y * Math.sin(epsilon),
  ];
}

function relativeState(parentMass, mass, separation, inclination, pole, index) {
  const normal = referencePole(pole);
  const xAxis = unit(cross([0, 1, 0], normal));
  const yAxis = cross(normal, xAxis);
  const node = rad(index * 67),
    phase = rad(35 + index * 137.508);
  const p = add(mul(xAxis, Math.cos(node)), mul(yAxis, Math.sin(node)));
  const q = add(
    mul(
      add(mul(xAxis, -Math.sin(node)), mul(yAxis, Math.cos(node))),
      Math.cos(rad(inclination)),
    ),
    mul(normal, Math.sin(rad(inclination))),
  );
  const speed = Math.sqrt((G * (parentMass + mass)) / separation);
  const toWorld = ([x, y, z]) => [x, z, y];
  return {
    position: toWorld(
      mul(add(mul(p, Math.cos(phase)), mul(q, Math.sin(phase))), separation),
    ),
    velocity: toWorld(
      mul(add(mul(p, -Math.sin(phase)), mul(q, Math.cos(phase))), speed),
    ),
    trailInterval: (2 * Math.PI * separation) / speed / 500,
  };
}

export function addMoons(bodies) {
  for (const parent of [...bodies]) {
    const children = moons
      .filter(([parentId]) => parentId === parent.id)
      .map(
        (
          [parentId, name, gm, radius, separation, inclination, color, pole],
          index,
        ) => {
          const mass = gm / G;
          return {
            id: name.toLowerCase(),
            name,
            parentId,
            kind: "Moon",
            mass,
            radius,
            color,
            trail: [],
            ...relativeState(
              parent.mass,
              mass,
              separation,
              inclination,
              pole,
              index,
            ),
          };
        },
      );
    if (!children.length) continue;
    // The planet's input state denotes this subsystem's barycenter. Shift both
    // planet and moons without adding moon mass into the planet itself. This
    // also preserves the intended JPL Earth-Moon barycenter initial orbit.
    const total =
      parent.mass + children.reduce((sum, moon) => sum + moon.mass, 0);
    const center = mul(
      children.reduce(
        (sum, moon) => add(sum, mul(moon.position, moon.mass)),
        [0, 0, 0],
      ),
      1 / total,
    );
    const velocity = mul(
      children.reduce(
        (sum, moon) => add(sum, mul(moon.velocity, moon.mass)),
        [0, 0, 0],
      ),
      1 / total,
    );
    parent.position = sub(parent.position, center);
    parent.velocity = sub(parent.velocity, velocity);
    for (const moon of children) {
      moon.position = add(parent.position, moon.position);
      moon.velocity = add(parent.velocity, moon.velocity);
      bodies.push(moon);
    }
  }
}
