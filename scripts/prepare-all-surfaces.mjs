// Sequential, bounded offline preparation; source downloads are opt-in.
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const mode = process.argv[2] || "--rebuild";
if (!["--rebuild", "--download"].includes(mode))
  throw new Error("Use --rebuild or --download");
const scripts = (await readdir(new URL(".", import.meta.url)))
  .filter((name) => /^prepare-.*-(surface|shape)\.mjs$/.test(name))
  .sort();
try {
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
} finally {
  // Keep the runnable manifest complete even if a local original is missing.
  await import("./assemble-surfaces.mjs");
}
