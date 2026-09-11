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
  focus(body) {
    const distance =
      body.id === "sun" ? 6.5e11 : Math.max(body.radius * 24, 1e5);
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
    this.followId = null;
    this.previousTarget = null;
    this.transition = null;
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
      ["w", this.forward, 1],
      ["s", this.forward, -1],
      ["a", this.right, -1],
      ["d", this.right, 1],
      ["q", [0, 1, 0], -1],
      ["e", [0, 1, 0], 1],
    ])
      if (keys.has(key)) direction = add(direction, mul(axis, sign));
    if (length(direction) > 0) {
      this.release();
      this.position = add(
        this.position,
        mul(
          unit(direction),
          this.speed(bodies) * dt * (keys.has("shift") ? 4 : 1),
        ),
      );
    }
  }
  speed(bodies) {
    return clamp(
      Math.min(
        ...bodies.map((b) =>
          Math.max(b.radius, length(sub(this.position, b.position)) - b.radius),
        ),
      ) * 0.6,
      1e6,
      3e13,
    );
  }
  travel(amount, bodies) {
    this.transition = null;
    this.position = add(
      this.position,
      mul(this.forward, amount * this.speed(bodies)),
    );
  }
  rotate(dx, dy) {
    this.transition = null;
    this.yaw -= dx * 0.004;
    this.pitch = clamp(
      this.pitch + dy * 0.004,
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
      if (depth < 1e4) return null;
      return {
        x:
          width / 2 +
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
