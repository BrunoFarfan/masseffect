import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Explicit public-file allowlist: never upload the repository root or QA output.
export async function buildSite(destination, environment = "preview") {
  if (!["preview", "production"].includes(environment))
    throw new Error("Environment must be preview or production");
  destination = resolve(destination);
  if (basename(destination) !== "dist")
    throw new Error("Build destination must be a dedicated dist directory");
  const existing = await lstat(destination).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (existing?.isSymbolicLink() || (existing && !existing.isDirectory()))
    throw new Error("Refusing a symlink or non-directory build destination");
  const modules = (await readdir(resolve(root, "src")))
    .filter((name) => name.endsWith(".js"))
    .sort();
  const files = [
    "index.html",
    "style.css",
    "robots.txt",
    "sitemap.xml",
    "assets/favicon.svg",
    "assets/fonts/instrument-sans-variable.ttf",
    "assets/fonts/OFL-Instrument-Sans.txt",
    "assets/apple-touch-icon.png",
    "assets/social-preview.png",
    ...modules.map((name) => `src/${name}`),
  ];
  // Only prepared, manifest-listed surface products are publishable. Scientific
  // originals and benchmark captures remain outside this explicit allowlist.
  const surfaceManifest = JSON.parse(
    await readFile(resolve(root, "assets/surfaces/manifest.json"), "utf8"),
  );
  files.push("assets/surfaces/manifest.json");
  const surfaceFiles = new Set();
  for (const body of Object.values(surfaceManifest.bodies)) {
    for (const level of Object.values(body.levels || {})) {
      for (const path of [
        level.color,
        level.heightUrl,
        level.region?.heightUrl,
        ...(level.regions || []).map((region) => region.heightUrl),
        level.geometry,
      ]) {
        if (!path) continue;
        if (
          !/^\/assets\/surfaces\/[a-z0-9_-]+(?:\.height)?\.(png|jpg|webp|bin|json)$/.test(
            path,
          )
        )
          throw new Error(`Invalid prepared surface path: ${path}`);
        surfaceFiles.add(path.slice(1));
      }
    }
  }
  files.push(...[...surfaceFiles].sort());
  // Publish only prepared tiles named by the provenance indexes. Scientific
  // originals and arbitrary files under assets/surfaces remain excluded.
  for (const pack of ["terrain64", "color64"]) {
    const indexPath = `assets/surfaces/${pack}/index.json`;
    const index = JSON.parse(await readFile(resolve(root, indexPath), "utf8"));
    if (
      index.schemaVersion !== 1 ||
      Object.keys(index.bodies || {})
        .sort()
        .join(",") !== "earth,mars,moon"
    )
      throw new Error(`Invalid ${pack} index`);
    files.push(indexPath);
    for (const [body, grid] of Object.entries(index.bodies)) {
      if (
        grid.baseUrl !== `/assets/surfaces/${pack}/${body}` ||
        grid.tileCount !== 276 ||
        Object.keys(grid.tileSha256 || {}).length !== grid.tileCount
      )
        throw new Error(`Invalid ${pack} grid: ${body}`);
      for (const name of Object.keys(grid.tileSha256)) {
        if (
          !/^(?:[0-9]|1[01])-(?:[0-9]|1[0-9]|2[0-2])\.(?:bin\.gz|jpg)$/.test(
            name,
          ) ||
          !name.endsWith(pack === "terrain64" ? ".bin.gz" : ".jpg")
        )
          throw new Error(`Invalid ${pack} tile: ${name}`);
        files.push(`assets/surfaces/${pack}/${body}/${name}`);
      }
    }
  }
  // Detailed maps have source-dependent dimensions and separate polar tiles.
  // Only checked, indexed assets can enter the public build.
  const detailIndexPath = "assets/surfaces/detail/index.json";
  const detailIndex = JSON.parse(
    await readFile(resolve(root, detailIndexPath), "utf8"),
  );
  if (detailIndex.schemaVersion !== 1 || !detailIndex.bodies)
    throw new Error("Invalid detailed surface index");
  files.push(detailIndexPath);
  for (const [body, grid] of Object.entries(detailIndex.bodies)) {
    if (
      !/^[a-z]+$/.test(body) ||
      !surfaceManifest.bodies[body] ||
      !Array.isArray(grid.tiles)
    )
      throw new Error(`Invalid detailed surface body: ${body}`);
    const ids = new Set();
    for (const tile of grid.tiles) {
      if (!tile.id || ids.has(tile.id))
        throw new Error(`Duplicate detail tile: ${body}/${tile.id}`);
      ids.add(tile.id);
      for (const [key, suffix] of [
        ["colorUrl", "jpg"],
        ["heightUrl", "bin.gz"],
      ]) {
        const path = tile[key];
        if (!path) continue;
        if (
          !new RegExp(
            `^/assets/surfaces/detail/${body}/[a-z0-9_-]+\\.${suffix.replaceAll(".", "\\.")}$`,
          ).test(path)
        )
          throw new Error(`Invalid detail tile path: ${path}`);
        surfaceFiles.add(path.slice(1));
      }
    }
  }
  files.push(
    ...[...surfaceFiles].filter((file) => !files.includes(file)).sort(),
  );
  for (const file of files)
    if (!(await lstat(resolve(root, file))).isFile())
      throw new Error(`Public source must be a regular file: ${file}`);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  // Only this generated output is replaced; source and local QA artifacts stay intact.
  await rm(destination, { recursive: true, force: true });
  await mkdir(resolve(destination, "src"), { recursive: true });
  await mkdir(resolve(destination, "assets"), { recursive: true });
  await mkdir(resolve(destination, "assets/surfaces"), { recursive: true });
  const hashes = {};
  for (const file of files) {
    await mkdir(dirname(resolve(destination, file)), { recursive: true });
    await cp(resolve(root, file), resolve(destination, file));
    hashes[file] = createHash("sha256")
      .update(await readFile(resolve(destination, file)))
      .digest("hex");
  }
  await writeFile(
    resolve(destination, "release.json"),
    JSON.stringify({ revision, environment, files: hashes }, null, 2) + "\n",
  );
  await writeFile(
    resolve(destination, "_headers"),
    [
      "/*",
      "  X-Content-Type-Options: nosniff",
      "  Referrer-Policy: strict-origin-when-cross-origin",
      "  X-Frame-Options: DENY",
      "  Cache-Control: public, max-age=0, must-revalidate",
      // bruni.to injects Cloudflare Web Analytics at the edge for browser requests.
      // Permit its two documented origins in production, not arbitrary scripts.
      `  Content-Security-Policy: default-src 'self'; script-src 'self'${environment === "production" ? " https://static.cloudflareinsights.com" : ""}; connect-src 'self'${environment === "production" ? " https://cloudflareinsights.com" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
      ...(environment === "preview"
        ? ["  X-Robots-Tag: noindex, nofollow"]
        : []),
      "",
    ].join("\n"),
  );
  return { revision, environment, files: hashes };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await buildSite(resolve(root, "dist"), process.argv[2]);
  console.log(
    `Built ${Object.keys(result.files).length} public files for ${result.environment} (${result.revision.slice(0, 7)})`,
  );
}
