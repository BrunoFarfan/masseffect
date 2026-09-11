import { sub, dot, length } from "./math.js";
import { rotateVector, IDENTITY } from "./rotation.js";

// Main C/B/A ring boundaries in meters. Decorative annuli, not gravitating
// particles. The Cassini division stays open; no screen-space ellipse or tilt.
// https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html
const BANDS = [
  [7.4658e7, 9.2e7, 0.16],
  [9.2e7, 1.1758e8, 0.44],
  [1.2217e8, 1.36775e8, 0.3],
];

function clip(polygon, distance, includeBoundary = true) {
  const out = [];
  if (!polygon.length) return out;
  const inside = (d) => (includeBoundary ? d >= 0 : d > 0);
  let a = polygon.at(-1),
    da = distance(a);
  for (const b of polygon) {
    const db = distance(b);
    if (inside(da) !== inside(db)) {
      const t = da / (da - db);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
    if (inside(db)) out.push(b);
    a = b;
    da = db;
  }
  return out;
}

export function projectSaturnRings(body, camera, width, height) {
  const result = { back: [], front: [] };
  if (body.ghost || body.kind === "Star" || body.radius >= BANDS[0][0])
    return result;
  const center = sub(body.position, camera.position),
    focal = height * 0.95;
  if ((BANDS.at(-1)[1] * focal) / length(center) < 2) return result;
  const q = body.orientation || IDENTITY,
    x = rotateVector(q, [1, 0, 0]),
    z = rotateVector(q, [0, 0, 1]),
    right = camera.right,
    up = camera.up,
    forward = camera.forward,
    offset = width / 2 + (camera.screenOffsetX || 0);
  const point = (radius, angle) => {
    const v = x.map(
      (a, k) => radius * (a * Math.cos(angle) + z[k] * Math.sin(angle)),
    );
    const r = center.map((a, k) => a + v[k]);
    return [dot(r, right), dot(r, up), dot(r, forward), -dot(center, v)];
  };
  const planes = [
    (p) => p[2] - 0.01,
    (p) => p[0] + (offset / focal) * p[2],
    (p) => ((width - offset) / focal) * p[2] - p[0],
    (p) => p[1] + (height / 2 / focal) * p[2],
    (p) => (height / 2 / focal) * p[2] - p[1],
  ];
  for (const [inner, outer, alpha] of BANDS) {
    const back = [],
      front = [];
    for (let i = 0; i < 192; i++) {
      const a = (i / 192) * 2 * Math.PI,
        b = ((i + 1) / 192) * 2 * Math.PI;
      const quad = [
        point(inner, a),
        point(outer, a),
        point(outer, b),
        point(inner, b),
      ];
      for (const [side, faces] of [
        [-1, back],
        [1, front],
      ]) {
        let polygon = clip(quad, (p) => side * p[3], side === 1);
        for (const plane of planes) polygon = clip(polygon, plane);
        if (polygon.length >= 3)
          faces.push(
            polygon.map((p) => [
              offset + (focal * p[0]) / p[2],
              height / 2 - (focal * p[1]) / p[2],
            ]),
          );
      }
    }
    result.back.push({ alpha, faces: back });
    result.front.push({ alpha, faces: front });
  }
  return result;
}

export function drawRingFaces(ctx, bands) {
  const alpha = ctx.globalAlpha;
  ctx.fillStyle = "#ded0a8";
  for (const band of bands) {
    ctx.globalAlpha = alpha * band.alpha;
    ctx.beginPath();
    for (const face of band.faces) {
      ctx.moveTo(...face[0]);
      for (const point of face.slice(1)) ctx.lineTo(...point);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.globalAlpha = alpha;
}
