# Surface rotation and impacts — three-pass intermediate loop

2026-09-11. Baseline: `b687e3a` on `main`; upstream was fetched and integrated before editing. The dependency-free browser architecture was retained. This is a focused three-pass Builder/Evaluator cycle, not another expansion cycle.

Evaluation was performed in separate play-test stages by the same assistant, **not an independent reviewer or subagent**. Each pass used a fresh temporary Chromium browser on macOS, actual application rendering, screenshots, and numerical tests. The affected Firefox/Hyprland machine was not available. Screenshots below live in ignored `output/playwright/`; they are local evidence, not published assets.

## Scores

Scores reflect execution, not just feature presence. The stop condition is the requested three-pass cap, not a claim that nothing remains to improve.

| Category | Pass 1 | Pass 2 | Pass 3 |
| --- | ---: | ---: | ---: |
| Physics / orbital credibility | 7.0 | 7.5 | 7.5 |
| Camera and navigation | 6.8 | 7.0 | 8.0 |
| Visual quality | 6.8 | 7.0 | 7.6 |
| UI minimalism and clarity | 7.6 | 7.6 | 8.0 |
| Body creation UX | 7.0 | 7.0 | 7.2 |
| Scale and orientation | 7.0 | 7.1 | 8.0 |
| Simulation / time controls | 7.6 | 7.7 | 8.0 |
| Performance and stability | 7.6 | 7.5 | 7.6 |
| Simplicity / maintainability | 7.7 | 7.4 | 7.5 |
| Sandbox enjoyment | 7.0 | 7.4 | 7.8 |
| Product coherence | 7.0 | 7.4 | 7.9 |
| **Overall** | **7.0** | **7.3** | **7.8** |

## Pass 1 — axial rotation and a rotating surface frame

Builder: added quaternion orientation, SI angular velocity, canonical spin periods/tilts and idealized synchronous moons. Close surface patterns use body-local coordinates. Camera proximity engages body rotation; ascent fades the coupling and releases automatic follow. History records axial state. The local vertical eases toward the ground normal while preserving the look direction. No new navigation mode or persistent control panel.

Validation: 93 numerical tests passed, including spin phase, synchronous facing, camera basis, hysteresis, detachment and history reconstruction. Browser inspection placed the observer at a known lunar surface point using instrumentation, then advanced the actual simulation. Earth moved about 0.061 pixels over 692,606 simulated seconds. The browser also exercised aggressive mouse turns and the ordinary impact scenario (four finite fragments at 900 seconds).

Evidence: `surface-pass1-moon-before.png`, `surface-pass1-moon-after.png`, `surface-pass1-impact.png`. The sky relationship worked, but the chosen site did not show the horizon, so those first images were poor demonstrations of standing on a body.

Five weaknesses: (1) near-ground clearance/speed remained too coarse; (2) widely displaced fragment birth still popped; (3) glancing impacts always coalesced; (4) a changing follow target could move the observer abruptly; (5) no easy lunar starting view. Next pass: address contact outcomes and their visual handoff. Rotation itself did not regress existing orbital tests; spin work added some per-step overhead.

## Pass 2 — contact response and a readable topology change

Builder: introduced inelastic unbound hit-and-run contacts, including non-recursively-fragmenting debris. Low-energy bound contacts still merge. Mergers transfer orbital and intrinsic angular momentum into spin. Fragment birth is compact instead of three fragment radii from the collision center; shared spin/tangential ejection carries angular momentum within a bounded energy budget. A separate half-second presentation layer fades progenitor silhouettes into the physical outcome. It is bounded, pause-safe and cleared for rewind/scenario changes; silhouettes never exert gravity or accept clicks.

Validation: 98 tests passed. Real browser contact screenshots captured approach, onset, outcome and rewind. Four finite fragments at 884 seconds rewound to two originals at 744 seconds, with no stale effects; replay and continued motion remained finite at 1,283 seconds. Mass, momentum, compact placement, nonrecursive rebounds, merged spin and effect immutability have dedicated numerical tests.

Evidence: `surface-pass2-impact-before.png`, `surface-pass2-impact-contact.png`, `surface-pass2-impact-after.png`, `surface-pass2-impact-rewind.png`, `surface-pass2-impact-later.png`. The handoff removed the large spatial gap, but also exposed a follow-anchor jump at fragmentation. Four equal spheres still look deliberately artificial.

Five weaknesses: (1) collision-follow camera jump; (2) tiny disks did not visibly use axial shading; (3) coarse near-surface travel; (4) a synchronous escaped moon would still track its primary; (5) release and scenario changes needed explicit frame cleanup. Next pass: finish these transitions and verify the complete surface-to-space experience. No numerical regressions; conservative outcomes remain toy approximations, not a fracture solver.

## Pass 3 — surface-to-space continuity and final regression checks

Builder: ground clearance is now two meters with a coordinate-precision floor. Local Q/E allows walking-speed motion and boosted ascent. Explicit release suppresses reattachment until leaving the capture zone. Home eases its reference frame back to system orientation; scenarios reset it. Collision follow anchors rebase without carrying the observer through the survivor's COM change. Escaped moons retain free spin. Resolved disks blend into rotating ray/sphere shading; surface-level sky dots relax visual exaggeration, preserving the Sun/Earth angular-size relationship. Below-horizon labels/picks are occluded. Ground-local marker/ruler clutter is hidden. Fine albedo is illustrative, not terrain.

Added **Lunar lookout**, an ordinary canonical state with a convenient camera starting point. Scenario-specific time multipliers are inserted numerically, fixing arrow-key ordering. No cards, new engine, new dependencies or elaborate landing controls.

Browser observations:

- In the lookout, camera altitude stayed at 2.00003 meters. Earth drifted less than 0.003 pixels over roughly 2.8 simulated days while the Sun crossed the sky. Screenshot pair: `surface-pass3-lunar-before.png` / `surface-pass3-lunar-after.png`; cleaned final view: `surface-pass3-lunar-final.png`.
- Actual captured **E + Shift** input departed from the lunar surface and released both surface and follow state. After eight seconds the camera was about 237 lunar radii away. Aggressive diagonal mouse turns remained finite. See `surface-pass3-departure.png`.
- Surface rewind retained lunar attachment and Earth near the same screen point. Arrow Up correctly changed the lookout's six-hours/second setting to one day/second. Home and scenario changes recovered system orientation.
- Spawned Earth, Jupiter and stationary Proxima through the normal creation UI. The 29-body experiment remained finite after 3,289,444 simulated seconds (38.1 days). See `surface-pass3-presets.png` and `surface-pass3-evolved.png`. The requested month/second speed was CPU-limited, correctly advancing less rather than skipping physics.
- Final contact views cover high-energy fragmentation and controlled grazing/slow contacts. The latter use instrumented initial positions/velocities, then the ordinary running solver and renderer. See `surface-pass3-impact-contact.png`, `surface-pass3-impact-final.png`, `surface-pass3-grazing-contact.png`, `surface-pass3-grazing-after.png`, `surface-pass3-merge-contact.png`, `surface-pass3-merge-after.png`.
- A sampled near-surface draw took about 10.6 ms median / 10.9 ms p95 on this Mac/headless Chromium before the final albedo/occlusion cleanup. This is a local renderer measurement, not a full-frame benchmark or cross-platform performance claim.

Final verification: **103 tests passed**, `just check` passed. Controlled browser grazing retained two bodies moving apart; the slow impact produced one body at rest. Both retained total mass 1.283382e24 kg and finite state. No page errors were observed in that final contact/lookout run. Temporary test browsers were closed after each evaluation.

Regression fixes during evaluation: removed an overly repetitive rocky texture; hid labels/picks through the local horizon; repaired collision-follow jumps, explicit-release reattachment, near-ground scale clutter and scenario speed ordering. Existing mouse delta accumulation/raw-input preferences were preserved.

## Five remaining weaknesses and next recommendations

1. **Four equal fragments and a fixed impact threshold remain artificial.** A crossfade improves continuity but is not material deformation. Only consider unequal major remnants if it clearly improves these specific encounters.
2. **Rotation is intentionally simplified.** Ideal synchronous facing omits libration and tidal torques. Fragment angular momentum can be reduced by the energy cap; merger spin does not trigger rotational breakup. These limits are explicit in the README.
3. **Surface visuals remain spare.** The horizon is a smooth sphere with procedural albedo, not lunar terrain or measured planetary maps. This is within scope, but not a surface-exploration renderer.
4. **Extreme acceleration remains demanding.** Close moons constrain the exact solver, and very fast apparent celestial motion can be difficult to follow. History changes body topology discretely during rewind; it does not reverse a material simulation.
5. **Real Firefox/Hyprland mouse feel remains unverified.** The next useful check is on that actual machine, particularly high-polling-rate diagonals and the surface transition. Mac browser automation and numerical input tests cannot certify compositor behavior.

Stop after three passes. Prefer hardware validation and small targeted corrections over another feature expansion.
