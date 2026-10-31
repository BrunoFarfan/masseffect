// Sequential, bounded offline preparation; source downloads are opt-in.
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const mode = process.argv[2] || "--rebuild";
if (!["--rebuild", "--download"].includes(mode))
  throw new Error("Use --rebuild or --download");
const scripts = (await readdir(new URL(".", import.meta.url)))
  .filter(
    (name) =>
      /^prepare-.*-(surface|shape)\.mjs$/.test(name) ||
      name === "prepare-saturn-moons.mjs",
  )
  .sort();
try {
  // These appearance sources replace the old flat-color and browse fallbacks.
  // Rebuilds must verify them rather than silently reverting to those stages.
  const imagery = spawnSync(
    process.execPath,
    [new URL("prepare-map-imagery.mjs", import.meta.url).pathname, mode],
    { stdio: "inherit" },
  );
  if (imagery.status !== 0)
    throw new Error("Mapped appearance source preparation failed");
  for (const script of ["prepare-surfaces.mjs", ...scripts]) {
    const text = await readFile(new URL(script, import.meta.url), "utf8");
    const args =
      mode === "--download"
        ? [
            text.includes('"--download-pinned"')
              ? "--download-pinned"
              : "--download",
            "--rebuild",
          ]
        : ["--rebuild"];
    console.log(`Preparing ${script}`);
    const result = spawnSync(
      process.execPath,
      [new URL(script, import.meta.url).pathname, ...args],
      { stdio: "inherit" },
    );
    if (result.status !== 0)
      throw new Error(`${script} failed: ${result.status}`);
  }
  const levels = spawnSync(
    process.execPath,
    [new URL("prepare-map-levels.mjs", import.meta.url).pathname, "--rebuild"],
    { stdio: "inherit" },
  );
  if (levels.status !== 0) throw new Error("Global map levels failed");
} finally {
  // Keep the runnable manifest complete even if a local original is missing.
  await import("./assemble-surfaces.mjs");
}
