# Deimos shape source

The checked-in Deimos mesh is derived from the NASA Planetary Data System
Small Body Optical Shape Models Bundle V1.0, specifically the ASCII product
`m2deimos.tab`:

- PDS logical identifier:
  `urn:nasa:pds:ast-sat.thomas.shape-models:data:m2deimos_tab`
- Product citation: Thomas et al. (2021), [Small Body Optical Shape Models
  Bundle V1.0](https://doi.org/10.26033/g5e0-kh52)
- Shape-model method: Thomas (1993), [Gravity, tides, and topography on small
  satellites and asteroids](https://doi.org/10.1006/icar.1993.1130)
- PDS landing page: [Small Body Optical Shape
  Models](https://sbn.psi.edu/pds/resource/oshape.html)
- Source: [m2deimos.tab](https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/data/m2deimos.tab)
  and its [PDS label](https://sbnarchive.psi.edu/pds4/non_mission/ast-sat.thomas.shape-models_V1_0/data/m2deimos.xml)
- Source sampling: 5° planetocentric latitude/longitude grid, radius in km;
  source records and units are defined by `m2deimos.xml`.
- Retrieved source SHA-256:
  `9a4dbc132c7546acb2ef26a386d306f155519f0988c8052acb2276ddeb7ca2fd`
- Retrieved label SHA-256:
  `74b4c557e6827940430b2d670ec972d9a5d5dc63ef0a95b2b6ebd141ab78f634`

`m2deimos.xml` identifies the coordinates as planetocentric and the values as
degrees and kilometers. Planetocentric longitude uses the standard +East
direction; the USGS +West convention applies to Deimos planetographic
coordinates and is not silently substituted here. The mesh uses
`x = r cos(latitude) cos(longitude)`, `y = r sin(latitude)`, and
`z = r cos(latitude) sin(longitude)`, with km converted to meters.

`scripts/prepare-deimos-shape.mjs` samples every 10° latitude and every 5°
source longitude, preserving measured source vertices. It collapses the
duplicated -90° and +90° source longitude rows into one vertex per pole and
uses consistently outward-wound triangles. The result has 1,226 vertices and
2,448 triangles. It is a bounded reduction of the measured Viking-derived
shape table, not an ellipsoid fit, sphere, or spherical height-map substitute.

To reproduce after downloading the pinned source:

```sh
node scripts/prepare-deimos-shape.mjs --download
```

For offline reproduction, provide an existing checksum-verified source:

```sh
node scripts/prepare-deimos-shape.mjs --source output/surface-originals/m2deimos.tab
```

The PDS bundle is scientific archive data; this repository stores only the
small derived mesh and provenance, not the original archive.
