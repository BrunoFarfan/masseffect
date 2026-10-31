// Source verification and explicit georeferencing for the new appearance maps.
// Outputs remain ignored scientific working files, consumed by the tile builder.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import sharp from "sharp";
import { fromFile } from "geotiff";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, "output/surface-originals");
sharp.cache({ memory: 96 });
sharp.concurrency(2);
const sources = {
  mercury: {
    file: "mercury-mosaic-250m.tif",
    sha256: "720938d9a403803b016e88d22d58cddbbf4fe8cb99f652c90f19b5a1bc946c76",
    url: "https://planetarymaps.usgs.gov/mosaic/Mercury_MESSENGER_mosaic_global_250m_2013.tif",
    width: 61324,
    height: 30662,
    center: 0,
    west: false,
    citation:
      "NASA MESSENGER MDIS / USGS global monochrome mosaic, May 2013, 250 m pixels",
  },
  enceladus: {
    file: "enceladus-mosaic-100m.tif",
    sha256: "1738c5cf8e856c7ae262d858261af0fbb32503a68a524884d36194afb23afcc5",
    url: "https://asc-astropedia.s3.us-west-2.amazonaws.com/Enceladus/Cassini/Enceladus_Cassini_mosaic_global_100m_schenk2024.tif",
    width: 16098,
    height: 8049,
    center: 180,
    west: false,
    citation:
      "Schenk and McKinnon (2024), Cassini ISS global mosaic, 100 m pixels; DOI 10.1016/j.icarus.2023.115827",
  },
  io: {
    file: "io-usgs-color-1km.tif",
    sha256: "135f88cb645bfdb4e045b380971ab2ba14e230590c96c9c86cfe7310fda881ac",
    url: "https://planetarymaps.usgs.gov/mosaic/Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif",
    width: 11445,
    height: 5723,
    center: 0,
    west: true,
    citation:
      "NASA Galileo SSI / Voyager, USGS color-merged mosaic, 1 km grid; source detail varies 1–10 km, false color and baked illumination",
  },
  titan: {
    file: "titan-2026-global.png",
    sha256: "5b17af4c230f5f2434497d77621dbe6503458ac15d54557a946c1e1ca9562cb2",
    url: "https://www.sciencebase.gov/catalog/file/get/68a5107ad4be02198e361c35?f=__disk__40%2Ffc%2F6b%2F40fc6b3d12f9356149245c46522fc4aca6cb9d5f",
    labelFile: "titan-2026-global.lbl",
    labelUrl:
      "https://www.sciencebase.gov/catalog/file/get/68a5107ad4be02198e361c35?f=__disk__d5%2F4a%2F74%2Fd54a743860579c91705ea68578005e7b5caf8bbe",
    labelSha256:
      "77b1bf7c39ab7428b8e61b1dde12bbe9e9a9870ae644ed5ce03516680e2741f0",
    width: 23048,
    height: 11524,
    center: 180,
    west: false,
    citation:
      "Weller et al., USGS 2026 controlled Titan ISS 938 nm global mosaic, 702 m; DOI 10.5066/P14FAEKS. Full-resolution PNG display derivative; sharpening baked into source, not true RGB/albedo.",
  },
};
async function checksum(path) {
  const hash = createHash("sha256");
  for await (const b of createReadStream(path)) hash.update(b);
  return hash.digest("hex");
}
const wrap = (x, n) => ((x % n) + n) % n;
async function prepare(body, download) {
  const source = sources[body];
  if (!source) throw new Error(`Unknown imagery body: ${body}`);
  const input = resolve(dir, source.file);
  if (download && !existsSync(input)) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${body} download ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(input));
  }
  if ((await checksum(input)) !== source.sha256)
    throw new Error(`${body} imagery checksum mismatch`);
  let geo,
    stretch = null;
  if (source.labelFile) {
    const label = resolve(dir, source.labelFile);
    if (download && !existsSync(label)) {
      const response = await fetch(source.labelUrl);
      if (!response.ok) throw new Error(`${body} label ${response.status}`);
      await writeFile(label, await response.text());
    }
    if ((await checksum(label)) !== source.labelSha256)
      throw new Error(`${body} label checksum mismatch`);
    const metadata = await sharp(input, { limitInputPixels: false }).metadata();
    if (metadata.width !== source.width || metadata.height !== source.height)
      throw new Error(`${body} appearance dimensions mismatch`);
    geo = {
      origin: [-8089848, 4044924, 0],
      resolution: [702, -702, 0],
      keys: {
        ProjCoordTransGeoKey: 17,
        ProjCenterLongGeoKey: 180,
        GeogSemiMajorAxisGeoKey: 2575000,
      },
    };
  } else {
    const tiff = await fromFile(input);
    try {
      const image = await tiff.getImage();
      const keys = image.getGeoKeys(),
        origin = image.getOrigin(),
        resolution = image.getResolution();
      if (
        image.getWidth() !== source.width ||
        image.getHeight() !== source.height ||
        keys.ProjCoordTransGeoKey !== 17 ||
        keys.ProjCenterLongGeoKey !== source.center ||
        resolution[0] <= 0 ||
        resolution[1] >= 0
      )
        throw new Error(`Unexpected ${body} image georeferencing`);
      geo = { origin, resolution, keys };
      if (body === "enceladus") {
        const sample = await image.readRasters({
          width: 256,
          height: 128,
          samples: [0],
          interleave: true,
        });
        const values = Array.from(sample)
          .filter((v) => Number.isFinite(v) && v > 0)
          .sort((a, b) => a - b);
        stretch = [
          values[Math.floor(values.length * 0.005)],
          values[Math.floor(values.length * 0.995)],
        ];
        if (!(stretch[1] > stretch[0]))
          throw new Error("Invalid Enceladus display range");
      }
    } finally {
      await tiff.close();
    }
  }
  const width = Math.min(23040, source.width - (source.width % 2)),
    height = width / 2;
  let image = sharp(input, { limitInputPixels: false }).removeAlpha();
  if (stretch)
    image = image.linear(
      255 / (stretch[1] - stretch[0]),
      (-stretch[0] * 255) / (stretch[1] - stretch[0]),
    );
  if (body !== "io") image = image.toColourspace("b-w");
  const { data, info } = await image
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(data.length),
    channels = info.channels;
  const radius = geo.keys.GeogSemiMajorAxisGeoKey;
  for (let y = 0; y < height; y++) {
    const latitude = ((90 - ((y + 0.5) * 180) / height) * Math.PI) / 180;
    const sy = Math.max(
      0,
      Math.min(
        height - 1,
        (((radius * latitude - geo.origin[1]) / geo.resolution[1]) * height) /
          source.height -
          0.5,
      ),
    );
    const y0 = Math.floor(sy),
      fy = sy - y0,
      y1 = Math.min(height - 1, y0 + 1);
    for (let x = 0; x < width; x++) {
      const longitude =
        (-180 + ((x + 0.5) * 360) / width) * (source.west ? -1 : 1);
      const delta = wrap(longitude - source.center + 180, 360) - 180;
      const sx =
        ((((radius * delta * Math.PI) / 180 - geo.origin[0]) /
          geo.resolution[0]) *
          width) /
          source.width -
        0.5;
      const floor = Math.floor(sx),
        fx = sx - floor,
        x0 = wrap(floor, width),
        x1 = wrap(floor + 1, width);
      for (let c = 0; c < channels; c++) {
        const a = data[(y0 * width + x0) * channels + c],
          b = data[(y0 * width + x1) * channels + c];
        const d = data[(y1 * width + x0) * channels + c],
          e = data[(y1 * width + x1) * channels + c];
        output[(y * width + x) * channels + c] = Math.round(
          (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy,
        );
      }
    }
  }
  const path = resolve(dir, `${body}-normalized.tif`);
  await sharp(output, { raw: { width, height, channels } })
    .tiff({ compression: "lzw", tile: true })
    .toFile(path);
  const metadata = {
    sha256: await checksum(path),
    width,
    height,
    source: { ...source, bytes: (await stat(input)).size },
    georeferencing: geo,
    displayStretch: stretch,
    normalization:
      "Pixel-centered planetocentric east-positive -180..180 north-up; source GeoTIFF origin/resolution and label longitude direction explicitly sampled; no height inferred. Source grid is downsampled at most to 64 ppd; display contrast is not calibrated albedo.",
  };
  await writeFile(
    resolve(dir, `${body}-normalized.json`),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  console.log(`Normalized ${body} imagery ${width}x${height}`);
}
await mkdir(dir, { recursive: true });
const args = process.argv.slice(2);
if (!args.some((arg) => ["--rebuild", "--download"].includes(arg)))
  throw new Error("Use --rebuild or --download [body]");
const body = args.find((arg) => !arg.startsWith("--"));
for (const id of body ? [body] : Object.keys(sources))
  await prepare(id, args.includes("--download"));
