import { add, sub, mul, dot, cross, length, unit } from "./math.js";
const G = 6.6743e-11;
export function angularMomentum(a, b) {
  const mass = a.mass + b.mass;
  const orbital = mul(
    cross(sub(a.position, b.position), sub(a.velocity, b.velocity)),
    a.mass * (b.mass / mass),
  );
  return [a, b].reduce(
    (sum, body) =>
      add(
        sum,
        mul(
          body.angularVelocity || [0, 0, 0],
          0.4 * body.mass * body.radius ** 2,
        ),
      ),
    orbital,
  );
}

// A frictionless, inelastic normal impulse for unbound grazing encounters.
// Deep initial overlaps and bound contacts still coalesce. Spent fragments may
// rebound, but cannot trigger another generation of disruption.
export function hitAndRun(a, b) {
  if (!a.kind || !b.kind || a.kind === "Star" || b.kind === "Star")
    return false;
  const r = sub(b.position, a.position),
    distance = length(r),
    radius = a.radius + b.radius;
  if (distance < radius * 0.99) return false;
  const n = unit(r),
    relative = sub(b.velocity, a.velocity),
    normal = dot(relative, n),
    speed2 = dot(relative, relative);
  if (normal >= 0 || speed2 === 0) return false;
  const spent = a.fragmentGeneration >= 1 || b.fragmentGeneration >= 1;
  if (!spent && normal ** 2 / speed2 > 0.35) return false;
  const restitution = 0.4,
    mass = a.mass + b.mass;
  const afterSpeed2 = speed2 - (1 - restitution ** 2) * normal ** 2;
  if (afterSpeed2 <= (2 * G * mass) / radius) return false;
  a.velocity = add(
    a.velocity,
    mul(n, ((1 + restitution) * normal * b.mass) / mass),
  );
  b.velocity = sub(
    b.velocity,
    mul(n, ((1 + restitution) * normal * a.mass) / mass),
  );
  // Mass-weighted separation avoids a zero-time repeat in swept contact tests.
  const gap = Math.max(1e-3, radius * 1e-6) + Math.max(0, radius - distance);
  a.position = sub(a.position, mul(n, (gap * b.mass) / mass));
  b.position = add(b.position, mul(n, (gap * a.mass) / mass));
  return true;
}
const TETRAHEDRON = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
];
// Dimensionless close-packed templates, scaled by the physical fragment radius.
// Antipodal pairs keep COM exactly centered. Deterministic disorder avoids a
// crystal-shaped debris cloud, with a short relaxation to retain compactness.
function fragmentOffsets(count) {
  if (count === 4) return TETRAHEDRON.map((v) => mul(v, Math.SQRT1_2 * 1.02));
  const candidates = [];
  for (let x = -4; x <= 4; x++)
    for (let y = -4; y <= 4; y++)
      for (let z = -4; z <= 4; z++) {
        if (
          (x + y + z) % 2 ||
          !(x > 0 || (x === 0 && (y > 0 || (y === 0 && z > 0))))
        )
          continue;
        candidates.push([x, y, z]);
      }
  candidates.sort(
    (a, b) =>
      dot(a, a) - dot(b, b) || a[0] - b[0] || a[1] - b[1] || a[2] - b[2],
  );
  let points = candidates.slice(0, count / 2).flatMap((p, i) => {
    const q = p.map(
      (v, k) =>
        v * Math.SQRT2 * 1.02 + 0.65 * Math.sin((i + 1) * (k + 2) * 7.13),
    );
    return [q, mul(q, -1)];
  });
  for (let pass = 0; pass < 24; pass++) {
    const corrections = points.map(() => [0, 0, 0]);
    for (let i = 0; i < count; i++)
      for (let j = i + 1; j < count; j++) {
        const delta = sub(points[i], points[j]),
          distance = length(delta);
        if (distance >= 2.04) continue;
        const push = mul(delta, ((2.04 - distance) * 0.25) / distance);
        corrections[i] = add(corrections[i], push);
        corrections[j] = sub(corrections[j], push);
      }
    points = points.map((p, i) => add(p, corrections[i]));
    for (let i = 0; i < count; i += 2) points[i + 1] = mul(points[i], -1);
  }
  let separation = Infinity;
  for (let i = 0; i < count; i++)
    for (let j = i + 1; j < count; j++)
      separation = Math.min(separation, length(sub(points[i], points[j])));
  return points.map((p) => mul(p, Math.max(1, 2.04 / separation)));
}
// Solve the full dimensionless inertia tensor; an arbitrary compact cluster is
// not isotropic. The RHS has already been divided by total mass * radius².
function clusterSpin(offsets, rhs) {
  const tensor = [0, 1, 2].map((i) =>
    [0, 1, 2].map((j) =>
      offsets.reduce(
        (s, r) =>
          s + ((i === j ? dot(r, r) + 0.4 : 0) - r[i] * r[j]) / offsets.length,
        0,
      ),
    ),
  );
  const rows = tensor.map((r, i) => [...r, rhs[i]]);
  for (let i = 0; i < 3; i++) {
    const pivot = rows[i][i];
    for (let j = i; j < 4; j++) rows[i][j] /= pivot;
    for (let k = 0; k < 3; k++)
      if (k !== i) {
        const f = rows[k][i];
        for (let j = i; j < 4; j++) rows[k][j] -= f * rows[i][j];
      }
  }
  return rows.map((r) => r[3]);
}
const finiteVector = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const validBody = (body) =>
  body &&
  typeof body.id === "string" &&
  body.id.length > 0 &&
  Number.isFinite(body.mass) &&
  body.mass > 0 &&
  Number.isFinite(body.radius) &&
  body.radius > 0 &&
  (body.fragmentGeneration === undefined ||
    (Number.isInteger(body.fragmentGeneration) &&
      body.fragmentGeneration >= 0)) &&
  finiteVector(body.position) &&
  finiteVector(body.velocity);

// Conservative eligibility for a deliberately approximate disruption model.
// The caller supplies an actual contacting pair and validates any external parent.
// Compact spheres preserve mass, volume, COM and linear momentum. A shared
// spin carries angular momentum where the ejection budget permits it. Placement
// changes gravitational energy; this is not material fracture or stellar evolution.
export function fragmentImpact(
  a,
  b,
  { bodyCount, maxBodies = 128, fragmentLimit = 4 } = {},
) {
  if (
    !validBody(a) ||
    !validBody(b) ||
    a.id === b.id ||
    !Number.isInteger(bodyCount) ||
    bodyCount < 2 ||
    !Number.isInteger(maxBodies) ||
    ![4, 8, 16, 32, 64].includes(fragmentLimit) ||
    bodyCount + 2 > maxBodies ||
    a.kind === "Star" ||
    b.kind === "Star" ||
    (a.fragmentGeneration ?? 0) >= 1 ||
    (b.fragmentGeneration ?? 0) >= 1
  )
    return null;
  if (b.mass > a.mass) [a, b] = [b, a];
  if (b.mass / a.mass < 0.05) return null;
  const totalMass = a.mass + b.mass;
  const count = [64, 32, 16, 8, 4].find(
    (n) =>
      n <= fragmentLimit &&
      bodyCount - 2 + n <= maxBodies &&
      totalMass / n >= 1e14 &&
      Math.cbrt((a.radius ** 3 + b.radius ** 3) / n) >= 1000,
  );
  if (!count) return null;
  const mass = totalMass / count;
  const radius = Math.cbrt((a.radius ** 3 + b.radius ** 3) / count);
  if (
    !Number.isFinite(totalMass) ||
    !Number.isFinite(radius) ||
    mass < 1e14 ||
    radius < 1000
  )
    return null;
  const speed = Math.hypot(
    ...a.velocity.map((value, k) => value - b.velocity[k]),
  );
  const reducedMass = a.mass * (b.mass / totalMass);
  const relativeEnergy = 0.5 * reducedMass * speed ** 2;
  const threshold =
    2 * 0.6 * G * (a.mass * (a.mass / a.radius) + b.mass * (b.mass / b.radius));
  if (
    !Number.isFinite(relativeEnergy) ||
    !Number.isFinite(threshold) ||
    relativeEnergy <= threshold
  )
    return null;
  const ejectionEnergy = 0.25 * (relativeEnergy - threshold);
  const offsets = fragmentOffsets(count);
  const angular = angularMomentum(a, b);
  const unconstrainedSpin = clusterSpin(
    offsets,
    mul(angular, 1 / (totalMass * radius ** 2)),
  );
  const spinEnergy = Math.max(0, dot(angular, unconstrainedSpin) / 2);
  // Bound rotational energy rather than inventing energy for extreme input spins.
  const spinFraction =
    spinEnergy > 0
      ? Math.min(1, Math.sqrt((ejectionEnergy * 0.8) / spinEnergy))
      : 1;
  const omega = mul(unconstrainedSpin, spinFraction);
  // Equal speeds within opposite pairs retain zero net impulse. Each velocity
  // remains radial, so this spread adds no angular momentum.
  const ejection = offsets.map((r, i) =>
    mul(
      r,
      count === 4 ? 1 : 1 + 0.3 * Math.sin((Math.floor(i / 2) + 1) * 8.37),
    ),
  );
  const componentSpeed = Math.sqrt(
    (2 * Math.max(0, ejectionEnergy - spinEnergy * spinFraction ** 2)) /
      totalMass /
      (ejection.reduce((s, r) => s + dot(r, r), 0) / count),
  );
  const center = a.position.map(
    (value, k) =>
      value * (a.mass / totalMass) + b.position[k] * (b.mass / totalMass),
  );
  const velocity = a.velocity.map(
    (value, k) =>
      value * (a.mass / totalMass) + b.velocity[k] * (b.mass / totalMass),
  );
  const parentId =
    typeof a.parentId === "string" &&
    a.parentId &&
    a.parentId === b.parentId &&
    a.parentId !== a.id &&
    a.parentId !== b.id
      ? a.parentId
      : undefined;
  // Including both full IDs makes new IDs longer than either input, and unique
  // across disjoint input pairs. First-generation fragments cannot fragment again.
  const prefix = `fragment:${JSON.stringify([a.id, b.id])}:`;
  const fragments = offsets.map((direction, index) => ({
    id: index === 0 ? a.id : `${prefix}${index + 1}`,
    name: `${a.name || a.id} fragment ${index + 1}`,
    kind: "Fragment",
    mass,
    radius,
    color: a.color || "#c8b8a8",
    ...(parentId ? { parentId } : {}),
    ...(Number.isFinite(a.albedo) ? { albedo: a.albedo } : {}),
    fragmentGeneration: 1,
    position: direction.map((value, k) => center[k] + value * radius),
    velocity: add(
      ejection[index].map((sign, k) => velocity[k] + sign * componentSpeed),
      cross(omega, mul(direction, radius)),
    ),
    orientation: [...(a.orientation || [0, 0, 0, 1])],
    angularVelocity: [...omega],
    rotationModel: "free",
    rotationPeriod: length(omega) > 0 ? (2 * Math.PI) / length(omega) : 0,
    trail: [],
    relativeTrail: [],
    trailInterval: 100,
  }));
  if (!fragments.every(validBody)) return null;
  // Huge coordinates can round distinct offsets into overlapping positions.
  for (let i = 0; i < fragments.length; i++)
    for (let j = i + 1; j < fragments.length; j++)
      if (
        Math.hypot(
          ...fragments[i].position.map(
            (value, k) => value - fragments[j].position[k],
          ),
        ) <=
        2 * radius
      )
        return null;
  return fragments;
}
