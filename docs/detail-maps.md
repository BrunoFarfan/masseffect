# Three-level surface maps and polar tiles

The browser keeps three bounded global appearance/elevation levels (`preview`,
`medium`, `near`) and requests native-detail tiles only on approach. Source
resolution varies by body; a common delivery format does not make all bodies
equally well surveyed. No imagery brightness is interpreted as elevation.

`assets/surfaces/detail/index.json` is the public inventory. Each descriptor
records its bounds, projection, dimensions, byte count and SHA-256. Its body
record retains source checksums, coordinate conversions, effective sampling
and height policy. Only indexed assets enter the static build.

| Body | Detailed appearance | Elevation |
| --- | --- | --- |
| Earth, Moon, Mars | Existing global color tiles, plus projected polar replacements | Existing measured global packs, plus projected polar replacements |
| Mercury | MESSENGER 250 m monochrome mosaic, bounded to 64 ppd | Measured MESSENGER DEM; grid spacing does not imply effective terrain resolution |
| Enceladus | Registered Schenk 2024 Cassini 100 m mosaic | Separate 200 m DEM, converted from triaxial reference to radial height; invalid measurements excluded from interpolation |
| Titan | USGS 2026 controlled 702 m near-infrared mosaic | Corlies 2017 sparse/interpolated 4 ppd elevation; no fabricated finer relief |
| Europa, Io, Ganymede, Callisto, Rhea, Iapetus | Source-native USGS spacecraft mosaics | Existing explicitly procedural baseline; no procedural height promoted into scientific detail tiles |
| Dione, Mimas, Tethys | NASA/Cassini mapped appearance | Ellipsoid-only until the separately published measured radius products can be retrieved and verified |
| Triton, Miranda, Ariel, Umbriel, Titania, Oberon | Source-limited polar reprojections, preserving documented coverage/alignment uncertainty | Existing procedural baseline |
| Venus | Constant illustrative appearance, unchanged | Measured Magellan polar elevation; radar browse pixels are not assumed to be a georeferenced color source |

## Preparation

Scientific originals and normalized working images remain in ignored
`output/surface-originals/`. Downloads are explicit; rebuilds verify SHA-256
before reading a source. Source-download size is separate from published size.

```sh
just prepare-map-imagery "" --download
just prepare-surfaces --rebuild
just prepare-map-levels
just assemble-surfaces
just prepare-detail-maps
just check
just test
just build preview
```

`prepare-map-imagery` prepares Mercury, Enceladus, Io and Titan working images.
`scripts/prepare-saturn-moons.mjs` prepares the three added Saturn moons and
their pinned working images. Existing per-body source scripts supply the
remaining pinned originals. The final global-level pass applies the working
imagery and adds small preview elevation maps where real or explicitly labeled
baseline height maps already exist. Bodies without terrain retain that absence.

For one detail pack use `just prepare-detail-maps europa`. A changed source or
processing version requires rebuilding its pack; the index reconciliation removes
stale detail derivatives. Originals are never included in the site build.

## Polar treatment and runtime limits

New detailed packs replace the cylindrical caps above 70 degrees with polar
stereographic tiles. Cap sampling follows equatorial ground spacing, bounded
by the source's native detail. Existing Earth/Moon/Mars global packs are retained
for compatibility and receive small polar overlays rather than being rewritten.
Their polar overlays add storage; existing cylindrical cap rows are not removed.

CPU sampling and the GPU share the same stereographic registration. Stable
latitude and tangent-direction normal sampling avoid longitude singularities.
Fallback pole rows converge to a shared pole value. Source observation gaps,
lower-resolution polar imagery and photometric seams remain source limitations.

The runtime selects a bounded visible group of tiles, retaining global maps
while they load. Neighbor gutters support continuous interpolation. CPU decoded
assets retain the 96 MiB cache limit; GPU atlases use bounded residency and
release replaced textures. Tile count and memory are independent of the total
published pack size. These are three global levels plus a close-detail layer,
not a complete tiled pyramid at every intermediate resolution.

## Reproducibility and limits

The 2025 PDS SPC radius products for Dione, Mimas and Tethys are scientific
ingestion candidates, not bundled elevation. The archive returned security
challenges to both command-line and browser requests during this preparation.
Their per-body source notes retain the dataset references. No false-color DEM
thumbnail, image-derived depth or arbitrary synthetic height substitutes for
those measurements.

Titan appearance is a full-resolution display PNG published alongside the
702 m GeoTIFF, registered using its detached ISIS label. Its source sharpening
and contrast are retained and documented; it is neither visible RGB nor
calibrated albedo. Enceladus floating-point brightness uses a recorded display
stretch independently of its elevation. Io is a color-merged mosaic with
spatially variable source detail and baked illumination.
