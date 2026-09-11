import { add, sub, mul, dot, cross, length, unit, clamp } from "./math.js";

// Unit quaternions [x,y,z,w] are dimensionless. Angular velocities are rad/s;
// periods are seconds. Rounded NASA fact-sheet periods/tilts, not pole ephemerides.
// https://nssdc.gsfc.nasa.gov/planetary/factsheet/
const SPINS = {
  sun: [2192832, 7.25],
  mercury: [5067014.4, 0.034],
  venus: [20997360, 177.36],
  earth: [86164.1, 23.44],
  mars: [88642.7, 25.19],
  jupiter: [35730, 3.13],
  saturn: [38520, 26.73],
  uranus: [62064, 97.77],
  neptune: [57996, 28.32],
};
export const IDENTITY = [0, 0, 0, 1];
export const conjugate = (q) => [-q[0], -q[1], -q[2], q[3]];
export function multiply(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function rotateVector(q, v) {
  const t = mul(cross(q, v), 2);
  return add(v, add(mul(t, q[3]), cross(q, t)));
}
export function axisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  return [...mul(unit(axis), s), Math.cos(angle / 2)];
}
export function between(a, b) {
  const d = clamp(dot(a, b), -1, 1);
  if (d < -0.999999)
    return axisAngle(
      cross(a, Math.abs(a[0]) < 0.8 ? [1, 0, 0] : [0, 0, 1]),
      Math.PI,
    );
  return unit([...cross(a, b), 1 + d]);
}
export function blendRotation(q, amount) {
  if (q[3] < 0) q = q.map((v) => -v);
  const angle = 2 * Math.acos(clamp(q[3], -1, 1));
  return angle < 1e-10
    ? [...IDENTITY]
    : axisAngle(q.slice(0, 3), angle * amount);
}
function fromAxes(x, y, z) {
  const trace = x[0] + y[1] + z[2];
  let q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  } else if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    q = [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  } else if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    q = [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  } else {
    const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
    q = [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
  }
  return unit(q);
}
export function synchronize(body, parent) {
  const r = sub(parent.position, body.position),
    v = sub(parent.velocity, body.velocity);
  const h = cross(r, v),
    r2 = dot(r, r);
  if (r2 <= 0 || length(h) === 0) return false;
  const x = unit(r),
    y = unit(h),
    z = unit(cross(x, y));
  body.orientation = fromAxes(x, y, z);
  body.angularVelocity = mul(h, 1 / r2);
  return true;
}
export function initializeRotations(bodies) {
  for (const body of bodies) {
    if (body.orientation && body.angularVelocity) continue;
    const [period, tilt] = SPINS[body.id] ||
      SPINS[body.name?.toLowerCase()] || [86400, 0];
    body.rotationPeriod ??= period;
    const angle = (tilt * Math.PI) / 180;
    // The existing ecliptic-to-world mapping has prograde angular momentum -Y.
    const pole = [Math.sin(angle), -Math.cos(angle), 0];
    body.orientation ??= between([0, 1, 0], pole);
    body.angularVelocity ??= mul(pole, (2 * Math.PI) / body.rotationPeriod);
    if (body.kind === "Moon" && body.parentId)
      body.rotationModel ??= "synchronous";
    body.rotationModel ??= "free";
    if (body.rotationModel === "synchronous") {
      const parent = bodies.find((b) => b.id === body.parentId);
      if (parent) synchronize(body, parent);
    }
  }
}
export function advanceRotations(bodies, dt) {
  for (const body of bodies) {
    const parent =
      body.rotationModel === "synchronous" &&
      bodies.find((b) => b.id === body.parentId);
    if (parent) {
      const r = sub(parent.position, body.position),
        v = sub(parent.velocity, body.velocity);
      const bound =
        dot(v, v) < (2 * 6.6743e-11 * (body.mass + parent.mass)) / length(r);
      if (bound && synchronize(body, parent)) continue;
    }
    // An escaped moon keeps its last spin instead of magically tracking a
    // distant primary. This is an idealized lock, not a tidal-torque solver.
    if (body.rotationModel === "synchronous") {
      body.rotationModel = "free";
      body.rotationPeriod =
        length(body.angularVelocity) > 0
          ? (2 * Math.PI) / length(body.angularVelocity)
          : 0;
    }
    const speed = length(body.angularVelocity || [0, 0, 0]);
    if (speed)
      body.orientation = unit(
        multiply(
          axisAngle(body.angularVelocity, (speed * dt) % (2 * Math.PI)),
          body.orientation,
        ),
      );
  }
}
