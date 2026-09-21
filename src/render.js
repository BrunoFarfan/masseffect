import { length, sub, dot, mul, unit } from "./math.js";
import { SphereSurface, sphereRasterWidth } from "./sphere.js";
import { ImpactView } from "./impact-view.js";
import { projectSaturnRings, drawRingFaces } from "./rings.js";
import { TerrainGPU } from "./terrain-gpu.js";
import { ShapeGPU } from "./shape-gpu.js";
import { Surfaces } from "./surfaces.js";
import {
  SURFACE_LANDMARKS,
  landmarkPoint,
  landmarkVisibility,
  nearbyLandmarkBodies,
} from "./landmarks.js";
import { surfaceFrame } from "./surface-definition.js";

// Hide labels/picks whose sightline enters a nearer physical surface. Otherwise
// a planet below the local horizon can still appear as a floating text label.
export function occluded(body, origin, blockers, surfaces = null) {
  const delta = sub(body.position, origin),
    distance = length(delta);
  if (!distance) return false;
  const direction = mul(delta, 1 / distance);
  return blockers.some((other) => {
    if (other.id === body.id || other.ghost) return false;
    if (surfaces?.has(other)) {
      const hit = surfaces.contact(other, origin, delta, 0);
      return hit !== null && hit < 1 - body.radius / distance;
    }
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
    this.surfaces = new Surfaces();
    this.terrain = new TerrainGPU();
    this.shapes = new ShapeGPU();
    this.impacts = new ImpactView();
    this.resize();
  }
  drawSurface(ctx, body, camera, width, height, light) {
    const state = this.surfaces.state(body);
    if (
      state?.asset?.shape &&
      this.shapes.draw(ctx, body, camera, width, height, light, state)
    )
      return;
    if (
      state?.asset?.color &&
      this.terrain.draw(ctx, body, camera, width, height, light, state)
    )
      return;
    this.surface.draw(ctx, body, camera, width, height, light);
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
    this.terrain.retain(new Set(this.surfaces.states.keys()));
    this.shapes.retain(new Set(this.surfaces.states.keys()));
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
    this.pickBodies = sim.bodies.filter((body) => !body.ghost);
    this.pickCamera = camera;
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
      p.occluded = occluded(b, camera.position, close, this.surfaces);
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
      const rings =
        b.id === "saturn" ? projectSaturnRings(b, camera, w, h) : null;
      if (rings) drawRingFaces(ctx, rings.back);
      if (!p) {
        this.drawSurface(ctx, b, camera, w, h, sun?.id === b.id ? null : sun);
        if (rings) drawRingFaces(ctx, rings.front);
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
      if (b.id === selected && !this.surfaces.state(b)?.asset?.shape) {
        ctx.strokeStyle = b.color + "70";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
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
        this.drawSurface(ctx, b, camera, w, h, sun?.id === b.id ? null : sun);
      }
      ctx.globalAlpha = b.visualAlpha ?? 1;
      if (rings) drawRingFaces(ctx, rings.front);
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
      const bodyLabelRects = [];
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
            bodyLabelRects.push({ x: x - 4, y: y - 13, w: width + 8, h: 20 });
            ctx.strokeStyle = "#10151e";
            ctx.lineWidth = 4;
            ctx.strokeText(labelName, x, y);
            ctx.fillStyle = b.color;
            ctx.fillText(labelName, x, y);
          }
          continue;
        }
        occupied.push(label);
        bodyLabelRects.push(label);
        ctx.fillStyle = b.id === selected ? "#f1ece4" : "#adb4bf";
        ctx.fillText(labelName, label.x + 4, label.y + 12);
      }
      // Contextual, non-clickable landmark annotations. Body disks remain
      // occupied for body labels but intentionally do not block these labels.
      const landmarkOccupied = [
        ...bodyLabelRects,
        ...(options.occlusions || []),
      ];
      let shown = 0;
      for (const landmarkBody of nearbyLandmarkBodies(sim.bodies, camera.position)) {
        const landmarkState = this.surfaces.state(landmarkBody);
        const landmarkFrame = landmarkState?.frame || surfaceFrame(landmarkBody, sim.time);
        if (!landmarkFrame) continue;
        const sampleState = {
          ...landmarkState,
          frame: landmarkFrame,
          referenceRadiusMeters:
            landmarkState?.referenceRadiusMeters || landmarkBody.radius,
          sample: landmarkState
            ? (direction) => this.surfaces.sample(landmarkState, direction)
            : () => 0,
        };
        const cameraRadial = unit(sub(camera.position, landmarkBody.position));
        const horizonDot = landmarkBody.radius /
          Math.max(landmarkBody.radius, length(sub(camera.position, landmarkBody.position)));
        const nearbySites = SURFACE_LANDMARKS[landmarkBody.id]
          .map((site) => ({ site, point: landmarkPoint(landmarkBody, sampleState, site, 50) }))
          .filter(({ point }) => point && dot(point.direction, cameraRadial) >= horizonDot - 0.02)
          .map((entry) => ({ ...entry, screen: this.project(entry.point.position) }))
          .filter(({ screen }) => screen && screen.x >= 0 && screen.x < w && screen.y >= 0 && screen.y < h)
          .sort((a, b) =>
            Math.hypot(a.screen.x - w / 2, a.screen.y - h / 2) -
            Math.hypot(b.screen.x - w / 2, b.screen.y - h / 2),
          );
        for (const { site, point } of nearbySites.slice(0, 16)) {
          if (
            occluded(
              { id: landmarkBody.id, position: point.position, radius: 0 },
              camera.position,
              sim.bodies,
            )
          )
            continue;
          const visibility = landmarkVisibility(
            camera.position,
            landmarkBody,
            sampleState,
            point,
            {
              width: w,
              height: h,
              project: this.project,
            },
          );
          if (!visibility.visible || visibility.alpha <= 0) continue;
          const p = visibility.projected;
          const width = ctx.measureText(site.name).width + 8;
          const candidates = [
            { x: p.x + 9, y: p.y - 8 },
            { x: p.x - width - 9, y: p.y - 8 },
            { x: p.x - width / 2, y: p.y - 22 },
            { x: p.x - width / 2, y: p.y + 10 },
          ].map((candidate) => ({ ...candidate, w: width, h: 17 }));
          const label = candidates.find(
            (rect) =>
              rect.x > 10 &&
              rect.x + rect.w < w - 10 &&
              rect.y > 15 &&
              rect.y + rect.h < h - 90 &&
              !landmarkOccupied.some((other) => overlaps(rect, other)),
          );
          if (!label) continue;
          landmarkOccupied.push(label);
          shown++;
          ctx.globalAlpha = visibility.alpha;
          ctx.strokeStyle = "#10151e";
          ctx.lineWidth = 3;
          ctx.strokeText(site.name, label.x + 4, label.y + 12);
          ctx.fillStyle = "#c7cdd5";
          ctx.fillText(site.name, label.x + 4, label.y + 12);
          ctx.strokeStyle = "#10151e99";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(label.x + 4, label.y + 8);
          ctx.stroke();
          ctx.fillStyle = "#e6d39c";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          if (shown >= 8) break;
        }
        if (shown >= 8) break;
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
    const disk = this.hits
      .slice()
      .reverse()
      .find((p) => Math.hypot(x - p.x, y - p.y) < p.r)?.id;
    if (disk) return disk;
    // At extreme proximity the center of a planet can be behind the camera,
    // so it has no projected disk hit. Pick the visible surface by ray instead.
    const camera = this.pickCamera;
    if (!camera) return null;
    const scale = this.height * 0.95;
    const sx = (x - this.width / 2) / scale;
    const sy = (this.height / 2 - y) / scale;
    const forward = camera.forward, right = camera.right, up = camera.up;
    const direction = unit(forward.map((value, i) => value + sx * right[i] + sy * up[i]));
    let nearest = Infinity, id = null;
    for (const body of this.pickBodies || []) {
      const offset = sub(camera.position, body.position);
      const along = dot(offset, direction);
      const discriminant = along * along - (dot(offset, offset) - body.radius ** 2);
      if (discriminant < 0) continue;
      const near = -along - Math.sqrt(discriminant);
      const far = -along + Math.sqrt(discriminant);
      const distance = near > 0 ? near : far;
      if (distance > 0 && distance < nearest) {
        nearest = distance;
        id = body.id;
      }
    }
    return id;
  }
}
export function formatDistance(meters) {
  if (meters < 1000)
    return `${meters.toLocaleString("en", { maximumFractionDigits: 1 })} m`;
  return meters >= 1e9
    ? `${(meters / 1e9).toLocaleString("en", { maximumFractionDigits: 1 })} million km`
    : `${(meters / 1000).toLocaleString("en", { maximumFractionDigits: 0 })} km`;
}
