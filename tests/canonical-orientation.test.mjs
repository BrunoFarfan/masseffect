import test from "node:test";
import assert from "node:assert/strict";
import { solarSystem } from "../src/solar.js";
import {
  initializeRotations,
  advanceRotations,
  rotateVector,
  synchronize,
} from "../src/rotation.js";
import { sub, cross, dot, unit, length, mul } from "../src/math.js";
import { Simulation, step } from "../src/physics.js";
import { History } from "../src/history.js";

const angle = (a, b) =>
  (Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180) / Math.PI;
const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} != ${b}`);
// Reference data independent of the implementation's world-axis construction.
// IAU PCK00011 J2000 pole RA/Dec and nominal sidereal periods in seconds.
const planets = [
  ["sun", 286.13, 63.87, 2192832],
  ["mercury", 281.0103, 61.4155, 5067014.4],
  ["venus", 272.76, 67.16, -20996755.2],
  ["earth", 0, 90, 86164.1],
  ["mars", 317.680854, 52.886439, 88642.7],
  ["jupiter", 268.056595, 64.495303, 35730],
  ["saturn", 40.589, 83.537, 38520],
  ["uranus", 257.311, -15.175, -62064],
  ["neptune", 299.333739, 42.950359, 57478.68],
];

test("every planet and the Sun recover the reference equatorial pole and signed spin rate", () => {
  const bodies = solarSystem();
  initializeRotations(bodies);
  for (const [id, ra, dec, period] of planets) {
    const b = bodies.find((b) => b.id === id),
      w = unit(b.angularVelocity),
      e = (23.4392911 * Math.PI) / 180;
    // Undo the pseudovector reflection, then ecliptic -> equatorial rotation.
    const ecliptic = [-w[0], -w[2], -w[1]];
    const pole = mul(
      [
        ecliptic[0],
        ecliptic[1] * Math.cos(e) - ecliptic[2] * Math.sin(e),
        ecliptic[1] * Math.sin(e) + ecliptic[2] * Math.cos(e),
      ],
      Math.sign(period),
    );
    const r = (ra * Math.PI) / 180,
      d = (dec * Math.PI) / 180,
      expected = [
        Math.cos(d) * Math.cos(r),
        Math.cos(d) * Math.sin(r),
        Math.sin(d),
      ];
    assert.ok(angle(pole, expected) < 0.00001, id);
    close(b.rotationPeriod, Math.abs(period));
    close(length(b.angularVelocity) * b.rotationPeriod, 2 * Math.PI);
    assert.ok(
      angle(rotateVector(b.orientation, [0, 1, 0]), b.angularVelocity) <
        0.00001,
      id,
    );
    const initial = [...b.orientation];
    advanceRotations([b], b.rotationPeriod);
    close(Math.abs(dot(initial, b.orientation)), 1);
  }
});

test("planet obliquities are relative to their actual orbits, not the ecliptic", () => {
  const bodies = solarSystem();
  initializeRotations(bodies);
  const expected = {
    mercury: 0.034,
    venus: 177.36,
    earth: 23.44,
    mars: 25.19,
    jupiter: 3.13,
    saturn: 26.73,
    uranus: 97.77,
    neptune: 28.32,
  };
  for (const b of bodies.filter((b) => b.kind === "Planet")) {
    const h = cross(
      sub(b.position, bodies[0].position),
      sub(b.velocity, bodies[0].velocity),
    );
    assert.ok(
      Math.abs(angle(h, b.angularVelocity) - expected[b.id]) < 0.04,
      b.id,
    );
  }
});

test("Mars and Neptune frozen poles include their significant J2000 periodic terms", () => {
  const rad = (d) => (d * Math.PI) / 180;
  const ra =
    317.269202 +
    [0.000068, 0.000238, 0.000052, 0.000009, 0.419057].reduce(
      (s, a, i) =>
        s +
        a *
          Math.sin(
            rad([198.991226, 226.292679, 249.663391, 266.18351, 79.398797][i]),
          ),
      0,
    );
  const dec =
    54.432516 +
    [0.000051, 0.000141, 0.000031, 0.000005, 1.591274].reduce(
      (s, a, i) =>
        s +
        a *
          Math.cos(
            rad([122.433576, 43.058401, 57.663379, 79.476401, 166.325722][i]),
          ),
      0,
    );
  close(ra, planets.find((p) => p[0] === "mars")[1], 1e-8);
  close(dec, planets.find((p) => p[0] === "mars")[2], 1e-8);
  close(299.36 + 0.7 * Math.sin(rad(357.85)), planets.at(-1)[1], 1e-8);
  close(43.46 - 0.51 * Math.cos(rad(357.85)), planets.at(-1)[2], 1e-8);
  close((360 / 541.1397757) * 86400, planets.at(-1)[3], 1e-9);
});

test("all moon orbits agree with their parent's equator or documented inclined reference plane", () => {
  const bodies = solarSystem();
  initializeRotations(bodies);
  const ranges = {
    moon: [18, 29],
    phobos: [0.5, 2],
    deimos: [0.5, 3],
    io: [0, 0.1],
    europa: [0, 1],
    ganymede: [0, 1],
    callisto: [0, 1],
    titan: [0, 1.5],
    enceladus: [0, 0.1],
    rhea: [0, 1],
    iapetus: [7, 23],
    titania: [0, 0.2],
    oberon: [0, 0.2],
    ariel: [0, 0.1],
    umbriel: [0, 0.2],
    miranda: [4.2, 4.6],
    triton: [156, 158],
  };
  for (const b of bodies.filter((b) => b.kind === "Moon")) {
    const p = bodies.find((p) => p.id === b.parentId),
      h = cross(sub(b.position, p.position), sub(b.velocity, p.velocity)),
      tilt = angle(h, p.angularVelocity),
      [lo, hi] = ranges[b.id];
    assert.ok(tilt >= lo && tilt <= hi, `${b.id}: ${tilt}`);
    close(length(b.angularVelocity) * b.rotationPeriod, 2 * Math.PI);
    assert.notEqual(b.rotationPeriod, 86400, b.id);
    assert.ok(
      angle(
        rotateVector(b.orientation, [1, 0, 0]),
        sub(p.position, b.position),
      ) < 0.00001,
      b.id,
    );
  }
});

test("changing synchronous spin periods remain reconstructible through rewind", () => {
  const sim = new Simulation(solarSystem()),
    history = new History(sim),
    moon = sim.bodies.find((b) => b.id === "moon"),
    initial = moon.rotationPeriod;
  for (let i = 0; i < 20; i++) {
    step(sim.bodies, 50);
    sim.time += 50;
  }
  assert.notEqual(moon.rotationPeriod, initial);
  history.capture(sim);
  history.seek(sim, 525);
  close(sim.time, 525);
  for (const b of sim.bodies.filter((b) => b.kind === "Moon"))
    close(length(b.angularVelocity) * b.rotationPeriod, 2 * Math.PI);
  history.seek(sim, 1000);
  close(sim.time, 1000);
});

test("synchronous metadata follows velocity changes and a zero-spin custom body stays finite", () => {
  const bodies = solarSystem();
  initializeRotations(bodies);
  const m = bodies.find((b) => b.id === "moon"),
    p = bodies.find((b) => b.id === "earth"),
    before = m.rotationPeriod;
  m.velocity = m.velocity.map(
    (v, k) => p.velocity[k] + (v - p.velocity[k]) * 0.5,
  );
  synchronize(m, p);
  close(m.rotationPeriod, before * 2);
  const custom = { id: "custom", rotationPeriod: 0 };
  initializeRotations([custom]);
  assert.deepEqual(custom.angularVelocity, [0, 0, 0]);
  assert.ok(custom.orientation.every(Number.isFinite));
});
