# Canonical orientation corrections

This focused follow-up corrects the general planet/moon audit findings without
replacing the sandbox's approximate orbital model.

## Changes

- The Sun and all eight planets now use physical J2000 pole directions from
  [JPL's IAU orientation kernel](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc).
  Significant periodic Mars and Neptune pole terms are evaluated at J2000.
  One shared coordinate conversion constructs both planetary poles and moon
  reference planes, with the appropriate pseudovector sign for angular velocity.
- Neptune's nominal sidereal rotation is 57,478.68 seconds (15.9663 hours).
  Venus and Uranus retain their correctly signed retrograde rotations.
- Synchronous moons now store their actual instantaneous rotation period rather
  than a 24-hour placeholder. History reconstruction accepts changes in this
  derived value without mistaking ordinary orbital evolution for an edit.
- Saturn's decorative rings are physical-meter annuli in its equatorial plane,
  not a fixed screen-space ellipse. C/B/A bands and the Cassini gap use the
  boundaries also tabulated in this
  [primary ring study](https://www.nature.com/articles/s41561-024-01598-9).
  Front/back occlusion, near-plane clipping and viewport clipping support close
  approaches. The rendering stays restrained, with no additional UI.
- Custom bodies with a zero rotation period remain stationary instead of
  producing nonfinite angular velocity.

Initial spin/orbit angles measured from the actual initialized state:

| Planet | Angle |
| --- | ---: |
| Mercury | 0.034° |
| Venus | 177.362° |
| Earth | 23.439° |
| Mars | 25.192° |
| Jupiter | 3.120° |
| Saturn | 26.732° |
| Uranus | 97.770° |
| Neptune | 28.318° |

Phobos and Deimos now orbit about 1° from Mars's equator. Saturn's inner moons
likewise align closely with its equator. Uranian moons retain prograde motion
relative to Uranus's spin, while Triton remains retrograde at approximately 157°
to Neptune's spin. Planetary initial orbital elements, masses and radii are
unchanged; simulation quantities remain SI throughout.

## Validation

- `just test`: 119 tests passed, including independent pole-term calculations,
  all canonical spin directions and periods, all 17 moon orientations, dynamic
  period/history reconstruction, and ring projection/clipping regressions.
- `just check` and `git diff --check` passed.
- A further 100 simulated days with all 26 canonical bodies retained finite
  states, no collision events and relative total-energy change of approximately
  −3.0e−13 for this run. This is a regression check, not an ephemeris guarantee.
- Desktop Chromium checks used the actual body catalog and go-to action, then
  deterministic camera fixtures for oblique, north/south pole, edge-on,
  near-surface and near-ring-plane views. Screenshots were inspected at each
  state. Normal, accelerated and recorded reverse time were also exercised.
  No console errors or warnings were observed.
- Across those six camera fixtures, measured frame-time p95 was 18.2–18.6 ms;
  drawing p95 ranged from 1.9 ms to 14.7 ms, highest inside the ring annulus.
  These are local headless-browser measurements, not a cross-device guarantee.
  Screenshots are retained locally under `output/playwright/planet-axes-*`.

## Deliberate limits

Moon initial states remain approximate circular orbits with illustrative phases
and some illustrative nodes, not an epoch-accurate ephemeris. Exact primary-facing
moon orientation is an idealized lock: lunar obliquity, libration and tidal torque
evolution are not modeled. Planetary poles are fixed at J2000; tiny Jovian
nutations, later precession and accurate prime meridians are omitted. The Sun
has one nominal spin rather than differential rotation. Gravity remains
point-mass Newtonian, without oblateness terms.

Rings are thin decorative sheets, with no particles, shadows, gravity or
collisions. Exactly edge-on sheets have zero projected area. Surface patterns
remain illustrative rather than measured geographic maps. These limits are
intentional and separate from the corrected data/frame inconsistencies.
