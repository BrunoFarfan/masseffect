import { impactScenario } from "../src/impact-scenario.js";
import { fragmentImpact } from "../src/impacts.js";
import { initializeRotations } from "../src/rotation.js";
import { step, safeStep } from "../src/physics.js";

// Real solver work, including contact scans and axial updates; milliseconds.
for (const count of [4, 8, 16, 32, 64]) {
  const { bodies: inputs } = impactScenario();
  inputs.forEach((b, i) => (b.position = [(i ? 1 : -1) * b.radius, 0, 0]));
  initializeRotations(inputs);
  const bodies = fragmentImpact(...inputs, {
    bodyCount: 2,
    fragmentLimit: count,
  });
  const samples = [];
  for (let i = 0; i < 350; i++) {
    const start = performance.now();
    step(bodies, safeStep(bodies, 1), { fragmentLimit: count });
    if (i >= 50) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      requested: count,
      remaining: bodies.length,
      stepMedianMs: samples[150],
      stepP95Ms: samples[285],
      finite: bodies.every((b) =>
        [...b.position, ...b.velocity].every(Number.isFinite),
      ),
    }),
  );
}
