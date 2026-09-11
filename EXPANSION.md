# Expansion cycle

Previous cycle pushed to origin/main as e14d9e3 before starting this work.

## Outcome

Five expansion iterations plus one final verification pass. Independent final score: **8.0/10**. All **70 tests pass**; syntax/whitespace checks pass. The evaluator recommends stopping feature work. Current expansion changes remain local; only the pre-loop baseline was pushed.

| Pass | Focus | Independent overall score |
| --- | --- | ---: |
| 1 | Navigation, sparse UI, moons, close spheres | 6.4 |
| 2 | Presets, placement, scenarios, local trails | 7.1 |
| 3 | Recorded rewind, stellar/thermal properties | 7.4 |
| 4 | History controls, impacts, rendering cadence | 7.8 |
| 5 | Randomization, time consistency, follow cleanup | 8.0 |
| 6 | Final history presentation verification | 8.0 |

Full independent scores, five remaining weaknesses, regression notes and screenshot observations are preserved in [review 1](docs/expansion-evaluation-1.md), [review 2](docs/expansion-evaluation-2.md), [review 3](docs/expansion-evaluation-3.md), [review 4](docs/expansion-evaluation-4.md), [review 5](docs/expansion-evaluation-5.md), and [final verification](docs/expansion-evaluation-6.md). Screenshot artifacts are local under `output/playwright/` and intentionally excluded from Git.

Remaining scope limits: bounded history, deliberately approximate four-fragment impacts, primary-light visual shading, no exact-state ghost in Advanced, and CPU-limited maximum acceleration of the complete moon system. These do not justify further feature growth in this cycle.

## Iteration 1 — core inspection

Builder: replaced persistent statistics/instructions with contextual selection and explicit menus. Navigation captures the pointer after a browser-required initial click, then uses continuous mouse look; Escape releases it. Removed original orbital ellipses from both initialization and rendering. Added 17 moons using approximate JPL-based SI initial states, all receiving ordinary gravity. Camera movement slows near surfaces and cannot tunnel through spheres. Close views use ray/sphere shading, including surfaces whose centers leave the viewport. Focus frames a planet's moon system; Go closer approaches its surface.

Current limits to evaluate: raw creation form intentionally remains until the next iteration; no scenarios or reverse yet. Moon timesteps materially increase CPU work. Close-surface fidelity is deliberately simple. Default labels should suppress unresolved moons without hiding them from selection.

Independent evaluation: **6.4/10**, following eight minutes of desktop interaction and seven inspected screenshots. Main weaknesses: coarse close-sphere edges, unattainable maximum time rates, heliocentric moon trails, disconnected raw creation, and misleading moon hierarchy. No browser errors or stuck capture observed. Full evidence: output/exp-evaluation-1.md.

## Iteration 2 — useful experiments

Builder: introduced 13 physically meaningful presets with relative target/distance, inclination and orbital/stationary/random velocity choices. A live ghost and relative velocity arrow preview the arrival; exact SI coordinates remain under Advanced. Six curated scenarios reuse ordinary gravity. Grouped moons under their parents. Close-follow moon trails now use recorded parent-relative positions (not generated ellipses). Added analytical edge coverage and subdued giant-planet bands to near spheres.

Exact scalar force/contact scans replace temporary per-pair vectors: reference-comparison tests show identical results with roughly 3–5× faster hot paths on this machine. A fixed one-second quantum makes real-time mode responsive without tying physics steps to rendering. Actual achieved speed still reports saturation.

Validation: 36 numerical tests pass (including prepared history/thermal modules, not yet integrated). Syntax checks pass. Builder released a Jupiter preset and loaded the binary-star scenario, inspected placement and binary screenshots, then closed its browser. Evaluator should stress close views, local trail interpretation, creation payoff, and actual time acceleration.

Independent evaluation: **7.1/10**, after five minutes and ten inspected screenshots. Close edges, local trails, grouped moons, visible arrival release and real-time progress improved. Remaining priorities: honest rate expectations, dim/featureless near surfaces, stale selection during placement, clipped SI values, and revisit/history. The evaluator retested preview framing after its transition and withdrew the initial tiny-preview criticism. No console errors; browser closed.

## Iteration 3 — revisit an encounter

Builder: adds bounded recorded rewind and forward branching, explicitly distinct from analytical reversal of inelastic collisions. Sparse snapshot interpolation was rejected after a regression experiment placed Phobos inside Mars: intermediate replay instead uses ordinary gravity steps. History stores at most 900 snapshots / 32,000 body records and omits trail caches.

Added stellar luminosity and effective temperature, a restrained temperature-based stellar palette, and multistar radiative equilibrium temperature in explicit Details only. Stellar mergers sum incoming luminosity and recompute an internally consistent toy effective temperature; no stellar evolution is claimed. Merging repairs parent relationships and local trail caches.

Placement now suppresses stale selection information and uses an off-axis projection to center the visible region beside the drawer. Advanced inputs show compact scientific notation while preserving untouched exact values. Upper time choices say “Up to”; saturation is explicitly labeled “CPU limit.” Close surfaces gain gentler ambient light and very subtle illustrative rocky variation. Scenario identity stays visible.

Independent evaluation: **7.4/10**, after 5m32s. Actual UI collision/rewind changed 26 bodies back to 27 with the asteroid restored. Overview median/p95 frame intervals were 16.7/17.5 ms; close accelerated Earth was 16.7/33.4 ms. The five priorities were a direct rewind pause, visible history extent, offscreen impact recovery, close-trail clutter, and close-view frame pacing. Browser closed; 47 tests passed at review.

## Iteration 4 — controlled consequences

Builder: separated rewind, pause and forward actions; added a small scrubber only when paused/rewinding, with visible available past/future durations. Preserved placement framing after release and transferred a followed absorbed body to its survivor. Actual trails fade near surfaces instead of cutting across close views.

Near-sphere shading now runs inside conservative analytic pixel bounds, retaining the original edge coverage and full-viewport fallback at the horizon. Tests check every originally covered pixel in sampled cases; at a three-radius approach only 28.9% of the full raster needs shading.

Added one curated planetary impact and bounded four-fragment disruption for energetic, comparable nonstellar impacts. Mass, linear momentum, volume and center of mass are preserved. Ejection energy is bounded; stars, small impacts, cap-exceeding impacts and second-generation fragments merge. This is explicitly an approximate displacement model, not material fracture, angular-momentum/spin conservation or stellar evolution.

Independent evaluation: **7.8/10**, after 3m09s. Verified four fragments → two originals → four fragments, direct rewind pause, scrubbing and branching. Close-Earth p95 improved from 33.4 to 17.2 ms. Remaining concrete defects were the toast overlapping the new scrubber and a constant random provider; fast-release tracking and label repetition were minor. Browser closed; 64 tests passed.

## Iteration 5 — final consistency

Builder: separated the toast from visible history controls. Placement attempts now sample fresh random values once and retain them across preview/inspection/release; duplicate default body names receive a suffix. Advanced coordinates disable semantic fields while editing, preventing competing sources of truth. Fragment labels are shortened in the scene, while full names remain in the accessible body list.

A final audit found that the low-speed timestep fallback depended on pending render debt: at 60×, 30 FPS advanced only half as far as 60 FPS. Rates up to 3,600× now use a fixed one-second maximum; tests verify identical inert and binary states at 30/60/120 FPS. The time-budget safeguard remains active. Follow resolves a complete same-step merger chain before looking up the final survivor, with a regression test.

Removed unused original visitor generation and styling. No new product features in this iteration.

Builder validation: 70 tests pass, including sampled-placement stability, real frame-cadence equivalence and chained-merger camera recovery. Syntax and whitespace checks pass. In the browser, new placement attempts produced different inspected velocities; an actual impact was paused with the toast clearly above the scrubber. The builder inspected its screenshot and closed the browser before independent review.

Independent evaluation: **8.0/10**, after 3m23s. Confirmed stable random previews and fresh retries, unique naming, four ↔ two body history, forward branching, real-time progress, navigation and close rendering. Final 120-frame median/p95 was 16.7/17.5 ms. The evaluator judged the core coherent and recommended stopping feature expansion. Two small display defects remained: a negative future-history label and a stale event message after seeking backward.

## Pass 6 — final verification, no expansion

Captured the current forward state on pause so the latest recording includes the paused instant; clamped displayed history durations nonnegative. Rewind, seek and scenario changes clear transient event messages, preventing a future impact message from appearing above restored intact worlds. No other product behavior changed. This pass only verifies the final two presentation corrections.

Independent final verification: **8.0/10**, after 3m11s. Confirmed +0 s at the paused latest state, cleared history-event messages, four → two → four bodies, branching, real-time progression, random release and aggressive planet/moon navigation. All 70 tests passed; console clean. Final 120-frame median/p95 was 16.7/17.4 ms. No critical regression. All testing browsers were closed after their purpose; feature development stopped.
