# Jupiter atmospheric surface sources

## Appearance

The color layer is NASA's official [Jupiter 3-D resource](https://science.nasa.gov/3d-resources/jupiter/). NASA identifies the texture as coming from Voyager images and credits JPL & Caltech. The preparation script pins the 2048x1024 WebP by SHA-256 before making any derivative. The [JPL Jupiter texture-map entry](https://maps.jpl.nasa.gov/tmaps/jupiter.html) provides the related Voyager/JPL-Caltech provenance.

The source is treated as an equirectangular, north-up, planetocentric map with east-positive longitude in `-180..180`, pixel-centered. NASA does not publish a cartographic geotransform or prime-meridian convention for this visualization texture, so absolute imagery alignment is explicitly unverified. This is a representative atmospheric appearance layer, not a current cloud map: JPL cautions that gas-giant atmospheric dynamics change daily and that these textures should not be used for scientific analysis.

## Height

Jupiter emits no height products. Cloud brightness, bands, and storms are color-only atmospheric appearance and are never interpreted as terrain or elevation. Runtime uses the canonical Jupiter PCK reference radius of 69,911,000 m; the atmosphere's visual extent remains governed by the existing atmospheric renderer and body rotation.

## Rebuild

```sh
node scripts/prepare-jupiter-surface.mjs --download-pinned --rebuild
```

For a fully offline reproducible rebuild, keep the downloaded file at
`output/surface-originals/jupiter-voyager-texture.webp` and run:

```sh
node scripts/prepare-jupiter-surface.mjs --rebuild
```

The script validates the pinned source hash and dimensions, then emits only
512x256 preview, 1024x512 medium, and native-capped 2048x1024 near JPEG color
derivatives under `assets/surfaces/`. The manifest records each derivative's
dimensions and SHA-256; it is not a runtime catalog entry.
