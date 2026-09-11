import test from "node:test";
import assert from "node:assert/strict";
import { accelerations, safeStep, firstContact } from "../src/forces.js";
import { solarSystem } from "../src/solar.js";

// Frozen allocation-heavy reference from the pre-optimization physics module.
const G = 6.6743e-11;
function referenceAccelerations(bodies) {
  const result = bodies.map(() => [0, 0, 0]);
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i],
        b = bodies[j];
      const d = b.position.map((v, k) => v - a.position[k]);
      const r2 = Math.max(
        1,
        d.reduce((s, v) => s + v * v, 0),
      );
      const factor = G / (r2 * Math.sqrt(r2));
      for (let k = 0; k < 3; k++) {
        result[i][k] += d[k] * factor * b.mass;
        result[j][k] -= d[k] * factor * a.mass;
      }
    }
  return result;
}
function referenceSafeStep(bodies, maximum = 1800) {
  let limit = maximum;
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i],
        b = bodies[j];
      const r = Math.hypot(...a.position.map((v, k) => v - b.position[k]));
      const speed = Math.hypot(...a.velocity.map((v, k) => v - b.velocity[k]));
      limit = Math.min(
        limit,
        0.025 * Math.sqrt(r ** 3 / (G * (a.mass + b.mass))),
        (0.1 * r) / Math.max(speed, 1),
      );
    }
  return (
    maximum /
    2 ** Math.max(0, Math.ceil(Math.log2(maximum / Math.max(0.01, limit))))
  );
}
function referenceContact(bodies, remaining) {
  let contact = null,
    travel = remaining;
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i],
        b = bodies[j];
      const p = a.position.map((v, k) => v - b.position[k]);
      const v = a.velocity.map((v, k) => v - b.velocity[k]);
      const A = v.reduce((s, x) => s + x * x, 0);
      const B = p.reduce((s, x, k) => s + x * v[k], 0);
      const C = p.reduce((s, x) => s + x * x, 0) - (a.radius + b.radius) ** 2;
      const discriminant = B * B - A * C;
      if (C > 0 && (B >= 0 || A === 0 || discriminant < 0)) continue;
      const time = C <= 0 ? 0 : C / (-B + Math.sqrt(discriminant));
      if (time >= 0 && time <= travel) {
        travel = time;
        contact = { a, b, time };
      }
    }
  return contact;
}
function randomStates(count, seed = 421) {
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return Array.from({ length: count }, () => ({
    mass: 1e20 + random() * 1e28,
    radius: 1e5 + random() * 1e7,
    position: Array.from({ length: 3 }, () => (random() - 0.5) * 1e11),
    velocity: Array.from({ length: 3 }, () => (random() - 0.5) * 1e5),
  }));
}

test("scalar force and step scans reproduce the canonical 26-body system", () => {
  const bodies = solarSystem();
  assert.equal(bodies.length, 26);
  assert.deepEqual(accelerations(bodies), referenceAccelerations(bodies));
  assert.equal(safeStep(bodies), referenceSafeStep(bodies));
});
test("scalar scans match reference on seeded 3D states without mutating inputs", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const bodies = randomStates(2 + seed, seed),
      snapshot = structuredClone(bodies);
    assert.deepEqual(accelerations(bodies), referenceAccelerations(bodies));
    assert.equal(safeStep(bodies, 997), referenceSafeStep(bodies, 997));
    assert.deepEqual(firstContact(bodies, 1e7), referenceContact(bodies, 1e7));
    assert.deepEqual(bodies, snapshot);
  }
});
test("force floor and encounter quantization preserve coincident and sub-meter inputs", () => {
  const bodies = randomStates(3);
  bodies[0].position = [0, 0, 0];
  bodies[1].position = [0, 0, 0];
  bodies[2].position = [0.2, -0.3, 0.4];
  assert.deepEqual(accelerations(bodies), referenceAccelerations(bodies));
  assert.equal(safeStep(bodies), referenceSafeStep(bodies));
  assert.equal(safeStep([]), 1800);
  assert.deepEqual(accelerations([]), []);
});
const sphere = (position, velocity = [0, 0, 0]) => ({
  position,
  velocity,
  radius: 1,
});
test("continuous contact returns exact elapsed head-on time and body references", () => {
  const a = sphere([0, 0, 0], [2, 0, 0]),
    b = sphere([10, 0, 0]);
  const contact = firstContact([a, b], 10);
  assert.equal(contact.a, a);
  assert.equal(contact.b, b);
  assert.equal(contact.time, 4);
  assert.equal(firstContact([a, b], 3.99), null);
  a.position[0] += a.velocity[0] * 1.5;
  assert.equal(firstContact([a, b], 10).time + 1.5, 4);
});
test("contact scan handles tangent, miss, separation, rest, overlap and earliest pair", () => {
  const a = sphere([0, 0, 0], [1, 0, 0]);
  assert.equal(firstContact([a, sphere([10, 2, 0])], 20).time, 10);
  assert.equal(firstContact([a, sphere([10, 2.1, 0])], 20), null);
  assert.equal(firstContact([a, sphere([-10, 0, 0])], 20), null);
  assert.equal(firstContact([sphere([0, 0, 0]), sphere([10, 0, 0])], 20), null);
  assert.equal(firstContact([a, sphere([0, 0, 0])], 20).time, 0);
  const near = sphere([5, 0, 0]);
  assert.equal(firstContact([a, sphere([10, 0, 0]), near], 20).b, near);
  assert.equal(firstContact([], 20), null);
});
test("equal contact times preserve reference traversal order", () => {
  const bodies = [sphere([0, 0, 0]), sphere([0, 0, 0]), sphere([0, 0, 0])];
  const contact = firstContact(bodies, 1);
  assert.equal(contact.a, bodies[1]);
  assert.equal(contact.b, bodies[2]);
});

test("report warmed reference/scalar scan timing ratios for 26 and 128 bodies", (t) => {
  for (const count of [26, 128]) {
    const bodies = count === 26 ? solarSystem() : randomStates(count);
    for (const [name, reference, scalar] of [
      ["accelerations", referenceAccelerations, accelerations],
      ["safeStep", referenceSafeStep, safeStep],
      ["firstContact", referenceContact, firstContact],
    ]) {
      for (let i = 0; i < 30; i++) {
        reference(bodies, 1800);
        scalar(bodies, 1800);
      }
      const iterations = count === 26 ? 600 : 60;
      const duration = (fn) => {
        const start = performance.now();
        for (let i = 0; i < iterations; i++) fn(bodies, 1800);
        return performance.now() - start;
      };
      const oldMs = duration(reference),
        newMs = duration(scalar);
      t.diagnostic(
        `${count} bodies ${name}: reference ${oldMs.toFixed(2)} ms, scalar ${newMs.toFixed(2)} ms; ratio ${(oldMs / newMs).toFixed(2)}x`,
      );
    }
  }
});
