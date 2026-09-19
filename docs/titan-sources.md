# Titan surface sources

## Terrain

The bundled height field is the `topo_4PPD_interp.cub` product in the Corlies
et al. (2017) archive, *Titan's Topography and Shape at the End of the Cassini
Mission*. It combines Cassini RADAR altimetry, SARtopo, and
stereophotogrammetry, then applies a radial-basis-function interpolation to a
global 4 pixels/degree grid. The product is real Cassini-derived topography,
but only about 9% of Titan's area is directly constrained; the remaining grid
is interpolation and must not be described as uniformly measured terrain.

The earlier Lorenz et al. (2013) 1° spline-interpolated topographic map remains
the historical USGS reference and is retained as a source-page reference. The
USGS PDF is not decoded for height: PDF color is not a DEM. The Corlies archive
is pinned at `output/surface-originals/titan-topo-corlies.zip` by SHA-256 in the
preparation script and is reproducibly extracted offline.

The source uses a 2575 km spherical datum, planetocentric latitude, positive-
east longitude in `-180..180`, and north-up equirectangular geometry. Runtime
heights use the same canonical 2,575,000 m radius and encode metres as little-
endian uint16 (`elevation = -1800 + sample * 0.05`).

## Appearance

Color is independent of height and comes from NASA/JPL-Caltech/University of
Arizona's Cassini ISS global near-infrared mosaic, PIA22770, at 938 nm. NASA
describes this as a calibrated global mosaic assembled from 9,873 ISS images
with atmospheric and instrumental variation treated in the photometric model.
It is a mapped surface-under-the-haze appearance layer, not an elevation
measurement and not a substitute for the topographic grid.

Source pages:

- https://astrogeology.usgs.gov/search/map/lorenz_et_al_2013_titan_topographic_map_of_titan
- https://doi.org/10.1002/2017GL075518
- https://data.astro.cornell.edu/titan_topo_corlies/
- https://science.nasa.gov/resource/titan-mosaic-the-surface-under-the-haze/

Run `node scripts/prepare-titan-surface.mjs --rebuild --offline` after the
pinned originals exist. `--download-pinned` performs the network acquisition;
the rebuild itself only reads `output/surface-originals`.
