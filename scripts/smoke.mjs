import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { originalAssetBytes } from "./published-asset.mjs";

const [base, environment = "preview", revision] = process.argv.slice(2);
assert.ok(base, "Usage: smoke.mjs <url> <preview|production> [revision]");
const origin = new URL(base);
assert.equal(origin.protocol, "https:", "Smoke tests target HTTPS deployments");
assert.ok(["preview", "production"].includes(environment));
async function get(path) {
  return fetch(new URL(path, origin), {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
}
const response = await get("/release.json");
assert.equal(response.status, 200, "Release metadata must be available");
const release = await response.json();
assert.equal(release.environment, environment);
if (revision)
  assert.equal(release.revision, revision, "Deployed revision mismatch");
assert.match(release.revision, /^[a-f0-9]{40}$/);
assert.ok(Object.keys(release.files).length >= 3);
for (const [file, hash] of Object.entries(release.files)) {
  assert.match(
    file,
    /^(index\.html|style\.css|robots\.txt|sitemap\.xml|assets\/[a-z-]+\.(svg|png)|src\/[a-z-]+\.js)$/,
  );
  const asset = await get(`/${file}`);
  assert.equal(asset.status, 200, file);
  assert.match(
    asset.headers.get("content-type"),
    file.endsWith(".js")
      ? /javascript/
      : file.endsWith(".css")
        ? /text\/css/
        : file.endsWith(".png")
          ? /image\/png/
          : file.endsWith(".svg")
            ? /image\/svg\+xml/
            : file.endsWith(".txt")
              ? /text\/plain/
              : file.endsWith(".xml")
                ? /(?:application|text)\/xml/
                : /text\/html/,
  );
  assert.equal(
    createHash("sha256")
      .update(
        originalAssetBytes(
          file,
          Buffer.from(await asset.arrayBuffer()),
          environment,
        ),
      )
      .digest("hex"),
    hash,
    file,
  );
}
const home = await get("/");
assert.equal(home.status, 200);
const html = await home.text();
assert.match(html, /Mass Effect — orbital sandbox/);
assert.match(html, /rel="canonical" href="https:\/\/masseffect\.bruni\.to\/"/);
assert.match(html, /property="og:image"/);
assert.match(html, /name="twitter:card" content="summary_large_image"/);
assert.match(
  html,
  /https:\/\/masseffect\.bruni\.to\/assets\/social-preview\.png/,
);
assert.equal(home.headers.get("x-content-type-options"), "nosniff");
assert.match(home.headers.get("content-security-policy"), /script-src 'self'/);
if (environment === "production")
  assert.match(
    home.headers.get("content-security-policy"),
    /https:\/\/static\.cloudflareinsights\.com; connect-src 'self' https:\/\/cloudflareinsights\.com;/,
  );
if (environment === "preview")
  assert.match(home.headers.get("x-robots-tag"), /noindex/);
else assert.equal(home.headers.get("x-robots-tag"), null);
for (const path of [
  "/package.json",
  "/README.md",
  "/scripts/serve.mjs",
  "/tests/physics.test.mjs",
  "/missing-module.js",
])
  assert.equal((await get(path)).status, 404, `${path} must not be published`);
console.log(
  `Verified ${environment} ${release.revision}: ${Object.keys(release.files).length} asset hashes, MIME types, security headers and private-file exclusions at ${origin.origin}`,
);
