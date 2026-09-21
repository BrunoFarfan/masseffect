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
    /^(index\.html|style\.css|robots\.txt|sitemap\.xml|assets\/[a-z-]+\.(svg|png)|assets\/surfaces\/[a-z0-9_-]+(?:\.height)?\.(png|jpg|webp|bin|json)|assets\/surfaces\/(terrain64|color64)\/(index\.json|(earth|moon|mars)\/[0-9]+-[0-9]+\.(bin\.gz|jpg))|src\/[a-z-]+\.js)$/,
  );
  // The indexes cover every tile's checksum. Fetch representative tiles below
  // rather than transferring the entire 1+ GB pack in every smoke run.
  if (
    /^assets\/surfaces\/(terrain64|color64)\/(earth|moon|mars)\//.test(file)
  )
    continue;
  const asset = await get(`/${file}`);
  assert.equal(asset.status, 200, file);
  assert.match(
    asset.headers.get("content-type"),
    file.endsWith(".js")
      ? /javascript/
      : file.endsWith(".css")
        ? /text\/css/
        : file.endsWith(".json")
          ? /application\/json/
          : file.endsWith(".bin")
            ? /application\/octet-stream/
            : file.endsWith(".jpg")
              ? /image\/jpeg/
              : file.endsWith(".webp")
                ? /image\/webp/
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
for (const pack of ["terrain64", "color64"]) {
  const index = await (await get(`/assets/surfaces/${pack}/index.json`)).json();
  assert.deepEqual(Object.keys(index.bodies).sort(), ["earth", "mars", "moon"]);
  for (const [body, grid] of Object.entries(index.bodies)) {
    assert.equal(Object.keys(grid.tileSha256).length, 276);
    for (const [name, hash] of Object.entries(grid.tileSha256))
      assert.equal(release.files[`assets/surfaces/${pack}/${body}/${name}`], hash);
    for (const name of ["0-0", "5-11", "11-22"]) {
      const file = `assets/surfaces/${pack}/${body}/${name}.${pack === "terrain64" ? "bin.gz" : "jpg"}`;
      const asset = await get(`/${file}`);
      assert.equal(asset.status, 200, file);
      assert.match(
        asset.headers.get("content-type"),
        pack === "terrain64" ? /gzip|octet-stream/ : /image\/jpeg/,
      );
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(await asset.arrayBuffer()))
          .digest("hex"),
        release.files[file],
        file,
      );
    }
  }
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
