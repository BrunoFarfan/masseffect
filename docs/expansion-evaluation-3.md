# Expansion evaluation 3

Independent desktop review, 2026-09-11 14:00:55–14:06:27 UTC: **5 minutes 32 seconds**. Fresh browser; closed when finished. Overall **7.4/10: good, with noticeable interaction roughness**. The numerical/history work is substantial, but reverse navigation still falls below a polished exploratory tool.

| Category | Score | Observations |
|---|---:|---|
| Physics | 8.3 | 47/47 tests pass. UI impact actually occurred, then recorded rewind restored the absorbed asteroid. Numerical conservation, history replay, moon midpoint safety and stellar metadata have focused tests. |
| Camera | 7 | Focus/close Earth, Moon, Sun and initial captured flight worked. Impact changed selection to Earth but left the event offscreen. |
| Visual quality | 7 | Smooth close edges, brighter coherent shading and subtle rocky variation fit the simple sphere design. No requirement for terrain; remaining concern is distracting line composition at close scale. |
| UI minimalism | 8 | New physics details and rewind fit sparsely. Advanced scientific notation and sticky release resolve previous input clutter. |
| Body creation | 7.8 | Semantic asteroid and exact-state inspection enabled deliberate impact. Drawer-relative framing and hidden old selection improve placement context. |
| Scale/orientation | 7.3 | Parent frame text, distance and scale are useful. Local Moon close view still has long offscreen trail segments. |
| Time controls | 6.7 | Physical rewind works, but lacks a direct pause control and visible history position/range. Upper-speed labels now say 'Up to'. |
| Performance | 7.3 | Overview cadence is near 60 Hz; close accelerated scene has a 33.4 ms p95, about 30 Hz tail intervals. Console clean. |
| Simplicity | 7.8 | Compact semantic creation remains approachable. Rewind interaction requires discovering workarounds for precise stopping. |
| Sandbox enjoyment | 7.5 | Recreating and undoing a real collision is a meaningful improvement. Event camera context and temporal targeting limit the payoff. |
| Coherence | 7.5 | Thermal details, SI creation, dynamics and visual hierarchy largely fit together; history presentation is the main unfinished seam. |

## Actual interaction and validation

Entered from a fresh session, brought browser foreground, attempted captured W/mouse motion and escaped. Selected real time, created Asteroid stationary relative to Earth at 6500 km, expanded exact SI fields, released and accelerated to 1 hour/sec. UI status read 'Earth absorbed Asteroid'. Initial attempt to stop rewind using the expected Pause button timed out because its button becomes Play forward; rewind continued beyond the intended moment. Repeated the collision experiment from a fresh Solar System scenario to obtain unambiguous DOM evidence: post-impact list **26 bodies**, status **Earth absorbed Asteroid**; approximately 805 ms of rewind followed by opening Bodies yielded **27 bodies**, including **Asteroid**, at **00:00:58**. This establishes actual UI predecessor restoration, not only a unit-test claim. Forward resumed and scenario reset worked afterward.

Approached Earth and inspected equilibrium temperature (256–257 K in the observed orbit); measured overview and close accelerated frame cadence; approached Moon; focused Sun and inspected luminosity 3.83e26 W and effective temperature 5772 K. Advanced SI fields display compact exponents, and Release remains visible at 900 px viewport height. Multiple screenshots below were inspected visually. Console had zero errors/warnings. `just test`: 47 passed. Unwired impact/fragmentation additions receive no credit.

## Bounded animation measurement

Measured 120 consecutive requestAnimationFrame intervals in each state, in this headed 1440×900 browser. These are short local cadence samples, not a cross-device FPS guarantee.

| State | Median | p95 | Worst interval | Worst interval equivalent |
|---|---:|---:|---:|---:|
| Solar overview, 1 day/sec | 16.70 ms | 17.50 ms | 17.70 ms | 56.5 fps |
| Close Earth, up to 1 year/sec | 16.70 ms | 33.40 ms | 33.60 ms | 29.8 fps |

## Five weaknesses and recommendations

1. **Rewind cannot be paused directly with the visible time controls.** While rewinding, the play button becomes Play forward, not Pause; the reviewer had to open Bodies to freeze a restored moment. Add a separate pause action or a rewind button that toggles pause, with an unambiguous active state. This is a practical issue exposed by an actual collision experiment.
2. **The available recorded past is invisible until its boundary is reached.** The bounded history may be technically correct, but without an extent/position indicator it is hard to know whether an event remains reachable. A very small timeline/range readout and a way to choose a moment would make the approximately 30-second recording window useful. This review observed the start-of-recorded-history status; it did not independently exhaustively measure retention duration.
3. **An impact can leave the whole event offscreen.** After Earth absorbed the selected Asteroid, Earth was reachable only by its locator, with an otherwise empty viewport. Preserve the selected body's parent frame through release/absorption or provide a concise View event action. The event log alone is not sufficient visual feedback.
4. **Close-scale historical lines can dominate composition.** The Moon close screenshot has a bright long tangent-like line extending to the screen edge plus another unrelated line across the bottom. Fade/cull unsuitable distant segments while preserving real historical trajectories. Clean circles are acceptable; the issue is line legibility and composition, not missing terrain.
5. **Maximum-rate close rendering has uneven frame cadence.** The median remains good but p95 doubles to 33.4 ms. Keep prioritizing input/render work ahead of simulation debt and avoid unnecessary near-sphere redraw work; make attained rate legible when physics caps it. The new 'Up to' label is more honest but does not by itself explain capacity.

## Regression assessment and limits

No observed crash or console regression. Advanced-field clipping/sticky release and drawer framing improve the previous iteration. Rewind restores real collision predecessors; bounded replay does not visibly explode in this exercise. The absence of rewind pause is newly exposed functional roughness. Captured-flight entry displayed a retry hint in one screenshot, so universal first-click lock success is not claimed. Stellar merger UI was not forced; its metadata behavior is test-covered. Exact collision mass/momentum values were not read through UI. New fragmentation was not wired and not evaluated.

## Screenshot evidence

- `output/playwright/exp-eval3-collision-setup.png`: readable advanced SI, left-shifted framing, sticky release.
- `output/playwright/exp-eval3-after-collision.png`: actual Earth absorbed Asteroid status, empty event view and locator.
- `output/playwright/exp-eval3-rewound-list.png`: intermediate exploration attempt; not the definitive count evidence.
- `output/playwright/exp-eval3-collision-restored.png`: definitive repeated collision restored asteroid option at 00:00:58; DOM count 27.
- `output/playwright/exp-eval3-earth-details.png`: close Earth, equilibrium-temperature readout.
- `output/playwright/exp-eval3-close-speed.png`: close Earth under upper-rate selection.
- `output/playwright/exp-eval3-moon-close.png`: smooth sphere, subtle shading and distracting historical line composition.
- `output/playwright/exp-eval3-sun-details.png`: stellar luminosity/effective temperature and simple coherent rendering.
