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
      "index.html",
      "release.json",
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
