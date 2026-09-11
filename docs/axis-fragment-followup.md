# Axis, surface-exit and fragment follow-up

2026-09-11. One focused build, hands-on browser evaluation, and follow-up build.
This is a scoped self-evaluation, not a new independent whole-game score.

## Findings and changes

- Venus and Uranus already had retrograde spins and broadly correct periods.
  Their pole azimuths were arbitrary. The two now use J2000 IAU/JPL north-pole
  directions, with the correct angular-velocity sign for the reflected X,Z,Y
  world coordinates. Venus's period is refined from 243.025 to 243.018 days;
  Uranus remains 17.24 hours. Actual spin/orbit angles in the starting state are
  177.3624° and 97.7703°. Uranus's moon velocities were reversed relative to its
  spin despite the existing comment claiming otherwise; corrected and tested.
- F/G left the rotating surface basis behind; H's leveling was tied to a travel
  animation that input could cancel. Leveling is now independent, takes 0.65 s,
  preserves the viewing direction, and continues after travel interruption.
  The old surface cannot recapture the camera until it leaves the capture zone.
- View → Impact detail offers 4/8/16/32/64 fragments, with 32 as the application
  default. A conservative measured solver/drawing budget limits future impacts.
  The 128-body cap, minimum mass/radius and one-generation limit still apply.
  Existing bodies are never removed to satisfy a performance estimate.
- More pieces use a relaxed, deterministically disordered packing with paired
  radial velocities. Full-tensor angular momentum handling replaces the old
  isotropic approximation. History stores the effective collision policy and
  retains recorded outcomes. Unselected debris labels no longer crowd the view.

Sources: [JPL orientation kernel](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc),
[JPL planetary parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html),
[NASA Uranus](https://science.nasa.gov/uranus/facts/).

## Evaluation and follow-up

The first browser pass found visibly regular rows of fragments. The follow-up
adds bounded packing disorder and varied paired ejection speeds. It also found
full-screen image uploads/composites for small spheres: cropping those reduced
32-piece draw p95 from 12.4 ms to 3.7 ms in the local test.

A deliberately harsher close-up test paused immediately after a 64-piece impact,
then entered the debris cloud while the handoff silhouettes were still visible.
It exposed a 212.4 ms draw p95. The follow-up adds a shared projected-pixel budget
for sphere shading and rejects wholly behind-camera spheres before rasterization.
Ordinary single-surface views retain the original resolution. Dense clouds trade
shading resolution for frame pacing; physical spheres and positions are unchanged.

After the shared budget, the same close-up stress case measured **16.6 ms draw
p95 and 17.2 ms frame p95**, down from 212.4 ms draw p95. The final ordinary
32/64-piece views measured 18.2/18.6 ms frame p95 at a 1440×900 viewport. The
64-piece wide view costs less to shade because its smaller disks stay below the
ray-surface transition; fragment count alone does not predict drawing cost.
All states remained finite. Cropped-image borders are cleared to prevent stale
neighboring pixels from leaking into magnified sphere edges.

Local Node solver benchmark (`just benchmark-fragments`, 300 samples after warmup):

| Pieces | Median step (ms) | p95 step (ms) |
| ---: | ---: | ---: |
| 4 | 0.008 | 0.018 |
| 8 | 0.009 | 0.010 |
| 16 | 0.019 | 0.044 |
| 32 | 0.052 | 0.126 |
| 64 | 0.187 | 0.279 |

Every count remained finite and retained its pieces through 350 solver steps.
These are measurements on this Mac, not the user's Arch/Hyprland computer.
The browser budget learns local costs rather than inferring speed from core count.

## Validation and limitations

- All **109 tests pass**; syntax and whitespace checks pass. No browser console
  errors were observed. Owned QA browser sessions were closed after inspection.
- Regression suite covers both retrograde poles/periods, Uranian moon direction,
  F/G/H with look/wheel/keyboard interruption, all fragment counts' mass/volume/
  COM/momentum/non-overlap, capacity limits, history reconstruction, bounded
  sphere uploads and dense-scene shading allocation.
- Browser keyboard checks began on the actual Lunar lookout surface. F, G and H
  each restored the identity system-up frame after wheel interruption, released
  surface attachment and retained finite camera state.
- Arrow-left rewind restored the two pre-impact worlds; forward evolution
  returned to 64 pieces. This is recorded rewind, not analytical unfragmentation.
- Fragment sizes are still equal spheres and their initial packing is an
  approximation. Spin energy caps can lose angular momentum in extreme cases;
  placement changes potential energy. No material fracture or fluid model.
- CPU estimates are conservative and view-dependent, not a guaranteed frame
  rate. Lower requested time warp remains useful in dense systems. Shade quality
  can visibly soften in extreme close debris clouds.
- Other planets' pole azimuths and initial prime meridians remain illustrative.
  No physical Linux mouse/Wayland testing was possible in this Mac session.

Screenshots are local, excluded from Git, under `output/playwright/`: the
`axis-followup-32`, `-64`, `-rewind`, `-close`, `-surface` and `-departure` PNGs.
The focused frontend-design pass reused the existing flat View disclosure:
no new dashboard, persistent controls or cards.
