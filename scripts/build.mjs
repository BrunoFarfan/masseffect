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
import { basename, resolve } from "node:path";
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
    "assets/apple-touch-icon.png",
    "assets/social-preview.png",
    ...modules.map((name) => `src/${name}`),
  ];
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
  const hashes = {};
  for (const file of files) {
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
