#!/usr/bin/env python3
"""Download Environment Agency LIDAR Composite DTM + first-return DSM (1 m) for the
Home Roads box, one 1 km tile at a time, and store them in raw/ (not committed).

Source: Environment Agency, LIDAR Composite DTM/DSM 1m, Open Government Licence v3.
Run:  python3 scripts/fetch_lidar.py   (needs numpy + tifffile)
"""
import os, sys, time, urllib.request, numpy as np, tifffile, io
from bbox import E0, E1, N0, N1

RAW = os.path.join(os.path.dirname(__file__), '..', 'raw', 'lidar')
os.makedirs(RAW, exist_ok=True)
SRC = {
  'dtm': ('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs',
          '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'),
  'dsm': ('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-surface-model-first-return-dsm-1m/wcs',
          'df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m'),
}
T = 1000

def get(kind, e, n):
  out = os.path.join(RAW, f'{kind}_{e}_{n}.npy')
  if os.path.exists(out): return
  base, cov = SRC[kind]
  url = (f'{base}?service=WCS&version=2.0.1&request=GetCoverage&CoverageId={cov}&format=image/tiff'
         f'&subset=E({e},{e+T})&subset=N({n},{n+T})')
  for attempt in range(5):
    try:
      with urllib.request.urlopen(url, timeout=120) as r: buf = r.read()
      a = tifffile.imread(io.BytesIO(buf)).astype(np.float32)
      a[a < -1000] = np.nan
      np.save(out, a)
      print(kind, e, n, a.shape, np.nanmin(a) if np.isfinite(a).any() else 'empty', flush=True)
      return
    except Exception as ex:
      print('retry', kind, e, n, ex, flush=True); time.sleep(2 ** attempt)
  sys.exit(f'failed {kind} {e} {n}')

for n in range(N0, N1, T):
  for e in range(E0, E1, T):
    for k in ('dtm', 'dsm'): get(k, e, n)
print('done')
