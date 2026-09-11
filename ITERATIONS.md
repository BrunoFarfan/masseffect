# Builder → Evaluator log

## Iteration 1 · foundations

Built a dependency-free browser replacement after running and inspecting the Pygame prototype. Added nine-body SI gravity, velocity Verlet, conservative encounter stepping, real trails, starting orbit guides, a free camera with focus/follow, body selection and creation, and a restrained ink/pastel visual direction.

Architecture: plain ES modules, Canvas circles projected from true 3D positions, DOM controls. Exact gravity with a 128-body limit; no tree or engine yet. Removed obsolete Python source and manifests (recoverable through Git).

Evaluator focus: actual camera behavior across scales, crowded inner-planet labels, numerical/encounter edge cases, discoverability of body creation, desktop and narrow-screen composition. Tests must be run before assigning scores.

Validation: six numerical/camera/budget tests passed; ten-year relative system energy error below 1e-5. The prototype ran in Chromium without console errors. Desktop, whole-system, follow and narrow-screen screenshots were independently inspected.

Independent evaluation: physics 6.5, camera 6.0, visuals 6.7, clarity 6.7, scale/orientation 5.5, performance 7.0, simplicity 8.0, coherence 6.8. **Overall 6.6/10.**

Top problems: small/isolating camera framing with poor recovery on mobile; fast-body tunneling and gap-based collision slowdown; crowded whole-system labels and an overly technical first step to creation. No regression against a mature baseline (the old version had no physics). Next: continuous collisions, better framing/follow, label placement and quick arrivals.

## Iteration 2 · make exploration work

Continuous collision detection now finds the earliest sphere contact during each Verlet drift and merges at that point. Removed the asymptotically shrinking surface-gap timestep rule. Added regression tests for tunneling, actual contact and near misses.

Expanded inner-system framing; adjusted camera distance to viewport aspect ratio; following a body now gives a visibly larger sphere. Explicit release and keyboard movement exit follow. Added label collision avoidance, smaller distant inner-planet markers, true-distance/enlarged-size explanation, a one-click randomized arrival, and recoverable mobile view controls with collapsible body properties.

Evaluator focus: follow-to-free transitions, fast collisions and near misses, label readability at both scales, viewport resize/home behavior, realistic performance at the 128-body cap. Known remaining limit: mobile touch currently supports look but lacks a travel gesture. No extra rendering or physics dependencies.

User clarification incorporated: desktop first; mobile playability is not a requirement. No card UI. Removed inspector panel backgrounds and boxed toolbar buttons; customization/help use a simple edge-to-edge side sheet. Further evaluations prioritize desktop and no further mobile interaction work is planned.

Validation: nine tests passed, including swept contact and a high-speed near miss. The independent browser stress test at 128 bodies measured median 16.7 ms / p95 16.8 ms across 100 animation frames; both spawn actions correctly disable at the cap. No console errors. These are local observations, not cross-device guarantees.

Independent evaluation: physics 7.8, camera 7.2, visuals 7.5, clarity 7.6, scale/orientation 6.8, performance 7.8, simplicity 8.1, coherence 7.6. **Overall 7.5/10.** No material regressions. Top problems: no directional recovery after looking away, load limitation mislabeled as a close encounter, and quick arrivals sometimes hard to locate. One final focused iteration justified.

## Iteration 3 · orientation and honest feedback

Added a selected-body direction/recenter action, including when the body is behind the camera. Quick arrivals use the same recovery control. Show achieved simulated days/sec when requested time cannot be sustained, with neutral accuracy-protection wording. Dialog pause state is visible. Planet trails now sample at intervals proportional to their orbital periods, so outer-planet trajectories survive years of fast-forwarding while retaining a 600-point memory cap. Cache the camera projection basis once per render to reduce per-vertex work.

Desktop and no-card priorities retained. Final evaluation should exercise recovery, pause/forms/time controls, high-speed planetary motion and dense body counts. No mobile gestures, extra engine features or additional celestial catalogs added.

Final validation: **11/11 tests pass**, all module/server syntax checks pass, and `git diff --check` is clean. The independent evaluator exercised the actual desktop browser: paused time stayed fixed, manually configured SI values were preserved, a 180° look-away showed a directional recovery control, and clicking it restored the selected body. No browser warnings or errors. A local 128-body, high-time-scale test measured median 16.7 ms / p95 16.8 ms over 100 frames, with achieved time correctly reported when below the requested rate. This is a bounded local measurement, not a hardware-wide guarantee.

| Final category                              | Score / 10 |
| ------------------------------------------- | ---------: |
| Physics / orbital credibility               |        7.8 |
| Camera and navigation                       |        7.9 |
| Visual quality                              |        8.0 |
| Interaction clarity                         |        8.1 |
| Sense of scale and orientation              |        7.6 |
| Performance and stability                   |        8.1 |
| Code simplicity / maintainability           |        8.3 |
| Overall coherence with the intended product |        8.1 |

**Final overall score: 8.0/10. Stop after three iterations**, on the independent evaluator's recommendation. Progression: 6.6 → 7.5 → 8.0. No material regressions found.

Three remaining limits, in priority order:

1. Dense 128-body scenes are visually busy; Labels/Trails toggles help. A future selected-and-major-label mode is optional polish.
2. Close focus is physically sparse. Recovery and explicit release work; an intermediate-distance inspection preset could add context later.
3. Swept contacts follow each Verlet drift, adaptive encounter steps lose strict symplecticity, and initially chosen trail cadence does not adapt after capture. These are documented sandbox approximations.

Recommendation for a future builder: tune those interactions only if actual play suggests they matter. Do not grow the engine or catalog to improve evaluation scores. Final small handoff checks also verified sub-kilometer distances display in meters and ensured narrower desktop layouts keep time-rate feedback visible.
