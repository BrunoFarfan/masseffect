import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS, createPlacedBody, randomPlacement } from "../src/presets.js";
import { SCENARIOS, createScenario } from "../src/scenarios.js";
import { G, safeStep, step } from "../src/physics.js";
import { sub, length, dot } from "../src/math.js";

const primary = () => ({
  id: "primary",
  mass: 1.98847e30,
  radius: 6.957e8,
  position: [3e10, -2e10, 1e10],
  velocity: [800, -400, 200],
});

test("placement uses two-body circular velocity in the requested plane and primary frame", () => {
  const star = primary(),
    distance = 2e10,
    inclination = 0.65;
  const placed = createPlacedBody({
    presetId: "sun",
    primary: star,
    distance,
    inclination,
    phase: 0.5,
  });
  const r = sub(placed.position, star.position),
    v = sub(placed.velocity, star.velocity);
  const planeNormal = [0, Math.cos(inclination), -Math.sin(inclination)];
  assert.ok(Math.abs(length(r) / distance - 1) < 1e-14);
  assert.ok(
    Math.abs(
      length(v) / Math.sqrt((G * (star.mass + placed.mass)) / distance) - 1,
    ) < 1e-14,
  );
  assert.ok(Math.abs(dot(r, v) / length(r) / length(v)) < 1e-14);
  assert.ok(Math.abs(dot(r, planeNormal) / length(r)) < 1e-14);
  assert.ok(Math.abs(dot(v, planeNormal) / length(v)) < 1e-14);
  assert.equal(placed.parentId, star.id);
  assert.deepEqual(
    createPlacedBody({
      presetId: "earth",
      primary: star,
      distance,
      speedMode: "stationary",
    }).velocity,
    star.velocity,
  );
  const randomA = createPlacedBody(
    { presetId: "earth", primary: star, distance, speedMode: "random" },
    () => 0.5,
  );
  const randomB = createPlacedBody(
    { presetId: "earth", primary: star, distance, speedMode: "random" },
    () => 0.5,
  );
  assert.deepEqual(randomA.velocity, randomB.velocity);
  assert.notEqual(randomA.id, randomB.id);
});

test("placement rejects overlaps, unknown choices and nonfinite input", () => {
  const base = { presetId: "earth", primary: primary(), distance: 2e10 };
  for (const changes of [
    { distance: 1 },
    { distance: Infinity },
    { distance: NaN },
    { inclination: NaN },
    { phase: Infinity },
    { speedMode: "teleport" },
    { presetId: "unknown" },
    { name: " " },
    { id: "primary" },
    { primary: { ...primary(), velocity: [0, NaN, 0] } },
  ])
    assert.throws(() => createPlacedBody({ ...base, ...changes }), Error);
  assert.throws(
    () => createPlacedBody({ ...base, speedMode: "random" }, () => NaN),
    /Random values/,
  );
  assert.throws(() => createScenario("unknown"), /known scenario/);
});

test("presets and scenarios provide fresh finite SI bodies without initial overlaps", () => {
  assert.equal(
    new Set(PRESETS.map((preset) => preset.id)).size,
    PRESETS.length,
  );
  for (const preset of PRESETS) {
    assert.ok(Number.isFinite(preset.mass) && preset.mass > 0);
    assert.ok(Number.isFinite(preset.radius) && preset.radius > 0);
    if (preset.kind === "Star")
      assert.ok(preset.luminosity > 0 && preset.effectiveTemperature > 0);
  }
  for (const scenario of SCENARIOS) {
    const first = createScenario(scenario.id),
      second = createScenario(scenario.id);
    assert.deepEqual(first, second);
    assert.notEqual(first.bodies, second.bodies);
    assert.equal(
      new Set(first.bodies.map((body) => body.id)).size,
      first.bodies.length,
    );
    const total = first.bodies.reduce((sum, body) => sum + body.mass, 0);
    for (let k = 0; k < 3; k++) {
      assert.ok(
        Math.abs(
          first.bodies.reduce(
            (sum, body) => sum + (body.position[k] * body.mass) / total,
            0,
          ),
        ) < 1e-4,
        scenario.id,
      );
      assert.ok(
        Math.abs(
          first.bodies.reduce(
            (sum, body) => sum + (body.velocity[k] * body.mass) / total,
            0,
          ),
        ) < 1e-9,
        scenario.id,
      );
    }
    first.bodies.forEach((body, index) => {
      assert.ok([...body.position, ...body.velocity].every(Number.isFinite));
      for (const other of first.bodies.slice(index + 1))
        assert.ok(
          length(sub(body.position, other.position)) >
            body.radius + other.radius,
          scenario.id,
        );
    });
    first.bodies[0].position[0] += 123;
    assert.notEqual(first.bodies[0].position[0], second.bodies[0].position[0]);
  }
});

test("binary initial conditions complete an orbit under ordinary gravity", () => {
  const { bodies } = createScenario("binary-stars"),
    initial = length(sub(bodies[0].position, bodies[1].position));
  const period =
    2 *
    Math.PI *
    Math.sqrt(initial ** 3 / (G * (bodies[0].mass + bodies[1].mass)));
  for (let time = 0; time < period; ) {
    const dt = safeStep(bodies);
    assert.equal(step(bodies, dt).length, 0);
    time += dt;
  }
  assert.ok(
    Math.abs(
      length(sub(bodies[0].position, bodies[1].position)) / initial - 1,
    ) < 1e-5,
  );
});
test("placement attempts sample fresh motion but repeated previews preserve the sampled state", () => {
  let value = 0;
  const rng = () => (++value * 0.13) % 1;
  const first = randomPlacement(rng),
    second = randomPlacement(rng);
  assert.notDeepEqual(first, second);
  const primary = {
    id: "primary",
    mass: 1.98847e30,
    radius: 6.957e8,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
  };
  const make = (state) => {
    let draw = 0;
    return createPlacedBody(
      {
        presetId: "earth",
        primary,
        distance: 1.5e11,
        phase: state.phase,
        speedMode: "random",
        id: "preview",
      },
      () => state.samples[draw++],
    );
  };
  assert.deepEqual(make(first), make(first));
  assert.notDeepEqual(make(first).velocity, make(second).velocity);
});
