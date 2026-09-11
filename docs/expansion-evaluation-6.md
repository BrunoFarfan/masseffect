# Evaluation 6 — final regression verification

Independent desktop session, **2026-09-11 14:34:16–14:37:27 UTC (3 minutes 11 seconds)**. Fresh browser closed at completion. Final score remains **8.0/10**: coherent, polished enough for the requested restrained showcase, with bounded simulation/product limitations rather than a critical unfinished interaction. **Stop the iteration loop.**

| Category | Score | Final evidence |
|---|---:|---|
| Physics | 8.5 | 70 tests pass; UI impact creates four fragments and seeking restores two originals/four fragments. |
| Camera | 8 | Earth approach, W/D movement, aggressive look, wheel, Escape and Moon recovery all work. |
| Visual quality | 8 | Smooth close planets/moons, clear compact fragment labels and restrained composition. |
| UI minimalism | 8 | Corrected toast and history range coexist cleanly; drawers remain sparse. |
| Body creation | 8.2 | Random Moon placement around Neptune at 130 degrees releases successfully with unique Moon 2 name and system context. |
| Scale/orientation | 8 | Preview, parent frame, scale, selection and close approach remain coherent. |
| Time controls | 8 | Newest paused state shows +0 s; seeking/reversing clears stale event toast; direct pause, forward branching and low-rate clock work. |
| Performance | 8 | Final close Earth 120-frame sample: median 16.7 ms, p95 17.4 ms, worst 17.7 ms. Console clean. |
| Simplicity | 8 | Updated help correctly explains reverse, pause and separate forward action. |
| Sandbox enjoyment | 8.2 | Actual impact/revisit and custom moon exploration form complete working experiments. |
| Coherence | 8 | Previous small history presentation regressions are resolved; no critical new issue found. |

## Direct regression evidence

Watched Planetary impact for 15 seconds, paused after fragmentation, captured and inspected the state. The history DOM read **−901 s / +0 s**; the event toast was above the range. Scrubbed Home: **2 bodies**, empty status text. Scrubbed End: **4 bodies**, empty status text. Started reverse, paused directly, resumed with Play forward and switched to real time. The clock progressed from **00:13:47 to 00:13:51 during a 3.1-second sample**; whole-second quantization means this short displayed interval is not a precise rate benchmark. Frame-rate independence is protected by the passing numerical tests.

Changed scenario to Solar System, created a Moon around Neptune at **700,000 km, random motion, inclination 130 degrees**, inspected settled preview and released **Moon 2**. Approached Earth, captured flight, held W then D, aggressively rotated, scrolled and escaped; selected Moon and approached it. Inspected View help: **« rewinds; Ⅱ pauses either direction; › resumes forward**. Returned to close Earth at the upper rate for 120 rAF intervals. Console: zero errors/warnings; `just test`: **70/70 passed**. Seven screenshots captured and visually inspected. No source changes during the evaluation.

## Five remaining limitations, not blockers

1. **Upper-rate capacity:** the full moon system still runs far below the largest requested upper rate on this machine. Attained speed/CPU messaging communicates this; numerical safety should remain the priority.
2. **Bounded history:** recording is a short window rather than durable save/load or unlimited reversal. The visible range and help now explain the available operation correctly.
3. **Simplified impacts:** four bounded fragments model an energetic outcome, not detailed material disruption or stellar evolution. Conservation tests and explicit scope are more valuable than visual spectacle here.
4. **Advanced spatial preview:** the earlier final review found exact-state mode less visually guided than semantic placement. That optional enhancement was not changed in this narrow pass and was not retested here.
5. **Fast-arrival framing:** an escaping custom body can leave its parent-system view; the locator and follow/approach actions recover it. In this pass Moon 2 was still visible near the frame edge, with its locator also appearing, a minor redundant cue rather than a failed release.

## Outcome

The +−1-second history artifact is fixed. The old event toast no longer survives explicit seeks/reverse into another state. Forward replay, counts, low-rate progress, creation and near navigation remain functional. No critical regression, crash, stuck cursor or console error was found. Keep the **8.0** score rather than increasing it for two copy/state fixes. Further changes would be separate optional work; no seventh cycle is warranted.

## Screenshots

- `output/playwright/exp-eval6-impact-pause.png`: clean paused impact, four fragments, +0 s endpoint.
- `output/playwright/exp-eval6-history-home.png`: intact original worlds and cleared event toast.
- `output/playwright/exp-eval6-placement.png`: inclined random Moon 2 preview around Neptune.
- `output/playwright/exp-eval6-release.png`: released Moon 2, parent-system context and edge locator.
- `output/playwright/exp-eval6-moon.png`: clean close Moon after aggressive flight.
- `output/playwright/exp-eval6-help.png`: corrected time-control help.
- `output/playwright/exp-eval6-earth.png`: final clean close-Earth performance state.
