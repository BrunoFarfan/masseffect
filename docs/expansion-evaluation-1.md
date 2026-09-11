# Expansion evaluation 1

Independent harsh review of the running desktop app, 2026-09-11, approximately 13:22–13:30 UTC. Overall **6.4/10: coherent but visibly unfinished**. This is measured against the expanded sandbox vision, not awarded for adding features. An 8 would require materially better close views, time behavior, and exploratory reward.

| Category | Score | Evidence |
|---|---:|---|
| Physics | 8 | 16/16 tests pass, including SI moon states, barycenters, two Phobos periods, ten-year bounded energy, swept collisions, and conservation. These establish strong numerical foundations; no manual collision was completed. |
| Camera | 7 | Mouse capture, aggressive mouse movement, Escape, WASD, Shift, wheel, planet focus and close moon approach all worked. Focus transition takes time to settle. |
| Visual quality | 5.5 | Quiet attractive overview, but Jupiter and Europa close views are plain shaded spheres with extremely conspicuous staircase edges. |
| UI minimalism | 8 | Sparse navigation, compact selected-body tools, restrained drawer; no card dashboard. |
| Body creation | 6 | Arbitrary mass, radius, off-plane position, and retrograde velocity accepted. Release leaves the new arrival behind the camera without revealing it. |
| Scale/orientation | 6 | Distance, contextual scale and behind-camera locator help; moon list hierarchy is misleading and local moon trails are hard to interpret. |
| Time controls | 4.5 | 1 year/sec achieved only about 2.0–2.52 days/sec. Real time showed 0.0 days/s achieved. No reverse/history yet. |
| Performance | 6 | Interaction remained responsive and console clean, but high requested simulation rates are dramatically unattainable in the observed full system. No quantitative FPS benchmark. |
| Simplicity | 7 | Few concepts and clear drawer controls; creation still requires scientific coordinates without local spatial feedback. |
| Sandbox enjoyment | 6 | Flying to moons is rewarding initially, but close views repeat the same featureless sphere and manual creation is disconnected from its outcome. |
| Coherence | 6.5 | Strong foundation and consistent minimal typography, with large quality gaps between clean interface, numerics, rendering and time controls. |

## Interaction performed

Fresh independent browser session at http://127.0.0.1:5173, brought to foreground before mouse capture. Entered space, aggressive mouse look, held W, escaped to controls; selected Jupiter and focused its moon system; approached Jupiter; changed to real time; flew forward and rotated; selected Europa and approached it; accelerated to one year/sec; created Odd Pebble (2e19 kg, 180000 m, Y=8e10 m, Z velocity=-18000 m/s); flew backward with Shift, scrolled far, strafed, and escaped. Captured and visually inspected all screenshots below. Browser console: zero errors and warnings. `just test`: 16 passed.

## Five principal weaknesses and recommendations

1. **Close views fail visually.** Jupiter and Europa occupy roughly 600 pixels across, with visible coarse pixel steps and no distinctive surface detail. Improve sphere sampling/edge antialiasing and add restrained procedural identity (Jupiter bands, rocky/icy variation). Close flight should be the main reward, not the weakest screen.
2. **Time choices promise speeds the full moon system cannot deliver.** Requested 365.25 days/sec produced 2.0–2.52 days/sec, around 145–180 times slower. Preserve numerical integrity, but either improve safe integration performance or make attainable rates clear and meaningful. Format real time in seconds/sec so it never reads 0.0 progress.
3. **Moon-system trails are visually confusing.** Jupiter focus reveals four moons, but their historical heliocentric paths sweep out of frame as long looping lines. Offer/reference local historical paths appropriately while following a parent, or fade unsuitable distant trail segments. Do not fabricate analytical ellipses.
4. **Creation lacks an observable payoff.** Releasing Odd Pebble 629 million km behind the camera left Europa filling the viewport. A deliberate arrival focus or immediate 'View arrival' affordance would connect input to result. The behind locator splits this short two-word name over several lines; widen/reflow it.
5. **Discoverability and hierarchy need work.** All moons appear after all planets, although each has an indented arrow. Group moons under their parents. More broadly, presets/scenarios and reverse/history remain deferred; they were not tested and cannot receive credit yet.

## Regression assessment and limits

No crash, stuck cursor, failed Escape, or failed body release was observed. The moons expose a serious achieved-time ceiling and visibly complex trails; these are expansion pressure points, not proven before/after regressions because the previous binary was not run side by side. Camera surface-guard behavior is covered by a passing test; the flight exercise did not independently establish all collision/tunneling extremes. Physical body collision was not forced in UI. No presets, scenarios, or reverse-time behavior was claimed tested.

## Screenshots

- `output/playwright/exp-eval1-start.png`: sparse overview and initial entry.
- `output/playwright/exp-eval1-jupiter-system.png`: four moons and confusing long system trails.
- `output/playwright/exp-eval1-jupiter-close.png`: close sphere and pronounced stair-step edge.
- `output/playwright/exp-eval1-europa.png`: repeated featureless close-sphere presentation, real-time 0.0 badge.
- `output/playwright/exp-eval1-create.png`: manual arbitrary-state creation drawer.
- `output/playwright/exp-eval1-spawned.png`: released body behind camera, locator wrapping, 2.0 days/sec achieved against year/sec request.
- `output/playwright/exp-eval1-far.png`: recovered far-flight state after Shift/backward/wheel/strafe.
