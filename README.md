# Mass Effect

A little space to play. A minimal 3D Solar System, simulated with Newtonian gravity and drawn with Canvas. No runtime packages, bundler, assets to download, or external services.

## Run

Install Node.js 22+ and run `just run` (or `npm start`). Open **http://127.0.0.1:5173**. Run numerical tests with `just test`, syntax checks with `just check`.

The website is static: deploy `index.html`, `style.css`, and `src/` to any static host. The Node server is only a local development convenience.

## Play

- Drag to look; scroll to travel. WASD translates, Q/E moves vertically, Shift accelerates. Movement speed follows nearby distances; focal length stays fixed.
- Click a sphere or use the body selector to inspect. Double-click or **Follow body** to approach and follow. **Inner system** / H returns home; **Whole system** frames the outer planets.
- Space pauses. Time controls advance days through years per real second.
- **Surprise me** releases a randomized, inclined arrival in one click. **Customize** accepts position in m, velocity in m/s, mass in kg and physical radius in m. Its Randomize action previews values before release. Side sheets pause time. Desktop mouse and keyboard are the target; mobile playability is not a requirement.
- If the selected body is outside the view, a directional label brings it back with one click. WASD exits follow; the explicit Release camera action does too.
- Bright trails record actual positions. Faint orbit guides show original unperturbed orbits, not predictions. Body sizes are visually enlarged; positions are never rescaled nonlinearly.

## Model and limits

Physics stores meters, kilograms, seconds and m/s exclusively. `G = 6.67430e-11 m³ kg⁻¹ s⁻²`. All nine bodies, including the Sun, receive exact pairwise forces. Velocity Verlet uses a 1,800 s base timestep, reduced by powers of two during close encounters. Frame rate and requested time scale are independent of the timestep. Changing steps near encounters loses strict symplecticity; canonical planetary motion uses the fixed step. A frame work budget slows simulated time under load rather than enlarging steps. No hidden-tab catch-up.

Physical contact is swept across every Verlet drift; the earliest contact merges spheres, preserving mass, linear momentum, volume and center of mass. Inelastic collisions do not conserve mechanical energy. Encounter steps have a roughly 0.007 s minimum: very extreme compact-mass flybys are not high-precision models, even though swept contact prevents tunneling. Trails are bounded to 600 samples per body, with planetary sampling intervals proportional to their starting orbital periods. The sandbox caps at 128 bodies, making exact gravity simpler than an approximate tree for this scope. No GR, moons, spin, fragmentation, or high-precision ephemeris claims.

When a requested speed cannot be sustained, the clock reports achieved simulated days per real second. This can happen from body count, close encounters or machine load; the simulation protects accuracy by slowing time. The reference scale bar is local to the selected body's depth, not a universal screen-space ruler.

Initial conditions use rounded [JPL J2000 approximate orbital elements](https://ssd.jpl.nasa.gov/planets/approx_pos.html) and [planetary physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html). Semi-major axes are stored in meters; angular elements are converted to radians only during initialization. Earth's starting orbit approximates the Earth–Moon barycenter. The whole system is shifted to its barycentric rest frame. After initialization, motion comes entirely from gravity.

## Architecture decision · iteration 1

The original Python/Pygame program was run and inspected. It drew three static, arbitrary-unit spheres and a grid; movement was event-driven, the camera had pole and clipping weaknesses, and gravity was not implemented. Retaining it would not save substantive physics or interaction work.

Replace it with browser-native ES modules and Canvas 2D: predictable pointer input, portable deployment, no engine or dependency tree. Keep the useful concept of projecting a mathematical 3D world into simple spheres. The retired implementation remains recoverable in Git history; there is only one maintained version.

- `physics.js`: SI force evaluator, Verlet integration, collision merging, time budget.
- `solar.js`: initial conditions and randomized visitors.
- `camera.js`: world-space movement and perspective projection.
- `render.js`: spheres, orbit references, bounded trails, picking.
- `main.js`: controls, state and animation loop.
- `math.js`: small vector helpers.

Numerical checks cover an Earth orbit, ten-year system energy stability, momentum conservation, swept collisions and misses, camera basis/recovery, bounded orbital trails and simulation budgeting. Browser evaluations and iteration decisions are recorded in `ITERATIONS.md`.
