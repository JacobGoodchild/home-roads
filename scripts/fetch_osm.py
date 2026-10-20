#!/usr/bin/env python3
"""Download OpenStreetMap data for the Home Roads box from the OSM editing API (/api/0.6/map) in small
tiles and store the raw XML in raw/osm/ (not committed). © OpenStreetMap contributors, ODbL.
(The Overpass API was not reachable from the build machine, the OSM API was.)"""
import os, time, urllib.request
RAW = os.path.join(os.path.dirname(__file__), '..', 'raw', 'osm')
os.makedirs(RAW, exist_ok=True)
LON0, LON1, LAT0, LAT1 = -1.375, -1.225, 51.210, 51.270
DLON, DLAT = 0.0125, 0.0075
i = 0
lat = LAT0
while lat < LAT1 - 1e-9:
  lon = LON0
  while lon < LON1 - 1e-9:
    out = os.path.join(RAW, f'tile_{i:03d}.osm'); i += 1
    if not os.path.exists(out):
      url = f'https://api.openstreetmap.org/api/0.6/map?bbox={lon:.4f},{lat:.4f},{lon+DLON:.4f},{lat+DLAT:.4f}'
      for a in range(5):
        try:
          req = urllib.request.Request(url, headers={'User-Agent': 'home-roads-bake/1.0 (one-off data bake for a game)'})
          with urllib.request.urlopen(req, timeout=180) as r: data = r.read()
          open(out, 'wb').write(data); print(out, len(data), flush=True); break
        except Exception as ex:
          print('retry', url, ex, flush=True); time.sleep(3 * 2 ** a)
      time.sleep(1)
    lon += DLON
  lat += DLAT
print('done')
