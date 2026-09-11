import test from "node:test";
import assert from "node:assert/strict";
import { equilibriumTemperature, stellarColor } from "../src/thermal.js";

const earth = () => ({
  id: "earth",
  kind: "Planet",
  radius: 6.371e6,
  position: [1.495978707e11, 0, 0],
  albedo: 0.3,
});
const sun = () => ({
  id: "sun",
  kind: "Star",
  radius: 6.957e8,
  position: [0, 0, 0],
  luminosity: 3.828e26,
});

test("Earth-Sun radiative equilibrium is approximately 255 K", () => {
  const planet = earth(),
    star = sun();
  const temperature = equilibriumTemperature(planet, [planet, star]);
  assert.ok(Math.abs(temperature - 254.58) < 0.2);
  delete planet.albedo;
  assert.equal(equilibriumTemperature(planet, [star]), temperature);
});

test("stellar fluxes add and temperature follows inverse square root distance", () => {
  const planet = earth(),
    star = sun(),
    initial = equilibriumTemperature(planet, [star]);
  assert.ok(
    Math.abs(
      equilibriumTemperature(planet, [star, { ...sun(), id: "second" }]) /
        initial -
        2 ** 0.25,
    ) < 1e-12,
  );
  planet.position[0] *= 4;
  assert.ok(
    Math.abs(equilibriumTemperature(planet, [star]) / initial - 0.5) < 1e-12,
  );
});

test("thermal model excludes self, handles no stars, bounds albedo and guards contact", () => {
  const planet = earth(),
    star = sun();
  assert.equal(equilibriumTemperature(planet, []), 0);
  assert.equal(equilibriumTemperature(star, [star]), 0);
  assert.equal(
    equilibriumTemperature(planet, [{ ...star, luminosity: NaN }]),
    0,
  );
  planet.albedo = 2;
  assert.equal(equilibriumTemperature(planet, [star]), 0);
  planet.albedo = -1;
  const black = equilibriumTemperature(planet, [star]);
  planet.albedo = 0;
  assert.equal(equilibriumTemperature(planet, [star]), black);
  planet.position = [0, 0, 0];
  const touching = equilibriumTemperature(planet, [star]);
  assert.ok(Number.isFinite(touching) && touching > 0);
  planet.position[0] = star.radius + planet.radius;
  assert.equal(equilibriumTemperature(planet, [star]), touching);
});

test("stellar display colors remain valid with warm and cool trends", () => {
  const channels = (color) =>
    color
      .slice(1)
      .match(/../g)
      .map((pair) => parseInt(pair, 16));
  for (const temperature of [
    -1,
    0,
    1000,
    3000,
    5772,
    10000,
    40000,
    Infinity,
    NaN,
  ])
    assert.match(stellarColor(temperature), /^#[0-9a-f]{6}$/);
  const warm = channels(stellarColor(3000)),
    cool = channels(stellarColor(20000));
  assert.ok(warm[0] > warm[2]);
  assert.ok(cool[2] > cool[0]);
});
