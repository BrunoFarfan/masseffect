// Exact SI pair forces and encounter limits, without temporary pair vectors.
const G = 6.6743e-11;

export function accelerations(bodies) {
  const result = new Array(bodies.length);
  for (let i = 0; i < bodies.length; i++) result[i] = [0, 0, 0];
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i],
      ai = result[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j],
        aj = result[j];
      const x = b.position[0] - a.position[0];
      const y = b.position[1] - a.position[1];
      const z = b.position[2] - a.position[2];
      const r2 = Math.max(1, x * x + y * y + z * z);
      const factor = G / (r2 * Math.sqrt(r2));
      ai[0] += x * factor * b.mass;
      ai[1] += y * factor * b.mass;
      ai[2] += z * factor * b.mass;
      aj[0] -= x * factor * a.mass;
      aj[1] -= y * factor * a.mass;
      aj[2] -= z * factor * a.mass;
    }
  }
  return result;
}

export function safeStep(bodies, maximum = 1800) {
  let limit = maximum;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const r = Math.hypot(
        a.position[0] - b.position[0],
        a.position[1] - b.position[1],
        a.position[2] - b.position[2],
      );
      const speed = Math.hypot(
        a.velocity[0] - b.velocity[0],
        a.velocity[1] - b.velocity[1],
        a.velocity[2] - b.velocity[2],
      );
      limit = Math.min(
        limit,
        0.025 * Math.sqrt(r ** 3 / (G * (a.mass + b.mass))),
        (0.1 * r) / Math.max(speed, 1),
      );
    }
  }
  return (
    maximum /
    2 ** Math.max(0, Math.ceil(Math.log2(maximum / Math.max(0.01, limit))))
  );
}

// Earliest contact along Verlet's linear drift; references remain unmodified.
// Equality deliberately selects the last pair, matching the original traversal.
export function firstContact(bodies, remaining) {
  let contactA = null,
    contactB = null,
    travel = remaining;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const px = a.position[0] - b.position[0];
      const py = a.position[1] - b.position[1];
      const pz = a.position[2] - b.position[2];
      const vx = a.velocity[0] - b.velocity[0];
      const vy = a.velocity[1] - b.velocity[1];
      const vz = a.velocity[2] - b.velocity[2];
      const A = vx * vx + vy * vy + vz * vz;
      const B = px * vx + py * vy + pz * vz;
      const C = px * px + py * py + pz * pz - (a.radius + b.radius) ** 2;
      const discriminant = B * B - A * C;
      if (C > 0 && (B >= 0 || A === 0 || discriminant < 0)) continue;
      // Rationalized smaller root avoids cancellation near the contact surface.
      const time = C <= 0 ? 0 : C / (-B + Math.sqrt(discriminant));
      if (time >= 0 && time <= travel) {
        travel = time;
        contactA = a;
        contactB = b;
      }
    }
  }
  return contactA ? { a: contactA, b: contactB, time: travel } : null;
}
