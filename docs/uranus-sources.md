# Uranus atmospheric surface sources

## Appearance

The color layer is the official [JPL/Caltech Solar System Simulator Uranus texture map](https://maps.jpl.nasa.gov/tmaps/uranus.html), also linked from NASA's [Uranus 3-D model resource](https://science.nasa.gov/resource/uranus-3d-model/). JPL identifies the 720x360 source as a fictional, plain solid-blue representative texture. The preparation script pins the downloaded JPEG by SHA-256 before making derivatives.

JPL cautions that maps of Uranus and the other gas/ice giants are representative, that atmospheric dynamics change daily, and that the textures should not be used for scientific analysis. The source is preserved in its supplied pixel order. Runtime uses an east-positive `-180..180`, north-up, 2:1 texture convention, but the source does not publish a cartographic geotransform, prime meridian, longitude sign, or pole-orientation metadata: absolute imagery alignment is explicitly unverified.

## Height

Uranus has no solid terrain in this asset. No height files are emitted; the atmospheric color is never interpreted as elevation. The canonical runtime reference radius is 25,362,000 m from the repository's NASA NAIF-derived `SURFACE_PCK`. The existing oblate PCK shape and Uranus rotation remain runtime responsibilities.

## Rebuild

```sh
node scripts/prepare-uranus-surface.mjs --download-pinned --rebuild
```

For an offline rebuild, retain `output/surface-originals/uranus-jpl-texture.jpg` and run:

```sh
node scripts/prepare-uranus-surface.mjs --rebuild
```

The script validates the pinned source hash and dimensions, then emits only a 512x256 preview plus native-capped 720x360 medium and near JPEG color derivatives under `assets/surfaces/`. Because the official source is only 720x360, no derivative is upscaled. The manifest records every derivative's dimensions and SHA-256.
