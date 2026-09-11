# Mass Effect

A small desktop-first orbital sandbox. Newtonian gravity in three dimensions, a quiet Canvas sky, and no runtime dependencies.

## Run

Node.js 22+: `just run` (or `npm start`), then open **http://127.0.0.1:5173**. `just test` runs numerical regressions; `just check` checks syntax. The app is static: deploy `index.html`, `style.css`, and `src/` to any static host.

## Explore

Click **Enter space** once to permit browser mouse capture. Mouse movement then looks continuously; no dragging. **Escape** releases the cursor for controls; **Explore** returns to navigation. WASD translates, Q/E descends/rises, Shift accelerates, and the wheel travels without changing focal length. Speed adapts to nearby surfaces. Movement stays in the followed body's frame until **Release follow** is chosen in Details.

Click a body at the crosshair, or use **Bodies**. **Focus / F** frames its moons; **Go closer / G** approaches its surface. **H** returns to the inner system; View also offers the outer-system overview. Body properties appear only in Details.

**Add body** offers planetary, small-body and stellar presets. Choose a target, distance (AU or km for display), inclination and initial relative motion. A ghost and arrow preview the arrival and its relative velocity. **Advanced** exposes exact SI position, velocity, mass and radius; Y is up. Compact scientific displays retain full precision unless edited. **Scenarios** offers seven ordinary initial states, including binary stars, a deliberately unstable second Sun and a planetary impact. Opening a sheet pauses simulation.

**Space** pauses. The time selector sets a requested multiplier, not a promise to skip physics. When CPU work saturates, an achieved-rate label reports the actual speed. Short-period moons make the full Solar System much more demanding than a two-star experiment.

**«** rewinds recorded history; **Ⅱ** pauses either direction; **›** resumes forward and branches from the restored state. A small scrubber appears while paused or rewinding and can revisit either direction within the retained recording. Up to 900 snapshots / 32,000 body records are retained, recorded at at most 30 Hz plus discrete events (roughly 30 seconds of recent interaction at small body counts, not unlimited history). Its ends show available past/future durations. Rewind stops at the boundary and clears trails. Between compatible snapshots, ordinary forward gravity reconstructs the requested time; it does not interpolate shortcuts through moon orbits. Reconstruction is bounded to 4,096 steps and reports the time actually reached.

Trails record actual motion, never predefined orbital ellipses. When inspecting a planet and its moons closely, moon trails use recorded positions relative to their parent. Elsewhere trails are in the inertial world frame. Tiny bodies are visually enlarged; orbital positions and physical radii are never altered for visibility.

## Physical model

Every state and force calculation uses **meters, kilograms, seconds, m/s and m/s²**. G = 6.67430e-11 m³ kg⁻¹ s⁻². All bodies receive exact pairwise gravity. The 26-body starting system includes the Sun, eight planets and 17 moons. A 128-body cap keeps an approximate gravity tree unnecessary.

Velocity Verlet uses a maximum 1,800-second step, reduced by powers of two for close/fast encounters. At requested multipliers up to 3,600×, the maximum is one second for responsive low-speed playback. Neither mode chooses steps from render-frame debt: tests verify identical states at 30/60/120 FPS. The render clock, configured physics maximum and requested multiplier remain distinct. Adaptive steps lose strict symplecticity; this is a convincing sandbox, not a professional ephemeris. A frame work budget slows time under load, with no hidden-tab catch-up. The encounter step floor is about 0.007 seconds; extreme compact-object encounters are not high-precision models.

Swept sphere contact during each drift catches impacts between step endpoints. Merging preserves total mass, linear momentum, center of mass and volume. It is inelastic and does **not** conserve mechanical energy.

Energetic impacts between comparable nonstellar bodies can instead create **four** equal-mass fragments. The threshold is twice the summed uniform-sphere binding energies; at most one quarter of excess relative kinetic energy becomes fragment ejection energy. Fragment mass is at least 1e14 kg, radius at least 1,000 m, and the smaller impactor must have at least 5% of the larger body's mass. Body-cap overflow, stars, low-energy impacts, tiny impacts and already-fragmented descendants fall back to merging.

Fragments preserve total mass, linear momentum, center of mass and volume. Their tetrahedral displacement is deliberately approximate: it changes gravitational potential energy and does not conserve angular momentum or model spin, impact heat or material fracture. Generation limits prevent recursive fragmentation, including after later merges and rewind. No relativity, terrain, climate or stellar evolution is modeled.

Merges can be undone by restoring recorded states, **not** by analytically reversing their dissipated energy. A changed body set snaps to the earlier recorded state; no mass interpolation is performed. Creation at the same timestamp replaces that recorded state. Reset/scenario changes start a new history.

Stars store luminosity in watts and effective temperature in kelvin, with a restrained qualitative color approximation. A merger sums incoming stellar luminosities and derives a consistent effective temperature from its merged radius; this is a toy radiative bookkeeping rule, not stellar evolution. Nonstellar Details show radiative equilibrium temperature from the sum of all stellar fluxes, with absorbed fraction (1 − albedo), uniform reradiation and default albedo 0.3. It excludes atmospheres, eclipses, tides, thermal inertia and internal heat. Earth near the Sun is approximately 255 K, not its actual surface temperature.

Planet initial conditions use rounded [JPL J2000 elements](https://ssd.jpl.nasa.gov/planets/approx_pos.html) and [physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html). Moons use approximate mean circular relative states with [JPL satellite physical parameters](https://ssd.jpl.nasa.gov/sats/phys_par/) and inclined orbital planes, not an epoch-accurate ephemeris. Moon systems retain their original subsystem barycenter, then the whole system is shifted into its barycentric rest frame. All subsequent motion comes from gravity.

Close surfaces use inexpensive ray/sphere shading and edge coverage, including when the body's center leaves the viewport. Giant bands are illustrative, not measured maps. The camera cannot penetrate a physical sphere. Trails are capped at 600 samples per body.

## Small architecture

Plain ES modules and Canvas 2D, no engine, build pipeline or downloaded assets. The original Python/Pygame prototype was run and inspected in the previous cycle: it had three static arbitrary-unit spheres, an unstable camera and no gravity. The browser replacement retained the useful 3D-to-screen concept; the retired version is recoverable in Git history.

- `forces.js`, `physics.js`: exact forces, encounter stepping, integration and merging.
- `impacts.js`: bounded approximate fragmentation eligibility and conservation.
- `solar.js`, `moons.js`: approximate canonical SI initial conditions.
- `presets.js`, `scenarios.js`: reusable starting states.
- `history.js`: bounded recorded rewind and physically reconstructed branches.
- `thermal.js`: multistar equilibrium temperature and restrained stellar colors.
- `camera.js`: world-space navigation, follow and surface guards.
- `render.js`, `sphere.js`: projection, actual trails, picking and close surfaces.
- `main.js`: explicit application state and sparse controls.

Seventy numerical tests cover planetary and moon stability, momentum, swept collision timing, bounded fragmentation, recorded reconstruction, preset/scenario construction, camera recovery, frame-rate-independent low-speed stepping and bounded work/memory. Builder and independent desktop evaluation reports are summarized in [ITERATIONS.md](ITERATIONS.md) (original cycle) and [EXPANSION.md](EXPANSION.md) (current expansion, final independent score 8.0/10).
