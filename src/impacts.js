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
// Four compact spheres preserve mass, volume, COM and linear momentum. A shared
// spin carries angular momentum where the ejection budget permits it. Placement
// changes gravitational energy; this is not material fracture or stellar evolution.
export function fragmentImpact(a, b, { bodyCount, maxBodies = 128 } = {}) {
  if (
    !validBody(a) ||
    !validBody(b) ||
    a.id === b.id ||
    !Number.isInteger(bodyCount) ||
    bodyCount < 2 ||
    !Number.isInteger(maxBodies) ||
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
  const mass = totalMass / 4;
  const radius = Math.cbrt((a.radius ** 3 + b.radius ** 3) / 4);
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
  const componentOffset = radius * Math.SQRT1_2 * 1.02;
  const inertia = totalMass * (2 * componentOffset ** 2 + 0.4 * radius ** 2);
  const angular = angularMomentum(a, b);
  const spinEnergy = dot(angular, angular) / (2 * inertia);
  // Bound rotational energy rather than inventing energy for extreme input spins.
  const spinFraction =
    spinEnergy > 0
      ? Math.min(1, Math.sqrt((ejectionEnergy * 0.8) / spinEnergy))
      : 1;
  const omega = mul(angular, spinFraction / inertia);
  const componentSpeed = Math.sqrt(
    (2 * Math.max(0, ejectionEnergy - spinEnergy * spinFraction ** 2)) /
      totalMass /
      3,
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
  const fragments = TETRAHEDRON.map((direction, index) => ({
    id: index === 0 ? a.id : `${prefix}${index + 1}`,
    name: `${a.name || a.id} fragment ${index + 1}`,
    kind: "Fragment",
    mass,
    radius,
    color: a.color || "#c8b8a8",
    ...(parentId ? { parentId } : {}),
    ...(Number.isFinite(a.albedo) ? { albedo: a.albedo } : {}),
    fragmentGeneration: 1,
    position: direction.map((sign, k) => center[k] + sign * componentOffset),
    velocity: add(
      direction.map((sign, k) => velocity[k] + sign * componentSpeed),
      cross(omega, mul(direction, componentOffset)),
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
