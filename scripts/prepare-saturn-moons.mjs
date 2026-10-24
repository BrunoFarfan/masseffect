#!/usr/bin/env node
// Pinned mission map products. Scientific originals remain ignored under output/.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { fromFile } from "geotiff";
import { SURFACE_PCK } from "../src/surface-pck.js";
const root = resolve(import.meta.dirname, "..");
const originals = resolve(root, "output/surface-originals");
const assets = resolve(root, "assets/surfaces");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const sources = {
  dione: {
    file: "dione-usgs-full.tif",
    url: "https://planetarymaps.usgs.gov/mosaic/Dione_Cassini_Voyager_mosaic_global_154m.tif",
    sha256: "5c5d796c02e3c99fde5dd034e01dd1f25905699a4885843aed445ded955e08b5",
    width: 23040,
    height: 11520,
    metersPerPixel: 153.53443263638,
    projectionRadiusMeters: 563000,
    referenceRadiusMeters: 561400,
    labelSha256:
      "9ebd3ab389c665a4ed3ae3285c7f16b68438e26b8ba18b5e7fe177cb76716a9e",
    metadata:
      "https://astrogeology.usgs.gov/search/map/dione_cassini_voyager_global_mosaic_154m",
    doi: "10.26033/bxx6-g543",
  },
  tethys: {
    file: "tethys-usgs-full.tif",
    url: "https://planetarymaps.usgs.gov/mosaic/Tethys_Cassini_mosaic_global_293m.tif",
    sha256: "40723c3ebfaaa52a657827b37309bc84234811db1cf26a21d086e26aba2b3640",
    width: 11520,
    height: 5760,
    metersPerPixel: 292.50627432643,
    projectionRadiusMeters: 536300,
    referenceRadiusMeters: 531100,
    labelSha256:
      "8fa11c1ab3415e39cc3b15de5cb7993468e5e240c7860e11b03877a63f199e40",
    metadata:
      "https://astrogeology.usgs.gov/search/map/tethys_cassini_global_mosaic_293m",
    doi: "10.26033/hpv0-eh61",
  },
  mimas: {
    file: "mimas-nasa-full.jpg",
    url: "https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA17214.jpg",
    sha256: "f2d62eaa50c7864e303a13434738a7bc6db0e133f1f4b163c2506979800c1116",
    width: 5760,
    height: 2880,
    metersPerPixel: 216,
    projectionRadiusMeters: 198200,
    referenceRadiusMeters: 198200,
    metadata:
      "https://www.jpl.nasa.gov/images/pia17214-mimas-global-map-june-2017/",
    coordinateReference: {
      url: "https://planetarydata.jpl.nasa.gov/img/data/cassini/cassini_orbiter/coiss_3006_v3/data/images/SM_1M_0_0_SIMP.IMG",
      sha256:
        "beea77a709f49f35b6dfaf378b076971f4050badc190313c58b488819ffd2fc2",
      description:
        "Earlier PDS global map attached label: 5760x2880, 16ppd, center0, west180 at left to west-180 at right; zero projection rotation; spherical198.2km figure. Coordinate reference only, not imagery input.",
    },
    doi: "10.26033/y8wv-r303",
  },
};
await mkdir(originals, { recursive: true });
await mkdir(assets, { recursive: true });
for (const [id, source] of Object.entries(sources)) {
  const sourcePath = resolve(originals, source.file);
  if (process.argv.includes("--download-pinned")) {
    const r = await fetch(source.url);
    if (!r.ok) throw Error(`${id}: HTTP ${r.status}`);
    await writeFile(sourcePath, Buffer.from(await r.arrayBuffer()));
    if (source.labelSha256) {
      const r = await fetch(source.url.replace(".tif", ".lbl"));
      if (!r.ok) throw Error(`${id} label HTTP ${r.status}`);
      await writeFile(
        resolve(originals, `${id}-usgs-full.lbl`),
        Buffer.from(await r.arrayBuffer()),
      );
    }
  }
  if (!process.argv.includes("--rebuild")) continue;
  if (hash(await readFile(sourcePath)) !== source.sha256)
    throw Error(`${id} source checksum`);
  if (
    source.labelSha256 &&
    hash(await readFile(resolve(originals, `${id}-usgs-full.lbl`))) !==
      source.labelSha256
  )
    throw Error(`${id} label checksum`);
  const meta = await sharp(sourcePath, { limitInputPixels: false }).metadata();
  if (meta.width !== source.width || meta.height !== source.height)
    throw Error(`${id} dimensions`);
  if (source.labelSha256) {
    const t = await fromFile(sourcePath);
    try {
      const i = await t.getImage(),
        k = i.getGeoKeys(),
        o = i.getOrigin(),
        r = i.getResolution();
      if (
        k.ProjCoordTransGeoKey !== 17 ||
        k.ProjCenterLongGeoKey !== 0 ||
        k.GeogSemiMajorAxisGeoKey !== source.projectionRadiusMeters ||
        o[0] >= 0 ||
        o[1] <= 0 ||
        r[0] <= 0 ||
        r[1] >= 0
      )
        throw Error(`${id} georeferencing`);
    } finally {
      await t.close();
    }
  }
  const normalized = resolve(originals, `${id}-normalized.tif`);
  await sharp(sourcePath, { limitInputPixels: false })
    .tiff({ compression: "lzw" })
    .toFile(normalized);
  const coordinates = {
    longitude: "east-positive -180..180",
    latitude: "planetocentric",
    projection: "equirectangular",
    northAtTop: true,
    pixelRegistration: "pixel-centered",
  };
  const normalization =
    "Native simple cylindrical north-up map, full globe -180..180 east-positive; no rotation, mirror, colorization, sharpening, or invented pixels. Projection reference radius is independent of the canonical JPL SI radius.";
  await writeFile(
    resolve(originals, `${id}-normalized.json`),
    JSON.stringify(
      {
        sha256: hash(await readFile(normalized)),
        source,
        coordinates,
        normalization,
      },
      null,
      2,
    ) + "\n",
  );
  const levels = {};
  for (const [name, width] of [
    ["preview", 512],
    ["medium", 1024],
    ["near", 4096],
  ]) {
    const path = resolve(assets, `${id}-${name}.jpg`);
    await sharp(normalized, { limitInputPixels: false })
      .resize(width, width / 2, { withoutEnlargement: true })
      .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
      .toFile(path);
    levels[name] = {
      color: `/assets/surfaces/${id}-${name}.jpg`,
      width,
      height: width / 2,
      colorSha256: hash(await readFile(path)),
      colorKind: "NASA Cassini mapped grayscale imagery",
    };
  }
  const heightPolicy =
    "Ellipsoid only. Measured 2025 PDS SPC global radius grids exist, but were not integrated because archive downloads returned access challenges; no synthetic height or brightness-derived terrain is generated.";
  const manifest = {
    schemaVersion: 1,
    generatedBy: "scripts/prepare-saturn-moons.mjs",
    bodies: {
      [id]: {
        body: id,
        referenceRadiusMeters: source.referenceRadiusMeters,
        bodyrefSIradius: source.referenceRadiusMeters,
        sourceType: "mapped-imagery-ellipsoid-only",
        baseRadiiMeters: [
          SURFACE_PCK[id].radiiMeters[0],
          SURFACE_PCK[id].radiiMeters[2],
          SURFACE_PCK[id].radiiMeters[1],
        ],
        sourceOrganization:
          "NASA/JPL/Space Science Institute; USGS Astrogeology",
        coordinates,
        heightPolicy,
        provenance: {
          source,
          sourceMetadata: source.metadata,
          citation: `NASA Cassini ISS global ${id} map; ${id === "dione" ? "Voyager gap fill; " : ""}see source product metadata.`,
          coverage:
            "Global mosaic footprint with spatially variable source image resolution and photometric seams; nominal map spacing does not imply uniform effective resolution.",
          license:
            "NASA/USGS public planetary imagery; retain mission and product attribution.",
          processing: normalization,
          measuredTerrainCandidate: `https://doi.org/${source.doi}`,
          terrainLimitation: heightPolicy,
        },
        levels,
      },
    },
  };
  await writeFile(
    resolve(assets, `${id}-manifest.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `Prepared ${id}: ${source.width}x${source.height} source; three image levels; ellipsoid-only.`,
  );
}
