import { G } from "./physics.js";
import { add, mul, sub } from "./math.js";

// JPL approximate J2000 elements, rounded; semimajor axes are stored in METERS.
// Earth uses the approximate Earth-Moon barycenter orbit; moons are omitted.
// name, kg, radius m, color, a m, e, inclination°, mean longitude°, perihelion°, node°
const planets = [
  [
    "Mercury",
    3.30103e23,
    2.4394e6,
    "#c6b6bd",
    5.7909227e10,
    0.20563593,
    7.004979,
    252.250324,
    77.457796,
    48.330766,
  ],
  [
    "Venus",
    4.86731e24,
    6.0518e6,
    "#e7c99b",
    1.0820948e11,
    0.00677672,
    3.394676,
    181.9791,
    131.602467,
    76.679843,
  ],
  [
    "Earth",
    5.97217e24,
    6.371e6,
    "#a4cfca",
    1.4959826e11,
    0.01671123,
    -0.00001531,
    100.464572,
    102.937682,
    0,
  ],
  [
    "Mars",
    6.41691e23,
    3.3895e6,
    "#df9e8b",
    2.2794382e11,
    0.0933941,
    1.849691,
    -4.553432,
    -23.94363,
    49.559539,
  ],
  [
    "Jupiter",
    1.898125e27,
    6.9911e7,
    "#dfbba0",
    7.7834082e11,
    0.04838624,
    1.304397,
    34.396441,
    14.72848,
    100.473909,
  ],
  [
    "Saturn",
    5.68317e26,
    5.8232e7,
    "#ded0a8",
    1.4266664e12,
    0.05386179,
    2.485992,
    49.954244,
    92.598878,
    113.662424,
  ],
  [
    "Uranus",
    8.68099e25,
    2.5362e7,
    "#acd0d8",
    2.8706582e12,
    0.04725744,
    0.772638,
    313.238105,
    170.954276,
    74.016925,
  ],
  [
    "Neptune",
    1.024092e26,
    2.4622e7,
    "#a2b1dd",
    4.4983964e12,
    0.00859048,
    1.770043,
    -55.12003,
    44.964762,
    131.784226,
  ],
];
const rad = (degrees) => (degrees * Math.PI) / 180;

function orbitalState(a, e, inclination, longitude, perihelion, node, mass) {
  const M = rad(longitude - perihelion),
    w = rad(perihelion - node),
    n = rad(node),
    i = rad(inclination);
  let E = M;
  for (let k = 0; k < 12; k++)
    E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  // Ecliptic XY -> world XZ, with world Y pointing north of the plane.
  const rotate = (x, y) => [
    (Math.cos(w) * Math.cos(n) - Math.sin(w) * Math.sin(n) * Math.cos(i)) * x +
      (-Math.sin(w) * Math.cos(n) - Math.cos(w) * Math.sin(n) * Math.cos(i)) *
        y,
    Math.sin(w) * Math.sin(i) * x + Math.cos(w) * Math.sin(i) * y,
    (Math.cos(w) * Math.sin(n) + Math.sin(w) * Math.cos(n) * Math.cos(i)) * x +
      (-Math.sin(w) * Math.sin(n) + Math.cos(w) * Math.cos(n) * Math.cos(i)) *
        y,
  ];
  const point = (angle) =>
    rotate(
      a * (Math.cos(angle) - e),
      a * Math.sqrt(1 - e * e) * Math.sin(angle),
    );
  const rate =
    Math.sqrt((G * (1.98847e30 + mass)) / a ** 3) / (1 - e * Math.cos(E));
  return {
    position: point(E),
    velocity: rotate(
      -a * Math.sin(E) * rate,
      a * Math.sqrt(1 - e * e) * Math.cos(E) * rate,
    ),
    trailInterval:
      (2 * Math.PI * Math.sqrt(a ** 3 / (G * (1.98847e30 + mass)))) / 500,
    orbit: Array.from({ length: 181 }, (_, k) =>
      point((k / 180) * Math.PI * 2),
    ),
  };
}

export function solarSystem() {
  const bodies = [
    {
      id: "sun",
      name: "Sun",
      mass: 1.98847e30,
      radius: 6.957e8,
      color: "#f5d9a0",
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      trail: [],
      kind: "Star",
    },
  ];
  for (const [name, mass, radius, color, ...elements] of planets) {
    bodies.push({
      id: name.toLowerCase(),
      name,
      mass,
      radius,
      color,
      ...orbitalState(...elements, mass),
      trail: [],
      kind: "Planet",
    });
  }
  const mass = bodies.reduce((s, b) => s + b.mass, 0);
  const center = mul(
    bodies.reduce((s, b) => add(s, mul(b.position, b.mass)), [0, 0, 0]),
    1 / mass,
  );
  const velocity = mul(
    bodies.reduce((s, b) => add(s, mul(b.velocity, b.mass)), [0, 0, 0]),
    1 / mass,
  );
  for (const b of bodies) {
    b.position = sub(b.position, center);
    b.velocity = sub(b.velocity, velocity);
    if (b.orbit) b.orbit = b.orbit.map((p) => sub(p, center));
    b.trail.push([...b.position]);
  }
  return bodies;
}

export function randomBody(index) {
  const angle = Math.random() * Math.PI * 2,
    r = 7e10 + Math.random() * 4e11;
  const speed = Math.sqrt((G * 1.98847e30) / r) * (0.65 + Math.random() * 0.95);
  return {
    id: `visitor-${index}`,
    name: `Visitor ${index}`,
    kind: "Visitor",
    color: "#c4b4df",
    mass: 10 ** (20 + Math.random() * 7),
    radius: 2e6 + Math.random() * 8e6,
    position: [
      Math.cos(angle) * r,
      (Math.random() - 0.5) * r * 0.55,
      Math.sin(angle) * r,
    ],
    velocity: [
      -Math.sin(angle) * speed,
      (Math.random() - 0.5) * speed * 0.5,
      Math.cos(angle) * speed,
    ],
    trail: [],
  };
}
