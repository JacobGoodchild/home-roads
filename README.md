# Home Roads

Drive a hypercar around the real roads of Overton and Whitchurch in Hampshire, and the B3400 between them.
Roads, buildings, shop names, the River Test, the railway and fields come from OpenStreetMap; the ground, building heights,
roof shapes, chimneys and every tree come from Environment Agency LIDAR. You start on Winchester Street, Overton, outside Domino's. Runs in the browser, phone or laptop, with no network use while playing.

Play: https://jacobgoodchild.github.io/home-roads/

Keys: ↑/W accelerate, ↓/S brake/reverse, ←/→ steer, Space handbrake, R reset, C camera, M mute, Esc menu.
Phone: ◀ ▶ steer, GAS, BRAKE, HB.

Develop: `npm ci && npm run vendor`, `npm run serve`, `npm test`. Re-bake the map with `npm run bake` (python3 + numpy, scipy, pillow, pyproj, tifffile).
