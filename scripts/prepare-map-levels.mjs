// Maintain three small global fallbacks alongside the source-native tile packs.
import { readFile, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, ".."),
  assets = resolve(root, "assets/surfaces");
const bodies = [
  "earth",
  "moon",
  "mars",
  "mercury",
  "enceladus",
  "europa",
  "titan",
  "io",
  "ganymede",
  "callisto",
  "dione",
  "mimas",
  "tethys",
  "rhea",
  "iapetus",
];
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function fileHash(path) {
  const h = createHash("sha256");
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest("hex");
}
if (!process.argv.includes("--rebuild")) throw new Error("Use --rebuild");
const combinedPath = resolve(assets, "manifest.json"),
  combined = JSON.parse(await readFile(combinedPath, "utf8"));
for (const id of bodies) {
  const path = resolve(assets, `${id}-manifest.json`);
  const product = existsSync(path)
    ? JSON.parse(await readFile(path, "utf8"))
    : null;
  const body = product ? product.bodies?.[id] || product : combined.bodies[id];
  if (!body?.levels) throw new Error(`Missing body levels: ${id}`);
  const normalized = resolve(
    root,
    `output/surface-originals/${id}-normalized.tif`,
  );
  const metaPath = resolve(
    root,
    `output/surface-originals/${id}-normalized.json`,
  );
  if (
    [
      "mercury",
      "enceladus",
      "io",
      "titan",
      "dione",
      "mimas",
      "tethys",
    ].includes(id) &&
    (!existsSync(normalized) || !existsSync(metaPath))
  )
    throw new Error(
      `Missing required ${id} mapped appearance; prepare the pinned originals first`,
    );
  if (existsSync(normalized) && existsSync(metaPath)) {
    const source = JSON.parse(await readFile(metaPath, "utf8"));
    if ((await fileHash(normalized)) !== source.sha256)
      throw new Error(`Invalid ${id} normalized imagery`);
    const meta = await sharp(normalized, {
      limitInputPixels: false,
    }).metadata();
    for (const [name, requested] of [
      ["preview", 512],
      ["medium", 1024],
      ["near", 2048],
    ]) {
      const entry = body.levels[name],
        width = Math.min(requested, meta.width),
        height = Math.round(width / 2);
      const output = resolve(assets, `${id}-${name}.jpg`);
      await sharp(normalized, { limitInputPixels: false })
        .resize(width, height, { fit: "fill", withoutEnlargement: true })
        .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
        .toFile(output);
      Object.assign(entry, {
        color: `/assets/surfaces/${id}-${name}.jpg`,
        width,
        height,
        colorSha256: hash(await readFile(output)),
      });
      delete entry.colorKind;
    }
    body.colorType =
      "Mapped spacecraft imagery; see pinned source and display processing";
    body.provenance ||= {};
    body.provenance.imagery = source;
  }
  const preview = body.levels.preview;
  if (!preview.heightUrl) {
    const source = body.levels.medium;
    if (source?.heightUrl) {
      const bytes = await readFile(resolve(root, source.heightUrl.slice(1)));
      const width = Math.min(512, source.heightWidth),
        height = Math.min(256, source.heightHeight);
      if (bytes.length !== source.heightWidth * source.heightHeight * 2)
        throw new Error(`Invalid ${id} base DEM`);
      const output = Buffer.alloc(width * height * 2);
      let min = Infinity,
        max = -Infinity;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const sx = Math.min(
            source.heightWidth - 1,
            Math.floor(((x + 0.5) * source.heightWidth) / width),
          );
          const sy = Math.min(
            source.heightHeight - 1,
            Math.floor(((y + 0.5) * source.heightHeight) / height),
          );
          const sample = bytes.readUInt16LE((sy * source.heightWidth + sx) * 2);
          output.writeUInt16LE(sample, (y * width + x) * 2);
          const h =
            source.heightOffsetMeters + sample * source.heightScaleMeters;
          min = Math.min(min, h);
          max = Math.max(max, h);
        }
      const file = `${id}-preview.height.bin`;
      await writeFile(resolve(assets, file), output);
      Object.assign(preview, {
        heightUrl: `/assets/surfaces/${file}`,
        heightWidth: width,
        heightHeight: height,
        heightSha256: hash(output),
        heightOffsetMeters: source.heightOffsetMeters,
        heightScaleMeters: source.heightScaleMeters,
        minElevationMeters: min,
        maxElevationMeters: max,
      });
    }
  }
  if (product) await writeFile(path, JSON.stringify(product, null, 2) + "\n");
  combined.bodies[id] = body;
}
await writeFile(combinedPath, JSON.stringify(combined, null, 2) + "\n");
console.log("Prepared three global imagery/elevation fallback levels");
