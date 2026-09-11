import { safeStep, step } from "./physics.js";

// Recorded SI states, not negative-time integration: inelastic collisions cannot
// be physically reversed by the forward solver. Trails/render caches are omitted.
const FIELDS = [
  "id",
  "name",
  "kind",
  "parentId",
  "mass",
  "radius",
  "color",
  "luminosity",
  "effectiveTemperature",
  "albedo",
  "trailInterval",
  "fragmentGeneration",
  "rotationModel",
  "rotationPeriod",
];
const MAX_SNAPSHOTS = 900;
const MAX_BODY_RECORDS = 32000;
const MAX_REPLAY_STEPS = 4096;

function cloneBody(body) {
  const result = {};
  for (const key of FIELDS)
    if (body[key] !== undefined) result[key] = body[key];
  result.position = [...body.position];
  result.velocity = [...body.velocity];
  if (body.orientation) result.orientation = [...body.orientation];
  if (body.angularVelocity) result.angularVelocity = [...body.angularVelocity];
  return result;
}

function snapshot(sim) {
  if (!Number.isFinite(sim.time) || !Array.isArray(sim.bodies))
    throw new Error(
      "History requires a finite simulation time and a body list.",
    );
  if (sim.bodies.length > MAX_BODY_RECORDS)
    throw new Error("There are too many bodies to record a history snapshot.");
  return { time: sim.time, bodies: sim.bodies.map(cloneBody) };
}

function compatible(a, b) {
  if (a.bodies.length !== b.bodies.length) return false;
  const later = new Map(b.bodies.map((body) => [body.id, body]));
  if (later.size !== b.bodies.length) return false;
  return a.bodies.every((body) => {
    const other = later.get(body.id);
    return other && FIELDS.every((key) => body[key] === other[key]);
  });
}

function reconstruct(before, target) {
  const restored = { time: before.time, bodies: before.bodies.map(cloneBody) };
  // Re-run ordinary forward physics from a known state. Linear interpolation
  // across a sparsely sampled moon orbit can cut through the parent planet.
  for (
    let count = 0;
    count < MAX_REPLAY_STEPS && restored.time < target;
    count++
  ) {
    const dt = Math.min(safeStep(restored.bodies), target - restored.time);
    if (!(dt > 0) || restored.time + dt <= restored.time) break;
    step(restored.bodies, dt);
    restored.time += dt;
  }
  // The cap reports the time actually reached, never a fabricated target time.
  return restored;
}

export class History {
  #snapshots = [];
  #bodyRecordCount = 0;
  #branchPoint = null;

  constructor(sim) {
    if (sim) this.clear(sim);
  }

  get oldestTime() {
    return this.#snapshots[0]?.time ?? 0;
  }
  get newestTime() {
    return this.#snapshots.at(-1)?.time ?? 0;
  }
  get snapshotCount() {
    return this.#snapshots.length;
  }
  get bodyRecordCount() {
    return this.#bodyRecordCount;
  }

  clear(sim) {
    this.#snapshots = [];
    this.#bodyRecordCount = 0;
    this.#branchPoint = null;
    if (sim) this.capture(sim);
  }

  #append(record) {
    // A changed state at the same time replaces that timestamp. This records
    // user edits/creation without inventing a zero-duration trajectory segment.
    while (this.#snapshots.length && this.#snapshots.at(-1).time >= record.time)
      this.#bodyRecordCount -= this.#snapshots.pop().bodies.length;
    this.#snapshots.push(record);
    this.#bodyRecordCount += record.bodies.length;
    this.#trim();
  }

  #trim(preservePast = false) {
    while (
      this.#snapshots.length > MAX_SNAPSHOTS ||
      this.#bodyRecordCount > MAX_BODY_RECORDS
    )
      this.#bodyRecordCount -= (
        preservePast ? this.#snapshots.pop() : this.#snapshots.shift()
      ).bodies.length;
  }

  capture(sim) {
    const record = snapshot(sim);
    if (this.#branchPoint) {
      // Resume branches from the actual reconstructed point, preserving
      // that point even when the next capture occurs after forward integration.
      this.#append(this.#branchPoint);
      this.#branchPoint = null;
    }
    this.#append(record);
  }

  rewind(sim, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new Error("Rewind duration must be a finite, nonnegative number.");
    return this.seek(sim, sim.time - seconds);
  }

  seek(sim, time) {
    if (!Number.isFinite(time))
      throw new Error("Recorded time must be finite.");
    if (!this.#snapshots.length) this.capture(sim);
    const target = Math.max(this.oldestTime, Math.min(this.newestTime, time));
    let index = this.#snapshots.length - 1;
    while (index > 0 && this.#snapshots[index].time > target) index--;
    const before = this.#snapshots[index],
      after = this.#snapshots[index + 1];
    const replay = after && target > before.time && compatible(before, after);
    const restored = replay ? reconstruct(before, target) : before;
    if (restored.time > before.time) {
      // Retain the exact reconstructed point for future rewinds and branching.
      // It participates in both memory caps, including while playback is paused.
      this.#snapshots.splice(index + 1, 0, restored);
      this.#bodyRecordCount += restored.bodies.length;
      // Rewinding must retain the oldest available past. The compatible later
      // snapshot has the same body count, so evicting future samples always
      // frees enough room before reaching this newly restored point.
      this.#trim(true);
    }
    this.#branchPoint = restored;
    // Across a creation/merge/metadata change, use the earlier recorded time as
    // well as its state. Never invent a continuous path through a body edit.
    sim.time = restored.time;
    sim.bodies = restored.bodies.map((body) => ({
      ...cloneBody(body),
      trail: [],
      relativeTrail: [],
      lastTrailTime: restored.time,
    }));
    sim.pending = 0;
    sim.events = [];
    sim.limited = false;
    return { atStart: restored.time <= this.oldestTime };
  }
}
