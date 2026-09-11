// Presentation only: short-lived silhouettes bridge a topology change. Physics
// bodies have already collided; these copies never exert gravity or accept clicks.
// Durations are wall seconds, so even a fast simulation gets a readable handoff.
export class ImpactView {
  constructor() {
    this.effects = [];
  }
  clear() {
    this.effects = [];
  }
  capture(events) {
    for (const event of events) {
      if (!event.afterIds || !event.before) continue;
      // A same-frame chain shows only its final handoff, never stale intermediates.
      const ids = new Set(event.before.map((b) => b.id));
      this.effects = this.effects.filter(
        (e) => !e.afterIds.some((id) => ids.has(id)),
      );
      this.effects.push({ ...event, age: 0 });
    }
    this.effects = this.effects.slice(-12);
  }
  bodies(bodies, dt) {
    this.effects = this.effects.filter(
      (e) =>
        (e.age += Math.max(0, dt)) < 0.5 &&
        e.afterIds.every((id) => bodies.some((b) => b.id === id)),
    );
    const alpha = new Map(),
      ghosts = [];
    for (const e of this.effects) {
      const t = Math.min(1, e.age / 0.5),
        blend = t * t * (3 - 2 * t);
      const outputs = bodies.filter((b) => e.afterIds.includes(b.id)),
        mass = outputs.reduce((s, b) => s + b.mass, 0);
      const center = [0, 1, 2].map((k) =>
        outputs.reduce((s, b) => s + b.position[k] * (b.mass / mass), 0),
      );
      const oldMass = e.before.reduce((s, b) => s + b.mass, 0);
      const oldCenter = [0, 1, 2].map((k) =>
        e.before.reduce((s, b) => s + b.position[k] * (b.mass / oldMass), 0),
      );
      for (const b of outputs) alpha.set(b.id, blend);
      for (const b of e.before)
        ghosts.push({
          ...b,
          id: `ghost:${b.id}`,
          ghost: true,
          visualAlpha: 1 - blend,
          radius: b.radius * (1 - 0.2 * blend),
          position: b.position.map(
            (v, k) => center[k] + (v - oldCenter[k]) * (1 - 0.3 * blend),
          ),
        });
    }
    return [
      ...bodies.map((b) =>
        alpha.has(b.id) ? { ...b, visualAlpha: alpha.get(b.id) } : b,
      ),
      ...ghosts,
    ];
  }
}
