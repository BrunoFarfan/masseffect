import { add, sub, mul, dot, length, unit, cross, clamp } from "./math.js";
import {
  IDENTITY,
  rotateVector,
  multiply,
  conjugate,
  between,
  blendRotation,
} from "./rotation.js";

// Two meters above ordinary surfaces; increase only to exceed coordinate ulps.
const clearance = (body) =>
  Math.max(2, ...body.position.map((v) => Math.abs(v) * Number.EPSILON * 32));

export class Camera {
  constructor() {
    this.position = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.followId = null;
    this.previousTarget = null;
    this.transition = null;
    this.aspect = 1.6;
    this.frameRotation = [...IDENTITY];
    this.surface = null;
    this.surfaceBlockedId = null;
    this.home();
  }
  get forward() {
    return rotateVector(this.frameRotation, [
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ]);
  }
  get right() {
    return rotateVector(this.frameRotation, [
      Math.cos(this.yaw),
      0,
      Math.sin(this.yaw),
    ]);
  }
  get up() {
    return cross(this.right, this.forward);
  }
  lookAt(target) {
    const d = rotateVector(
      conjugate(this.frameRotation),
      unit(sub(target, this.position)),
    );
    this.pitch = Math.asin(clamp(d[1], -1, 1));
    this.yaw = Math.atan2(d[0], -d[2]);
  }
  home(outer = false, animate = false) {
    this.stop();
    this.levelFrame(animate);
    this.surfaceBlockedId = animate ? this.surface?.id || this.followId : null;
    this.surface = null;
    const scale = (outer ? 1.12e13 : 6.5e11) * Math.max(1, 1.3 / this.aspect);
    const end = [scale * 0.18, scale * 0.64, scale * 0.78];
    this.followId = null;
    this.previousTarget = null;
    if (animate)
      this.transition = {
        start: [...this.position],
        end,
        target: [0, 0, 0],
        elapsed: 0,
      };
    else {
      this.position = end;
      this.lookAt([0, 0, 0]);
      this.transition = null;
    }
  }
  focus(body, bodies = null) {
    this.stop();
    this.levelFrame();
    this.surfaceBlockedId = this.surface?.id || this.followId;
    this.surface = null;
    const distance = bodies
      ? Math.max(
          body.radius * 24,
          ...bodies
            .filter((b) => b.parentId === body.id)
            .map((b) => length(sub(b.position, body.position)) * 3.2),
        )
      : body.radius * 3;
    this.transition = {
      start: [...this.position],
      end: sub(body.position, mul(this.forward, distance)),
      target: [...body.position],
      elapsed: 0,
    };
    this.followId = body.id;
    this.previousTarget = [...body.position];
  }
  release() {
    this.stop();
    this.levelFrame();
    this.surfaceBlockedId = this.surface?.id || this.followId;
    this.surface = null;
    this.followId = null;
    this.previousTarget = null;
    this.transition = null;
  }
  stop() {
    this.motion = [0, 0, 0];
    this.wheelMotion = 0;
  }
  levelFrame(animate = true) {
    this.leveling = animate
      ? { start: [...this.frameRotation], elapsed: 0 }
      : null;
    if (!animate) this.frameRotation = [...IDENTITY];
  }
  updateLevel(dt) {
    if (!this.leveling || this.surface) return;
    const view = this.forward,
      t = this.leveling;
    t.elapsed += dt;
    const x = clamp(t.elapsed / 0.65, 0, 1),
      ease = x * x * (3 - 2 * x);
    this.frameRotation = blendRotation(t.start, 1 - ease);
    // Level the horizon without turning the view. This continues even when
    // mouse look, wheel or movement interrupts the separate travel animation.
    this.lookAt(
      add(this.position, mul(view, Math.max(1, length(this.position) * 0.001))),
    );
    if (x === 1) this.leveling = null;
  }
  updateSurface(dt, bodies) {
    const blocked = bodies.find((b) => b.id === this.surfaceBlockedId);
    if (
      !blocked ||
      length(sub(this.position, blocked.position)) > blocked.radius * 1.7
    )
      this.surfaceBlockedId = null;
    let body = bodies.find((b) => b.id === this.surface?.id);
    if (
      this.surface &&
      (!body || length(sub(this.position, body.position)) > body.radius * 1.7)
    ) {
      if (this.followId === this.surface.id) {
        this.followId = null;
        this.previousTarget = null;
      }
      this.surface = null;
      this.levelFrame();
      body = null;
    }
    if (!this.surface && !this.transition) {
      body = bodies
        .filter(
          (b) =>
            b.kind !== "Star" &&
            b.orientation &&
            b.id !== this.surfaceBlockedId,
        )
        .filter((b) => length(sub(this.position, b.position)) < b.radius * 1.35)
        .sort(
          (a, b) =>
            length(sub(this.position, a.position)) / a.radius -
            length(sub(this.position, b.position)) / b.radius,
        )[0];
      if (body) {
        this.leveling = null;
        this.surface = {
          id: body.id,
          orientation: [...body.orientation],
          blend: 0,
        };
        this.followId = body.id;
        this.previousTarget = [...body.position];
      }
    }
    if (!this.surface || !body) return;
    const relative = sub(this.position, body.position),
      ratio = length(relative) / body.radius;
    const target = clamp((1.5 - ratio) / 0.3, 0, 1);
    this.surface.blend +=
      (target - this.surface.blend) * (1 - Math.exp(-dt / 0.18));
    if (target === 1 && this.surface.blend > 0.9999) this.surface.blend = 1;
    const change = blendRotation(
      multiply(body.orientation, conjugate(this.surface.orientation)),
      this.surface.blend,
    );
    this.position = add(body.position, rotateVector(change, relative));
    this.frameRotation = unit(multiply(change, this.frameRotation));
    this.motion = rotateVector(change, this.motion);
    this.surface.orientation = [...body.orientation];
    // Gradually make the local vertical radial. Preserve the viewing direction;
    // only the horizon rolls into alignment. Departure levels back to system up.
    const forward = this.forward,
      up = rotateVector(this.frameRotation, [0, 1, 0]);
    const align = blendRotation(
      between(up, unit(sub(this.position, body.position))),
      this.surface.blend * (1 - Math.exp(-dt / 0.25)),
    );
    this.frameRotation = unit(multiply(align, this.frameRotation));
    this.lookAt(add(this.position, mul(forward, Math.max(1, body.radius))));
  }
  followSurvivors(events, bodies) {
    let id = this.followId;
    for (const event of events) if (id === event.removed) id = event.survivor;
    const changed =
      id !== this.followId ||
      events.some(
        (e) =>
          e.kind !== "bounce" && e.before?.some((b) => b.id === this.followId),
      );
    if (!changed) return;
    // Rebase the follow anchor, never teleport the observer with a changed COM.
    // A vanished surface no longer owns the camera's orientation.
    this.surface = null;
    this.levelFrame();
    this.surfaceBlockedId = id;
    this.transition = null;
    this.stop();
    const body = bodies.find((b) => b.id === id);
    if (body) {
      this.followId = id;
      this.previousTarget = [...body.position];
    } else this.release();
  }
  update(dt, bodies, keys) {
    const body = bodies.find((b) => b.id === this.followId);
    if (body && this.previousTarget) {
      const delta = sub(body.position, this.previousTarget);
      this.position = add(this.position, delta);
      if (this.transition) {
        this.transition.start = add(this.transition.start, delta);
        this.transition.end = add(this.transition.end, delta);
        this.transition.target = [...body.position];
      }
      this.previousTarget = [...body.position];
    }
    this.updateSurface(dt, bodies);
    this.updateLevel(dt);
    if (this.transition) {
      const t = this.transition;
      t.elapsed += dt;
      const x = clamp(t.elapsed / 0.8, 0, 1),
        ease = x * x * (3 - 2 * x);
      this.position = add(t.start, mul(sub(t.end, t.start), ease));
      this.lookAt(t.target);
      if (x === 1) this.transition = null;
    }
    let direction = [0, 0, 0];
    for (const [key, axis, sign] of [
      ["KeyW", this.forward, 1],
      ["KeyS", this.forward, -1],
      ["KeyA", this.right, -1],
      ["KeyD", this.right, 1],
      ["KeyQ", rotateVector(this.frameRotation, [0, 1, 0]), -1],
      ["KeyE", rotateVector(this.frameRotation, [0, 1, 0]), 1],
    ])
      if (keys.has(key)) direction = add(direction, mul(axis, sign));
    const moving = length(direction) > 0;
    if (moving) this.transition = null;
    if (!this.transition && dt > 0) {
      // Smooth intent, not astronomical coordinates. Integrating the exponential
      // exactly keeps acceleration/braking consistent across render framerates.
      const boost = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 4 : 1,
        target = mul(unit(direction), boost),
        tau = moving ? 0.1 : 0.065,
        decay = Math.exp(-dt / tau),
        wheelDecay = Math.exp(-dt / 0.14),
        delta = add(
          add(
            mul(target, dt),
            mul(sub(this.motion, target), tau * (1 - decay)),
          ),
          mul(this.forward, this.wheelMotion * 0.14 * (1 - wheelDecay)),
        );
      this.motion = add(target, mul(sub(this.motion, target), decay));
      this.wheelMotion *= wheelDecay;
      if (!moving && length(this.motion) < 1e-5) this.motion = [0, 0, 0];
      if (Math.abs(this.wheelMotion) < 1e-5) this.wheelMotion = 0;
      this.move(mul(delta, this.speed(bodies)), bodies);
    }
    this.keepOutside(bodies);
  }
  speed(bodies) {
    return clamp(
      Math.min(
        ...bodies.map((b) =>
          Math.max(
            Math.max(3, Math.sqrt(b.radius) * 0.005),
            length(sub(this.position, b.position)) - b.radius,
          ),
        ),
      ) * 0.6,
      0.1,
      3e13,
    );
  }
  travel(amount) {
    this.transition = null;
    this.wheelMotion = clamp(this.wheelMotion + amount / 0.14, -6, 6);
  }
  move(delta, bodies) {
    this.keepOutside(bodies);
    // Sweep to first contact, then retain tangential travel. Pushing forward
    // into a surface must not prevent simultaneous strafing or vertical motion.
    for (let pass = 0; pass < 4 && length(delta) > 0; pass++) {
      let fraction = 1,
        hit = null;
      const a = dot(delta, delta);
      for (const b of bodies) {
        const r = b.radius + clearance(b),
          p = sub(this.position, b.position),
          along = dot(p, delta),
          c = Math.max(0, dot(p, p) - r * r),
          disc = along * along - a * c;
        if (along < 0 && disc >= 0) {
          const contact = c / (-along + Math.sqrt(disc));
          if (contact < fraction) {
            fraction = Math.max(0, contact);
            hit = b;
          }
        }
      }
      this.position = add(this.position, mul(delta, fraction));
      if (!hit) break;
      const normal = unit(sub(this.position, hit.position));
      delta = mul(delta, 1 - fraction);
      delta = sub(delta, mul(normal, Math.min(0, dot(delta, normal))));
      this.motion = sub(
        this.motion,
        mul(normal, Math.min(0, dot(this.motion, normal))),
      );
      this.keepOutside(bodies);
    }
    this.keepOutside(bodies);
  }
  keepOutside(bodies) {
    for (const b of bodies) {
      const d = sub(this.position, b.position),
        r = b.radius + clearance(b);
      if (length(d) < r)
        this.position = add(
          b.position,
          mul(length(d) > 0 ? unit(d) : [0, 1, 0], r),
        );
    }
  }
  rotate(dx, dy) {
    this.transition = null;
    this.yaw += dx * 0.002;
    this.pitch = clamp(
      this.pitch + dy * 0.002,
      -Math.PI / 2 + 0.02,
      Math.PI / 2 - 0.02,
    );
  }
  project(position, width, height) {
    return this.projection(width, height)(position);
  }
  // Capture the view basis once per rendered frame, not once per trail vertex.
  projection(width, height) {
    const origin = this.position,
      forward = this.forward,
      right = this.right,
      up = this.up,
      focal = height * 0.95;
    return (position) => {
      const x = position[0] - origin[0],
        y = position[1] - origin[1],
        z = position[2] - origin[2];
      const depth = x * forward[0] + y * forward[1] + z * forward[2];
      if (depth < 0.01) return null;
      return {
        x:
          width / 2 +
          (this.screenOffsetX || 0) +
          ((x * right[0] + y * right[1] + z * right[2]) * focal) / depth,
        y: height / 2 - ((x * up[0] + y * up[1] + z * up[2]) * focal) / depth,
        z: depth,
        scale: focal / depth,
      };
    };
  }
  locator(position, width, height) {
    const p = this.project(position, width, height);
    if (p && p.x > 40 && p.x < width - 40 && p.y > 155 && p.y < height - 145)
      return null;
    const d = sub(position, this.position),
      behind = dot(d, this.forward) <= 0;
    let x = dot(d, this.right),
      y = -dot(d, this.up);
    if (Math.hypot(x, y) < 1) {
      x = 0;
      y = 1;
    }
    const ratio = Math.min(
      (width / 2 - 90) / Math.max(Math.abs(x), 1),
      (height / 2 - 160) / Math.max(Math.abs(y), 1),
    );
    return {
      x: width / 2 + x * ratio,
      y: height / 2 + y * ratio,
      angle: Math.atan2(y, x),
      behind,
    };
  }
}
