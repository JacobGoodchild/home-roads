#!/usr/bin/env python3
"""Turn the raw OpenStreetMap + Environment Agency LIDAR downloads (raw/) into the compact files the game loads
(data/). Run fetch_osm.py and fetch_lidar.py first. Needs numpy, scipy, pillow, pyproj (build-time only).

World coordinates in the game: x = easting - EC (metres, east), z = NC - northing (metres, south), y = height (m AOD).
Output:
  data/meta.json            box, chunk grid, spawn points, sprint route, minimap roads, names, railway, water
  data/far.bin.gz           coarse 40 m height grid of the whole box (Uint16, 5 cm units)
  data/c/{i}_{j}.bin.gz     per 250 m chunk: 126x126 heights (Uint16, 5 cm) + land class (Uint8) + field variant (Uint8)
  data/c/{i}_{j}.json       per chunk: roads, buildings, trees, bushes, walls, hedges, lamps
"""
import os, sys, glob, json, gzip, math, re, random
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from scipy import ndimage

sys.path.insert(0, os.path.dirname(__file__))
from bbox import E0, E1, N0, N1, CHUNK

ROOT = os.path.join(os.path.dirname(__file__), '..')
RAW = os.path.join(ROOT, 'raw')
OUT = os.path.join(ROOT, 'data')
os.makedirs(os.path.join(OUT, 'c'), exist_ok=True)
EC, NC = (E0 + E1) // 2, (N0 + N1) // 2
W1, H1 = E1 - E0, N1 - N0                 # 1 m raster size
G = 2                                     # terrain grid step (m)
NX, NY = W1 // G + 1, H1 // G + 1         # 2 m sample grid (points)
CI, CJ = W1 // CHUNK, H1 // CHUNK         # chunk counts
CS = CHUNK // G                           # cells per chunk
random.seed(7)

def log(*a): print(*a, flush=True)

# ---------------------------------------------------------------- LIDAR
log('loading lidar')
def mosaic(kind):
  A = np.full((H1, W1), np.nan, np.float32)
  for f in glob.glob(os.path.join(RAW, 'lidar', f'{kind}_*.npy')):
    e, n = map(int, os.path.basename(f)[4:-4].split('_'))
    a = np.load(f)
    r0 = N1 - (n + a.shape[0]); c0 = e - E0
    A[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
  return A
D = mosaic('dtm'); S = mosaic('dsm')
log('dtm nan fraction', np.isnan(D).mean())
def fill_nan(A):
  m = np.isnan(A)
  if not m.any(): return A
  idx = ndimage.distance_transform_edt(m, return_distances=False, return_indices=True)
  return A[tuple(idx)]
D = fill_nan(D)
S = np.where(np.isnan(S), D, S)
ND = np.clip(S - D, 0, 80).astype(np.float32)
del S

def dtm_at(E, N):
  """bilinear DTM height at BNG coords (arrays ok)"""
  c = np.asarray(E, float) - E0 - 0.5; r = N1 - np.asarray(N, float) - 0.5
  c = np.clip(c, 0, W1 - 1.001); r = np.clip(r, 0, H1 - 1.001)
  c0 = np.floor(c).astype(int); r0 = np.floor(r).astype(int); fc = c - c0; fr = r - r0
  return (D[r0, c0] * (1 - fc) * (1 - fr) + D[r0, c0 + 1] * fc * (1 - fr) + D[r0 + 1, c0] * (1 - fc) * fr + D[r0 + 1, c0 + 1] * fc * fr)

# 2 m height grid at points E0+2i, N1-2j: mean of the four 1 m pixels around each point
Dp = np.pad(D, 1, mode='edge')
H2 = 0.25 * (Dp[0:H1 + 1:2, 0:W1 + 1:2] + Dp[1:H1 + 2:2, 0:W1 + 1:2] + Dp[0:H1 + 1:2, 1:W1 + 2:2] + Dp[1:H1 + 2:2, 1:W1 + 2:2])
assert H2.shape == (NY, NX), H2.shape
log('height range', float(H2.min()), float(H2.max()))

# ---------------------------------------------------------------- OSM
log('loading osm')
nodes, ways, rels = {}, {}, {}
for f in sorted(glob.glob(os.path.join(RAW, 'osm', '*.osm'))):
  for ev, el in ET.iterparse(f):
    if el.tag == 'node':
      i = int(el.get('id'))
      if i not in nodes:
        tags = {t.get('k'): t.get('v') for t in el.findall('tag')}
        nodes[i] = (float(el.get('lon')), float(el.get('lat')), tags or None)
      el.clear()
    elif el.tag == 'way':
      i = int(el.get('id'))
      if i not in ways:
        ways[i] = ([int(n.get('ref')) for n in el.findall('nd')], {t.get('k'): t.get('v') for t in el.findall('tag')})
      el.clear()
    elif el.tag == 'relation':
      i = int(el.get('id'))
      if i not in rels:
        rels[i] = ([(m.get('type'), int(m.get('ref')), m.get('role')) for m in el.findall('member')], {t.get('k'): t.get('v') for t in el.findall('tag')})
      el.clear()
log(len(nodes), 'nodes', len(ways), 'ways', len(rels), 'relations')
tr = Transformer.from_crs(4326, 27700, always_xy=True)
nid = np.array(list(nodes.keys()), np.int64)
lon = np.array([nodes[i][0] for i in nid]); lat = np.array([nodes[i][1] for i in nid])
ee, nn = tr.transform(lon, lat)
NE = {int(i): (float(e), float(n)) for i, e, n in zip(nid, ee, nn)}
def way_pts(w):
  return [NE[n] for n in ways[w][0] if n in NE] if w in ways else []

def rings_from(members):
  """Join relation member ways into closed rings."""
  segs = [list(ways[r][0]) for t, r, ro in members if t == 'way' and r in ways]
  rings = []
  while segs:
    cur = segs.pop()
    changed = True
    while cur[0] != cur[-1] and changed:
      changed = False
      for k, s in enumerate(segs):
        if s[0] == cur[-1]: cur += s[1:]
        elif s[-1] == cur[-1]: cur += s[::-1][1:]
        elif s[-1] == cur[0]: cur = s[:-1] + cur
        elif s[0] == cur[0]: cur = s[::-1][:-1] + cur
        else: continue
        segs.pop(k); changed = True; break
    if cur[0] == cur[-1] and len(cur) >= 4: rings.append([NE[n] for n in cur if n in NE])
  return rings

# areas: (tags, [outer rings], [inner rings])
areas = []
for w, (nds, tags) in ways.items():
  if len(nds) >= 4 and nds[0] == nds[-1] and tags:
    areas.append((tags, [way_pts(w)], [], w))
for r, (mem, tags) in rels.items():
  if tags.get('type') == 'multipolygon':
    outer = rings_from([m for m in mem if m[2] in ('outer', '')])
    inner = rings_from([m for m in mem if m[2] == 'inner'])
    if outer: areas.append((tags, outer, inner, -r))
log(len(areas), 'areas')

def loc(E, N): return (round(E - EC, 1), round(NC - N, 1))
def px2(E, N): return ((E - E0) / G, (N1 - N) / G)    # 2 m raster pixel coords
def px1(E, N): return (E - E0 - 0.5, N1 - N - 0.5)     # 1 m raster pixel coords

# ---------------------------------------------------------------- land classes (2 m raster)
CLS = {'grass': 0, 'farm': 1, 'meadow': 2, 'wood': 3, 'resi': 4, 'paved': 5, 'water': 6, 'rail': 7, 'scrub': 8, 'park': 9, 'yard': 10}
def land_class(t):
  lu, na, le = t.get('landuse'), t.get('natural'), t.get('leisure')
  if na == 'water' or lu in ('reservoir', 'basin') or t.get('waterway') == 'riverbank': return 'water'
  if lu == 'forest' or na == 'wood': return 'wood'
  if lu == 'farmland': return 'farm'
  if lu in ('meadow', 'grass', 'village_green', 'recreation_ground') or na == 'grassland': return 'meadow'
  if lu in ('orchard', 'vineyard', 'allotments', 'plant_nursery', 'cemetery') or na in ('scrub', 'heath') or t.get('wetland'): return 'scrub'
  if lu in ('residential',): return 'resi'
  if lu in ('industrial', 'commercial', 'retail', 'construction', 'brownfield', 'garages') or t.get('amenity') == 'parking' or t.get('area:highway') or t.get('highway') == 'pedestrian': return 'paved'
  if lu == 'railway': return 'rail'
  if le in ('park', 'pitch', 'golf_course', 'playground', 'garden', 'sports_centre', 'common') : return 'park'
  if lu == 'farmyard': return 'yard'
  return None
PRI = ['resi', 'farm', 'meadow', 'scrub', 'park', 'wood', 'yard', 'paved', 'rail', 'water']
cimg = Image.new('L', (NX, NY), CLS['meadow'])
vimg = Image.new('L', (NX, NY), 0)
cd, vd = ImageDraw.Draw(cimg), ImageDraw.Draw(vimg)
for name in PRI:
  for tags, outer, inner, aid in areas:
    if land_class(tags) != name or 'building' in tags: continue
    var = random.randint(1, 255)
    for ring in outer:
      if len(ring) >= 3:
        cd.polygon([px2(*p) for p in ring], fill=CLS[name]); vd.polygon([px2(*p) for p in ring], fill=var)
    for ring in inner:
      if len(ring) >= 3: cd.polygon([px2(*p) for p in ring], fill=CLS['meadow'])

# ---------------------------------------------------------------- roads
ROAD_W = {'motorway': 11, 'trunk': 9, 'primary': 7.6, 'secondary': 7.0, 'tertiary': 6.4, 'unclassified': 5.2, 'residential': 5.4,
          'living_street': 4.6, 'service': 3.6, 'track': 3.0, 'pedestrian': 4.0,
          'motorway_link': 6, 'trunk_link': 6, 'primary_link': 6, 'secondary_link': 6, 'tertiary_link': 5.5}
RANK = {'motorway': 0, 'trunk': 1, 'primary': 2, 'secondary': 3, 'tertiary': 4, 'unclassified': 5, 'residential': 6, 'living_street': 7,
        'pedestrian': 7, 'service': 8, 'track': 9}
def num(v):
  try: return float(re.findall(r'[\d.]+', v)[0])
  except Exception: return None
names, name_idx = [], {}
def nm(s):
  if not s: return -1
  if s not in name_idx: name_idx[s] = len(names); names.append(s)
  return name_idx[s]

road_ways = []
for w, (nds, t) in ways.items():
  hw = t.get('highway')
  if hw not in ROAD_W or t.get('area') == 'yes' or t.get('access') == 'private' and hw == 'service' and t.get('service') == 'driveway': continue
  if hw == 'track' and t.get('tracktype') not in (None, 'grade1', 'grade2'): continue
  if t.get('tunnel') in ('yes', 'culvert') and hw in ('service', 'track'): continue
  pts = way_pts(w)
  if len(pts) < 2: continue
  wd = num(t['width']) if 'width' in t and num(t['width']) else None
  if not wd:
    wd = ROAD_W[hw]
    ln = num(t.get('lanes', '') or '')
    if ln and ln >= 2 and hw not in ('service',): wd = max(wd, ln * 3.2)
    if t.get('oneway') == 'yes' and hw in ('residential', 'unclassified', 'tertiary', 'secondary') and not ln: wd = min(wd, 4.2)
    if t.get('service') == 'parking_aisle': wd = 5
  wd = max(2.6, min(14, wd))
  road_ways.append((w, nds, t, pts, wd, hw))
log(len(road_ways), 'roads')

# junction nodes: shared by two or more drivable ways
use = {}
for w, nds, t, pts, wd, hw in road_ways:
  for k, n in enumerate(nds):
    use[n] = use.get(n, 0) + (2 if 0 < k < len(nds) - 1 else 1)
junctions = [NE[n] for n, c in use.items() if c >= 3 and n in NE]
jarr = np.array(junctions) if junctions else np.zeros((0, 2))
jgrid = {}
for (e, n) in junctions: jgrid.setdefault((int(e // 50), int(n // 50)), []).append((e, n))
def near_junction(e, n, r):
  gx, gy = int(e // 50), int(n // 50)
  for dx in (-1, 0, 1):
    for dy in (-1, 0, 1):
      for (je, jn) in jgrid.get((gx + dx, gy + dy), ()):
        if (je - e) ** 2 + (jn - n) ** 2 < r * r: return True
  return False

def densify(pts, step):
  out = [pts[0]]
  for a, b in zip(pts, pts[1:]):
    d = math.hypot(b[0] - a[0], b[1] - a[1]); k = max(1, int(math.ceil(d / step)))
    for s in range(1, k + 1): out.append((a[0] + (b[0] - a[0]) * s / k, a[1] + (b[1] - a[1]) * s / k))
  return out

def smooth_heights(ys, n=2):
  ys = np.array(ys, float)
  if len(ys) < 5: return ys
  k = np.ones(2 * n + 1) / (2 * n + 1)
  p = np.pad(ys, n, mode='edge')
  return np.convolve(p, k, mode='valid')

def chunk_of(E, N):
  return (min(CI - 1, max(0, int((E - E0) // CHUNK))), min(CJ - 1, max(0, int((N1 - N) // CHUNK))))

chunks = {}
def C(key): return chunks.setdefault(key, {'roads': [], 'bld': [], 'trees': [], 'bush': [], 'walls': [], 'hedges': [], 'lamps': []})

road_mask = Image.new('L', (NX, NY), 0); rmd = ImageDraw.Draw(road_mask)
mini = []   # simplified roads for the minimap
graph = {}  # routing graph: node -> [(node, cost, length, way)]
road_index_pts = []
for w, nds, t, pts, wd, hw in road_ways:
  bridge = t.get('bridge') not in (None, 'no')
  dp = densify(pts, 6.0)
  E = np.array([p[0] for p in dp]); N = np.array([p[1] for p in dp])
  ys = dtm_at(E, N)
  if bridge:
    ys = np.linspace(ys[0], ys[-1], len(ys))  # DTM has the deck removed: span straight between the abutments
  else:
    ys = smooth_heights(ys)
  inside = [(E0 + 5 < e < E1 - 5 and N0 + 5 < n < N1 - 5) for e, n in dp]
  if not any(inside): continue
  ref = t.get('ref'); name = t.get('name')
  label = f'{name} ({ref})' if name and ref else (name or ref or ({'track': 'Farm track', 'service': 'Service road'}.get(hw, '')))
  # pavements in town
  sw = t.get('sidewalk', t.get('sidewalk:both', ''))
  mid = dp[len(dp) // 2]; mx, my = px2(*mid)
  lc = cimg.getpixel((int(min(NX - 1, max(0, mx))), int(min(NY - 1, max(0, my)))))
  town = lc in (CLS['resi'], CLS['paved'])
  side = 0
  if sw in ('both', 'separate', 'yes'): side = 3
  elif sw == 'left': side = 1
  elif sw == 'right': side = 2
  elif sw in ('no', 'none'): side = 0
  elif town and hw in ('residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'living_street'): side = 3
  if hw in ('track', 'service') and sw not in ('both', 'left', 'right'): side = 0
  marks = 1 if (wd >= 5.6 and hw not in ('service', 'track', 'living_street', 'pedestrian') and t.get('oneway') != 'yes') else 0
  if hw in ('primary', 'secondary') and wd >= 6.5: marks = 2
  surf = 1 if hw == 'track' or t.get('surface') in ('gravel', 'unpaved', 'dirt', 'compacted', 'fine_gravel', 'ground') else 0
  rmd.line([px2(*p) for p in dp], fill=1, width=max(1, int(wd / G)))
  mini.append({'c': RANK.get(hw, 9), 'p': [v for p in pts[::1] for v in loc(*p)]})
  # split into per-chunk pieces
  ni = nm(label)
  cur, curk = [], None
  for k, (p, y) in enumerate(zip(dp, ys)):
    key = chunk_of(*p)
    nj = near_junction(p[0], p[1], wd * 0.5 + 5)
    rec = [*loc(*p), round(float(y), 2), (0 if nj else marks) | (4 if nj else 0)]
    if curk is None: curk = key
    if key != curk and len(cur) >= 1:
      cur.append(rec)
      C(curk)['roads'].append({'n': ni, 'r': RANK.get(hw, 9), 'w': round(wd, 1), 's': side, 'b': int(bridge), 'g': surf, 'p': [v for r in cur for v in r]})
      cur, curk = [rec], key
      continue
    cur.append(rec)
  if len(cur) >= 2:
    C(curk)['roads'].append({'n': ni, 'r': RANK.get(hw, 9), 'w': round(wd, 1), 's': side, 'b': int(bridge), 'g': surf, 'p': [v for r in cur for v in r]})
  # routing graph on OSM nodes
  fac = {2: 1.0, 3: 1.0, 4: 1.25, 5: 1.6, 6: 2.0, 7: 3, 8: 4, 9: 6}.get(RANK.get(hw, 9), 3)
  if t.get('ref') == 'B3400': fac = 0.8
  for a, b in zip(nds, nds[1:]):
    if a in NE and b in NE:
      L = math.dist(NE[a], NE[b])
      graph.setdefault(a, []).append((b, L * fac, L)); graph.setdefault(b, []).append((a, L * fac, L))
log('roads split into chunks')

# ---------------------------------------------------------------- railway, water
rail = []
for w, (nds, t) in ways.items():
  if t.get('railway') == 'rail' and t.get('service') not in ('siding', 'yard') :
    pts = densify(way_pts(w), 8.0)
    if len(pts) < 2: continue
    E = np.array([p[0] for p in pts]); N = np.array([p[1] for p in pts]); ys = dtm_at(E, N)
    if t.get('bridge') not in (None, 'no'): ys = np.linspace(ys[0], ys[-1], len(ys))
    else: ys = smooth_heights(ys, 3)
    rail.append({'b': int(t.get('bridge') not in (None, 'no')), 'p': [v for p, y in zip(pts, ys) for v in (*loc(*p), round(float(y), 2))]})
    rmd.line([px2(*p) for p in pts], fill=2, width=3)
water_polys = []
for tags, outer, inner, aid in areas:
  if land_class(tags) == 'water':
    rings = []
    for ring in outer + inner:
      E = np.array([p[0] for p in ring]); N = np.array([p[1] for p in ring])
      if E.max() < E0 or E.min() > E1 or N.max() < N0 or N.min() > N1: continue
      ys = dtm_at(E, N)
      rings.append([v for p, y in zip(ring, ys) for v in (*loc(*p), round(float(y), 2))])
    if rings: water_polys.append({'o': rings[:len(outer)], 'i': rings[len(outer):]})
streams = []
WW = {'river': 9, 'stream': 2.2, 'ditch': 1.2, 'drain': 1.2, 'canal': 8}
for w, (nds, t) in ways.items():
  ww = t.get('waterway')
  if ww in WW and t.get('tunnel') not in ('culvert', 'yes'):
    pts = densify(way_pts(w), 8.0)
    if len(pts) < 2: continue
    E = np.array([p[0] for p in pts]); N = np.array([p[1] for p in pts]); ys = dtm_at(E, N)
    wd = num(t.get('width', '') or '') or WW[ww]
    streams.append({'w': round(min(wd, 15), 1), 'r': int(ww == 'river'), 'p': [v for p, y in zip(pts, ys) for v in (*loc(*p), round(float(y), 2))]})
    cd.line([px2(*p) for p in pts], fill=CLS['water'], width=max(1, int(wd / G)))

# ---------------------------------------------------------------- buildings with LIDAR heights
log('buildings')
blds = []
for tags, outer, inner, aid in areas:
  if 'building' in tags and tags.get('building') != 'no':
    ring = outer[0]
    if len(ring) < 4: continue
    E = [p[0] for p in ring]; N = [p[1] for p in ring]
    if max(E) < E0 or min(E) > E1 or max(N) < N0 or min(N) > N1: continue
    blds.append((tags, ring, inner))
bimg = Image.new('I', (W1, H1), 0); bdr = ImageDraw.Draw(bimg)
for k, (tags, ring, inner) in enumerate(blds):
  bdr.polygon([px1(*p) for p in ring], fill=k + 1)
B = np.array(bimg, dtype=np.int32); del bimg
lab = B.ravel(); val = ND.ravel()
sel = lab > 0
lab_s = lab[sel]; val_s = val[sel]
order = np.lexsort((val_s, lab_s)); lab_s = lab_s[order]; val_s = val_s[order]
starts = np.searchsorted(lab_s, np.arange(1, len(blds) + 2))
# shops and named places to put on buildings
pois = []
for i, (lo, la, tags) in nodes.items():
  if tags and (tags.get('shop') or tags.get('amenity') in ('pub', 'cafe', 'restaurant', 'bank', 'pharmacy', 'post_office', 'fast_food', 'library', 'bar')) and tags.get('name'):
    pois.append((NE[i], tags['name'], tags.get('shop') or tags.get('amenity')))
bposi = {}
for (pe, pn), name, kind in pois:
  c, r = px1(pe, pn); c, r = int(round(c)), int(round(r))
  if 0 <= r < H1 and 0 <= c < W1:
    k = B[r, c]
    if not k:
      win = B[max(0, r - 6):r + 7, max(0, c - 6):c + 7]; nzv = win[win > 0]
      k = int(np.bincount(nzv).argmax()) if len(nzv) else 0
    if k: bposi[k - 1] = (name, kind)
bmask = ndimage.binary_dilation(B > 0, iterations=2)
del B
for k, (tags, ring, inner) in enumerate(blds):
  a, b = starts[k], starts[k + 1]
  v = val_s[a:b]
  bt = tags.get('building')
  lv = num(tags.get('building:levels', '') or '')
  th = num(tags.get('height', '') or '')
  if len(v) >= 4 and np.percentile(v, 90) > 2.0:
    ridge = float(np.percentile(v, 95)); eave = float(np.percentile(v, 25))
  elif th: ridge, eave = th, th * 0.7
  elif lv: ridge, eave = lv * 3 + 2, lv * 3
  else:
    ridge, eave = (3.2, 2.6) if bt in ('garage', 'garages', 'shed') else (7.5, 5.0)
  ridge = max(2.4, min(45, ridge)); eave = max(2.2, min(ridge, eave))
  E = np.array([p[0] for p in ring]); N = np.array([p[1] for p in ring])
  ce, cn = E.mean(), N.mean()
  base = float(dtm_at(E, N).min())
  rec = {'p': [v for p in ring[:-1] for v in loc(*p)], 'h': round(ridge, 1), 'e': round(eave, 1), 'y': round(base, 2), 't': bt}
  if k in bposi: rec['shop'] = bposi[k][0]; rec['k'] = bposi[k][1]
  elif tags.get('shop') or tags.get('amenity'):
    if tags.get('name'): rec['shop'] = tags['name']; rec['k'] = tags.get('shop') or tags.get('amenity')
  if tags.get('amenity') == 'place_of_worship' or bt in ('church', 'chapel'): rec['t'] = 'church'
  C(chunk_of(ce, cn))['bld'].append(rec)
log(len(blds), 'buildings')

# ---------------------------------------------------------------- trees and bushes from the LIDAR canopy
log('trees')
rm = np.array(road_mask) > 0
cls_arr = np.array(cimg)
# 2 m canopy = max of the 1 m nDSM around each 2 m point
NDp = np.pad(ND, 1, mode='edge')
ND2 = np.maximum.reduce([NDp[0:H1 + 1:2, 0:W1 + 1:2], NDp[1:H1 + 2:2, 0:W1 + 1:2], NDp[0:H1 + 1:2, 1:W1 + 2:2], NDp[1:H1 + 2:2, 1:W1 + 2:2]])
bm2 = bmask[0:H1:2, 0:W1:2]; bm2 = np.pad(bm2, ((0, 1), (0, 1)), mode='edge')
ND2[bm2] = 0
ND2[cls_arr == CLS['water']] = np.minimum(ND2[cls_arr == CLS['water']], 0)
mx3 = ndimage.maximum_filter(ND2, size=3)
cnt = ndimage.uniform_filter((ND2 > 1.5).astype(np.float32), size=3) * 9
peaks = (ND2 == mx3) & (ND2 >= 3.0) & (cnt >= 4)
jj, ii = np.nonzero(peaks)
log(len(jj), 'trees')
for j, i in zip(jj, ii):
  h = float(ND2[j, i]); E = E0 + i * G; N = N1 - j * G
  # crown radius from how far the canopy stays above half the height
  win = ND2[max(0, j - 3):j + 4, max(0, i - 3):i + 4]
  r = max(1.5, min(9, math.sqrt((win > h * 0.55).sum() * 4 / math.pi)))
  x, z = loc(E + random.uniform(-0.7, 0.7), N + random.uniform(-0.7, 0.7))
  C(chunk_of(E, N))['trees'] += [x, z, round(h, 1), round(r, 1)]
bushes = (ND2 == mx3) & (ND2 >= 1.0) & (ND2 < 3.0) & (cnt >= 3) & (~rm) & (cls_arr != CLS['paved'])
jj, ii = np.nonzero(bushes)
log(len(jj), 'bushes')
for j, i in zip(jj, ii):
  h = float(ND2[j, i]); E = E0 + i * G; N = N1 - j * G
  x, z = loc(E + random.uniform(-0.5, 0.5), N + random.uniform(-0.5, 0.5))
  C(chunk_of(E, N))['bush'] += [x, z, round(h, 1)]

# ---------------------------------------------------------------- walls, fences, hedges, lamps
for w, (nds, t) in ways.items():
  bar = t.get('barrier')
  if bar in ('wall', 'fence', 'retaining_wall', 'hedge', 'city_wall'):
    pts = way_pts(w)
    if len(pts) < 2: continue
    pts = densify(pts, 10)
    E = np.array([p[0] for p in pts]); N = np.array([p[1] for p in pts]); ys = dtm_at(E, N)
    key = chunk_of(E[len(E) // 2], N[len(N) // 2])
    rec = {'p': [v for p, y in zip(pts, ys) for v in (*loc(*p), round(float(y), 2))]}
    if bar == 'hedge': C(key)['hedges'].append(rec)
    else:
      rec['k'] = 'f' if bar == 'fence' else 'w'; rec['h'] = num(t.get('height', '') or '') or (1.2 if bar == 'fence' else 1.6)
      C(key)['walls'].append(rec)
for i, (lo, la, tags) in nodes.items():
  if tags and tags.get('highway') == 'street_lamp':
    E, N = NE[i]
    if E0 < E < E1 and N0 < N < N1: C(chunk_of(E, N))['lamps'] += list(loc(E, N))

# ---------------------------------------------------------------- spawn points and the sprint route
def nearest_road_node(E, N, min_rank=6):
  best = None
  for w, nds, t, pts, wd, hw in road_ways:
    if RANK.get(hw, 9) > min_rank: continue
    for k, n in enumerate(nds):
      if n in NE:
        d = math.dist(NE[n], (E, N))
        if best is None or d < best[0]: best = (d, n, nds, k, t)
  return best
def spawn_at(lonlat, label, min_rank=6):
  E, N = tr.transform(*lonlat)
  d, n, nds, k, t = nearest_road_node(E, N, min_rank)
  a = NE[nds[max(0, k - 1)]]; b = NE[nds[min(len(nds) - 1, k + 1)]]
  x, z = loc(*NE[n]); ax, az = loc(*a); bx, bz = loc(*b)
  h = math.atan2(bx - ax, bz - az)
  return {'name': label, 'x': x, 'z': z, 'h': round(h, 3), 'road': t.get('name') or t.get('ref'), 'node': n}
spawns = [spawn_at((-1.26215, 51.24365), 'Overton', 4), spawn_at((-1.33775, 51.23020), 'Whitchurch', 4)]
# B3400 midway and the highest public road in the box
b34 = [n for w, nds, t, pts, wd, hw in road_ways if t.get('ref') == 'B3400' for n in nds if n in NE]
if b34:
  midE = (tr.transform(-1.26215, 51.24365)[0] + tr.transform(-1.33775, 51.2302)[0]) / 2
  n = min(b34, key=lambda n: abs(NE[n][0] - midE))
  lo, la = Transformer.from_crs(27700, 4326, always_xy=True).transform(*NE[n])
  spawns.append(spawn_at((lo, la), 'B3400', 3))
best = None
for w, nds, t, pts, wd, hw in road_ways:
  if RANK.get(hw, 9) <= 6 and t.get('name'):
    for n in nds[1:-1]:
      if n in NE:
        E, N = NE[n]
        if E0 + 400 < E < E1 - 400 and N0 + 400 < N < N1 - 400:
          y = float(dtm_at(E, N))
          if best is None or y > best[0]: best = (y, n)
if best:
  lo, la = Transformer.from_crs(27700, 4326, always_xy=True).transform(*NE[best[1]])
  sp = spawn_at((lo, la), 'Hilltop', 6); sp['name'] = 'Hilltop'; spawns.append(sp)
log('spawns', spawns)

import heapq
def route(a, b):
  dist = {a: 0}; prev = {}; pq = [(0, a)]
  while pq:
    d, u = heapq.heappop(pq)
    if u == b: break
    if d > dist.get(u, 1e18): continue
    for v, c, L in graph.get(u, ()):
      nd = d + c
      if nd < dist.get(v, 1e18): dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
  path = [b]
  while path[-1] != a and path[-1] in prev: path.append(prev[path[-1]])
  return path[::-1]
rp = route(spawns[0]['node'], spawns[1]['node'])
rpts = [loc(*NE[n]) for n in rp]
total = sum(math.dist(p, q) for p, q in zip(rpts, rpts[1:]))
cps, acc, nextd = [], 0, 700
for p, q in zip(rpts, rpts[1:]):
  L = math.dist(p, q)
  while acc + L >= nextd and nextd < total - 300:
    f = (nextd - acc) / L; cps.append([round(p[0] + (q[0] - p[0]) * f, 1), round(p[1] + (q[1] - p[1]) * f, 1)]); nextd += 700
  acc += L
cps.append(list(rpts[-1]))
log('sprint route', round(total), 'm', len(cps), 'checkpoints')
for s in spawns: s.pop('node', None)

# ---------------------------------------------------------------- write terrain chunks
log('writing chunks')
road_arr = np.array(road_mask)
cls_out = cls_arr.copy()
cls_out[road_arr == 1] |= 0x80      # under a road: the game lowers the ground a touch so the road sits on top
cls_out[road_arr == 2] = CLS['rail']
var_arr = np.array(vimg)
Hq = np.clip(np.round(H2 * 20), 0, 65535).astype('<u2')
for cj in range(CJ):
  for ci in range(CI):
    sl = (slice(cj * CS, cj * CS + CS + 1), slice(ci * CS, ci * CS + CS + 1))
    buf = Hq[sl].tobytes() + cls_out[sl].astype(np.uint8).tobytes() + var_arr[sl].astype(np.uint8).tobytes()
    with gzip.open(os.path.join(OUT, 'c', f'{ci}_{cj}.bin.gz'), 'wb', 9) as f: f.write(buf)
    ch = chunks.get((ci, cj))
    with open(os.path.join(OUT, 'c', f'{ci}_{cj}.json'), 'w') as f:
      json.dump(ch or {}, f, separators=(',', ':'))
FAR = 20
far = Hq[::FAR // G, ::FAR // G]
farc = (cls_out & 0x7f)[::FAR // G, ::FAR // G].astype(np.uint8)
with gzip.open(os.path.join(OUT, 'far.bin.gz'), 'wb', 9) as f: f.write(far.tobytes() + farc.tobytes())

meta = {
  'credit': '© OpenStreetMap contributors (ODbL); contains Environment Agency LIDAR data © Environment Agency copyright and/or database right (OGL v3)',
  'origin': {'E': EC, 'N': NC, 'crs': 'EPSG:27700'},
  'box': {'x0': E0 - EC, 'x1': E1 - EC, 'z0': NC - N1, 'z1': NC - N0},
  'chunk': CHUNK, 'grid': G, 'ci': CI, 'cj': CJ, 'far': {'step': FAR, 'nx': far.shape[1], 'ny': far.shape[0]},
  'hscale': 0.05, 'classes': CLS,
  'spawns': spawns, 'sprint': {'route': [v for p in rpts for v in p], 'cps': cps, 'length': round(total)},
  'names': names, 'mini': mini, 'rail': rail, 'water': water_polys, 'streams': streams,
}
with open(os.path.join(OUT, 'meta.json'), 'w') as f: json.dump(meta, f, separators=(',', ':'))
log('done', sum(os.path.getsize(p) for p in glob.glob(os.path.join(OUT, '**', '*'), recursive=True)) // 1024, 'KB')
