// Cloudflare can prepend zone-managed crawler policy to production robots.txt.
// Verify the original suffix exactly; never ignore changes to other assets.
import assert from "node:assert/strict";

export const PUBLISHED_ASSET_PATH =
  /^(index\.html|style\.css|robots\.txt|sitemap\.xml|assets\/[a-z-]+\.(svg|png)|assets\/surfaces\/[a-z0-9_-]+(?:\.height)?\.(png|jpg|webp|bin|json)|assets\/surfaces\/(terrain64|color64)\/(index\.json|(earth|moon|mars)\/[0-9]+-[0-9]+\.(bin\.gz|jpg))|assets\/surfaces\/detail\/(index\.json|[a-z]+\/[a-z0-9_-]+\.(bin\.gz|jpg))|assets\/fonts\/(instrument-sans-variable\.ttf|OFL-Instrument-Sans\.txt)|src\/[a-z-]+\.js)$/;
export const LAZY_SURFACE_TILE_PATH =
  /^assets\/surfaces\/(?:(terrain64|color64)\/(earth|moon|mars)\/|detail\/[a-z]+\/)/;

// Check every tile against release metadata, but transfer only one of each
// projection/payload type per body during deployed smoke checks.
export function detailSmokeSamples(index, files) {
  assert.equal(index.schemaVersion, 1);
  assert.ok(index.bodies && Object.keys(index.bodies).length > 0);
  const samples = new Set();
  for (const [body, pack] of Object.entries(index.bodies)) {
    assert.match(body, /^[a-z]+$/);
    assert.ok(Array.isArray(pack.tiles) && pack.tiles.length > 0, body);
    const represented = new Set();
    for (const tile of pack.tiles) {
      for (const kind of ["color", "height"]) {
        const url = tile[`${kind}Url`];
        if (!url) continue;
        const file = url.slice(1);
        assert.ok(url.startsWith(`/assets/surfaces/detail/${body}/`), url);
        assert.match(file, PUBLISHED_ASSET_PATH);
        assert.match(tile[`${kind}Sha256`], /^[a-f0-9]{64}$/);
        assert.equal(files[file], tile[`${kind}Sha256`], file);
        const category = `${tile.pole || 0}:${kind}`;
        if (!represented.has(category)) {
          samples.add(file);
          represented.add(category);
        }
      }
    }
  }
  return [...samples];
}

export function originalAssetBytes(file, bytes, environment) {
  if (file !== "robots.txt" || environment !== "production") return bytes;
  const text = bytes.toString("utf8");
  const begin = text.indexOf("# BEGIN Cloudflare Managed content");
  const marker = "# END Cloudflare Managed Content\n\n";
  const end = text.indexOf(marker);
  if (begin >= 0 && end > begin)
    return Buffer.from(text.slice(end + marker.length));
  return bytes;
}

export function publishedAssetMime(file) {
  if (file.endsWith(".ttf")) return /font\/ttf/;
  return file.endsWith(".js")
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
                      : /text\/html/;
}
