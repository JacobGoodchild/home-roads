# Credits

## Code
- Car models (`src/carmodel.js`, `src/cars.js`), chase camera (`src/camera.js`), input and tilt (`src/input.js`, `src/tilt.js`),
  engine/tyre audio (`src/audio.js`), effects (`src/effects.js`), texture helpers (`src/textures.js`, `src/photo.js`), the sky shader
  and quality presets in `src/scene.js`, the car physics that `src/car.js` is adapted from, the Playwright setup, `scripts/serve.mjs`,
  `scripts/vendor.mjs` and the deploy workflow come from **Apex Ring** (https://github.com/JacobGoodchild/apex-ring), same author.
  The cars are original designs, no real brands.
- Three.js r186 (https://threejs.org), vendored in `vendor/three/` — MIT licence (see `vendor/three/LICENSE`).

## Map data
| Data | Source | Licence |
|---|---|---|
| Roads, street names, buildings (footprints), land use, woods, water, River Test, railway, walls, hedges, street lamps, shop names | © OpenStreetMap contributors, downloaded from the OSM API (api.openstreetmap.org) on 2026-10-20 | Open Database Licence (ODbL) 1.0, https://www.openstreetmap.org/copyright |
| Ground heights (LIDAR Composite DTM, 1 m) | Environment Agency, via the Defra Data Services Platform WCS | Open Government Licence v3.0. Contains Environment Agency information © Environment Agency and/or database right |
| Building heights, tree and hedge positions/heights (LIDAR Composite First Return DSM, 1 m, minus the DTM) | Environment Agency, as above | Open Government Licence v3.0 |

The baked files in `data/` are a derived database of OpenStreetMap data and are available under the ODbL.

## Textures (assets/tex/)
| File | Source | Licence |
|---|---|---|
| asphalt, grass, drygrass, gravel, concrete (+ normal maps) | Poly Haven (via Apex Ring) | CC0 |
| soil (farm_soil), forest (forest_leaves_04), brick (red_brick_03), rooftile (clay_roof_tiles_02), slate (roof_slates_02), paving (concrete_pavement), bark (bark_brown_02), render (painted_plaster_wall) | Poly Haven, https://polyhaven.com, fetched by `scripts/fetch_textures.py` | CC0 |

Facade windows, doors and shopfronts are drawn on a canvas at runtime over the CC0 brick/render photos (`src/buildings.js`).

## Sound
All sound is synthesised in Web Audio (`src/audio.js`, from Apex Ring). No sound files.

## Weather (optional)
If you pick "Live weather" in the menu, the game asks Open-Meteo (https://open-meteo.com, CC BY 4.0) once for the current
weather in Overton. Nothing is requested while driving.
