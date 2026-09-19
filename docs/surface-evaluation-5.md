# Independent final product evaluation — round 5

Post-evaluation correction: the user identified horizontally mirrored Earth
geography. The original alignment score below missed a shared camera/world
handedness mismatch and must not be treated as validation of screen orientation.
The subsequent fix and regression checks are recorded in surface-development.md;
this historical evaluation has not been independently re-scored.

Overall: **7.3/10** (14-category mean 7.32). Functional and scientifically conscientious, but not showcase-ready for close surface exploration. Eight means showcase quality, not feature presence. This is the fifth and final evaluation; no further outer iteration recommended.

Read-only evaluator used a dedicated headed Chromium session, 1440×900, actual localhost app. No source edits. More than 30 screenshots are under `output/playwright/eval5-final-*.png`. Raw 120-frame measurements are in `eval5-final-metrics.json`; values describe this machine/session, not device-independent performance.

| Category | Score | Evidence and limit |
| --- | ---: | --- |
| Scientific correctness | 8 | Source notes/manifests distinguish DEMs, meshes, sparse Titan interpolation, procedural relief and emissive Sun. SI/render separation documented. Not an independent scientific audit of all 26 products. |
| Body-fixed alignment | 8 | Tycho/Olympus landmarks agree visually with mapped features; Deimos rotates and stays centered during accelerated playback; pole/seam sample has no obvious gap. PCK fixtures reviewed via source documentation. |
| Far appearance | 8 | Moon/Mars recognizable detailed disks; valid Sun disk stable and emissive. |
| Medium appearance | 7 | Strong global maps, but enlargement exposes softness, baked illumination and contrasting source tones. |
| Near appearance | 4.5 | Foreground becomes stretched blurred color; 2 m Moon/Mars effectively smooth planes, Earth low-altitude landscape weak. |
| Relief | 6.5 | Tycho and Olympus calderas are visible, Deimos has measured silhouette. Broad relief works; limited grid spacing and stepped skylines do not support ground-level fidelity. |
| Lighting | 6 | Dynamic day/night works but photographic lighting competes with terrain normals; several materials flatten or wash out. |
| LOD | 7 | Different distances load and blend without persistent corruption; near view still has stepped skyline and abrupt perceived loss of texture definition. |
| Camera | 8.5 | Live visit preserves play; pointer/W navigation works; 240 aggressive boosted rotation/movement steps stayed finite and above terrain. |
| Loading | 8 | No failed cache entries; bodies become usable quickly locally. Helper timing includes settling and is not cold-network latency. |
| Performance | 8.5 | Usually 16.7 ms median and ~18 ms p95. Ground Moon and reverse have higher tails. |
| Memory | 8 | Observed decoded cache below 96 MiB, bounded GPU accounting, zero context loss. Not whole-browser process memory. |
| Simplicity | 8 | Ctrl+K body/landmark search and arrival are straightforward; details are unobtrusive. |
| Visual coherence | 6.5 | Overall UI consistent, but Moon/Mars, flat illustrative meshes, grayscale Titan/Europa and Earth vary markedly in fidelity. |

Five remaining weaknesses:

1. Ground-level fidelity is the largest gap: soft or almost featureless planes, no local geology, highly stretched source pixels. See `moon-settled-ground`, `mars-ground`, `earth-alps`.
2. Terrain silhouettes are visibly stair-stepped at low altitude; broad DEM topology is useful but not a smooth detailed landscape. See `moon-extreme`, `moon-near`, `olympus`.
3. Lighting/materials do not consistently convey believable surfaces: Mars remains dark/mauve in a deliberately subsolar sample; Enceladus is washed out; Deimos is untextured tan. See `mars-near`, `enceladus`, `deimos-fast`.
4. Surface quality varies widely across bodies. Titan and Europa close views have little visual identity; Earth lacks a convincing close atmospheric/landscape appearance. Accurate source qualification does not itself improve visible quality.
5. At enlarged orbital scale, source-image illumination and tone boundaries compete with dynamic shading; existing coarse maps limit medium/near quality even when loading is successful.

Interaction coverage: actual Ctrl+K > Tycho while playing preserved playback (play button remained pause, simulation advanced); Ctrl+K > Olympus and Ctrl+K > Earth also succeeded. Moon/Mars far, medium, 15 km, 100 m and 2 m; Earth orbital, ocean close and Alps close; Deimos disk/normal/1 day-per-second/reverse; Jupiter, Sun, Titan, Enceladus, Europa; Moon 86° latitude at 179.99° longitude; actual pointer capture/look/W/Escape on Earth; injected camera stress separately. Did not visually exhaust every one of the 26 bodies.

Fixtures: Moon Tycho used explicit simulation day45.9. Mars generic distance cases used `sunlit:true`, meaning subsolar radial, not the latitude/longitude echoed by the helper. Olympus actual UI arrival used time4019160 s and Sun cosine0.7673, chosen analytically as a daylight fixture without changing physical material. These are controlled rendering fixtures, not claims of historically accurate ephemerides.

Benchmark summary: Moon/Mars at ordinary sampled distances median16.7 ms, p95 17.9–18.3 ms. Moon2m median18.9 ms, p95 23.0 ms, max25.1 ms. Earth orbital/close median16.7 ms, p95 18.0 ms. Deimos normal median16.7/p95 18.3 ms; accelerated16.7/18.0; reverse14.1/23.2. Initial measured peak decoded cache79,167,488 bytes (75.5 MiB); later Earth interaction79,321,200 bytes (75.6 MiB); cap100,663,296 bytes. Largest measured terrain GPU allocation46,137,344 bytes (~44 MiB), Deimos mesh176,256 bytes. Cumulative surface transfer102,594,621 bytes by playback tests includes repeated visits/cache churn, not initial payload. Local near helper settling generally1.07–1.19 s. Its ~16.09 s far/Deimos cases are a helper wait-for-near timeout and must not be reported as application loading latency. All sampled cache failed counts0, GPU errors null, contextLost false.

Camera stress minimum clearance1.9999903468 m across240 steps, position finite, still Moon surface frame. Actual Deimos body-relative distance15581.9298 m remained constant under normal and accelerated follow while silhouette rotated.

Regressions/final narrow fix: evaluator initially called Sun with `sunlit:true`, which was an invalid zero-radial fixture; initial `eval5-final-sun.png` is excluded from scoring. Independently, root fixed close analytic-sphere precision. After reload, valid Sun2m/100m and Jupiter2m show clean uniform surfaces, no salt-and-pepper artifact; Moon/Mars orbital regression captures remain recognizable. See `fixed-sun-2`, `fixed-sun-100`, `fixed-jupiter-2`, `fixed-moon-2000000`, `fixed-mars-4000000`. No persistent regression found in that bounded recheck. Final browser console reports0 errors and0 warnings. Prior rounds were not replayed, so no general historical regression claim is made.

Final post-fix Sun2m and Jupiter2m both measured16.7 ms median/18.2 ms p95; GPU memory2 MiB and8 MiB respectively, errors null and contextLost false. Raw values: `eval5-final-postfix.json`.

Some immediately captured helper frames retained a stale HUD/fallback frame; use the explicitly `settled-ground` images for Moon/Earth and `fixed-*` images for final analytic surfaces. Browser session closed after evaluation.
