import { length, sub, dot, mul } from "./math.js";
import { SphereSurface, sphereRasterWidth } from "./sphere.js";
import { ImpactView } from "./impact-view.js";

// Hide labels/picks whose sightline enters a nearer physical surface. Otherwise
// a planet below the local horizon can still appear as a floating text label.
export function occluded(body, origin, blockers) {
  const delta = sub(body.position, origin),
    distance = length(delta);
  if (!distance) return false;
  const direction = mul(delta, 1 / distance);
  return blockers.some((other) => {
    if (other.id === body.id || other.ghost) return false;
    const r = sub(other.position, origin),
      along = dot(r, direction);
    if (along <= 0) return false;
    const perpendicular2 = Math.max(0, dot(r, r) - along ** 2);
    return (
      perpendicular2 < other.radius ** 2 &&
      along - Math.sqrt(other.radius ** 2 - perpendicular2) <
        distance - body.radius
    );
  });
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.hits = [];
    this.surface = new SphereSurface();
    this.impacts = new ImpactView();
    this.resize();
  }
  resize() {
    this.width = innerWidth;
    this.height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  path(points, camera, color, width = 1, dashed = false) {
    const ctx = this.ctx;
    ctx.beginPath();
    let pen = false;
    for (const point of points) {
      const p = this.project(point);
      if (
        !p ||
        Math.abs(p.x) > this.width * 8 ||
        Math.abs(p.y) > this.height * 8
      ) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [3, 6] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  draw(sim, camera, selected, options) {
    const ctx = this.ctx,
      w = this.width,
      h = this.height;
    this.project = camera.projection(w, h);
    ctx.clearRect(0, 0, w, h);
    // Sparse deterministic stars with orientation, so looking around feels spatial.
    for (let i = 0; i < 95; i++) {
      const theta = i * 2.399963,
        y = 1 - (2 * (i + 0.5)) / 95,
        r = Math.sqrt(1 - y * y);
      const star = this.project([
        camera.position[0] + r * Math.cos(theta) * 1e17,
        camera.position[1] + y * 1e17,
        camera.position[2] + r * Math.sin(theta) * 1e17,
      ]);
      if (star && star.x > 0 && star.x < w && star.y > 0 && star.y < h) {
        ctx.fillStyle = i % 4 ? "#b1b9c138" : "#e0d8c869";
        ctx.fillRect(star.x, star.y, i % 4 ? 0.9 : 1.4, i % 4 ? 0.9 : 1.4);
      }
    }
    const resolved = (b) => {
      if (!b.parentId || b.id === selected) return true;
      const parent = sim.bodies.find((p) => p.id === b.parentId),
        p = this.project(b.position);
      return (
        !parent ||
        (p && length(sub(b.position, parent.position)) * p.scale > 18)
      );
    };
    const followed = sim.bodies.find((b) => b.id === camera.followId);
    const hasChildren = (body) =>
      body && sim.bodies.some((b) => b.parentId === body.id);
    const reference = hasChildren(followed)
      ? followed
      : sim.bodies.find((b) => b.id === followed?.parentId);
    const local =
      reference &&
      hasChildren(reference) &&
      reference.kind !== "Star" &&
      length(sub(camera.position, reference.position)) <
        reference.radius * 5000;
    options.trailReference = local ? reference.name : null;
    const nearestSurfaceRatio = Math.min(
      ...sim.bodies.map(
        (b) => length(sub(camera.position, b.position)) / b.radius,
      ),
    );
    const trailAlpha = Math.max(0, Math.min(1, (nearestSurfaceRatio - 3) / 9));
    ctx.globalAlpha = trailAlpha;
    if (options.trails && trailAlpha > 0)
      for (const b of sim.bodies) {
        if (!resolved(b)) continue;
        if (local && b.parentId !== reference.id) continue;
        const points = local
          ? (b.relativeTrail || []).map((p) =>
              p.map((v, k) => v + reference.position[k]),
            )
          : b.trail;
        if (points.length < 2) continue;
        for (let section = 0; section < 5; section++) {
          const start = Math.floor(((points.length - 1) * section) / 5),
            end = Math.floor(((points.length - 1) * (section + 1)) / 5) + 1;
          this.path(
            points.slice(start, end),
            camera,
            b.color + ["18", "30", "50", "80", "bb"][section],
            1.4,
          );
        }
        this.path([points.at(-1), b.position], camera, b.color + "cc", 1.4);
      }
    ctx.globalAlpha = 1;
    this.hits = [];
    const drawnBodies = this.impacts.bodies(sim.bodies, options.effectDt || 0);
    const close = drawnBodies.filter(
      (b) =>
        length(sub(camera.position, b.position)) < b.radius * 12 ||
        b.radius * (this.project(b.position)?.scale || 0) > 12,
    );
    this.surface.rasterWidth = sphereRasterWidth(camera, close, w, h);
    const visible = drawnBodies
      .filter(resolved)
      .map((b) => ({ b, p: this.project(b.position) }))
      .filter(
        ({ p }) =>
          p && p.x > -100 && p.x < w + 100 && p.y > -100 && p.y < h + 100,
      )
      .sort((a, b) => b.p.z - a.p.z);
    const sun = sim.bodies.find((b) => b.kind === "Star");
    for (const { b, p } of visible)
      p.occluded = occluded(b, camera.position, close);
    const drawOrder = [
      ...visible,
      ...close
        .filter((b) => !visible.some((v) => v.b === b))
        .map((b) => ({ b, p: null })),
    ].sort(
      (a, b) =>
        length(sub(camera.position, b.b.position)) -
        b.b.radius -
        (length(sub(camera.position, a.b.position)) - a.b.radius),
    );
    for (const { b, p } of drawOrder) {
      ctx.globalAlpha = b.visualAlpha ?? 1;
      if (!p) {
        this.surface.draw(ctx, b, camera, w, h, sun?.id === b.id ? null : sun);
        continue;
      }
      const separation = sun
        ? length(sub(b.position, sun.position)) * p.scale
        : 100;
      const distantMinimum =
        b.id === "sun"
          ? 17
          : b.radius > 5e7
            ? 9
            : b.radius > 1e7
              ? 7
              : Math.min(4.5, Math.max(1.5, separation / 10));
      // On a surface, apparent angular sizes matter (the Sun must not dwarf
      // Earth in the lunar sky). Retain only a tiny point floor for distant dots.
      const minimum =
        1.5 +
        (distantMinimum - 1.5) *
          Math.max(0, Math.min(1, (nearestSurfaceRatio - 1.5) / 4));
      const r = Math.min(
        Math.max(minimum, b.radius * p.scale),
        Math.max(w, h) * 2,
      );
      if (b.kind === "Star") {
        const glow = ctx.createRadialGradient(
          p.x,
          p.y,
          r * 0.5,
          p.x,
          p.y,
          r * 5,
        );
        glow.addColorStop(0, "#edc88b24");
        glow.addColorStop(1, "#edc88b00");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (b.id === selected) {
        ctx.strokeStyle = b.color + "70";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (b.id === "saturn") {
        ctx.strokeStyle = b.color + "90";
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r * 1.9, r * 0.48, -0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
      const surfaceBlend = Math.max(
        0,
        Math.min(1, (b.radius * p.scale - 12) / 12),
      );
      if (surfaceBlend < 1) {
        const shade = ctx.createRadialGradient(
          p.x - r * 0.3,
          p.y - r * 0.35,
          r * 0.1,
          p.x,
          p.y,
          r * 1.3,
        );
        shade.addColorStop(0, b.color);
        shade.addColorStop(0.55, b.color);
        shade.addColorStop(1, b.id === "sun" ? "#b38350" : "#343945");
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (surfaceBlend > 0) {
        ctx.globalAlpha = (b.visualAlpha ?? 1) * surfaceBlend;
        this.surface.draw(ctx, b, camera, w, h, sun?.id === b.id ? null : sun);
      }
      if (!b.ghost && !p.occluded)
        this.hits.push({ id: b.id, x: p.x, y: p.y, r: Math.max(13, r + 6) });
      p.radius = r;
    }
    ctx.globalAlpha = 1;
    if (options.labels) {
      ctx.font = '11px "Trebuchet MS", sans-serif';
      const occupied = visible.map(({ p }) => ({
        x: p.x - p.radius - 3,
        y: p.y - p.radius - 3,
        w: 2 * p.radius + 6,
        h: 2 * p.radius + 6,
      }));
      occupied.push(...(options.occlusions || []));
      const overlaps = (a, b) =>
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;
      for (const { b, p } of [...visible].sort(
        (a, b) =>
          (b.b.id === selected) - (a.b.id === selected) || b.b.mass - a.b.mass,
      )) {
        if (
          b.ghost ||
          p.occluded ||
          (b.visualAlpha ?? 1) < 0.6 ||
          (b.kind === "Fragment" && b.id !== selected && sim.bodies.length > 8)
        )
          continue;
        const labelName =
          b.kind === "Fragment" ? b.name.replace(" fragment ", " · ") : b.name;
        const width = ctx.measureText(labelName).width + 8,
          r = p.radius;
        const candidates = [
          { x: p.x + r + 8, y: p.y - 7 },
          { x: p.x - width - r - 8, y: p.y - 7 },
          { x: p.x - width / 2, y: p.y - r - 23 },
          { x: p.x - width / 2, y: p.y + r + 9 },
          { x: p.x + r + 13, y: p.y - r - 25 },
        ];
        const label = candidates
          .map((p) => ({ ...p, w: width, h: 17 }))
          .find(
            (rect) =>
              rect.x > 10 &&
              rect.x + rect.w < w - 10 &&
              rect.y > 15 &&
              rect.y + rect.h < h - 90 &&
              !occupied.some((other) => overlaps(rect, other)),
          );
        if (!label) {
          if (b.id === selected) {
            const x = Math.max(
                12,
                Math.min(w - width - 12, p.x + p.radius + 12),
              ),
              y = Math.max(165, Math.min(h - 145, p.y - 14));
            occupied.push({ x: x - 4, y: y - 13, w: width + 8, h: 20 });
            ctx.strokeStyle = "#10151e";
            ctx.lineWidth = 4;
            ctx.strokeText(labelName, x, y);
            ctx.fillStyle = b.color;
            ctx.fillText(labelName, x, y);
          }
          continue;
        }
        occupied.push(label);
        ctx.fillStyle = b.id === selected ? "#f1ece4" : "#adb4bf";
        ctx.fillText(labelName, label.x + 4, label.y + 12);
      }
    }
    if (options.preview) {
      const b = options.preview,
        p = this.project(b.position),
        primary = sim.bodies.find((p) => p.id === b.parentId);
      if (p && primary) {
        const velocity = sub(b.velocity, primary.velocity),
          duration =
            (length(sub(b.position, primary.position)) /
              Math.max(length(velocity), 1)) *
            0.3;
        const end = this.project(
          b.position.map((v, k) => v + velocity[k] * duration),
        );
        ctx.strokeStyle = b.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (end && length(velocity) > 0) {
          const angle = Math.atan2(end.y - p.y, end.x - p.x);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(end.x, end.y);
          ctx.lineTo(
            end.x - 9 * Math.cos(angle - 0.4),
            end.y - 9 * Math.sin(angle - 0.4),
          );
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(
            end.x - 9 * Math.cos(angle + 0.4),
            end.y - 9 * Math.sin(angle + 0.4),
          );
          ctx.stroke();
        }
        ctx.font = '12px "Trebuchet MS",sans-serif';
        ctx.fillStyle = b.color;
        ctx.fillText(b.name + " · preview", p.x + 18, p.y - 16);
      }
    }
    // Contextual ruler only, not a permanent overlay.
    if (!selected || camera.surface?.id === selected) return;
    const target = sim.bodies.find((b) => b.id === selected)?.position || [
      0, 0, 0,
    ];
    const depth =
      this.project(target)?.z || length(sub(camera.position, target));
    const meters = (100 * depth) / (h * 0.95),
      order = 10 ** Math.floor(Math.log10(meters)),
      nice = Math.floor(meters / order) * order;
    const pixels = (nice * (h * 0.95)) / depth;
    ctx.strokeStyle = "#777f8966";
    ctx.beginPath();
    ctx.moveTo(32, h - 105);
    ctx.lineTo(32 + pixels, h - 105);
    ctx.moveTo(32, h - 108);
    ctx.lineTo(32, h - 102);
    ctx.moveTo(32 + pixels, h - 108);
    ctx.lineTo(32 + pixels, h - 102);
    ctx.stroke();
    ctx.font = '10px "Trebuchet MS",sans-serif';
    ctx.fillStyle = "#8d95a0";
    ctx.fillText(
      `${formatDistance(nice)} · at ${selected ? sim.bodies.find((b) => b.id === selected)?.name : "Sun"}`,
      32,
      h - 116,
    );
  }
  pick(x, y) {
    return this.hits
      .slice()
      .reverse()
      .find((p) => Math.hypot(x - p.x, y - p.y) < p.r)?.id;
  }
}
export function formatDistance(meters) {
  if (meters < 1000)
    return `${meters.toLocaleString("en", { maximumFractionDigits: 1 })} m`;
  return meters >= 1e9
    ? `${(meters / 1e9).toLocaleString("en", { maximumFractionDigits: 1 })} million km`
    : `${(meters / 1000).toLocaleString("en", { maximumFractionDigits: 0 })} km`;
}
