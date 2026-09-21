# Surface landmark provenance

Landmark labels are sparse orientation aids, not surveyed outlines. The
renderer stores planetocentric latitude and east-positive longitude in degrees
and uses the center coordinate returned by the IAU/USGS Gazetteer where one is
available. Gazetteer pages commonly expose longitudes as planetographic
`+West, 0–360`; those values were converted with `east = 360 - west` and then
wrapped into `[-180, 180]`.

Primary coordinate references:

- [IAU/USGS Mercury Caloris Planitia](https://planetarynames.wr.usgs.gov/Feature/979)
- [IAU/USGS Venus Aphrodite Terra](https://planetarynames.wr.usgs.gov/Feature/317)
- [IAU/USGS Phobos Stickney](https://planetarynames.wr.usgs.gov/Feature/5707)
- [IAU/USGS Deimos Voltaire](https://planetarynames.wr.usgs.gov/Feature/6431)
- [IAU/USGS Io Prometheus](https://planetarynames.wr.usgs.gov/Feature/4836)
- [IAU/USGS Europa Pwyll](https://planetarynames.wr.usgs.gov/Feature/4878)
- [IAU/USGS Ganymede Galileo Regio](https://planetarynames.wr.usgs.gov/Feature/2076)
- [IAU/USGS Callisto Valhalla](https://planetarynames.wr.usgs.gov/Feature/6284)
- [IAU/USGS Titan Xanadu](https://planetarynames.wr.usgs.gov/Feature/6958)
- [IAU/USGS Rhea Tirawa](https://planetarynames.wr.usgs.gov/Feature/6026)
- [IAU/USGS Iapetus Cassini Regio](https://planetarynames.wr.usgs.gov/Feature/1047)
- [IAU/USGS Titania Gertrude](https://planetarynames.wr.usgs.gov/Feature/2150)
- [IAU/USGS Miranda Verona Rupes](https://planetarynames.wr.usgs.gov/Feature/6359)
- [IAU/USGS Oberon Hamlet](https://planetarynames.wr.usgs.gov/Feature/2340)

The expanded Moon and Mars named-feature centers were checked against the
[IAU/USGS nightly GIS exports](https://planetarynames.wr.usgs.gov/GIS_Downloads)
downloaded on 2026-09-20. The source KMZ archives are retained offline only:

- `MOON_nomenclature_center_pts.kmz` — SHA-256 `20bd83a4ff8b13de6c27355b0c37969805faaacd8b3f6468c838ea875f91f7cc`
- `MARS_nomenclature_center_pts.kmz` — SHA-256 `99861c1fed07cfee1989dffab82b2785dee0c2c309f439845f3f74a49262968a`

These KML centers are east-positive, planetocentric. Values above 180° were
wrapped into the renderer's −180..180° interval. The on-screen names remain
map-center orientation aids, not surveyed feature outlines. The [Apollo 11
landing coordinate](https://www.nasa.gov/history/apollo-11-mission-overview/)
and [Apollo 17 Taurus-Littrow center](https://science.nasa.gov/resource/taurus-littrow-valley/)
come from NASA rather than IAU feature nomenclature; neither implies that
the lander is resolved in the runtime imagery. The small outer-moon entries
without a stable, verified named-feature center use a clearly labelled polar
reference instead. Triton uses a polar reference rather than incorrectly
attributing Pluto's Sputnik Planitia to Triton.

Gas-giant labels and the Sun intentionally avoid Great Red Spot, storm, or
sunspot claims: those features evolve and are not durable body-fixed POIs in
this simulation. Their north-pole references are stable orientation markers.
