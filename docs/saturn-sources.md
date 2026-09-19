# Saturn atmospheric surface sources

The color layer is NASA's [Saturn 3-D resource](https://science.nasa.gov/3d-resources/saturn/), identified as a fictional image texture from the JPL/Caltech generated planetary-map database. The pinned 2048x1024 WebP is downloaded by `scripts/prepare-saturn-surface.mjs` and checked by SHA-256 before derivatives are made. JPL's [texture-map catalog](https://maps.jpl.nasa.gov/tmaps/) explicitly describes gas-giant maps as representative atmospheric appearances that change over time and are not for scientific analysis.

The source is preserved in its supplied pixel order. The runtime convention is a 2:1 equirectangular-style east-positive `-180..180`, north-up sampling convention, but NASA/JPL's public source metadata does not specify Saturn's prime meridian, longitude sign, or pole orientation. Alignment is therefore explicitly unverified; the script validates raster dimensions/channels/depth and performs no flip or rotation.

Saturn has no solid surface terrain in this asset. No height files are emitted, and cloud brightness is never interpreted as elevation. The canonical runtime reference radius is 58,232,000 m from the repository's NASA NAIF-derived `SURFACE_PCK`.

## Rebuild

```sh
node scripts/prepare-saturn-surface.mjs --download-pinned --rebuild
```

For an offline rebuild, retain `output/surface-originals/saturn-nasa-texture.webp` and run:

```sh
node scripts/prepare-saturn-surface.mjs --rebuild
```

The script emits 512x256 preview, 1024x512 medium, and native-capped 2048x1024 near JPEG color derivatives under `assets/surfaces/`. The manifest records the pinned source hash, each derivative hash, dimensions, attribution, and the atmospheric/no-terrain policy.
