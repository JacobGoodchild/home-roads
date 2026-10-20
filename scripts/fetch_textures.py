#!/usr/bin/env python3
"""Download the CC0 Poly Haven textures used by the game (1k diffuse, resized). Usage:
  python3 scripts/fetch_textures.py farm_soil:soil:512 forest_leaves_04:forest:512 red_brick_03:brick:512 clay_roof_tiles_02:rooftile:512 roof_slates_02:slate:512 concrete_pavement:paving:512 bark_brown_02:bark:256 painted_plaster_wall:render:512"""
import json, urllib.request, sys, io
from PIL import Image
for spec in sys.argv[1:]:
  pid, out, size = spec.split(':')
  d = json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.polyhaven.com/files/{pid}', headers={'User-Agent':'home-roads-build/1.0'})))
  key = 'Diffuse' if 'Diffuse' in d else [k for k in d if 'diff' in k.lower()][0]
  url = d[key]['1k']['jpg']['url']
  im = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'home-roads-build/1.0'})).read())).convert('RGB').resize((int(size), int(size)), Image.LANCZOS)
  im.save(f'/home/user/home-roads/assets/tex/{out}.jpg', quality=82)
  print(pid, '->', out, url)
