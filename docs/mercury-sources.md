# Mercury surface source

The Mercury height levels are derived from the USGS Astrogeology / NASA
MESSENGER global DEM:

- Source: <https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif>
- Product: MESSENGER/MDIS global DEM, 665 m/pixel, 64 pixels/degree.
- Downloaded source: 530,934,581 bytes, SHA-256
  `defce776241dcaf44cb0f081ee508c17dbea28aa5a22880bf7a5e8c25f96cbea`.
- Native raster: 23,040 × 11,520, signed 16-bit GeoTIFF.
- Coordinates: equirectangular, planetocentric latitude, east-positive
  longitude from 0° through 360°, north at the first row.
- Datum: spherical Mercury radius 2,439,400 m. The TIFF embeds GDAL
  `SCALE=0.5`, `OFFSET=0`; raster samples are signed half-metre elevations
  relative to that datum (not absolute radius). Prepared binaries use the
  runtime contract `uint16LE * 0.5 - 10000`.

`scripts/prepare-mercury-surface.mjs` verifies the source checksum and
GeoTIFF georeferencing, rotates the native 0..360° columns into the runtime's
canonical -180..180° layout, and creates bounded preview (512×256), medium
(1024×512), and near (2048×1024) height/color levels. The JPEGs are a neutral
procedural fallback only: they are not MDIS albedo, calibrated color, or
imagery. A separate real-color source is available from the USGS mosaic
catalogue (`Mercury_MESSENGER_ClrMosaic_global_665m_v3.tif`), but is not
downloaded or represented as color in this bounded preparation.

The USGS product page lists no access constraint and requests citation of the
authors/product. Preserve the source URL and checksum above when redistributing
derived levels; consult the source catalogue for the current attribution text.
