# Published global 64 ppd terrain pack

Run `just prepare-terrain64 "" --download` once to fetch the scientific originals
and prepare Earth, Moon, and Mars. Later, `just prepare-terrain64 "" --rebuild`
recreates the derived tiles without network access. Originals are kept in
`output/surface-originals/`; derived tiles and their provenance index are in
`assets/surfaces/terrain64/`. Scientific originals remain ignored by Git;
prepared tiles and provenance indexes are versioned and included in the normal
static build. The browser still downloads them only on close approach.

The game first loads its bundled global map. Below approximately 2.5% of a
body radius in altitude, it requests only the 16-degree terrain tile under
the viewed surface. The previous map remains visible until the tile loads;
the decoded-tile cache has the same bounded 96 MiB budget as other surface
assets. Moving away evicts high-resolution data. The 64 ppd files are not
loaded at startup, and missing tiles leave the bundled map intact.

Run `just prepare-color64 "" --download` to add corresponding optional color
tiles. Earth uses the unshaded NASA Blue Marble 2 km global map (native 60 ppd),
Moon uses the full NASA LROC WAC 2019 mosaic (native 76 ppd), and Mars reuses the
already-downloaded USGS Viking 1 km JPEG (about 59 ppd). The offline pipeline
normalizes each to the same 64 ppd planetocentric grid, but does not claim
resampling adds measured detail. The original Moon TIFF is about 494 MB;
scientific originals remain ignored by Git, while derived JPEG tiles are
published as lazy-loaded static assets. `assets/surfaces/color64/index.json` records
source and tile checksums, dimensions, coordinate convention, and provenance.
Mars's fine brightness detail is partly colorized monochrome imagery rather
than independently measured full-resolution RGB. The lunar polar color fill
above 70 degrees is lower resolution than the nominal global tile size.

| Body | Scientific source | Native source resolution | Prepared tile grid |
| --- | --- | --- | --- |
| Earth | NOAA ETOPO2022 ice-surface elevation | 60 samples/degree | Bilinear 64 ppd; no claim of added measured detail |
| Moon | NASA GSFC LOLA/LDEM global DEM | 64 pixels/degree | Native 64 ppd samples |
| Mars | NASA PDS MGS MOLA MEGDR planetary radius | 64 pixels/degree | Native 64 ppd samples |

All heights remain meters above each body's documented reference radius.
Earth's EGM2008-referenced elevation is combined with ellipsoidal radius over
the simulation's reference sphere; local geoid-undulation correction is not
included, so its absolute radial datum can differ by tens of meters. MOLA's
signed planetary radius is converted directly to
radial height. The Moon's 0.5 m sample scale is preserved. Visual exaggeration
and camera clearance still use the existing rendering path and never alter
orbital radius, mass, or collision physics.

Each tile is 1024 samples wide except at the east/south edges. Files are
lossless-gzipped little-endian uint16 height arrays, decoded on demand to
Float32 meters for CPU/GPU sampling. `index.json` records source URLs,
organizations, citations, source SHA-256 checksums, derived tile checksums,
dimensions, encoding, minimum/maximum elevation, processing, and total bytes.

Limitations: the current shader uses one fine tile at a time, blending its
border into the bundled globe. At a tile boundary or when viewing a wide area,
detail can visibly soften; a multi-tile atlas would be the next rendering
improvement. Source resolution also does not imply uniformly measured local
accuracy: LOLA and MOLA interpolate where observations are sparse. The packs
are hosted on the website but are not a default download for visitors.

Sources: [NOAA ETOPO2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model),
[NASA Moon Kit LDEM](https://svs.gsfc.nasa.gov/4720/), and
[NASA PDS MOLA MEGDR](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html).
