# Expansion evaluation 5 — final independent review

Desktop browser evaluation, 2026-09-11 **14:26:44–14:30:07 UTC (3 minutes 23 seconds)**. Fresh browser closed immediately after the checks. Overall **8.0/10: a coherent, restrained showcase within the requested simple visual direction**. This is not exceptional production polish or a 9; it is a working, enjoyable physical sandbox with a small set of remaining limitations. Recommend stopping the expansion loop; only tiny copy corrections remain worthwhile now.

| Category | Score | Evidence |
|---|---:|---|
| Physics | 8.5 | 70 passing tests; real UI fragmentation and history restoration work. New low-rate frame independence and chained-survivor behavior have focused tests. |
| Camera | 8 | Aggressive flight, Escape, Earth/Moon approach and created-comet follow work without observed loss or clipping failure. |
| Visual quality | 8 | Simple shaded spheres, quiet typography and sparse controls are coherent; shortened fragment labels reduce clutter. Close shapes remain clean. |
| UI minimalism | 8 | Toast now clears history; compact contextual scrubber supports the experiment without a dashboard. Minor endpoint/copy artifacts remain. |
| Body creation | 8.2 | Random state is stable within one attempt and changes on retry; advanced mode disables conflicting semantic controls; unique default name Comet 2 verified. |
| Scale/orientation | 8 | Planet/moon follow, system preview, distance/scale and distinct entry modes provide useful spatial context. |
| Time controls | 7.8 | Reverse, pause, seek both ways and forward branching work; real-time clock advances at the expected observed rate. Endpoint text needs a small clamp. |
| Performance | 8 | Final close Earth plus one added comet: 120 rAF intervals median 16.7 ms, p95 17.5 ms, worst 17.6 ms. Console clean. |
| Simplicity | 8 | Semantic placement and advanced authority are comprehensible, controls remain compact. |
| Sandbox enjoyment | 8.2 | Impact and reversible examination are now a complete loop; custom arrival/navigation also work. |
| Coherence | 8 | The important interactions fit together, and previous major execution defects are resolved. |

## Actual final checks

Loaded Planetary impact and watched through fragmentation; paused at 00:15:01. Four compactly labeled fragments and nonoverlapping toast/scrubber were visible. Reversed, directly paused, scrubbed Home, and verified **2 bodies: Cinder, Pearl**. Scrubbed End and verified **4 full accessible body names: Cinder fragment 1–4**. Returned Home and selected Play forward; changed to 1× real time. DOM clock changed **00:00:01 → 00:00:04 over 3.1 real seconds**.

In Solar System, placed Comet around Jupiter at 1,000,000 km with random velocity. Advanced state showed `(1270.1, -2987.2, 11122)` m/s, unchanged after closing/reopening advanced mode. Try another position produced `(-9609.4, 6283.7, 17360)` m/s. Four semantic select controls were disabled in advanced mode. Released successfully; the comet was followed close with Jupiter visible in the background. Opened another Comet attempt and verified default name **Comet 2**.

Approached Earth, captured mouse, held W, aggressively rotated, scrolled and escaped; approached Moon and inspected clean near rendering. Returned to Earth at Up to 1 year/sec for the final 120-frame cadence sample. Six screenshot states captured and visually inspected. Browser console: zero errors/warnings. `just test`: **70/70 passed**.

## Five remaining weaknesses or limitations

1. **Tiny history endpoint sign artifact.** At the paused newest state the future endpoint displayed `+-1 s` in `exp-eval5-impact-paused.png`. Clamp/normalize negligible negative future duration to zero. This is a small presentation defect, not a failure to seek.
2. **Event toast can describe a future event after rewind.** Immediately scrubbing Home left 'Cinder and Pearl dispersed into four fragments' visible over the restored intact worlds. Clear the transient toast on an explicit seek, or mark it as the last event. Evidence: `exp-eval5-originals.png`. The toast no longer overlaps controls.
3. **Advanced mode loses the semantic ghost context.** Disabling semantic controls correctly gives exact inputs authority, but the observed advanced screen no longer shows the ghost/velocity arrow. Keeping a valid exact-state preview would make advanced edits easier to reason about. This is optional enhancement, not a broken launch.
4. **Very high full-system rates remain a capacity limit.** The full SI moon system cannot approach the most ambitious upper selector rate on this machine. Existing CPU-limit/achieved-rate messaging is appropriate; further optimization is separate work and should not weaken integration safety.
5. **History and impact fidelity have deliberate bounds.** The short recorded window is not permanent save/load, and four bounded fragments are a simplified collision outcome rather than material fragmentation. These are practical scope limits, not regressions. Do not expand into terrain, fluid disruption or unlimited historical recording merely to chase a 9.

## Regression assessment and stopping recommendation

Verified resolution of the previous two concrete cleanup blockers: toast/history overlap is gone, and random motion now samples fresh attempts while keeping each preview stable. Short labels retain full body-list names. Low-rate UI clock progresses and the new numerical tests protect frame-rate independence. No crash, stale clickable references in ordinary UI use, failed release, missing restored body, visible near-edge regression or console error was observed. The small `+-1 s` and stale-toast artifacts can receive direct copy-state fixes without another broad expansion iteration. **Stop feature work here; the remaining marginal polish does not justify a sixth expansion cycle.**

## Screenshot evidence

- `output/playwright/exp-eval5-impact-paused.png`: compact fragments, clear toast above scrubber, minor `+-1 s` endpoint.
- `output/playwright/exp-eval5-originals.png`: originals restored; prior event toast remains briefly.
- `output/playwright/exp-eval5-random-advanced.png`: compact new velocity sample and disabled semantic fields.
- `output/playwright/exp-eval5-release.png`: released comet followed with Jupiter in view.
- `output/playwright/exp-eval5-moon.png`: clean close Moon after aggressive navigation.
- `output/playwright/exp-eval5-earth.png`: final close Earth cadence-check state.
