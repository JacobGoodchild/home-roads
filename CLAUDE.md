# Home Roads: build brief

You're working on your own until about 13:30 UK time. I won't be around to answer questions, so make sensible
choices yourself and write them down in the progress log. Check the time now and then with `TZ=Europe/London date`.

## The goal
A browser game where you drive a hypercar around the real roads of **Overton and Whitchurch in Hampshire, England**
(and the B3400 between them), as realistic as possible. It should be published on GitHub Pages and run smoothly on my
phone (a Pixel 7) as well as on a laptop.

Use real map data: the real road layout, road widths, junctions, buildings in the right places with sensible
heights, the River Test, the railway, fields, woods and hedgerows, and the real shape of the ground (the hills and
valleys should be the true shape, not invented). THIS IS AN IMPORTANT POINT: IT SHOULD BE AS REALISTIC AS POSSIBLE. MAKE IT VERY REALISTIC, EVERYTHING ABOUT IT REALISTIC ALL THE HOUSES AND ROADS AND SHOPS AND TREES AND WHATEVER EVERYTHING IS ALL HYPERREALISTIC NOT JUST RUBBISHY BLOCKS AND SIMPLE 3D SHAPES.
Also use real-time weather data to make the weather realistic, see next point

## Starting point: reuse my other game
My game Apex Ring (public repo: https://github.com/JacobGoodchild/apex-ring) already has hypercars, driving physics,
engine sounds, a chase camera, phone and keyboard controls, rain and night lighting, and a tested GitHub Pages setup.
Clone it and **copy across whatever is useful**: the car models, vehicle physics, audio, input, camera, scene and
lighting setup, Playwright test setup and the deploy workflow. Read its CLAUDE.md first; it explains the code. Don't
change the Apex Ring repo itself. Note in CREDITS.md that this code comes from Apex Ring.

Use the same approach as Apex Ring: plain ES modules, no build step, Three.js copied into `vendor/` from npm, an
import map in index.html, Playwright tests, and a GitHub Actions workflow that runs the tests and deploys to GitHub
Pages only if they pass.

## Map data
- Area: a box covering both towns and the road between them, roughly latitude 51.215 to 51.260 and longitude
  -1.360 to -1.240. Overton's centre is around 51.244, -1.263 and Whitchurch's around 51.230, -1.338. Check these
  against the map data and adjust the box if needed.
- Roads, buildings, water, railway, land use, woods, hedges, street names: OpenStreetMap.
- Ground shape: the best free height data you can get. Ideally the Environment Agency's free LIDAR terrain data
  (1 m or 2 m), otherwise OS Terrain 50 or another open source. If you can get both the bare-ground and the
  with-buildings LIDAR, use the difference to give buildings their real heights.
- **Download and process the data once, ahead of time**, with a script in `scripts/`, and save compact files in
  `data/`. The game must not fetch anything from the internet while it's running. Split the world into chunks so
  the phone only loads and draws what's near the car.
- Credit the data properly: show "© OpenStreetMap contributors" in the game (on the menu or a credits screen) and list
  every data source and licence in CREDITS.md.
- **If this environment can't reach those download sites**, don't give up and don't invent the map. Instead, make a
  GitHub Actions workflow (`bake-data.yml`) that runs the download-and-process script on GitHub's servers and commits
  the results to the repo, then pull them down. Say in the log which route you used.

## Rules
- Never use real car brands, logos or copies of real car designs (the Apex Ring cars are fine, they're original).
- Only use textures, models and sounds with a licence that allows reuse (CC0 or CC-BY), and list each in CREDITS.md.
- Aim for 60 fps on a Pixel 7. Watch triangle and draw-call counts, merge and instance repeated things (trees,
  street lights, hedges), and use simpler versions of distant things.
- No network requests while playing, no tracking, no cookies, no secrets, no eval. Only localStorage (in try/catch).
- Only well-known npm packages. If you need extra tools for processing map data in the scripts, keep them to
  well-known ones and only use them in the scripts, never in the game itself.
- Keep it playable after every commit. If something breaks, undo it rather than stacking fixes on top.

## How to check your work (before every commit)
1. Run the tests (headless Chromium): no console errors, the game loads, the car spawns on a real road, it drives
   and steers, and the frame rate is reasonable.
2. Take screenshots at phone portrait (412x915) and landscape (915x412) at a few known spots (Overton centre,
   Whitchurch centre, on the B3400, somewhere on a hill). Look at them properly and fix anything ugly or wrong, like
   floating roads, roads buried in hills, buildings in the road or holes in the ground.
3. Commit with a clear message, one feature per commit, and push to `main` so it deploys.

## Order of work (top to bottom; get something live early)
1. **Setup:** repo structure, copied Apex Ring parts, tests, deploy workflow. Push a first version to Pages quickly.
2. **Map data:** the download-and-process script, the baked chunk files in `data/`.
3. **Drivable world:** ground mesh with real heights, roads laid onto it at the right widths with markings and
   kerbs, the car spawning in Overton's centre, chase camera, phone controls. **Deploy this as soon as it works.**
4. **Filling the world:** buildings from real footprints, trees, woods and hedgerows, the river, the railway,
   bridges where roads cross water or rail, fields. Chunk loading and simpler distant versions for speed.
5. **Driving around:** solid collisions with buildings and walls, slower grip on grass and fields, a minimap drawn
   from the real roads, the name of the road you're on shown on screen, a menu to start in Overton, Whitchurch or
   on the B3400, and a reset button if you get stuck.
6. **Realism:** good road and ground textures, nice lighting and shadows, the time of day matching real UK time
   (with an option to pick), street lights and headlights at night, optional rain.
7. **A challenge:** an Overton to Whitchurch sprint with a timer, checkpoints and your best time saved.
8. After that, keep improving whatever would make it look and feel most real.

## Progress log
At about 13:25 UK time, stop starting new work, make sure `main` is deployed and working, and write a short summary
in plain English: what's done, what isn't and why, the link to the live game, and the best ideas for next time.

### Code map
- `scripts/fetch_osm.py`, `scripts/fetch_lidar.py`, `scripts/bake.py` (+ `bbox.py`): download and bake the map into `data/`
  (`npm run bake`; needs python3 with numpy, scipy, pillow, pyproj, tifffile). `raw/` holds the downloads (not committed).
- `src/mapdata.js` — loads `data/` (meta, coarse heights, 250 m chunks), height/road/class queries, building + wall collision.
- `src/world.js` — streams chunks around the car with LOD rings. `src/terrain.js` ground meshes + ground shader,
  `src/roads.js` roads/pavements/bridges/railway/water, `src/buildings.js` buildings + facade atlas, `src/vegetation.js`
  trees/bushes/hedges, `src/lamps.js` street lights.
- `src/car.js` — free-roam car physics (adapted from Apex Ring's vehicle.js). `src/scene.js` renderer, sky, real sun position.
- `src/main.js` — boot, menu, loop, HUD, sprint, test hook (`window.__hr` with `?test=1`; `__hr.sim()` runs physics without rendering).
- From Apex Ring unchanged or nearly: `carmodel.js`, `cars.js`, `camera.js`, `input.js`, `tilt.js`, `audio.js`, `effects.js`, `textures.js`, `photo.js`.
- URL options: `?test=1`, `start=Overton|Whitchurch|B3400|Hilltop|sprint` (skip the menu), `quality=low|medium|high`, `hour=`, `rain=1`.

### Log
- 2026-10-20 09:47 Started. Checked network: Overpass and Geofabrik are blocked here, but the OpenStreetMap editing API
  (api.openstreetmap.org/api/0.6/map) and the Environment Agency's LIDAR WCS (1 m DTM + 1 m first-return DSM) both work,
  so I baked the data directly here (no bake-data.yml workflow needed). Box: BNG E444000–454000, N146000–152000
  (≈ 51.211–51.265 N, −1.372–−1.227), a little bigger than the brief's box so both towns have room around them.
- 10:30 Setup + map data + first drivable world: copied Apex Ring's cars, camera, input, audio, effects, Three.js vendor,
  Playwright and deploy workflow. Baked 960 chunks (2 m LIDAR ground, land classes), 1,241 roads, 3,793 buildings with
  LIDAR heights, ~149k trees + 17k bushes found as peaks in the LIDAR canopy, railway, River Test, streams. Car spawns on
  London Road (B3400) in Overton. Choice: phone controls are on-screen ◀ ▶ / GAS / BRAKE / HB pads (free roaming needs
  throttle and brake, unlike Apex Ring's auto-accelerate). Choice: live weather is opt-in from the menu (one request to
  open-meteo.com before you drive, never while playing), because the rules say no network while playing.
- 10:30 Rendering: full screen sharpness by default (device pixel ratio up to 3, antialiasing on; adaptive resolution only
  drops to 80% if frames get slow), graphics setting Best/Sharp/Balanced/Fast, reflections from the sky on the car paint
  and wet roads, a bit more distance haze. LOD rings reworked (2 m ground only where the car is), ~330k triangles.
  Fixed the car being launched when the ground data under it switched from coarse to detailed. Trees whose trunk would
  stand on a road removed; crowns next to roads limited to the distance to the road.
- 10:30 Brief update from Jacob: REAL data only. Roof shapes from LIDAR, objects only where OSM maps them, OSM tags
  where they exist, neutral defaults elsewhere. Removing the invented details (windows atlas, made-up lamp posts,
  random tree colours/species).
- 10:50 Jacob's feedback: start outside Domino's in Overton, stop the glitches (thrown into the sky, crashing off
  buildings), and look like his Street View photos of Winchester Street (white render + red brick terraces, sash
  windows, clay/slate roofs, chimneys, brick walls with railings, bollards, lamp post, parked cars, big trees),
  target is desktop Chrome. Done: Overton spawn is on Winchester Street 10 m from Domino's (OSM node 11085421488,
  10 Winchester Street), facing the High Street crossroads. Root cause of the sky launches: small LIDAR steps (kerbs,
  walls) were treated as ramps at speed; the car now just follows the ground. Walls slide instead of bounce.
  A robot driver test drives the whole Overton→Whitchurch route: no launches, reaches the end.
  Roofs now come from the LIDAR (1 m grid per building), OSM street objects only (lamps, signs, poles, post boxes...).
- 11:40 Buildings rebuilt to look like Jacob's Street View photos of Winchester Street: facades drawn in a shader
  (sash windows with white frames and reflective glass, front door on the wall facing the road, shopfronts with a dark
  fascia and the real OSM name, e.g. "Domino's"), white/cream render, red brick, flint. Roofs fitted to the LIDAR
  (flat / gable / hip with the scanned pitch, ridge direction and ridge height) for ~1,600 buildings; the rest keep the
  smoothed scanned roof grid. Chimneys from LIDAR spikes (1,363 buildings) with pots. Clay tile / slate textures.
  Trees: leafy leaf-card crowns at their LIDAR positions/heights/widths.
