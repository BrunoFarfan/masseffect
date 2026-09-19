import { cross, dot, sub, unit, length } from "./math.js";

// A measured, star-shaped triangle mesh, not a radial texture. SI meters in/out.
export function shapeIntersection(
  shape,
  origin,
  direction,
  maximum = Infinity,
) {
  let nearest = maximum;
  const vertices = shape.vertices,
    indices = shape.indices;
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertices[indices[i]],
      b = vertices[indices[i + 1]],
      c = vertices[indices[i + 2]];
    const edge1 = sub(b, a),
      edge2 = sub(c, a),
      p = cross(direction, edge2);
    const determinant = dot(edge1, p);
    if (Math.abs(determinant) < 1e-10) continue;
    const inverse = 1 / determinant,
      fromA = sub(origin, a);
    const u = dot(fromA, p) * inverse;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const q = cross(fromA, edge1),
      v = dot(direction, q) * inverse;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const t = dot(edge2, q) * inverse;
    if (t >= 0 && t < nearest) nearest = t;
  }
  return nearest < maximum ? nearest : null;
}

export function shapeRadius(shape, direction) {
  return shapeIntersection(shape, [0, 0, 0], unit(direction)) ?? 0;
}

export function validateShape(shape) {
  if (
    !Array.isArray(shape.vertices) ||
    !Array.isArray(shape.indices) ||
    !shape.vertices.length ||
    shape.vertices.length > 20000 ||
    shape.indices.length > 120000 ||
    shape.indices.length % 3 ||
    !shape.vertices.every((v) => v.length === 3 && v.every(Number.isFinite)) ||
    !shape.indices.every(
      (i) => Number.isInteger(i) && i >= 0 && i < shape.vertices.length,
    )
  )
    throw new Error("Invalid bounded shape product");
  shape.maxRadius = Math.max(...shape.vertices.map(length));
  shape.minRadius = Math.min(...shape.vertices.map(length));
  return shape;
}
