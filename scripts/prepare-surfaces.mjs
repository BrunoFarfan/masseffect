#!/usr/bin/env node
/** Build bounded, browser-ready planetary surface maps from verified originals.
 *
 * Originals live in output/surface-originals (ignored by git). This script is
 * intentionally offline by default: `--download` fetches the URLs below,
 * while `--rebuild` only reads the local originals and verifies their hashes.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const root = resolve(import.meta.dirname, "..");
const originalDir = resolve(root, "output/surface-originals");
const outputDir = resolve(root, "assets/surfaces");
const SOURCES = {
  moonRegionRows: {
    file: "tycho-lola64-rows.bin",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_64_uint.tif",
    sha256: "0939469ef9247e0f98c5a2107463882566b53f10fa8eba1e6aff9f322cf83dbf",
    byteRange: [371589128, 412876807],
  },
  moonRegionOffsets: {
    file: "ldem_64_strip_offsets.bin",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_64_uint.tif",
    sha256: "37b193b79c4d983e38b393fdb14c45fd7cea325281cea29bae1977a7a2f44c49",
    byteRange: [530887938, 530934017],
  },
  marsRegionRows: {
    file: "megr44n180hb-rows2816-3839.bin",
    url: "https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg128/megr44n180hb.img",
    sha256: "3e2c8fe236f1988a88abf1d10b253fae46450e4957f9944310f97cbcf2040b93",
    byteRange: [64880640, 88473599],
  },
  marsRegionLabel: {
    file: "megr44n180hb.xml",
    url: "https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg128/megr44n180hb.xml",
    sha256: "761e02350cf424b6a5791f30c406169fb80d824c36aa163ac707beeba4ffcef6",
  },
  marsColor: {
    file: "mars_viking_mdim21_clrmosaic_1km.jpg",
    url: "https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/5ea881c6-01b3-41fa-a7af-42d2131b54f1/download/mars_viking_mdim21_clrmosaic_1km.jpg",
    sha256: "fdfcd335559c3dc67052b7e8a9565d850e336ac0d1f3ea7f5eb7826ffb44ecb2",
    labelFile: "mars_viking_mdim21_clrmosaic_1km.jpg.aux.xml",
    labelUrl:
      "https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/69f3953f-9791-4d92-bffe-ebe24945eb95/download/mars_viking_mdim21_clrmosaic_1km.jpg.aux.xml",
    labelSha256:
      "027a2ff4e0e169ca4f03b417eb4e8e88d29d80d78031549ba5674fe1c26445bc",
  },
  moonColor: {
    file: "lroc_color_poles_4k.tif",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif",
    sha256: "918649a7f8ed2f1329b2cd95bb0d25483befdcb60ae1a66db681a637cc21344f",
  },
  moonHeight: {
    file: "ldem_16_uint.tif",
    url: "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif",
    sha256: "45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62",
  },
  marsRadius: {
    file: "megr90n000eb.img",
    url: "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megr90n000eb.img",
    sha256: "976cb28c7a6561d1c3f7b4281e035e0c1dd02d387375e4a4aba5010b7064a8d0",
    labelFile: "megr90n000eb.lbl",
    labelUrl:
      "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megr90n000eb.lbl",
    labelSha256:
      "39caa45880c19cb3df1bd8dce0ff33a64d14eee844b03419f84ce30c24d7849c",
  },
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifySource(source) {
  const path = resolve(originalDir, source.file);
  if (!existsSync(path))
    throw new Error(`Missing ${path}; run with --download first`);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (actual !== source.sha256)
    throw new Error(
      `${source.file} sha256 mismatch: expected ${source.sha256}, got ${actual}`,
    );
  if (source.labelFile) {
    const labelPath = resolve(originalDir, source.labelFile);
    if (!existsSync(labelPath))
      throw new Error(`Missing ${labelPath}; run with --download first`);
    if (sha256(await readFile(labelPath)) !== source.labelSha256)
      throw new Error(`${source.labelFile} sha256 mismatch`);
  }
  return { path, bytes };
}

async function download() {
  await mkdir(originalDir, { recursive: true });
  for (const source of Object.values(SOURCES)) {
    const path = resolve(originalDir, source.file);
    const response = await fetch(
      source.url,
      source.byteRange
        ? { headers: { Range: `bytes=${source.byteRange.join("-")}` } }
        : undefined,
    );
    if (!response.ok)
      throw new Error(`Download failed ${response.status}: ${source.url}`);
    if (source.byteRange && response.status !== 206)
      throw new Error("Server ignored bounded source range");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== source.sha256)
      throw new Error(`Downloaded checksum mismatch: ${source.file}`);
    await writeFile(path, bytes);
    console.log(`downloaded ${source.file} (${bytes.length} bytes)`);
    if (source.labelFile) {
      const labelResponse = await fetch(source.labelUrl);
      if (!labelResponse.ok)
        throw new Error(
          `Download failed ${labelResponse.status}: ${source.labelUrl}`,
        );
      const label = Buffer.from(await labelResponse.arrayBuffer());
      if (sha256(label) !== source.labelSha256)
        throw new Error(`Downloaded checksum mismatch: ${source.labelFile}`);
      await writeFile(resolve(originalDir, source.labelFile), label);
    }
  }
}

function writeLittleEndian(values) {
  const out = Buffer.allocUnsafe(values.length * 2);
  for (let i = 0; i < values.length; i++) out.writeUInt16LE(values[i], i * 2);
  return out;
}

// The pinned PAM sidecar gives an equidistant cylindrical sphere, R=3396190m,
// upper-left (-10670000,5335000), pixel spacing (1000,-1000). Reproject its
// slightly non-global raster extent to exact pixel-centered longitude/latitude.
// JPEG shrink-on-load keeps offline working memory bounded. No brightness is
// ever used as elevation. Source illumination remains baked into the imagery.
async function marsColorMap(path, width, height) {
  const { data, info } = await sharp(path)
    .resize(4096)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const output = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const longitude = (((x + 0.5) / width) * 2 - 1) * Math.PI;
      const latitude = (0.5 - (y + 0.5) / height) * Math.PI;
      const sx = Math.max(
        0,
        Math.min(
          info.width - 1,
          ((longitude * 3396190 + 10670000) / (21339 * 1000)) * info.width -
            0.5,
        ),
      );
      const sy = Math.max(
        0,
        Math.min(
          info.height - 1,
          ((5335000 - latitude * 3396190) / (10670 * 1000)) * info.height - 0.5,
        ),
      );
      const ix = Math.floor(sx),
        iy = Math.floor(sy),
        fx = sx - ix,
        fy = sy - iy;
      for (let c = 0; c < 3; c++) {
        const at = (dx, dy) =>
          data[
            (Math.min(iy + dy, info.height - 1) * info.width +
              Math.min(ix + dx, info.width - 1)) *
              3 +
              c
          ];
        output[(y * width + x) * 3 + c] = Math.round(
          (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) +
            (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy,
        );
      }
    }
  return output;
}

async function decodeTiff(path, depth = 1) {
  const image = sharp(path, { limitInputPixels: false });
  if (depth === 1) image.greyscale();
  const meta = await image.metadata();
  const { data, info } = await image
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true });
  if (depth !== info.channels)
    throw new Error(`Expected ${depth} channel TIFF, got ${info.channels}`);
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
    meta,
  };
}

// libvips currently reads this NASA TIFF's unusual IDL 16-bit strips as 8-bit.
// The TIFF is little-endian, uncompressed, and its strip table is contiguous;
// retain the original uint16 samples directly instead of silently losing data.
function decodeMoonDem(bytes) {
  const width = 5760,
    height = 2880,
    offset = 8,
    length = width * height * 2;
  const data = bytes.subarray(offset, offset + length);
  if (data.length !== length)
    throw new Error("Unexpected Moon DEM strip layout");
  return { data, width, height };
}

async function resizeRgb(data, width, height, targetWidth, targetHeight) {
  return (
    await sharp(data, { raw: { width, height, channels: 3 } })
      .resize(targetWidth, targetHeight, { kernel: "lanczos3" })
      .raw()
      .toBuffer({ resolveWithObject: true })
  ).data;
}

// Area-average elevation in sample units (linear meter encoding), independently
// of image color management. Target/source pixels are both area-centered.
function resizeU16(
  data,
  width,
  height,
  targetWidth,
  targetHeight,
  longitudeShift = 0,
) {
  const source = new Uint16Array(
    data.buffer,
    data.byteOffset,
    data.byteLength / 2,
  );
  const out = new Uint16Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const y0 = (y * height) / targetHeight,
      y1 = ((y + 1) * height) / targetHeight;
    for (let x = 0; x < targetWidth; x++) {
      const x0 = (x * width) / targetWidth,
        x1 = ((x + 1) * width) / targetWidth;
      let sum = 0,
        weight = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          sum +=
            source[
              Math.min(height - 1, sy) * width + ((sx + longitudeShift) % width)
            ] * w;
          weight += w;
        }
      }
      out[y * targetWidth + x] = Math.round(sum / weight);
    }
  }
  return out;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--download")) await download();
  if (!args.has("--download") && !args.has("--rebuild")) {
    console.error(
      "Usage: node scripts/prepare-surfaces.mjs --download [--rebuild]",
    );
    process.exitCode = 2;
    return;
  }
  const [
    moonColor,
    moonHeight,
    marsRadius,
    marsColor,
    regionRows,
    regionOffsets,
    marsRegionRows,
    marsRegionLabel,
  ] = await Promise.all([
    verifySource(SOURCES.moonColor),
    verifySource(SOURCES.moonHeight),
    verifySource(SOURCES.marsRadius),
    verifySource(SOURCES.marsColor),
    verifySource(SOURCES.moonRegionRows),
    verifySource(SOURCES.moonRegionOffsets),
    verifySource(SOURCES.marsRegionRows),
    verifySource(SOURCES.marsRegionLabel),
  ]);
  const moonRgb = await decodeTiff(moonColor.path, 3);
  const moonDem = decodeMoonDem(moonHeight.bytes);
  const marsBytes = marsRadius.bytes;
  const marsWidth = 5760,
    marsHeightPx = 2880;
  if (marsBytes.length !== marsWidth * marsHeightPx * 2)
    throw new Error("Unexpected MOLA dimensions");
  const marsEncoded = new Uint16Array(marsWidth * marsHeightPx);
  let marsMin = Infinity,
    marsMax = -Infinity;
  for (let i = 0; i < marsEncoded.length; i++) {
    // PDS OFFSET=3396000 gives planetary radius. Convert directly to the
    // sandbox's canonical mean radius; no areoid/topography correction.
    const elevation = marsBytes.readInt16BE(i * 2) + 6500;
    marsMin = Math.min(marsMin, elevation);
    marsMax = Math.max(marsMax, elevation);
    marsEncoded[i] = elevation + 20000;
  }
  const levels = [
    { name: "preview", width: 512, colorHeight: 256, includeHeight: false },
    {
      name: "medium",
      width: 2048,
      colorHeight: 1024,
      heightWidth: 1024,
      heightHeight: 512,
      includeHeight: true,
    },
    {
      name: "near",
      width: 4096,
      colorHeight: 2048,
      heightWidth: 2048,
      heightHeight: 1024,
      includeHeight: true,
    },
  ];
  await mkdir(outputDir, { recursive: true });
  // Pinned uncompressed NASA TIFF: every row strip was checked, not guessed.
  for (let y = 0; y < 11520; y++) {
    if (regionOffsets.bytes.readUInt32LE(y * 4) !== 8 + y * 23040 * 2)
      throw new Error("Unexpected LOLA64 strip layout");
  }
  const regionalBytes = Buffer.alloc(896 * 896 * 2);
  for (let y = 0; y < 896; y++) {
    const start = (y * 23040 + 10368) * 2;
    regionRows.bytes.copy(regionalBytes, y * 896 * 2, start, start + 896 * 2);
  }
  let regionalMin = Infinity,
    regionalMax = -Infinity;
  for (let i = 0; i < regionalBytes.length; i += 2) {
    const h = regionalBytes.readUInt16LE(i) * 0.5 - 10000;
    regionalMin = Math.min(regionalMin, h);
    regionalMax = Math.max(regionalMax, h);
  }
  await writeFile(resolve(outputDir, "moon-tycho.height.bin"), regionalBytes);
  const marsRegionalBytes = Buffer.alloc(1024 * 1024 * 2);
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const radius =
        marsRegionRows.bytes.readInt16BE((y * 11520 + 5376 + x) * 2) + 3396000;
      const elevation = radius - 3389500;
      marsRegionalBytes.writeUInt16LE(elevation + 20000, (y * 1024 + x) * 2);
    }
  }
  let marsRegionalMin = Infinity,
    marsRegionalMax = -Infinity;
  for (let i = 0; i < marsRegionalBytes.length; i += 2) {
    const elevation = marsRegionalBytes.readUInt16LE(i) - 20000;
    marsRegionalMin = Math.min(marsRegionalMin, elevation);
    marsRegionalMax = Math.max(marsRegionalMax, elevation);
  }
  await writeFile(
    resolve(outputDir, "mars-olympus.height.bin"),
    marsRegionalBytes,
  );
  const bodies = {};
  for (const body of ["moon", "mars"]) {
    const isMoon = body === "moon";
    const source = isMoon
      ? moonDem
      : {
          data: Buffer.from(marsEncoded.buffer),
          width: marsWidth,
          height: marsHeightPx,
        };
    const sourceMin = isMoon ? Infinity : marsMin;
    const sourceMax = isMoon ? -Infinity : marsMax;
    const moonValues = isMoon
      ? new Uint16Array(
          moonDem.data.buffer,
          moonDem.data.byteOffset,
          moonDem.data.byteLength / 2,
        )
      : null;
    let min = isMoon ? Infinity : sourceMin,
      max = isMoon ? -Infinity : sourceMax;
    if (isMoon)
      for (const encoded of moonValues) {
        const h = encoded * 0.5 - 10000;
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
    const levelManifest = {};
    for (const level of levels) {
      const name = `${body}-${level.name}`;
      const colorRaw = isMoon
        ? await resizeRgb(
            moonRgb.data,
            moonRgb.width,
            moonRgb.height,
            level.width,
            level.colorHeight,
          )
        : await marsColorMap(marsColor.path, level.width, level.colorHeight);
      const colorPath = resolve(outputDir, `${name}.jpg`);
      await sharp(colorRaw, {
        raw: { width: level.width, height: level.colorHeight, channels: 3 },
      })
        .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
        .toFile(colorPath);
      const entry = {
        width: level.width,
        height: level.colorHeight,
        color: `/assets/surfaces/${name}.jpg`,
      };
      entry.colorSha256 = sha256(await readFile(colorPath));
      if (level.includeHeight) {
        const values = resizeU16(
          source.data,
          source.width,
          source.height,
          level.heightWidth,
          level.heightHeight,
          isMoon ? 0 : source.width / 2,
        );
        const heightPath = resolve(outputDir, `${name}.height.bin`);
        await writeFile(heightPath, writeLittleEndian(values));
        entry.heightUrl = `/assets/surfaces/${name}.height.bin`;
        entry.heightWidth = level.heightWidth;
        entry.heightHeight = level.heightHeight;
        entry.heightSha256 = sha256(await readFile(heightPath));
        entry.heightOffsetMeters = isMoon ? -10000 : -20000;
        entry.heightScaleMeters = isMoon ? 0.5 : 1;
        let levelMin = Infinity,
          levelMax = -Infinity;
        for (const encoded of values) {
          const elevation =
            encoded * (isMoon ? 0.5 : 1) + (isMoon ? -10000 : -20000);
          levelMin = Math.min(levelMin, elevation);
          levelMax = Math.max(levelMax, elevation);
        }
        entry.minElevationMeters = levelMin;
        entry.maxElevationMeters = levelMax;
        if (isMoon && level.name === "near")
          entry.region = {
            name: "Tycho LOLA64 regional relief",
            heightUrl: "/assets/surfaces/moon-tycho.height.bin",
            heightSha256: sha256(regionalBytes),
            width: 896,
            height: 896,
            heightScaleMeters: 0.5,
            heightOffsetMeters: -10000,
            uvBounds: [0.45, 0.7, 176 / 360, 140 / 180],
            blendBorder: 0.08,
            minElevationMeters: regionalMin,
            maxElevationMeters: regionalMax,
          };
        if (!isMoon && level.name === "near")
          entry.region = {
            name: "Olympus MOLA128 regional radial shape",
            heightUrl: "/assets/surfaces/mars-olympus.height.bin",
            heightSha256: sha256(marsRegionalBytes),
            width: 1024,
            height: 1024,
            heightScaleMeters: 1,
            heightOffsetMeters: -20000,
            uvBounds: [
              222 / 360 - 0.5,
              (90 - 22) / 180,
              230 / 360 - 0.5,
              (90 - 14) / 180,
            ],
            blendBorder: 0.08,
            minElevationMeters: marsRegionalMin,
            maxElevationMeters: marsRegionalMax,
          };
      }
      levelManifest[level.name] = entry;
    }
    bodies[body] = {
      referenceRadiusMeters: isMoon ? 1737400 : 3389500,
      sourceType: isMoon
        ? "NASA LROC color + LOLA DEM"
        : "NASA/USGS Viking colorized imagery + MOLA MEGDR radial shape",
      body,
      sourceOrganization: isMoon
        ? "NASA GSFC / LROC ASU / LOLA"
        : "NASA Ames / JPL / USGS / NASA PDS",
      license:
        "US government scientific imagery; retain source attribution; no endorsement implied",
      coordinates: {
        longitude: "east-positive -180..180",
        latitude: "planetocentric",
        projection: "equirectangular",
        northAtTop: true,
        pixelRegistration: "area-centered",
      },
      proceduralDetail:
        "Deterministic micro-normal and grain approximation; not measured relief; does not displace geometry",
      provenance: isMoon
        ? {
            citation:
              "NASA Scientific Visualization Studio, CGI Moon Kit (4720); LRO LROC WAC color mosaic and LOLA DEM",
            sources: [
              {
                url: SOURCES.moonColor.url,
                sha256: SOURCES.moonColor.sha256,
                dimensions: "4096x2048 RGB TIFF",
                operations:
                  "decode; Lanczos resize to 512/2048/4096; JPEG quality 88",
              },
              {
                url: SOURCES.moonHeight.url,
                sha256: SOURCES.moonHeight.sha256,
                dimensions: "5760x2880 unsigned 16-bit TIFF",
                operations:
                  "decode pinned uncompressed uint16 strip; area-average resize to 1024/2048; round to half-meter; little-endian uint16 export",
              },
              {
                url: SOURCES.moonRegionRows.url,
                sha256: SOURCES.moonRegionRows.sha256,
                checksumScope:
                  "HTTP byte-range extraction, not full original TIFF",
                byteRange: SOURCES.moonRegionRows.byteRange,
                stripOffsetsSha256: SOURCES.moonRegionOffsets.sha256,
                stripOffsetsByteRange: SOURCES.moonRegionOffsets.byteRange,
                dimensions:
                  "23040x11520 original; 23040x896 extracted row band; 896x896 prepared crop",
                operations:
                  "verify row strip offsets; extract rows8064..8959, columns10368..11263; no resampling; little-endian uint16 half-meter samples; blend outer8% into global LOLA at runtime",
                coverage:
                  "east longitude -18..-4, planetocentric latitude -50..-36",
                citation:
                  "NASA SVS CGI Moon Kit4720; LOLA science team; Ernie Wright(USRA), Noah Petro(NASA/GSFC)",
              },
            ],
            datum:
              "LOLA sphere radius 1,737,400 m; planetocentric east-positive cylindrical map",
          }
        : {
            citation:
              "NASA PDS MGS MOLA MEGDR product v2.0 (MEGR90N000EB), 16 pixels/degree",
            sources: [
              {
                url: SOURCES.marsRadius.url,
                sha256: SOURCES.marsRadius.sha256,
                labelUrl: SOURCES.marsRadius.labelUrl,
                labelSha256: SOURCES.marsRadius.labelSha256,
                dimensions:
                  "5760x2880 signed big-endian int16 IMG; PDS OFFSET 3396000 m",
                operations:
                  "decode planetary radius; subtract canonical 3389500 m; roll longitude 180 degrees from 0..360 to -180..180; encode with -20000 m offset; area-average resize; little-endian uint16 export",
              },
              {
                url: SOURCES.marsColor.url,
                sha256: SOURCES.marsColor.sha256,
                labelUrl: SOURCES.marsColor.labelUrl,
                labelSha256: SOURCES.marsColor.labelSha256,
                dimensions: "21339x10670 RGB JPEG",
                operations:
                  "JPEG shrink-on-load to 4096px; bilinear reprojection using pinned PAM geotransform to east-positive planetocentric exact global raster; edge clamp <1 source pixel; JPEG quality88",
              },
              {
                url: SOURCES.marsRegionRows.url,
                labelUrl: SOURCES.marsRegionLabel.url,
                sha256: SOURCES.marsRegionRows.sha256,
                labelSha256: SOURCES.marsRegionLabel.sha256,
                dimensions: "5632x11520 source tile; 1024x1024 derived crop",
                byteRange: SOURCES.marsRegionRows.byteRange,
                checksumScope:
                  "HTTP byte-range extraction, not full original tile",
                operations:
                  "verify SignedMSB2 rows 2816..3839; extract columns 5376..6399; convert radius offset 3396000 to canonical 3389500 radial elevation; little-endian uint16 export with -20000 m offset",
                coverage:
                  "planetocentric 222..230E, 14..22N; MOLA128 IAU2000_MARS",
              },
            ],
            datum:
              "MOLA MEGDR mean planetary-radius shape; planetocentric, east-positive 0-360 degrees; runtime reference radius 3,389,500 m",
            colorNote:
              "Viking MDIM2.1 colorized imagery by NASA Ames/USGS; baked illumination and acquisition seams remain; not a calibrated albedo product.",
          },
      levels: levelManifest,
    };
  }
  delete bodies._min;
  const manifest = {
    schemaVersion: 1,
    coordinateConvention:
      "u=(east longitude + pi)/(2 pi), v=(pi/2 - planetocentric latitude)/pi; pixel centers; north at top",
    generatedBy: "scripts/prepare-surfaces.mjs",
    bodies,
  };
  await writeFile(
    resolve(outputDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`prepared ${outputDir}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
