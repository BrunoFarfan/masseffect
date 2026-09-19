# Neptune atmospheric surface sources

## Appearance

The color layer is NASA's official [Neptune 3-D resource](https://science.nasa.gov/3d-resources/neptune/), using the representative atmospheric texture exposed by NASA's asset service. The related [JPL Neptune texture-map entry](https://maps.jpl.nasa.gov/tmaps/neptune.html) is the mission/map provenance and cautions that gas-giant maps are representative: atmospheric dynamics change daily and the maps are not for scientific analysis.

The source is kept as a 2:1 image texture. Runtime samples it with east-positive `-180..180`, planetocentric latitude, and north-up conventions, but NASA/JPL does not publish a cartographic geotransform, prime meridian, or orientation metadata for this visualization asset. Absolute imagery alignment is therefore explicitly unverified.

## Height

Neptune emits no height products. Cloud brightness and structure are color-only atmospheric appearance and are never interpreted as terrain or elevation. Runtime uses the canonical Neptune PCK reference radius of 24,622,000 m; atmosphere extent and rotation remain governed by the existing runtime model.

## Rebuild

```sh
node scripts/prepare-neptune-surface.mjs --download-pinned --rebuild
```

For an offline rebuild, keep the downloaded file at
`output/surface-originals/neptune-nasa-texture.webp` and run:

```sh
node scripts/prepare-neptune-surface.mjs --rebuild
```

The script validates the pinned source SHA-256 and 2048x1024 8-bit sRGB
3-channel dimensions, then emits only 512x256 preview, 1024x512 medium, and
native-capped 2048x1024 near JPEG color derivatives under `assets/surfaces/`.
The manifest records each derivative's dimensions and SHA-256; no height
products are generated.
