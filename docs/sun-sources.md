# Sun surface appearance

The Sun uses a color-only emissive appearance. No height product is emitted,
and brightness, granulation, and sunspots are never interpreted as terrain or
elevation. The runtime reference radius is the canonical `SURFACE_PCK` value:
695,700,000 m.

## Source and limitations

This product is explicitly `procedural-emissive-approximate-photosphere` in
`assets/surfaces/sun-manifest.json`. A stable, trustworthy, globally mapped
NASA/JPL photosphere texture was not selected: available solar imagery is
observation-specific and does not provide a persistent full-surface map with
verified longitude/latitude registration. The prepared appearance is therefore
an original deterministic visual approximation, not solar imagery or a
scientific map. It should not be used for photometry, feature tracking,
orientation, or scientific analysis.

## Reproducible preparation

Run:

```sh
node scripts/prepare-sun-surface.mjs --rebuild
```

`--download` is accepted for command-line parity with sourced products but is a
no-op because there is no external source. The script samples smooth value
noise from a 3-D unit direction vector, so the equirectangular texture wraps
without a longitude seam. It produces restrained warm-white granulation and
modest spots, with no baked illumination. Preview is 512×256, medium is
1024×512, and near is intentionally capped at 1024×512 because this is a
procedural approximation rather than a high-resolution source reproduction.

The manifest records every derivative's dimensions and SHA-256 checksum,
processing description, coordinate addressing convention, canonical radius, and
the no-height policy.
