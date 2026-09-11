const G = 6.6743e-11;
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
// Four displaced spheres preserve mass, volume, COM and linear momentum. Their
// placement changes gravitational energy; spin/angular momentum and impact heat
// are not modeled. This is neither material fracture nor stellar evolution.
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
  const componentSpeed = Math.sqrt((2 * ejectionEnergy) / totalMass / 3);
  const componentOffset = Math.sqrt(3) * radius; // radial distance = 3 radii
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
    velocity: direction.map((sign, k) => velocity[k] + sign * componentSpeed),
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
