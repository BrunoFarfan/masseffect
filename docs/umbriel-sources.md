# Umbriel surface sources

## Appearance

The color layer is NASA's official [Uranus–Umbriel 3-D resource](https://science.nasa.gov/3d-resources/uranus-umbriel/), credited to USGS/Tammy Becker and JPL/Caltech and mosaicked with Voyager imagery. The pinned 2048x1024 WebP is downloaded by `scripts/prepare-umbriel-surface.mjs` and checked by SHA-256 before derivatives are made. Voyager 2 mapped mainly the southern hemisphere; unmapped regions remain source gaps or explicitly approximate appearance.

The NASA page does not publish longitude/latitude registration, control points, or a verified pole orientation for this rendered texture. JPL's [planetary map catalog](https://maps.jpl.nasa.gov/tmaps/) also describes these maps as representative/aesthetically edited, not scientific-analysis products. The manifest therefore records source alignment as unverified. The runtime uses a documented equirectangular normalization (`east-positive -180..180`, north at top, pixel-centered) for addressing only; it must not be treated as scientifically verified longitude.

## Height

No reliable complete global Umbriel DEM is available. Medium and near levels use a restrained seamless direction-vector field generated independently of color. This is a visual approximation, not measured Umbriel topography, and does not sample image brightness. Height files are little-endian uint16 with `radial height = -120 + sample * 0.5 m`; each manifest records decoded minimum and maximum metres and its hash.

## Rebuild

```sh
node scripts/prepare-umbriel-surface.mjs --download-pinned --rebuild
```

For an offline reproducible rebuild, retain the downloaded file at `output/surface-originals/umbriel-voyager-texture.webp` and run:

```sh
node scripts/prepare-umbriel-surface.mjs --rebuild
```

The script emits 512x256 preview color only, 1024x512 medium color plus height, and native-capped 2048x1024 near color plus height under `assets/surfaces/`. The source SHA-256 is `bc38cae37204856e174bb8474e004f0a033ecee3fda001f4752bbd64c0c6511e`.
