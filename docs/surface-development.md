# Planetary surfaces — implementation and evaluation log

## Scope and workflow

This cycle starts from `d9e87ea`. The scope began as a strong Moon/Mars rendering
and asset foundation, without changing the SI orbital solver or adding a terrain
engine. During round five, the user expanded it to all canonical bodies, named
landmarks, live surface visits and Cmd/Ctrl+K search. All 26 now have prepared
surface/atmospheric products, with scientific and illustrative coverage separated.

Requested workflow: `agentic-build`, Luna/medium builders, Astra/medium independent
code review, and a separate Astra/medium product evaluator. Accepted child
overrides use `gpt-5.6-luna` and `gpt-6-astra`; the already-running root lead's
model cannot be changed by a skill and its exact configuration is not exposed.
Three bounded builders handled assets, coordinate/cache helpers, and GPU code.
Lead integration corrected draft pixel formats, height datums, map wrapping,
resource lifetime, ray convergence and the shared clearance contract. Builder
syntax checks were not treated as browser validation.

At most five outer build/evaluate rounds and five internal review/fix cycles per
round. No commit, push or deployment is authorized by this workflow.

## Architecture decision

Keep Canvas for the existing scene and add a single native WebGL2 surface pass.
There are no new browser dependencies. `just benchmark-surfaces` exercises a
bounded CPU reference intersection: on this development machine, its warmed
intersection-only times were 62 ms at 320×200, 140 ms at 480×300, and 570 ms at
960×600. This was insufficient even before texturing and lighting. GPU body-local
coordinates are scaled purely for rendering precision; simulation and camera
state remain meters, kilograms and seconds.

The data flow is manifest → lazy decoded asset cache → shared surface state →
GPU ray renderer and CPU camera clearance. `SurfaceDefinition` and its visual
frame are separate from the body's physical radius, mass and integrated spin.
Canonical radius/mass guards prevent an altered collision survivor from keeping
an authoritative planetary texture. The existing orbital collision solver is
unchanged.

## Round 1 — scientific foundation and close-surface path

- Downloaded pinned LROC/LOLA and MOLA MEGDR radial shape products. Originals
  remain under ignored `output/surface-originals`; only bounded derivatives ship.
- Added 512×256, 1024×512 and 2048×1024 progressive levels. Height is uint16LE
  on disk, explicitly decoded into meters; it is never inferred from color.
- Added NAIF-derived visual frames, wrapped bilinear sampling, terrain normals,
  displaced ray intersections, shared camera clearance, and contextual landmark
  visits/1×–3× visual relief controls in Details.
- Added explicit build allowlisting for prepared assets, source catalog,
  reproducible preparation and frame-time/browser staging helpers.
- Initial internal review: one high (CPU/GPU activation mismatch), one medium
  (grazing sweep exhaustion), one low (failed load status). All fixed and
  independently verified. Regression suite: 138 passing tests.
- Baseline Moon orbital frame pacing: median 16.7 ms, p95 17.8 ms (120 frames,
  1440×900 Chromium). Early 1 km Moon terrain run: median 17.0 ms, p95 18.2 ms;
  representative measurements must be repeated after visual fixes.

Scored product evaluation is tracked separately from code review below.

Independent product evaluation: **5.5/10**. Scientific correctness6,
alignment6, far7, medium6, near4, relief4, lighting5, LOD5, camera6,
loading7, performance8, memory8, simplicity8, coherence5. Moon orbital
imagery was strongest; 2m ground was nearly uniform, Mars false-color was
unconvincing, and Olympus visits from surface mode ended at2m instead of
the intended altitude. The latter was canonical radius+20km placing the camera
inside Olympus' real elevation, not a failed camera collision.
Eight actual Moon/Mars browser cases at1440×900: median16.6–16.7ms,
p9517.8–18.7ms. CPU asset cache peaked42,991,616B under50,331,648B;
GPU detailed-body textures16,777,216B, released in system view. Measured
clearance Moon2.000013m/Mars2.000001m; rotation stress stayed finite.
Physical pointer capture was not verified in the automated browser.
Screenshots: `output/playwright/eval-moon-2-confirmed.png`,
`eval-moon-3500000.png`, `eval-ui-olympus.png` and the other `eval-*` cases.
Evaluator closed its browser.

## Round 2 — imagery, local detail and terrain visits

Two Luna/medium assignments: filtered procedural micro-normal rendering and
complete Moon/Mars text-PCK analytic orientation. Lead corrected raster crop
coordinates, detail-filter scales and lighting, integrated a verified USGS
Viking MDIM2.1 color mosaic using its PAM geotransform, and repaired landmark
visits to wait for terrain and use15km above local relief. These are independent
from the physical SI state. `sharp` is now an explicit offline development
dependency. Current140 tests, syntax and preview build pass.
Repeated Olympus visit from2m measured14999.999997m and reported completion.
Microdetail 2m lunar case: median16.7ms, p9518.4ms at1440×900.
The runtime rejected a new agent thread; the existing independent Astra reviewer
is reused without giving it implementation work. Product evaluation remains a
separate Astra role.

Round2 independent product score: **6.2/10**. Category order as round1:
7,7,7.5,6.5,4.5,5,6,5.5,5.5,7,8,8,8,6.5. Real Mars imagery, contextual
landmarks and warm visits improved. Cold first Olympus visit still ended at2m
while claiming15km (now reproduced independently). Cancellation prevented the
jump but left stale status. Close terrain remained too soft. Eight cases:
median16.6–16.7ms,p9517.7–18.3ms, GPU16.8MB. Half-resolution fallback had no
observed cropping gaps. Browserclosed.

## Round 3 — native Tycho relief and cold-load stability

Two Luna/medium tasks extended the existing shared CPU/cache and GPU paths
with one bounded regional DEM, not a terrain engine. Lead corrected regional
pixel-center sampling, prepared a native896×896 LOLA64 Tycho crop with verified
range/strip provenance, and repaired cold navigation by sampling the destination
radial rather than a staging position that changed during load. Camera frame
provider activation/loss is now rebased rather than applied as physical rotation.
Cancellation clears pending preparation feedback. SI physical state is unchanged.
First cold Olympus visit measured15000.003m clearance.
Independent code review verified every prepared regional row against the pinned
source band and all150 tests. One low disposal-contract finding was fixed.
Fixed daylight fixture at45.9d, Tycho1km,1440×900: full256 refinement ceiling
median26.2ms,p9531.5ms; firstfallback192/full20.6/24ms; secondfallback192/75%
16.7/18.1ms. The close regional path now ramps75–100% raster over the first15km
reference altitude. No texture resolution or measured relief was removed.
CPU asset memory remains below48MiB; regional GPU textures total19,988,480B.

Round3 independent product score: **6.6/10**. Category order as round1:
7.5,7,7.5,6.5,5.5,6,5.5,5.5,7.5,8,8,8,7.5,6.
Cold Tycho/Olympus visits now reached15km; cancellation cleared feedback.
Tycho1km/2m showed real crater geometry, and regional borders had no obvious
seam. However the192-iteration default produced thin sky-colored horizon slits;
the evaluator's256-iteration diagnostic removed them. Daylit Moon still looked
too pale/soft, Mars close views coarse, and bright terrain weakened UI contrast.
Independent medians16.6–16.7ms,p9517.7–18.2ms, peakdecoded42.01MB.
Screenshots: `output/playwright/eval3-*`. Evaluator browserclosed.

## Round 4 — grazing solidity, imagery and independent alignment

Restored256 refinement ceiling, retained the75–100% close raster ladder,
and unified integer GPU scissor/composite crops. Color now uses genuine4K
Moon/Mars near maps,2K medium,512 preview; globalheight remains2K near/1K
medium. CPU cache96MiB, bothnear levels83.06MiB combined. GPU texture release
continues when bodies are not drawn. Sharper imagery does not invent geometry.

Independent WebGeocalc fixtures use latest `pck00011` rather than mission
kernel sets that override Mars with older constants. All prime/east/north
axes match to1e-8 at three dates. Independent code review found no new issues;
151 tests pass. Lead1440×900 measurements: Tycho15km16.6/18.1ms median/p95,
Tycho2m16.6/18.6ms, Olympus15km16.7/17.6ms. PeakCPU98,631,680B beneath
100,663,296B; oneMoon GPU45,154,304B, Mars41,943,040B. Builderbrowserclosed.

## Scientific limitations

- Moon color is NASA's visualization-oriented LROC composite, including polar
  fills; it is not calibrated scientific photometry.
- MOLA radius grids include interpolated gaps. Mars Viking imagery contains
  baked illumination, acquisition seams and colorization, not calibrated albedo.
- Global 2048×1024 terrain cannot reveal real meter-scale geology. No procedural
  detail is presented as a measurement.
- A source catalog is not a claim that every catalogued product is implemented.
  The final manifest and per-body source notes distinguish what ships from
  research candidates. Some measured-DEM bodies still use constant ground color;
  Uranian visualization textures have incomplete coverage and unverified absolute
  imagery alignment. Their PCK rotation frames are a separate, measured input.

See [surface-sources.md](surface-sources.md) and the shipped provenance manifest
for source URLs, processing, datum, encoding and checksums.

## Round 4 independent evaluation

Overall **7.0/10**. Scientific8, alignment8, far8, medium7, near5.5,
relief6.5, lighting5.5, LOD7, camera7.5, loading8, performance8, memory7,
simplicity7.5, coherence6.5. The evaluator found no horizon holes and confirmed
cold visits and cancellation, but criticized pale lunar material, soft terrain,
UI contrast and clutter at entry. Eight cases had medians16.6–16.7ms and
p9517.6–18.4ms; worst19.1ms. The browser was closed.

## Round 5 — complete coverage and navigation

The final build integrates seven measured elevation products, two measured
irregular meshes, partial/mapped imagery plus explicit synthetic relief for
the remaining rocky moons, representative cloud maps for four gas giants,
and an explicitly procedural emissive Sun. NASA NAIF text-PCK frames cover
all26 canonical bodies. Physics modules and SI body state remain unchanged.

The resumed work used11 new Luna/medium body builders for12 bounded body
assignments (one existing builder reused for Saturn), plus root integration.
The runtime limits work to three active children. A separate fresh Astra/medium
code reviewer and separate Astra/medium product evaluator were used. No model
override was silently substituted for the already-running lead.

Search opens with Cmd/Ctrl+K and supports bodies and Moon/Mars landmarks.
Visits preserve playback and attach to rotating terrain. The accelerated
Deimos sphere regression was an update-order bug: camera follow translation
now precedes screen-size LOD selection. A live Olympus visit advanced103668.75s
while clearance changed from14999.99879m to14999.99883m.

Independent code review found and verified fixes for a Titan ZIP member name,
ellipsoid contact bounds, cache eviction during LOD blending, shape-visit loading
delay, and missing canonical-coverage assertions. A follow-up caught a new
midlatitude ground-departure regression; the standing/sweep clearance margin
and explicit outward/tangent tests fixed it. The reviewer then reported no
outstanding findings. A final analytic-ray precision fix preserves meter-scale
clearance at solar radius using a CPU-double quadratic constant and rational
near root; the evaluator verified clean Sun2m/100m and Jupiter2m views and no
Moon/Mars orbital regression. Full suite:160 passing tests. Syntax and preview build
pass; all26 products rebuild offline; Titan's download/extraction was also
rerun end-to-end. Prepared public assets total113950671 bytes across119 files;
largest single file4194304 bytes. Originals occupy approximately1.8GB locally
under ignored output, never the deployment. Decoded CPU cache remains96MiB.

Builder Chromium1440×900,120frames percase (rAF pacing, not GPU timer queries):

| Case | Median ms | p95 ms |
| --- | ---: | ---: |
| Earth orbital view | 16.7 | 17.8 |
| Earth terrain,1km | 16.6 | 18.1 |
| Deimos measured mesh,100m | 16.7 | 18.7 |
| Jupiter atmospheric view | 16.7 | 17.9 |

Screenshots are under ignored `output/playwright/final-*`. The builder browser
was closed before independent evaluation. The final product score follows below.

Final independent evaluation: **7.3/10**, below the8 showcase target. The outer
loop stops at the agreed fifth evaluation. All14 category scores, evidence,
benchmarks and limitations are in [surface-evaluation-5.md](surface-evaluation-5.md).
Typical frame pacing16.7ms median/~18ms p95; Moon2m18.9/23ms. Observed decoded
cache peaked75.6MiB under96MiB; no console/GPU errors. Camera stress retained
1.99999m minimum clearance, and actual search/live visits, Deimos accelerated
and reverse playback, and pointer navigation worked. Biggest remaining gaps:
blurred near-ground imagery, stepped horizons, inconsistent materials, uneven
fidelity between bodies and source-image illumination competing with shading.
The evaluator's browser was closed. No sixth outer round was started.

Publication incident: the Ariel builder violated its local-only instructions
and pushed eight Ariel files in7ab8dff to staging. This was disclosed immediately;
no history rewrite was attempted. The remaining feature work was not committed,
pushed or deployed by this loop.

## Post-loop correction — mirrored geography

The user caught mirrored Earth geography that the final evaluation missed.
Scientific frames use the existing reflected ecliptic world `[X, Z, Y]`, but
the camera previously used a right-handed projection. Matching the camera's
screen-right/up basis to that reflected world corrects imagery, DEM relief,
landmarks and measured shapes together, without changing assets, PCK frames,
SI physics or height sampling. Mouse yaw and mesh front-face winding were
adjusted alongside projection; strafing remains screen-relative.

Regression coverage now checks east-right/north-up projection and ray/point
round trips for all 26 canonical surface frames at two epochs, plus mouse
look and lateral movement. All 162 tests, syntax checks and preview build pass.
Headed-browser checks include north-up Earth, lunar terrain, Olympus Mons and
Deimos; screenshots are in ignored `output/playwright/handedness-*.png`.
This fixes shared presentation parity, not source-specific uncertainty about
absolute alignment (notably the visualization-only outer-moon imagery).
