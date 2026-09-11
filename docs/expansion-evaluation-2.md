# Expansion evaluation 2

Independent desktop review, 2026-09-11 13:44:38–13:49:45 UTC (5 minutes 7 seconds). Fresh strict browser, closed immediately after evaluation. Overall **7.1/10: good, with noticeable issues; not showcase polish**. Scores reflect observed experience, not feature count.

| Category | Score | Evidence |
|---|---:|---|
| Physics | 8 | 36 tests passed, including new preset state validation, scalar force equivalence, binary orbit and existing SI/conservation/collision tests. History/thermal tests also run but unwired UI receives no credit. |
| Camera | 7 | Captured flight, W, aggressive rotation, wheel and Escape worked. Several contextual focus transitions settle correctly; transient views are misleading until settled. |
| Visual quality | 6.5 | Close-sphere AA is a clear improvement; Jupiter has bands. Rocky/icy close bodies remain essentially featureless, and Jupiter is muddy/dim in the observed orientation. |
| UI minimalism | 8 | More functionality fits into restrained drawers and text controls without card clutter. |
| Body creation | 7.5 | Semantic comet preset, Jupiter target, random velocity and 67-degree inclination produced a visible trajectory. Invalid overlapping blue giant was rejected. Settled preview/arrow works. |
| Scale/orientation | 7 | Grouped moons and local historical tracks significantly clarify Jupiter. Placement camera framing and old-selection HUD still compete. |
| Time controls | 6 | Real-time seconds clock advances; full solar year/sec request achieved only 4.1–4.5 days/sec. Reverse/history intentionally deferred. |
| Performance | 6.5 | Responsive interactions; no console errors/warnings. Integrator optimization improves observed achieved rate, but ambitious rates remain far beyond capacity. |
| Simplicity | 7.5 | Presets lower scientific-input burden. Advanced decimal fields are visually cramped, and essential release control goes below the initial drawer fold. |
| Sandbox enjoyment | 7 | Comet orbit and heavier-moon scenario are immediate, readable experiments; binary scenario also loads coherently. |
| Coherence | 7 | Interface and exploration fit together better; remaining visual/time/input roughness prevents an 8. |

## Interaction and evidence

Fresh browser; captured mouse and flew with W, rotated and escaped; opened creator; deliberately invalid Blue giant around Earth at 0.001 km, observed radius validation; then Comet around Jupiter at 900000 km, random motion, 67-degree inclination; released successfully and saw trajectory in Jupiter system. Loaded heavier Moon, observed motion, switched to real time and verified seconds clock advancement; approached Heavy Moon, captured/rotated/flew/wheeled/Escaped; restored Solar System, tested year/sec, approached Jupiter; loaded Binary stars and inspected advanced SI fields; returned to Solar System and explicitly rechecked Jupiter placement preview after a 2.5-second settle. Nine meaningful screenshot states plus the settled-preview correction were captured and visually inspected. Console: zero errors/warnings. `just test`: 36/36.

## Five weaknesses and recommendations

1. **Upper time choices remain mostly aspirational.** Full system requested 365.25 days/sec and achieved 4.1–4.5, still roughly 81–89 times slower. Make attained capacity and rate limits immediately understandable, or improve safe performance further. No need to compromise the physical timestep to match the label.
2. **Close planets/moons still lack distinctive visual reward.** Jupiter bands/AA fix major roughness, but observed nightside is murky brown; Heavy Moon is a smooth gray ball. Improve restrained procedural rock/ice identity and legible ambient detail while retaining day/night lighting. This is an aesthetic weakness, not a claim that a dark nightside is physically incorrect.
3. **Placement context mixes two targets.** After choosing Jupiter, the scene centers Jupiter but selected Sun HUD remains (744 million km away), and preview framing uses the full-width canvas despite the right drawer. Use the visible viewport for framing and explicitly identify placement context. The initially tiny preview was a transition capture, NOT a persistent framing failure; a 2.5-second retest showed a readable ghost and velocity arrow.
4. **Advanced exact values are hard to read.** Full decimal SI numbers clip inside approximately 85-pixel inputs (position and velocity). Use suitable scientific notation/precision for display while preserving exact underlying values. Expanding advanced moves Release below the initial 900-pixel viewport; keep it easy to reach without sacrificing the minimal drawer.
5. **Scenario experiments lack revisit/comparison mechanics.** New starting points are useful, but reverse/history is still deferred, so exploratory mistakes and interesting encounters cannot yet be revisited. Add a clear bounded-history interaction and communicate scenario identity during experiments. This is outstanding scope, not a failed implementation claim.

## Improvements, regressions and limits

Verified improvements since evaluation 1: stair-stepped close edges resolved; local moon tracks now read as coherent orbital histories; moon hierarchy grouped; release reveals new body in meaningful system context; real-time seconds progress; achieved full-system speed approximately doubled. No crash, failed validation, broken release or stuck cursor observed. Old-selection HUD during placement and clipped advanced values are newly exposed rough edges. No forced physical collision in the UI; no quantitative FPS benchmark. Reverse/history and thermal UI were not wired and were not evaluated. Only heavier Moon, Binary stars and Solar System scenarios were exercised; the remaining scenario buttons were inspected, not claimed tested.

## Screenshots

- `output/playwright/exp-eval2-strange-preview.png`: invalid close blue giant and validation.
- `output/playwright/exp-eval2-comet-preview.png`: early transition frame, not settled preview evidence.
- `output/playwright/exp-eval2-comet-release.png`: new comet and coherent Jupiter moon histories.
- `output/playwright/exp-eval2-heavy-moon.png`: loaded two-body scenario.
- `output/playwright/exp-eval2-moon-close.png`: smooth but featureless close moon, advancing seconds clock.
- `output/playwright/exp-eval2-speed.png`: 4.5 days/sec against year/sec request.
- `output/playwright/exp-eval2-jupiter-close.png`: antialiased bands and dim face; 4.1 days/sec.
- `output/playwright/exp-eval2-binary.png`: binary-star scenario framing.
- `output/playwright/exp-eval2-advanced.png`: long SI values clipped in inputs.
- `output/playwright/exp-eval2-preview-settled.png`: corrected, readable Jupiter comet preview after 2.5 seconds; stale Sun HUD.
