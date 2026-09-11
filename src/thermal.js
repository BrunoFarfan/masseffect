const SIGMA = 5.670374419e-8; // Stefan-Boltzmann constant, W m^-2 K^-4.

// Uniform reradiation over a sphere: absorbed disk area / emitting area = 1/4.
// Radiative equilibrium only: no atmosphere, greenhouse effect, thermal inertia,
// tidal/internal heat, eclipses or cosmic background. This is not surface weather.
// NASA context: https://sunclimate.gsfc.nasa.gov/science
export function equilibriumTemperature(body, bodies) {
  const finitePosition = (value) =>
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  if (!finitePosition(body.position)) return 0;
  const albedo = Number.isFinite(body.albedo)
    ? Math.max(0, Math.min(1, body.albedo))
    : 0.3;
  if (albedo === 1) return 0;
  let flux = 0;
  for (const star of bodies) {
    if (
      star === body ||
      (body.id !== undefined && star.id === body.id) ||
      star.kind !== "Star" ||
      !Number.isFinite(star.luminosity) ||
      star.luminosity <= 0 ||
      !finitePosition(star.position)
    )
      continue;
    const radius = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
    const distance = Math.max(
      1,
      radius(star.radius) + radius(body.radius),
      Math.hypot(
        ...star.position.map((value, axis) => value - body.position[axis]),
      ),
    );
    flux += star.luminosity / (4 * Math.PI * distance ** 2);
  }
  return Math.pow(((1 - albedo) * flux) / (4 * SIGMA), 0.25);
}

// Restrained display-color approximation to the warm -> white -> blue blackbody
// sequence. Palette interpolation is qualitative, not a spectrophotometric model.
// https://science.nasa.gov/universe/stars/types/
export function stellarColor(tempK) {
  const stops = [
    [1000, [255, 151, 99]],
    [3000, [255, 191, 151]],
    [5772, [255, 239, 215]],
    [10000, [211, 225, 255]],
    [40000, [173, 199, 255]],
  ];
  const temperature = Number.isFinite(tempK)
    ? Math.max(1000, Math.min(40000, tempK))
    : 5772;
  let index = 1;
  while (index < stops.length - 1 && temperature > stops[index][0]) index++;
  const [low, a] = stops[index - 1],
    [high, b] = stops[index];
  const blend =
    (Math.log(temperature) - Math.log(low)) / (Math.log(high) - Math.log(low));
  return (
    "#" +
    a
      .map((channel, i) =>
        Math.round(channel + (b[i] - channel) * blend)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
