# Surface data provenance

The checked-in maps under `assets/surfaces/` are bounded derivatives of the
following authoritative planetary products. Large originals are deliberately
not checked in; they are downloaded into the ignored `output/surface-originals`
directory by `node scripts/prepare-surfaces.mjs --download`.

## Moon

NASA Scientific Visualization Studio, [CGI Moon Kit 4720](https://svs.gsfc.nasa.gov/4720),
provides the 2019 LROC WAC color mosaic (`lroc_color_poles_4k.tif`) and LOLA
DEM (`ldem_16_uint.tif`). The color map is a 4096x2048 RGB TIFF centered on
0° longitude. The DEM is 5760x2880 unsigned 16-bit samples at 16 pixels/degree;
each sample is a half-meter and has +20,000 (10,000 m) added to the signed
LOLA value relative to the 1,737,400 m spherical datum. The prepared height
maps therefore use `heightOffsetMeters: -10000` and `heightScaleMeters: 0.5`.
NASA asks users to credit NASA SVS, Ernie Wright (USRA), and Noah Petro (NASA
GSFC), and notes that the color product is optimized for visualization rather
than scientific analysis.

The near Moon level also carries a **Tycho regional LOLA64 tile**, bounded to
−18..−4° east longitude and −50..−36° planetocentric latitude. Its 896×896
samples retain the native64 pixels/degree (about474m north/south spacing),
not meter-scale geology. The pipeline fetches only rows8064..8959 of
`ldem_64_uint.tif` via HTTP Range: bytes371589128..412876807 (41.3MB).
It verifies all11520 strip offsets from the pinned TIFF strip table, then
extracts columns10368..11263 without resampling. The range checksum is explicitly
not represented as a checksum of the entire506MB TIFF. Prepared range is
−5387..2095.5m, 1.6MB on disk and3.2MB decoded. An outer8% border blends into
the global LOLA surface; GPU geometry/normals and camera clearance share it.
Outside this rectangle the global terrain remains in use. Like other gridded
LOLA products, the source includes interpolation between tracks.

## Mars

The source is the [NASA PDS MGS MOLA MEGDR archive](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/),
final product v2.0, 16 pixels/degree (`MEGR90N000EB.IMG` and its PDS label).
It is a 5760x2880 signed big-endian int16 map in meters, planetocentric and
east-positive from 0–360° longitude. The label defines each sample as mean
planetary radius with `OFFSET = 3396000` m. We subtract the simulation's
canonical Mars radius (3,389,500 m) directly from those radial samples; no
areoid or scalar correction is used. The prepared binary uses little-endian
uint16 samples with `heightOffsetMeters: -20000` and scale 1 m.

Color now comes from the USGS **Viking MDIM2.1 colorized global mosaic**, NASA
Ames/JPL/USGS, using its bounded 1 km JPEG and associated PAM georeferencing
sidecar linked on the [USGS product page](https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m).
The original is 21339×10670, 36.7 MB, SHA-256
`fdfcd335559c3dc67052b7e8a9565d850e336ac0d1f3ea7f5eb7826ffb44ecb2`.
The sidecar specifies equirectangular planetocentric coordinates, central
meridian 0°, projection sphere 3396190 m, upper-left (-10670000,5335000) m,
and (1000,-1000) m pixel spacing. The pipeline reprojects this exact transform
to the runtime convention, not an eyeballed image rotation. Source illumination,
colorization and acquisition seams remain: this is imagery, not calibrated
albedo. The earlier round-one height-tinted fallback has been replaced.

## Reproducibility and coordinates

The preparation script verifies SHA-256 before processing. `--download` fetches
the originals and then rebuilds; `--rebuild` is offline and only accepts local
files with the recorded checksums. It decodes the source grids, resizes to
512x256 preview, 2048x1024 medium, and 4096x2048 near color levels, emits JPEG color
and little-endian raw uint16 height maps for medium/near, and records ranges,
operations, URLs, checksums, dimensions, and datums in `manifest.json`.
Height dimensions are independent: 1024x512 medium and 2048x1024 near,
with one native-resolution regional tile. The decoded CPU cache is capped at96MiB.

Runtime coordinates are cylindrical: east-positive longitude and
planetocentric latitude, with `u=(longitude+π)/(2π)` and
`v=(π/2−latitude)/π`; pixel centers are used and north is at the top.
The analytic Moon/Mars frames are independently checked against NASA NAIF
WebGeocalc J2000-to-IAU transforms at -365.25d, J2000 and +365.25d using
`pck00011.tpc` (latest PCK kernel set3, not older mission overrides). All axes
agree within the service's eight-decimal output precision. Fixtures and exact
query conventions are in `tests/surface-orientation.test.mjs`.

## Catalog of other requested bodies

The catalog below was the research starting point. Prepared products now have
per-body `*-sources.md` notes and `*-manifest.json` files; the combined runtime
manifest is the authority for what actually ships. Coverage is not uniform:

| Runtime bodies | Shipped representation |
| --- | --- |
| Moon, Mars | LROC/LOLA and Viking/MOLA, plus native regional Tycho/Olympus DEM crops |
| Earth | Blue Marble imagery and ETOPO relief; WGS84 sea-level ellipsoid, omitted geoid correction documented |
| Mercury, Venus, Enceladus | MESSENGER, Magellan, Cassini measured DEMs; constant illustrative ground color, not measured albedo |
| Titan | Cassini ISS near-infrared appearance and Corlies 2017 sparse/interpolated topography, illustrative haze |
| Phobos, Deimos | Simplified measured PDS Thomas shape meshes, illustrative material |
| Io, Europa, Ganymede, Callisto, Rhea, Iapetus, Triton | Official mapped appearance and independent procedural relief, not DEMs |
| Miranda, Ariel, Umbriel, Titania, Oberon | Partial Voyager visualization mosaics; gaps and absolute alignment uncertainty retained; procedural relief |
| Jupiter, Saturn, Uranus, Neptune | Representative NASA/JPL cloud maps on PCK oblate shapes; no solid relief |
| Sun | Emissive appearance, no terrain; see its product manifest for source/approximation status |

Source candidates and supporting scientific holdings:

- [Mercury MESSENGER global DEM, 665 m](https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m): genuine DEM, separate from MDIS reflectance.
- [Venus Magellan global topography, 4641 m](https://astrogeology.usgs.gov/search/map/venus_magellan_global_topography_4641m): radar altimetry, not SAR brightness; keep the cloud and surface layers separate.
- [NOAA ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model): global Earth relief including bathymetry; its vertical datum must be converted explicitly before combining it with a radial sphere/ellipsoid.
- [Titan Lorenz et al. 2013 topography](https://astrogeology.usgs.gov/search/map/lorenz_et_al_2013_titan_topographic_map_of_titan): sparse Cassini measurements with large interpolated areas, not complete measured coverage.
- [Enceladus Cassini global DEM, Schenk, 200 m](https://astrogeology.usgs.gov/search/map/enceladus-cassini-global-dem-200m-schenk): a real global terrain product; retain the product's coverage/accuracy qualifications.
- [Galilean Voyager/Galileo mosaics](https://astrogeology.usgs.gov/search/map/jupiter-voyager-and-galileo-global-mosaics): Io, Europa, Ganymede and Callisto imagery. A global color mosaic is not evidence of a complete global DEM; any added relief must be labeled procedural.
- [Phobos Willner shape documentation in NAIF's DSK archive](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/dsk/satellites/willner_etal_phobos.pdf) and [Phobos/Deimos stereophotoclinometric shape models](https://pmc.ncbi.nlm.nih.gov/articles/PMC10290967/): research candidates. The shipped meshes instead use the pinned PDS Thomas optical-shape bundle documented in `phobos-sources.md` and `deimos-sources.md`.

Rhea, Iapetus and Triton are imagery-plus-approximation products, not assumed
global DEMs. Uranian moon textures preserve the source coverage gaps and do not
claim surveyed absolute texture alignment. Their individual manifests pin the
downloaded products and attribution.

These are the primary mission or agency holdings considered for future maps.
They are listed here so an absent asset is not mistaken for a fabricated one.
Coverage and licensing statements describe the source products, not a claim
that this repository has downloaded them.

| Body | Authoritative mapped source and coverage | Caveat |
| --- | --- | --- |
| Mercury | [USGS/IAU Mercury Messenger MDIS products](https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_global_mosaic_250m) (MESSENGER MDIS global mosaics; controlled map coordinates) | Public-domain USGS/NASA distribution; color/albedo products and DEMs are separate products and must not be conflated. |
| Venus | [USGS Magellan global mosaic](https://astrogeology.usgs.gov/search/map/venus_magellan_global_mosaic_1km) (SAR radar backscatter, global coverage) | Radar brightness is not visible color or albedo. USGS/NASA public-domain distribution; use the stated Magellan projection and datum. |
| Earth | [NASA Visible Earth Blue Marble](https://visibleearth.nasa.gov/images/2430/blue-marble-next-generation) (global visual-color imagery) | NASA imagery is generally public domain with NASA attribution, but this is an Earth observation composite, not a height map; land/ocean color and elevation are separate. |
| Moon | [NASA SVS CGI Moon Kit 4720](https://svs.gsfc.nasa.gov/4720) (global LROC color and LOLA DEM) | The checked-in Moon source above is the documented bounded product. NASA notes its color mosaic is visualization-oriented. |
| Mars | [NASA PDS MOLA MEGDR](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/) (global radial shape) and [USGS/NASA Viking MDIM2.1 colorized mosaic](https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m) (global mapped visual color) | The 12 GB original GeoTIFF is not bundled. The prepared color uses the official 1 km JPEG with its georeferencing sidecar. The separate MOLA false-color candidate below is not used as imagery. |
| Titan | [NASA PDS Cassini RADAR archive](https://pds-imaging.jpl.nasa.gov/volumes/cassim.html) and [USGS planetary mapping holdings](https://astrogeology.usgs.gov/search/results) | Global coverage is radar swath mosaicking with gaps and changing incidence; radar backscatter is not visible color. Do not fill gaps as if they were measured imagery. |
| Enceladus | [NASA PDS Cassini ISS archive](https://pds-imaging.jpl.nasa.gov/volumes/cassini.html) | High-resolution regional images exist, but there is no uniformly illuminated, complete global visible-color map; coverage and phase vary strongly. |
| Uranian moons | [NASA PDS Voyager imaging archive](https://pds-imaging.jpl.nasa.gov/volumes/voyager.html) | Voyager coverage is sparse and hemisphere-dependent for Miranda, Ariel, Umbriel, Titania, and Oberon. Any global-looking map would contain interpolation and must be labeled partial/derived. |
| Gas giants (Jupiter, Saturn, Uranus, Neptune) | [NASA/JPL planetary image archive](https://photojournal.jpl.nasa.gov/) and mission-specific PDS imaging archives | Cloud tops are time-variable atmospheric imagery, not fixed solid terrain. A texture must carry acquisition date, viewing geometry, and mission attribution; no height map should be inferred. |
| Sun | [NASA SDO image archive](https://sdo.gsfc.nasa.gov/data/) | SDO products are time-dependent solar-atmosphere imagery in instrument wavelengths, not a surface albedo map. False-color wavelength composites require their bandpass metadata. |
| Phobos | [USGS Phobos Viking Global Mosaic](https://astrogeology.usgs.gov/search/map/phobos_viking_global_mosaic_5m) | Real mapped spacecraft imagery exists, but illumination and seam quality vary; use its stated control/projection and public-domain USGS/NASA terms. |
| Deimos | [NASA PDS Viking imaging archive](https://pds-imaging.jpl.nasa.gov/volumes/viking.html) and [USGS Astrogeology holdings](https://astrogeology.usgs.gov/search/results) | Coverage is sparse compared with Phobos; no complete uniformly controlled global color mosaic should be assumed. |

### Downloaded small Mars visual map (not used as albedo)

The ignored original `output/surface-originals/mola_cylin.jpg` was downloaded
from NASA's [Interactive Mars Data Maps](https://marsoweb.nas.nasa.gov/globalData/):
`https://marsoweb.nas.nasa.gov/globalData/images/fullscale/MOLA_cylin.jpg`.
It is 5760×2880 RGB JPEG, SHA-256
`4be7f4347aca2d7273c123786744b02476c9a64ac89e6b76d7c1ba5978e6311b`, and is
described by NASA as the MOLA science-team cylindrical-projection map. Its
coordinates are global cylindrical, 0–360° east longitude with latitude rows
from 90°N to 90°S; the page identifies it as a composited MOLA visual map.
The rainbow colors encode/illustrate MOLA terrain and are not measured surface
albedo or photographic color. This unused candidate is never substituted for
the separately georeferenced Viking imagery.

### Downloaded NASA/JPL Mars texture candidate (not yet used)

NASA's [Mars Image Texture resource](https://science.nasa.gov/3d-resources/mars/)
identifies the texture as Viking imagery processed at USGS and credits NASA,
JPL, and Caltech. Its linked files are the 1440×720 RGB `Mars.jpg` (950.09 KB)
and `Mars.tif` (2.99 MB); the matching [JPL Solar System Simulator entry](https://space.jpl.nasa.gov/tmaps/mars.html)
describes the Mars texture as Viking / Caltech-JPL-USGS, 1440×720, 4 pixels per
degree, and links the original TIFF
`https://space.jpl.nasa.gov/tmaps/pix/mar0kuu2.tif`.

Downloaded ignored originals:

- `nasa-mars-Mars.jpg`: SHA-256 `12ec6bf02ebd42a246edc778cb2ce8c595b4d9f0892badf0bfff8abb2303c780`;
  NASA asset URL `https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/image/mars/Mars.jpg`.
- `nasa-mars-Mars.tif`: SHA-256 `fb094158273b465ba4c017be9d13e266a86921f3aa7ac0eb99d6943e0f3e5f47`;
  NASA asset URL `https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/image/mars/Mars.tif`.

The page supplies source/credit and raster dimensions, but does not state the
longitude origin, latitude convention, or projection in its public description.
Therefore this is a documented visual-color candidate, not a verified runtime
map: do not use it until the JPL/USGS product metadata confirms the equirectangular
orientation and prime-meridian convention. NASA's page supplies the credit;
retain it with any later derivative and do not claim the JPEG is an albedo
measurement.
