# Expansion evaluation 4

Independent desktop evaluation, 2026-09-11 **14:14:40–14:17:49 UTC (3 minutes 9 seconds)**. Fresh browser closed after purpose completed. Overall **7.8/10**. This is close to a modest showcase within the intentionally simple visual direction, but two concrete polish/semantic defects justify one bounded cleanup cycle. No credit is assigned for planned fixes.

| Category | Score | Evidence |
|---|---:|---|
| Physics | 8.4 | 64 tests pass; actual energetic impact produces four fragments; UI history restores two originals and seeks four fragments again. Simplified bounded fragmentation remains a model, not detailed material physics. |
| Camera | 7.8 | Impact remains visible while following the survivor, captured flight/Escape works, planet and moon approaches work. Fast released comet leaves view rapidly at maximum time. |
| Visual quality | 7.6 | Clean spheres and subdued palette are coherent; close Moon trail artifacts have been removed without obvious edge regression. Fragment labels make a compact event visually busier. |
| UI minimalism | 7.6 | History is compact and contextual, but the event toast visibly overlaps its scrubber. |
| Body creation | 7.5 | Placement preview, incline and release context work; random-motion mode passes a constant RNG value in current code. |
| Scale/orientation | 7.8 | Planetary-system placement is legible; impact is kept in frame; scale and parent frame labels help. |
| Time controls | 7.6 | Direct pause while reversing, Home/End history seeking and forward branching work. Retention remains bounded and upper rates remain much lower than the maximum label. |
| Performance | 8 | Close accelerated Earth rAF p95 improves from 33.4 to 17.2 ms in the bounded repeat sample. Console clean. |
| Simplicity | 8 | Controls remain sparse despite meaningful experimentation, with no card dashboard. |
| Sandbox enjoyment | 8 | Impact, rewind, seek and replay now form a useful, satisfying loop. |
| Coherence | 7.8 | Most previously reported seams are resolved; toast placement and random semantics prevent an unqualified 8. |

## Interaction and evidence

Loaded Planetary impact, watched approach for six seconds, then continued through collision and paused at 00:15:09. Four fragments were visible. Started reverse, directly paused it, scrubbed Home and opened Bodies: DOM count **2**, Cinder and Pearl. Closed drawer, scrubbed End and reopened Bodies: DOM count **4**, Cinder fragments 1–4. Scrubbed Home again and resumed forward to branch. Returned to Solar System, approached Earth at Up to 1 year/sec and measured 120 animation intervals. Captured mouse, held W, aggressively rotated, wheeled and escaped; approached Moon and checked close trail fade. Created Comet around Jupiter at 1,400,000 km with random motion and -42-degree inclination; inspected settled preview, released, and observed the resulting trajectory and locator at accelerated time. Seven meaningful screenshot states were captured and visually inspected. Console: zero errors/warnings. `just test`: 64 passed.

## Cadence comparison

120 requestAnimationFrame intervals, headed 1440×900 browser, close Earth at the same Up to 1 year/sec selection as iteration 3:

| Sample | Median | p95 | Worst | Worst interval equivalent |
|---|---:|---:|---:|---:|
| Iteration 3 | 16.70 ms | 33.40 ms | 33.60 ms | 29.8 fps |
| Iteration 4 | 16.70 ms | 17.20 ms | 17.40 ms | 57.5 fps |

This supports a material cadence improvement in the tested close view, not a universal performance guarantee. The visible achieved physics speed was approximately 4.2 days/sec with an explicit CPU-limit label.

## Five remaining weaknesses

1. **Toast overlaps history controls.** Pausing immediately after impact places 'Cinder and Pearl dispersed into four fragments' directly over the scrubber and its endpoint labels. `exp-eval4-fragments.png` is direct evidence. Move the toast above history whenever it is visible. This is an actual visible regression introduced by the scrubber.
2. **Random-motion semantics are not random in current placement code.** The UI choice was exercised, and a subsequent narrow source check confirms `src/main.js:356` supplies `() => 0.65` to `createPlacedBody`. Preserve a sampled random state across preview recomputation, and sample fresh values for a new attempt. Root identified this issue first; this reviewer independently confirmed the source, but did not statistically test multiple UI attempts.
3. **Maximum-time release can hide the arrival almost immediately.** At the retained upper rate, the released comet leaves frame within the two-second observation and becomes a locator. Parent-system framing is correct, but a direct Follow arrival action would make the result easier to inspect without forcing a time change. This is a remaining usability limitation, not a release failure.
4. **Fragment labels are repetitive in close events.** Four neighboring bodies each repeat 'Cinder fragment' before the distinguishing number; the selected fragment label also flips to the left. Keep complete accessible names but consider shorter visible labels while grouped. This is minor and should not trigger a broad visual rewrite.
5. **Full-system temporal acceleration remains capped far below upper choices.** The CPU-limit readout is now clear and honest, so this is a capacity limitation rather than deceptive UI. Around 4.2 days/sec cannot support year-scale exploration rapidly with all moons. Preserve physics safety; further optimization should be evidence-led and is not necessary for this cleanup cycle.

## Improvements, regressions, and recommendation

Verified fixes: reverse has a separate pause and forward action; history shows available past/future and seeks both directions; the impact stays visible through fragmentation; Moon close trails no longer slice the viewport; close cadence materially improves. No browser errors, crash, lost fragments or malformed restored body lists. The new toast/scrubber overlap and constant random provider deserve a fifth narrow cleanup iteration. Remaining capacity/label refinements are marginal relative to the now-working core; do not expand scope merely to chase a higher score.

## Screenshots

- `output/playwright/exp-eval4-approach.png`: readable two-world approach.
- `output/playwright/exp-eval4-fragments.png`: four visible fragments and toast/history overlap.
- `output/playwright/exp-eval4-history-start.png`: original worlds restored, history range visible.
- `output/playwright/exp-eval4-earth-close.png`: clean close sphere and explicit 4.2 days/sec CPU limit.
- `output/playwright/exp-eval4-moon-close.png`: improved close trail fade.
- `output/playwright/exp-eval4-placement.png`: settled Jupiter context and inclined comet preview.
- `output/playwright/exp-eval4-release.png`: parent-system view retained, fast comet now offscreen.
