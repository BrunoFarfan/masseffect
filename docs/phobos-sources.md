# Phobos shape source

The checked-in Phobos mesh is derived from the NASA Planetary Data System
Small Body Optical Shape Models Bundle V1.0, specifically the ASCII product
`m1phobos.tab`:

- PDS logical identifier:
  `urn:nasa:pds:ast-sat.thomas.shape-models:data:m1phobos_tab`
- Product citation: Thomas et al. (2021), [Small Body Optical Shape Models
  Bundle V1.0](https://doi.org/10.26033/g5e0-kh52)
- PDS landing page: [Small Body Optical Shape
  Models](https://sbn.psi.edu/pds/resource/oshape.html)
- Source sampling: 2° planetocentric latitude/longitude grid, radius in km;
  source records and units are defined by the PDS label `m1phobos.xml`.
- Retrieved source SHA-256:
  `e19d7f585d710747fa4350c078c558003a7e2122162e908d5fdd33b1970f0b1b`

`scripts/prepare-phobos-shape.mjs` samples measured source vertices at 12°
latitude and 6° longitude, converts km to meters, and writes
`assets/surfaces/phobos-shape.json`. The result has 842 vertices and 1,680
triangles, with collapsed polar fans and body-fixed planetocentric coordinates:

`x = r cos(latitude) cos(longitude)`, `y = r sin(latitude)`,
`z = r cos(latitude) sin(longitude)`.

This is a bounded reduction of the measured PDS shape table, not an artist
model, ellipsoid fit, or spherical height-map substitute. It preserves the
selected source vertices and their irregular radial silhouette; the runtime
must treat it as a mesh and must not force it through the global DEM path.

The derived artifact SHA-256 is recorded in
`assets/surfaces/phobos-manifest.json`:

The manifest is regenerated together with the mesh, so its checksum tracks the
actual derived bytes. Reproduce with `node scripts/prepare-phobos-shape.mjs --download`.

The PDS bundle is distributed as scientific archive data; this repository
stores only the small derived mesh and provenance, not the original archive.
