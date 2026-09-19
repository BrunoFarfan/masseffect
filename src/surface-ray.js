// Reference CPU intersection used by terrain clearance and benchmarks. Distances
// and sampled elevation are meters; it never changes a simulation body's radius.
export function intersectTerrain(
  origin,
  direction,
  radius,
  minHeight,
  maxHeight,
  sampleHeight,
  {
    steps = 64,
    tolerance = 0.25,
    slopeBound = 2,
    maxDistance = Infinity,
    conservative = false,
  } = {},
) {
  const a = direction.reduce((s, v) => s + v * v, 0);
  const b = origin.reduce((s, v, i) => s + v * direction[i], 0);
  const c = origin.reduce((s, v) => s + v * v, 0) - (radius + maxHeight) ** 2;
  const disc = b * b - a * c;
  if (!a || disc < 0) return null;
  const root = Math.sqrt(disc);
  let t = Math.max(0, (-b - root) / a);
  const end = Math.min(maxDistance, (-b + root) / a);
  if (end < t) return null;
  const speed = Math.sqrt(a);
  for (let i = 0; i < steps && t <= end; i++) {
    const x = origin[0] + direction[0] * t;
    const y = origin[1] + direction[1] * t;
    const z = origin[2] + direction[2] * t;
    const r = Math.hypot(x, y, z);
    const height = sampleHeight(x / r, y / r, z / r);
    const gap = r - radius - height;
    if (gap <= tolerance)
      return { distance: t, point: [x, y, z], iterations: i + 1 };
    t += Math.max(tolerance * 0.25, gap / (1 + slopeBound)) / speed;
  }
  // Exhaustion is not a proof of free space. Navigation stops at the last
  // verified-safe point; render/reference callers may instead report a miss.
  return conservative && t <= end ? { distance: t, unresolved: true } : null;
}
