import { sub, unit, dot } from "./math.js";
import { rotateVector, IDENTITY } from "./rotation.js";

// Conservative, half-open raster bounds of a perspective-projected sphere.
// Inputs are camera-space meters and raster pixels (including the focal length).
export function sphereRasterBounds(
  cx,
  cy,
  depth,
  radius,
  width,
  height,
  focal,
  screenOffsetX = 0,
) {
  const full = { left: 0, right: width, top: 0, bottom: height };
  // The shader's minimum coverage gradient is 1 m²/pixel. Its floor can admit
  // D > -0.5 m² even outside a tiny sphere; this conservative culling radius
  // retains that halo without changing the radius used for ray intersections.
  radius = Math.hypot(radius, Math.SQRT1_2);
  if (depth < -radius) return { left: 0, right: 0, top: 0, bottom: 0 };
  // A sphere touching/crossing the camera plane can cover the whole viewport.
  if (!(depth > radius)) return full;
  const denominator = depth * depth - radius * radius;
  const centerX =
    width / 2 + screenOffsetX + (focal * cx * depth) / denominator;
  const centerY = height / 2 - (focal * cy * depth) / denominator;
  const halfWidth =
    (focal * radius * Math.sqrt(denominator + cx * cx)) / denominator;
  const halfHeight =
    (focal * radius * Math.sqrt(denominator + cy * cy)) / denominator;
  if (![centerX, centerY, halfWidth, halfHeight].every(Number.isFinite))
    return full;
  // Preserve the existing analytic edge coverage beyond the geometric tangent.
  const clip = (value, limit) => Math.max(0, Math.min(limit, value));
  return {
    left: clip(Math.floor(centerX - halfWidth - 2), width),
    right: clip(Math.ceil(centerX + halfWidth + 2), width),
    top: clip(Math.floor(centerY - halfHeight - 2), height),
    bottom: clip(Math.ceil(centerY + halfHeight + 2), height),
  };
}

// Share a raster-work budget across overlapping close spheres. Canonical single
// surfaces retain full detail; dense debris lowers shading resolution, never
// physical size or body count. Quantized sizes avoid reallocating on every frame.
export function sphereRasterWidth(camera, bodies, width, height) {
  const w = Math.min(width, 960),
    h = Math.round((w * height) / width);
  const f = camera.forward,
    right = camera.right,
    up = camera.up;
  let pixels = 0;
  for (const body of bodies) {
    const c = sub(body.position, camera.position);
    const bounds = sphereRasterBounds(
      dot(c, right),
      dot(c, up),
      dot(c, f),
      body.radius,
      w,
      h,
      h * 0.95,
      ((camera.screenOffsetX || 0) * w) / width,
    );
    pixels += (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
  }
  if (pixels <= 600000) return w;
  return Math.min(
    w,
    Math.max(128, Math.floor((w * Math.sqrt(600000 / pixels)) / 64) * 64),
  );
}

// A single, low-cost ray/sphere surface for close approaches. No terrain or mesh.
// Rays and intersections remain in world meters; only the image is screen space.
export class SphereSurface {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
  }
  draw(ctx, body, camera, width, height, light) {
    const w = Math.min(width, this.rasterWidth || 960),
      h = Math.round((w * height) / width);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.pixels = this.ctx.createImageData(w, h);
    }
    const pixels = this.pixels.data,
      c = sub(body.position, camera.position),
      f = camera.forward,
      right = camera.right,
      up = camera.up;
    const radius = body.radius,
      C = dot(c, c) - radius * radius,
      focal = h * 0.95;
    const lighting = light
      ? unit(sub(light.position, body.position))
      : unit(sub(camera.position, body.position));
    const cr = dot(c, right),
      cu = dot(c, up);
    const offsetX = ((camera.screenOffsetX || 0) * w) / width;
    const bounds = sphereRasterBounds(
      cr,
      cu,
      dot(c, f),
      radius,
      w,
      h,
      focal,
      offsetX,
    );
    const rgb = body.color.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16));
    const orientation = body.orientation || IDENTITY,
      localX = rotateVector(orientation, [1, 0, 0]),
      localY = rotateVector(orientation, [0, 1, 0]),
      localZ = rotateVector(orientation, [0, 0, 1]);
    // The projected bounds can shrink or move between frames. Clear every old
    // alpha value, including pixels outside the new bounds, before rasterizing.
    pixels.fill(0);
    for (let y = bounds.top; y < bounds.bottom; y++)
      for (let x = bounds.left; x < bounds.right; x++) {
        const sx = (x + 0.5 - w / 2 - offsetX) / focal,
          sy = -(y + 0.5 - h / 2) / focal;
        const dx = f[0] + right[0] * sx + up[0] * sy,
          dy = f[1] + right[1] * sx + up[1] * sy,
          dz = f[2] + right[2] * sx + up[2] * sy;
        const A = dx * dx + dy * dy + dz * dz,
          B = dx * c[0] + dy * c[1] + dz * c[2],
          D = B * B - A * C,
          index = (y * w + x) * 4;
        const gradient =
          (2 * Math.hypot(B * cr - C * sx, B * cu - C * sy)) / focal;
        const coverage = Math.max(
          0,
          Math.min(1, 0.5 + D / Math.max(gradient, 1)),
        );
        if (coverage === 0 || B <= 0) continue;
        const t = C / (B + Math.sqrt(Math.max(0, D)));
        if (t < 0) continue;
        const nx = (dx * t - c[0]) / radius,
          ny = (dy * t - c[1]) / radius,
          nz = (dz * t - c[2]) / radius;
        const shade =
          body.kind === "Star"
            ? 1
            : 0.34 +
              0.66 *
                Math.max(
                  0,
                  nx * lighting[0] + ny * lighting[1] + nz * lighting[2],
                );
        // Subtle illustrative gas bands give giants identity, without terrain.
        const gas = body.radius > 2e7 && body.kind !== "Star";
        const lx = nx * localX[0] + ny * localX[1] + nz * localX[2],
          ly = nx * localY[0] + ny * localY[1] + nz * localY[2],
          lz = nx * localZ[0] + ny * localZ[1] + nz * localZ[2];
        const pattern = gas
          ? 0.92 + 0.08 * Math.sin(ly * 36 + 2 * Math.sin(lx * 5))
          : body.kind === "Star"
            ? 1
            : 0.95 +
              0.045 *
                Math.sin(lx * 6 + 2 * Math.sin(lz * 4)) *
                Math.sin(ly * 7 + lz * 3);
        // Meter-scale albedo variation, not geometry. Suppress unresolved detail
        // using the ray footprint so gravel never becomes a distant moiré pattern.
        const detail =
          body.kind !== "Star" && !gas && t < focal * 3
            ? 0.035 *
              Math.max(0, 1 - t / (focal * 3)) *
              Math.sin((lx + lz * 0.6) * radius * 0.8) *
              Math.sin((ly - lz * 0.3) * radius * 1.1)
            : 0;
        pixels[index] = rgb[0] * shade * (pattern + detail);
        pixels[index + 1] = rgb[1] * shade * (pattern + detail);
        pixels[index + 2] = rgb[2] * shade * (pattern + detail);
        pixels[index + 3] = 255 * coverage;
      }
    const bw = bounds.right - bounds.left,
      bh = bounds.bottom - bounds.top;
    if (bw === 0 || bh === 0) return;
    // Upload/composite only the disk's bounds, not a full viewport per fragment.
    // Bilinear upscaling can sample a neighboring source pixel at crop edges.
    // Clear that border so the preceding sphere cannot leave a rectangular seam.
    this.ctx.clearRect(bounds.left - 1, bounds.top - 1, bw + 2, bh + 2);
    this.ctx.putImageData(this.pixels, 0, 0, bounds.left, bounds.top, bw, bh);
    ctx.drawImage(
      this.canvas,
      bounds.left,
      bounds.top,
      bw,
      bh,
      (bounds.left * width) / w,
      (bounds.top * height) / h,
      (bw * width) / w,
      (bh * height) / h,
    );
  }
}
