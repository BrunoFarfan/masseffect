// Import in the running local game from a browser evaluation, not Node.
// Deterministic staging/measurements; no production code imports this module.
export async function placeSurfaceCase({
  id = "moon",
  latitude = -43.31,
  longitude = -11.36,
  altitude = 15000,
  view = "horizon",
  sunlit = false,
} = {}) {
  const { inspectSandbox } = await import("../src/main.js");
  const { surfaceFrame } = await import("../src/surface-definition.js");
  const { add, mul, unit, sub, cross } = await import("../src/math.js");
  const { between } = await import("../src/rotation.js");
  const s = inspectSandbox(),
    b = s.sim.bodies.find((b) => b.id === id);
  if (!b) throw new Error(`No body ${id}`);
  s.pause();
  s.select(id);
  const frame = surfaceFrame(b, s.sim.time);
  const lat = (latitude * Math.PI) / 180,
    lon = (longitude * Math.PI) / 180;
  const radial =
    sunlit && b.kind !== "Star"
      ? unit(
          sub(s.sim.bodies.find((b) => b.kind === "Star").position, b.position),
        )
      : add(
          mul(frame.north, Math.sin(lat)),
          add(
            mul(frame.prime, Math.cos(lat) * Math.cos(lon)),
            mul(frame.east, Math.cos(lat) * Math.sin(lon)),
          ),
        );
  s.camera.release();
  s.camera.surfaceBlockedId = null;
  s.camera.followId = b.id;
  s.camera.previousTarget = [...b.position];
  s.camera.position = add(
    b.position,
    mul(radial, b.radius + Math.max(altitude, 50000)),
  );
  const start = performance.now();
  while (performance.now() - start < 15000) {
    s.renderer.surfaces.prepare(s.sim, s.camera, innerHeight);
    if (s.renderer.surfaces.state(b)?.level === "near") break;
    await new Promise(requestAnimationFrame);
  }
  // Complete LOD blending before measuring a fixed case.
  for (let i = 0; i < 65; i++) await new Promise(requestAnimationFrame);
  // A newly loaded body-fixed provider may have rebased the staging camera.
  // Sample the requested destination radial, just like the actual Visit flow.
  const terrainRadius = s.renderer.surfaces.radiusAt(
    b,
    add(b.position, mul(radial, b.radius + 60000)),
  );
  s.camera.position = add(b.position, mul(radial, terrainRadius + altitude));
  s.camera.frameRotation = between([0, 1, 0], radial);
  s.camera.leveling = null;
  const tangent = unit(cross(radial, frame.north));
  s.camera.lookAt(
    view === "disk" || view === "down"
      ? b.position
      : add(
          s.camera.position,
          mul(unit(add(tangent, mul(radial, -0.05))), b.radius),
        ),
  );
  s.camera.update(0, s.sim.bodies, new Set());
  if (s.camera.surface) s.camera.surface.blend = 1;
  return {
    id,
    latitude,
    longitude,
    altitude,
    view,
    loadMs: performance.now() - start,
    cache: s.renderer.surfaces.cache.stats(),
    gpu: s.renderer.terrain.stats(),
    shapeGpu: s.renderer.shapes.stats(),
  };
}

export async function measureSurfaceCase(frames = 120) {
  const { inspectSandbox } = await import("../src/main.js");
  const s = inspectSandbox(),
    intervals = [],
    draws = [];
  let last = performance.now();
  for (let i = 0; i < frames; i++) {
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    intervals.push(now - last);
    last = now;
  }
  const sorted = intervals.slice(5).sort((a, b) => a - b);
  return {
    frames,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxMs: sorted.at(-1),
    cache: s.renderer.surfaces.cache.stats(),
    gpu: s.renderer.terrain.stats(),
    shapeGpu: s.renderer.shapes.stats(),
    resourceBytes: performance
      .getEntriesByType("resource")
      .filter((r) => r.name.includes("assets/surfaces"))
      .reduce((n, r) => n + r.transferSize, 0),
  };
}
