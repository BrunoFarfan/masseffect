import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildSite } from "../scripts/build.mjs";

test("static build publishes only browser assets, hashes them and removes stale output", async () => {
  const temp = await mkdtemp(join(tmpdir(), "masseffect-build-"));
  try {
    const dist = join(temp, "dist");
    const first = await buildSite(dist);
    assert.equal(first.environment, "preview");
    assert.match(
      await readFile(join(dist, "_headers"), "utf8"),
      /X-Robots-Tag: noindex/,
    );
    assert.doesNotMatch(
      await readFile(join(dist, "_headers"), "utf8"),
      /cloudflareinsights/,
    );
    for (const [file, hash] of Object.entries(first.files)) {
      assert.equal(
        createHash("sha256")
          .update(await readFile(join(dist, file)))
          .digest("hex"),
        hash,
      );
    }
    assert.deepEqual((await readdir(dist)).sort(), [
      "_headers",
      "assets",
      "index.html",
      "release.json",
      "robots.txt",
      "sitemap.xml",
      "src",
      "style.css",
    ]);
    await writeFile(join(dist, "stale.txt"), "old deployment");
    const second = await buildSite(dist, "production");
    assert.deepEqual(second.files, first.files);
    assert.equal(second.revision, first.revision);
    assert.doesNotMatch(
      await readFile(join(dist, "_headers"), "utf8"),
      /noindex/,
    );
    assert.match(
      await readFile(join(dist, "_headers"), "utf8"),
      /script-src 'self' https:\/\/static\.cloudflareinsights\.com; connect-src 'self' https:\/\/cloudflareinsights\.com;/,
    );
    assert.ok(!(await readdir(dist)).includes("stale.txt"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("sharing metadata is static, canonical and points to full-size local images", async () => {
  const root = new URL("../", import.meta.url);
  const html = await readFile(new URL("index.html", root), "utf8");
  for (const property of [
    "og:type",
    "og:title",
    "og:description",
    "og:url",
    "og:image",
    "og:image:type",
    "og:image:width",
    "og:image:height",
    "og:image:alt",
  ])
    assert.ok(html.includes(`property="${property}"`), property);
  assert.match(html, /name="description"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(
    html,
    /rel="canonical" href="https:\/\/masseffect\.bruni\.to\/"/,
  );
  assert.match(
    html,
    /https:\/\/masseffect\.bruni\.to\/assets\/social-preview\.png/,
  );
  for (const [name, width, height] of [
    ["social-preview.png", 1200, 630],
    ["apple-touch-icon.png", 180, 180],
  ]) {
    const png = await readFile(new URL(`assets/${name}`, root));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.ok(png.length < 500000, "Sharing images stay lightweight");
  }
  assert.match(
    await readFile(new URL("sitemap.xml", root), "utf8"),
    /<loc>https:\/\/masseffect\.bruni\.to\/<\/loc>/,
  );
  assert.match(
    await readFile(new URL("robots.txt", root), "utf8"),
    /Sitemap: https:\/\/masseffect\.bruni\.to\/sitemap.xml/,
  );
});

test("build rejects unknown environments and unsafe output targets", async () => {
  const temp = await mkdtemp(join(tmpdir(), "masseffect-build-"));
  try {
    await assert.rejects(
      buildSite(join(temp, "dist"), "staging"),
      /Environment/,
    );
    await assert.rejects(buildSite(temp), /dedicated dist/);
    await symlink(temp, join(temp, "dist"));
    await assert.rejects(buildSite(join(temp, "dist")), /symlink/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
