# Mass Effect

A small desktop-first orbital sandbox. Newtonian gravity in three dimensions, a quiet Canvas sky, and no runtime dependencies.

## Run

Node.js 22+: `just run` (or `npm start`), then open **http://127.0.0.1:5173**. `just test` runs numerical regressions; `just check` checks syntax. The app is static: deploy `index.html`, `style.css`, and `src/` to any static host.

## Explore

Click **Enter space** once to permit browser mouse capture. Mouse movement then looks continuously; no dragging. **Escape** only releases the cursor for controls; it does nothing in normal cursor mode. Click empty space to return to navigation. Physical WASD keys translate (including diagonals), Q/E descends/rises along the local vertical, either Shift accelerates, and the wheel travels without changing focal length. Translation eases in and brakes quickly; wheel travel is smoothed and speed adapts to nearby surfaces. Surface contact allows sliding instead of blocking sideways movement. Leaving navigation or switching focus cancels residual movement.

Approach a nonstellar surface to automatically travel **with its rotation**. The local vertical eases toward the ground normal without changing your viewing direction. Within 1.35 radii the surface frame engages; its rotation fades out on ascent and automatic follow releases beyond 1.7 radii. Ordinary ground clearance is two meters, with walkable near-ground speeds. Hold **E + Shift** to ascend quickly. No landing/mode button is required. **Release follow** overrides automatic attachment until you leave its capture zone. Explicit far-distance focus remains followed until released. Try **Scenarios → Lunar lookout**: Earth stays nearly fixed above the horizon while the Sun crosses the lunar sky.

Click a body at the crosshair, or use **Bodies**. **Focus / F** frames its moons; **Go closer / G** approaches its surface. **H** returns to the inner system; View also offers the outer-system overview. Leaving a surface with these controls smoothly restores system-up, even if mouse look, wheel travel or movement interrupts the journey. Body properties appear only in Details.

**View → Mouse look** adjusts sensitivity and selects Auto, System / trackpad, or Raw mouse input. Auto requests raw input on Firefox/Linux while preserving system acceleration on macOS and other browsers. Unsupported raw requests fall back to system input; legacy browsers that cannot confirm support are labeled accordingly. These two preferences are saved locally in this browser. Both mouse axes and fractional deltas are accumulated without rounding or axis snapping and consumed once per rendered frame; Escape/blur clears pending motion.

Firefox added raw pointer-lock input in [version 152](https://www.firefox.com/en-US/firefox/152.0/releasenotes/). Firefox/Wayland also has [reported high-polling-rate motion loss](https://bugzilla.mozilla.org/show_bug.cgi?id=2026316). Raw input is a compatibility option, not a guarantee that compositor/browser bugs are fixed: the app cannot reconstruct deltas the browser never delivers. Validation on macOS and synthetic event regressions do not replace testing on the affected Linux machine.

**Add body** offers planetary, small-body and stellar presets. Choose a target, distance (AU or km for display), inclination and initial relative motion. A ghost and arrow preview the arrival and its relative velocity. **Advanced** exposes exact SI position, velocity, mass and radius; Y is up. Compact scientific displays retain full precision unless edited. **Scenarios** offers eight ordinary initial states, including binary stars, a deliberately unstable second Sun, a planetary impact and the lunar lookout. Opening a sheet pauses simulation.

**Keys** in the top bar opens the full keybinding reference. **Space** toggles play/pause; **←** rewinds recorded history, **→** plays forward, and **↑ / ↓** selects a faster/slower time multiplier. Shortcuts are inactive in open sheets and input fields. The time selector sets a requested multiplier, not a promise to skip physics. When CPU work saturates, an achieved-rate label reports the actual speed. Short-period moons make the full Solar System much more demanding than a two-star experiment.

**«** rewinds recorded history; **Ⅱ** pauses either direction; **›** resumes forward and branches from the restored state. A small scrubber appears while paused or rewinding and can revisit either direction within the retained recording. Up to 900 snapshots / 32,000 body records are retained, recorded at at most 30 Hz plus discrete events (roughly 30 seconds of recent interaction at small body counts, not unlimited history). Its ends show available past/future durations. Rewind stops at the boundary and clears trails. Between compatible snapshots, ordinary forward gravity reconstructs the requested time; it does not interpolate shortcuts through moon orbits. Reconstruction is bounded to 4,096 steps and reports the time actually reached.

Trails record actual motion, never predefined orbital ellipses. When inspecting a planet and its moons closely, moon trails use recorded positions relative to their parent. Elsewhere trails are in the inertial world frame. Tiny bodies are visually enlarged; orbital positions and physical radii are never altered for visibility.

## Physical model

Every state and force calculation uses **meters, kilograms, seconds, m/s and m/s²**. G = 6.67430e-11 m³ kg⁻¹ s⁻². All bodies receive exact pairwise gravity. The 26-body starting system includes the Sun, eight planets and 17 moons. A 128-body cap keeps an approximate gravity tree unnecessary.

Velocity Verlet uses a maximum 1,800-second step, reduced by powers of two for close/fast encounters. At requested multipliers up to 3,600×, the maximum is one second for responsive low-speed playback. Neither mode chooses steps from render-frame debt: tests verify identical states at 30/60/120 FPS. The render clock, configured physics maximum and requested multiplier remain distinct. Adaptive steps lose strict symplecticity; this is a convincing sandbox, not a professional ephemeris. A frame work budget slows time under load, with no hidden-tab catch-up. The encounter step floor is about 0.007 seconds; extreme compact-object encounters are not high-precision models.

Axial orientation uses dimensionless unit quaternions and angular velocity in radians per second. Canonical planets use rounded [NASA rotation periods and obliquities](https://nssdc.gsfc.nasa.gov/planetary/factsheet/); illustrative new bodies default to a 24-hour spin unless their preset name matches a canonical planet/star. Regular moons use an **idealized synchronous orientation**: one face follows the actual primary direction and the pole follows orbital angular momentum. This intentionally omits lunar libration, precession and tidal torque evolution. A moon becoming unbound or losing its primary retains its last angular velocity as a free spin. Spin does not feed back into point-mass gravity. History records orientation and angular velocity.

Venus and Uranus use the actual J2000 pole directions from [JPL's IAU orientation kernel](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc), including the retrograde sign in the reflected world coordinate system. Venus takes 243.018 Earth days per sidereal rotation; Uranus takes 17.24 hours. Their spin/orbit angles are approximately 177.36° and 97.77°. Uranus's regular moons orbit in the same sense as its spin. Other planet pole azimuths and all initial prime meridians remain illustrative, not an ephemeris.

Swept sphere contact during each drift catches impacts between step endpoints. Slow bound contacts merge, preserving total mass, linear momentum, center of mass and volume. Orbital plus intrinsic angular momentum becomes merged spin using uniform-sphere inertia. Unbound grazing contacts (normal-speed squared below 35% of relative-speed squared) use a frictionless normal impulse with restitution 0.4, provided the outgoing pair remains unbound. This allows hit-and-run encounters rather than universal sticking. A tiny mass-weighted contact separation introduces a roughly part-per-million angular-momentum error. Contact processing limits repeated rebounds to 512 per solve before falling back to coalescence. These outcomes are inelastic and do **not** conserve mechanical energy.

Energetic impacts between comparable nonstellar bodies can instead create **up to 32 equal-mass fragments by default**. **View → Impact detail** offers ceilings of 4, 8, 16, 32 or 64. Measured solver and drawing costs conservatively lower future impacts' counts to target at most 2 ms per physics step and 10 ms per rendered frame, subject to the overall 128-body cap. This is an estimate, not a hardware guarantee; the usual physics frame budget also slows time under load. Existing debris is never deleted for performance. The threshold is twice the summed uniform-sphere binding energies; at most one quarter of excess relative kinetic energy becomes fragment ejection and spin energy. Fragment mass is at least 1e14 kg, radius at least 1,000 m, and the smaller impactor must have at least 5% of the larger body's mass. Insufficient body slots, stars, low-energy impacts and tiny impacts cannot fragment. Already-fragmented descendants may rebound when the outgoing pair is unbound, otherwise merge; they never recursively fragment.

Fragments preserve total mass, linear momentum, center of mass and volume. Four pieces use a compact tetrahedron; larger counts use a deterministically disordered, relaxed close-packed cloud with nonoverlapping spheres and varied radial ejection speeds. Opposite pairs cancel net impulse, and the full cluster inertia tensor determines spin. Shared spin and tangential ejection carry angular momentum when it fits the energy budget; extreme cases cap rotational energy at 80% of that budget and **lose angular momentum**. Placement still changes gravitational potential energy. This is a deliberately bounded toy approximation, not impact heat, material fracture or fluid deformation. Generation limits and recorded fragment outcomes survive later merges and rewind.

A half-second presentation-only crossfade bridges mergers/disruption with fading progenitor silhouettes. It never delays contact or changes the gravitational state. Effects freeze when paused, are bounded to 12 events, and clear on rewind, scrubbing or scenario changes. Actual bodies remain at their integrated positions; only temporary, unpickable silhouettes move/shrink for the handoff. Follow anchors rebase without teleporting the camera when a body changes into a survivor/fragment.

Merges can be undone by restoring recorded states, **not** by analytically reversing their dissipated energy. A changed body set snaps to the earlier recorded state; no mass interpolation is performed. Creation at the same timestamp replaces that recorded state. Reset/scenario changes start a new history.

Stars store luminosity in watts and effective temperature in kelvin, with a restrained qualitative color approximation. A merger sums incoming stellar luminosities and derives a consistent effective temperature from its merged radius; this is a toy radiative bookkeeping rule, not stellar evolution. Nonstellar Details show radiative equilibrium temperature from the sum of all stellar fluxes, with absorbed fraction (1 − albedo), uniform reradiation and default albedo 0.3. It excludes atmospheres, eclipses, tides, thermal inertia and internal heat. Earth near the Sun is approximately 255 K, not its actual surface temperature.

Planet initial conditions use rounded [JPL J2000 elements](https://ssd.jpl.nasa.gov/planets/approx_pos.html) and [physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html). Moons use approximate mean circular relative states with [JPL satellite physical parameters](https://ssd.jpl.nasa.gov/sats/phys_par/) and inclined orbital planes, not an epoch-accurate ephemeris. Moon systems retain their original subsystem barycenter, then the whole system is shifted into its barycentric rest frame. All subsequent motion comes from gravity.

Resolved disks blend into inexpensive ray/sphere shading, including when a close body's center leaves the viewport. Surface patterns rotate with the body; giant bands and fine surface albedo are illustrative, not measured maps or terrain. Unresolved fine detail fades to avoid aliasing. The camera cannot penetrate a physical sphere. Trails are capped at 600 samples per body.

Close spheres share a projected-pixel shading budget. Dense clouds use lower-resolution shading instead of drawing dozens of full-resolution overlapping surfaces; ordinary single-body approaches retain full detail. Sphere uploads and compositing are restricted to their projected bounds. This affects presentation only, never physical radii or positions.

## Small architecture

Plain ES modules and Canvas 2D, no engine, build pipeline or downloaded assets. The original Python/Pygame prototype was run and inspected in the previous cycle: it had three static arbitrary-unit spheres, an unstable camera and no gravity. The browser replacement retained the useful 3D-to-screen concept; the retired version is recoverable in Git history. The focused three-pass rotation/collision follow-up is documented in [surface-impact-loop.md](docs/surface-impact-loop.md).

- `forces.js`, `physics.js`: exact forces, encounter stepping, integration and merging.
- `impacts.js`: glancing impulses, angular momentum and bounded fragmentation.
- `fragment-budget.js`: measured CPU/drawing cost ceiling for future debris.
- `rotation.js`: SI axial spin and idealized synchronous moon orientation.
- `impact-view.js`: bounded presentation-only collision handoffs.
- `solar.js`, `moons.js`: approximate canonical SI initial conditions.
- `presets.js`, `scenarios.js`: reusable starting states.
- `history.js`: bounded recorded rewind and physically reconstructed branches.
- `thermal.js`: multistar equilibrium temperature and restrained stellar colors.
- `camera.js`: world-space navigation, follow and surface guards.
- `mouse-look.js`: two-axis input accumulation, sensitivity and raw-input fallback.
- `render.js`, `sphere.js`: projection, actual trails, picking and close surfaces.
- `main.js`: explicit application state and sparse controls.

Numerical tests cover planetary and moon stability, momentum, swept collision timing, bounded fragmentation, recorded reconstruction, preset/scenario construction, diagonal camera input, smooth travel and surface sliding, camera recovery, frame-rate-independent low-speed stepping and bounded work/memory. Builder and independent desktop evaluation reports are summarized in [ITERATIONS.md](ITERATIONS.md) (original cycle) and [EXPANSION.md](EXPANSION.md) (current expansion, final independent score 8.0/10).

Run `just benchmark-fragments` for local 4–64-body solver timings. The focused axis, surface-exit and fragment-budget build/evaluate/follow-up is recorded in [axis-fragment-followup.md](docs/axis-fragment-followup.md).
