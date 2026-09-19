import { performance } from "node:perf_hooks";
import { intersectTerrain } from "../src/surface-ray.js";

// Analytic synthetic terrain isolates per-ray cost before selecting a backend.
// It is not shipped as a scientific lunar elevation product.
const radius = 1737400;
const height = (x, y, z) =>
  2000 * Math.sin(Math.atan2(z, x) * 30) * Math.cos(Math.asin(y) * 24);
for (const width of [320, 480, 960]) {
  const heightPixels = Math.round(width * 0.625);
  const samples = [];
  let hits = 0;
  for (let frame = 0; frame < 4; frame++) {
    const start = performance.now();
    for (let y = 0; y < heightPixels; y++)
      for (let x = 0; x < width; x++) {
        const ray = [
          (x - width / 2) / heightPixels,
          (heightPixels / 2 - y) / heightPixels,
          -1,
        ];
        if (
          intersectTerrain(
            [0, 0, radius + 15000],
            ray,
            radius,
            -2000,
            2000,
            height,
            { slopeBound: 1, tolerance: 1 },
          )
        )
          hits++;
      }
    samples.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      width,
      height: heightPixels,
      intersectionOnlyMs: samples.slice(1),
      hits,
    }),
  );
}
