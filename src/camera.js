import { add, sub, mul, dot, length, unit, cross, clamp } from "./math.js";

export class Camera {
  constructor() {
    this.position = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.followId = null;
    this.previousTarget = null;
    this.transition = null;
    this.aspect = 1.6;
    this.home();
  }
  get forward() {
    return [
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ];
  }
  get right() {
    return [Math.cos(this.yaw), 0, Math.sin(this.yaw)];
  }
  get up() {
    return cross(this.right, this.forward);
  }
  lookAt(target) {
    const d = unit(sub(target, this.position));
    this.pitch = Math.asin(clamp(d[1], -0.9999, 0.9999));
    this.yaw = Math.atan2(d[0], -d[2]);
  }
  home(outer = false, animate = false) {
    this.stop();
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
    this.followId = null;
    this.previousTarget = null;
    this.transition = null;
  }
  stop() {
    this.motion = [0, 0, 0];
    this.wheelMotion = 0;
  }
  followSurvivors(events, bodies) {
    let id = this.followId;
    for (const event of events) if (id === event.removed) id = event.survivor;
    if (id === this.followId) return;
    const body = bodies.find((b) => b.id === id);
    if (body) this.focus(body);
    else this.release();
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
      ["KeyQ", [0, 1, 0], -1],
      ["KeyE", [0, 1, 0], 1],
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
            b.radius * 0.0005,
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
        const r = b.radius + Math.max(1, b.radius * 0.0001),
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
        r = b.radius + Math.max(1, b.radius * 0.0001);
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
