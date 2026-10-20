// Buildings.
// Real data: footprints (OpenStreetMap), heights, roof shapes (pitch, direction, ridges) and chimneys (Environment
// Agency LIDAR surface minus ground, baked per building as a 1 m roof grid), shop/pub names (OSM), OSM building type and
// any OSM material/colour tags.
// Styled defaults where the data says nothing (listed in CLAUDE.md): wall finish (white/cream render, red brick, timber
// frame, flint in Hampshire proportions), window and door layout, roof covering (clay tile / slate).
// Facades are drawn in the shader so windows stay crisp at any distance: sash windows with white frames and reflective
// glass, a front door on the side facing the road, shopfronts with a dark fascia on named shops.
import * as THREE from "three";
import { photo } from "./photo.js";

const WALL_TAG = { brick: 2, render: 0, plaster: 0, stone: 4, flint: 4, wood: 3, timber_framing: 3, metal: 5, concrete: 1 };
const ROOF_TAG = { roof_tiles: 0, tile: 0, tiles: 0, clay: 0, slate: 1, metal: 2, concrete: 2, tar_paper: 2 };

function hash(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }

export function buildingMaterials() {
  const tex = { brick: photo("brick"), render: photo("render"), stone: photo("concrete"), tile: photo("rooftile"), slate: photo("slate") };
  const wall = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  wall.userData.uniforms = { night: { value: 0 } };
  wall.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, wall.userData.uniforms, { tBrick: { value: tex.brick }, tRender: { value: tex.render }, tStone: { value: tex.stone } });
    sh.vertexShader = "attribute vec2 wuv; attribute vec4 wa; attribute vec2 wb; varying vec2 vWuv; varying vec4 vWa; varying vec2 vWb;\n" +
      sh.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n vWuv = wuv; vWa = wa; vWb = wb;");
    sh.fragmentShader = `uniform sampler2D tBrick, tRender, tStone; uniform float night; varying vec2 vWuv; varying vec4 vWa; varying vec2 vWb;
      float gGlass = 0.0, gLit = 0.0;
      float box(vec2 p, vec2 a, vec2 b) { vec2 w = fwidth(p) * 0.75 + 1e-4; vec2 s = smoothstep(a - w, a + w, p) * (1.0 - smoothstep(b - w, b + w, p)); return s.x * s.y; }
      float h1(float n) { return fract(sin(n * 91.345) * 47453.13); }
      ` + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      {
        float style = vWa.x, L = vWa.y, eave = vWa.z, seed = vWa.w, shop = vWb.x, doorBay = vWb.y;
        float u = vWuv.x, v = vWuv.y;
        vec3 base;
        vec3 rn = texture2D(tRender, vec2(u, v) / 3.0).rgb;
        float rl = dot(rn, vec3(0.333));
        if (style < 0.5) base = vec3(0.93, 0.92, 0.88) * (0.82 + 0.3 * rl);                        // white painted render
        else if (style < 1.5) base = vec3(0.90, 0.85, 0.74) * (0.82 + 0.3 * rl);                   // cream render
        else if (style < 2.5) base = texture2D(tBrick, vec2(u, v) / 2.2).rgb * vec3(1.35, 1.2, 1.15);  // red brick
        else if (style < 3.5) {                                                                    // black and white timber frame
          base = vec3(0.92, 0.9, 0.85) * (0.85 + 0.25 * rl);
          float fl = mod(v, 2.7), bx = mod(u, 1.1);
          float beam = max(1.0 - box(vec2(bx, 0.5), vec2(0.12, 0.0), vec2(1.0, 1.0)), box(vec2(0.5, fl), vec2(0.0, -0.1), vec2(1.0, 0.14)));
          base = mix(base, vec3(0.06, 0.05, 0.045), beam);
        }
        else if (style < 4.5) {                                                                    // flint with brick quoins
          base = texture2D(tStone, vec2(u, v) / 1.2).rgb * vec3(0.75, 0.75, 0.78);
          base = mix(base, texture2D(tBrick, vec2(u, v) / 2.2).rgb * 1.3, step(mod(u + 0.001, max(L, 0.1)), 0.35) + step(L - 0.35, mod(u, max(L, 0.1))));
        }
        else base = vec3(0.42, 0.45, 0.44) * (0.8 + 0.3 * step(0.5, fract(u * 2.5)));             // metal cladding
        // windows and doors (not on gables above the eaves, sheds or cladding)
        float floorH = 2.7, nf = max(1.0, floor((eave + 0.3) / floorH));
        float nb = max(1.0, floor(L / 2.7)), bay = L / nb;
        float bi = floor(u / bay), lx = (fract(u / bay) - 0.5) * bay;
        float fi = floor(v / floorH), ly = v - fi * floorH;
        vec3 col = base;
        bool canWin = style < 4.5 && L > 2.2 && v < eave - 0.25 && fi < nf && v > 0.0;
        if (canWin) {
          bool ground = fi < 0.5;
          if (shop > 0.5 && ground) {
            // shopfront: dark fascia, big glazed front between piers, stall riser
            float fascia = box(vec2(0.5, v), vec2(0.0, 2.55), vec2(1.0, 3.15));
            float pier = 1.0 - box(vec2(lx, 0.5), vec2(-bay * 0.5 + 0.22, 0.0), vec2(bay * 0.5 - 0.22, 1.0));
            float glass = box(vec2(lx, v), vec2(-bay * 0.5 + 0.22, 0.45), vec2(bay * 0.5 - 0.22, 2.45)) * (1.0 - pier);
            float frame = box(vec2(lx, v), vec2(-bay * 0.5 + 0.18, 0.38), vec2(bay * 0.5 - 0.18, 2.52)) - glass;
            col = mix(col, vec3(0.16, 0.18, 0.2), fascia);
            col = mix(col, vec3(0.2, 0.22, 0.24), max(0.0, frame));
            col = mix(col, vec3(0.05, 0.06, 0.07), glass);
            col = mix(col, vec3(0.3, 0.3, 0.3), box(vec2(0.5, v), vec2(0.0, 0.0), vec2(1.0, 0.38)) * (1.0 - pier));
            gGlass = glass; gLit = glass * 0.9;
          } else if (ground && abs(bi - doorBay) < 0.5) {
            // front door with a fanlight
            float d = box(vec2(lx, v), vec2(-0.48, 0.0), vec2(0.48, 2.1));
            float fr = box(vec2(lx, v), vec2(-0.56, 0.0), vec2(0.56, 2.62)) - d;
            float fan = box(vec2(lx, v), vec2(-0.44, 2.18), vec2(0.44, 2.52));
            vec3 dc = h1(seed * 7.0) < 0.35 ? vec3(0.1, 0.12, 0.14) : h1(seed * 7.0) < 0.6 ? vec3(0.12, 0.2, 0.32) : h1(seed * 7.0) < 0.8 ? vec3(0.35, 0.08, 0.07) : vec3(0.16, 0.26, 0.18);
            col = mix(col, vec3(0.92), max(0.0, fr));
            col = mix(col, dc * (0.85 + 0.15 * step(0.5, fract(v * 1.4))), d);
            col = mix(col, vec3(0.05, 0.06, 0.07), fan);
            gGlass = fan;
          } else {
            // sash window: white frame, glazing bars, stone sill, dark reflective glass
            float hw = min(0.55, bay * 0.24), y0 = ground ? 0.85 : 0.7, y1 = ground ? 2.25 : 2.1;
            float outer = box(vec2(lx, ly), vec2(-hw - 0.07, y0 - 0.07), vec2(hw + 0.07, y1 + 0.07));
            float glass = box(vec2(lx, ly), vec2(-hw, y0), vec2(hw, y1));
            float mid = (y0 + y1) * 0.5;
            float bars = max(box(vec2(lx, ly), vec2(-hw, mid - 0.035), vec2(hw, mid + 0.035)),
                             max(box(vec2(lx, ly), vec2(-0.02, y0), vec2(0.02, y1)), max(box(vec2(lx, ly), vec2(-hw * 0.5 - 0.015, y0), vec2(-hw * 0.5 + 0.015, y1)), box(vec2(lx, ly), vec2(hw * 0.5 - 0.015, y0), vec2(hw * 0.5 + 0.015, y1)))));
            float sill = box(vec2(lx, ly), vec2(-hw - 0.14, y0 - 0.16), vec2(hw + 0.14, y0 - 0.06));
            float reveal = outer - glass;
            col = mix(col, col * 0.55, box(vec2(lx, ly), vec2(-hw - 0.12, y0 - 0.12), vec2(hw + 0.12, y1 + 0.14)) * 0.35);
            col = mix(col, vec3(0.94, 0.94, 0.92), max(0.0, reveal));
            float g = glass * (1.0 - bars);
            float curtain = step(0.5, h1(seed * 13.0 + bi * 3.1 + fi * 7.7)) * box(vec2(lx, ly), vec2(-hw, y0), vec2(-hw * 0.55, y1));
            col = mix(col, mix(vec3(0.045, 0.05, 0.055), vec3(0.55, 0.5, 0.42), curtain * 0.5), g);
            col = mix(col, vec3(0.94, 0.94, 0.92), glass * bars);
            col = mix(col, vec3(0.78, 0.76, 0.72), sill);
            gGlass = g * (1.0 - curtain * 0.5); gLit = g * step(0.4, h1(seed * 3.0 + bi * 1.7 + fi * 5.3));
          }
        }
        // contact darkening where walls meet the ground, and under the eaves
        col *= mix(0.7, 1.0, smoothstep(-0.3, 0.9, v));
        col *= mix(0.75, 1.0, smoothstep(0.0, 0.5, eave - v + 0.1) + step(eave + 0.2, v) * 0.0);
        diffuseColor.rgb = col;
      }`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.04, gGlass);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, 0.55, gGlass);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0, 0.75, 0.45) * gLit * night * 1.4;");
  };
  wall.customProgramCacheKey = () => "wall3";

  const roof = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  roof.onBeforeCompile = (sh) => {
    sh.uniforms.tTile = { value: tex.tile }; sh.uniforms.tSlate = { value: tex.slate };
    sh.vertexShader = "attribute vec4 ra; varying vec4 vRa; varying vec3 vRw; varying float vRny;\n" + sh.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vRa = ra; vRny = abs(normal.y); vRw = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = "uniform sampler2D tTile, tSlate; varying vec4 vRa; varying vec3 vRw; varying float vRny;\n" + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      // ra.x = covering (0 clay tile, 1 slate, 2 flat/metal), ra.y = along-ridge coordinate (m), ra.z = tint
      vec2 tuv = vec2(vRa.y, vRa.w) / 2.2;  // along the ridge, across it (plan coordinates)
      vec3 c;
      if (vRa.x < 0.5) c = texture2D(tTile, tuv).rgb * vec3(1.35, 1.12, 1.0) * vRa.z;
      else if (vRa.x < 1.5) c = texture2D(tSlate, tuv).rgb * 0.95 * vRa.z;
      else c = vec3(0.32, 0.32, 0.33) * vRa.z;
      // near-vertical steps in the scanned roof (where a low extension meets the main roof) are wall, not tiles
      c = mix(vec3(0.86, 0.85, 0.81), c, smoothstep(0.25, 0.45, vRny));
      diffuseColor.rgb = c;`);
  };
  roof.customProgramCacheKey = () => "roof3";
  const pot = new THREE.MeshStandardMaterial({ color: 0x9a4a2e, roughness: 0.8 });
  return { wall, roof, pot, signMat: new THREE.MeshStandardMaterial({ roughness: 0.5 }) };
}

let railMat = null;
function railMaterial() {
  if (railMat) return railMat;
  const c = document.createElement("canvas"); c.width = 64; c.height = 64; const g = c.getContext("2d");
  g.fillStyle = "#111"; for (let x = 0; x < 64; x += 16) g.fillRect(x + 6, 4, 4, 60); g.fillRect(0, 4, 64, 4); g.fillRect(0, 54, 64, 4);
  g.beginPath(); for (let x = 0; x < 64; x += 16) { g.moveTo(x + 4, 6); g.lineTo(x + 8, 0); g.lineTo(x + 12, 6); } g.fill();
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping;
  railMat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 });
  return railMat;
}
function polyArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return a / 2; }

function roofGrid(rf) {
  const [ux, uz, s0, t0, ns, nt, st, q] = rf.f;
  const raw = atob(rf.v), v = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) v[i] = raw.charCodeAt(i) * q;
  const at = (i, j) => (i < 0 || j < 0 || i >= ns || j >= nt ? 0 : v[j * ns + i]);
  const height = (x, z) => {
    const s = x * ux + z * uz, t = -x * uz + z * ux;
    const fi = (s - s0) / st, fj = (t - t0) / st, i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j;
    let sum = 0, w = 0;
    for (const [di, dj, k] of [[0, 0, (1 - a) * (1 - b)], [1, 0, a * (1 - b)], [0, 1, (1 - a) * b], [1, 1, a * b]]) { const h = at(i + di, j + dj); if (h > 0) { sum += h * k; w += k; } }
    if (w > 0) return sum / w;
    let best = 0, bd = 1e9;
    for (let dj = -2; dj <= 3; dj++) for (let di = -2; di <= 3; di++) { const h = at(i + di, j + dj); if (h > 0) { const d = (di - a) ** 2 + (dj - b) ** 2; if (d < bd) { bd = d; best = h; } } }
    return best;
  };
  const m = rf.m;
  if (m) {
    // clean roof fitted to the scan: [type, ridge height, slope, s range, t range, error, ridge line]
    const [type, a, k, sa, sb, ta, tb, , rc] = m, sc = (sa + sb) / 2, tc = (ta + tb) / 2, hs = (sb - sa) / 2, ht = (tb - ta) / 2;
    const fn = (s, t) => {
      let d = 0;
      if (type === "gable_s") d = Math.abs(t - rc); else if (type === "gable_t") d = Math.abs(s - rc);
      else if (type === "hip_s") d = Math.max(Math.abs(t - rc), Math.abs(s - sc) - (hs - ht));
      else if (type === "hip_t") d = Math.max(Math.abs(s - rc), Math.abs(t - tc) - (ht - hs));
      return Math.max(1.8, a - k * d);
    };
    return { ux, uz, s0, t0, ns, nt, st, at, model: { type, fn, sa, sb, ta, tb, rc, sc, tc, hs, ht }, height: (x, z) => fn(x * ux + z * uz, -x * uz + z * ux) };
  }
  return { ux, uz, s0, t0, ns, nt, st, at, height };
}
function inPoly(pts, x, z) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
function distPoly(pts, x, z) { let b = Infinity; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [ax, az] = pts[j], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1; let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t)); b = Math.min(b, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return b; }

function signTexture(text) {
  const c = document.createElement("canvas"); c.width = 1024; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#2a2f33"; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = "#f4f4f0"; g.textAlign = "center"; g.textBaseline = "middle";
  let size = 78; g.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`;
  while (g.measureText(text).width > 960 && size > 28) { size -= 3; g.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`; }
  g.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function styleFor(b, seed, area) {
  const tag = WALL_TAG[(b.b_material || "").toLowerCase()];
  if (tag != null) return tag;
  const t = b.t;
  if (t === "church") return 4;
  if (["industrial", "warehouse", "farm_auxiliary", "barn", "hangar", "service", "container", "greenhouse", "static_caravan"].includes(t)) return 5;
  if (["garage", "garages", "shed", "carport", "roof"].includes(t) || area < 20) return 2;
  // Hampshire village mix (styled default): white render, red brick, cream render, some timber frame and flint
  return seed < 0.48 ? 0 : seed < 0.86 ? 2 : 1;
}

export function buildBuildings(chunk, mats, lod = 0) {
  const W = { pos: [], uv: [], a: [], b: [] }, R = { pos: [], ra: [] };
  const out = [], pots = [];
  const segs = chunk.segs || [];
  const rails = [];
  const nearestSeg = (x, z) => { let best = null; for (const s of segs) { const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1; let t = ((x - s.ax) * dx + (z - s.az) * dz) / L2; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t); if (!best || d < best.d) best = { d, s }; } return best; };
  const nearestRoad = (x, z) => { let best = Infinity; for (const s of segs) { const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1; let t = ((x - s.ax) * dx + (z - s.az) * dz) / L2; t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(x - s.ax - dx * t, z - s.az - dz * t)); } return best; };
  (chunk.f.bld || []).forEach((b, bi) => {
    const p = b.p, n = p.length / 2;
    let pts = []; for (let i = 0; i < n; i++) pts.push([p[i * 2], p[i * 2 + 1]]);
    let area = polyArea(pts);
    if (area < 0) { pts.reverse(); area = -area; }
    if (area < 3) return;
    const seed = hash((Math.round(pts[0][0] * 10) * 73856093) ^ (Math.round(pts[0][1] * 10) * 19349663));
    const style = styleFor(b, seed, area);
    const grid = b.rf ? roofGrid(b.rf) : null;
    const flatH = b.nodata ? (b.b_levels ? +b.b_levels * 3 : 5) : b.h;
    const roofAt = (x, z) => (grid ? grid.height(x, z) : flatH);
    const base = b.y - 0.5;
    let cx = 0, cz = 0; for (const q of pts) { cx += q[0]; cz += q[1]; } cx /= n; cz /= n;
    // which wall faces the road (front door / shopfront / sign go there)
    let front = -1, fd = Infinity;
    pts.forEach((a, i) => { const c = pts[(i + 1) % pts.length]; const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 2.5) return; const d = nearestRoad((a[0] + c[0]) / 2, (a[1] + c[1]) / 2); if (d < fd) { fd = d; front = i; } });
    const isShop = !!b.shop;
    // front garden wall with railings along the back of the pavement (styled default, as on Winchester Street)
    if (front >= 0 && !isShop && style !== 5 && area > 30 && lod <= 1) {
      const a = pts[front], c = pts[(front + 1) % pts.length], ns = nearestSeg((a[0] + c[0]) / 2, (a[1] + c[1]) / 2);
      if (ns && ns.s.pave) {
        const s = ns.s, dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz) || 1, ux2 = dx / L, uz2 = dz / L;
        const off = s.hw + s.pave + 0.15, set = ns.d - off;
        if (set > 2 && set < 14) {
          const side = Math.sign((cx - s.ax) * -uz2 + (cz - s.az) * ux2) || 1, nx2 = -uz2 * side, nz2 = ux2 * side;
          const proj = (q) => { const t = (q[0] - s.ax) * ux2 + (q[1] - s.az) * uz2; return [s.ax + ux2 * t + nx2 * off, s.az + uz2 * t + nz2 * off, t]; };
          let p0 = proj(a), p1 = proj(c); if (p0[2] > p1[2]) [p0, p1] = [p1, p0];
          const len = p1[2] - p0[2] - 1.2;
          if (len > 2) {
            const q0 = [p0[0] + ux2 * 0.6, p0[1] + uz2 * 0.6], q1 = [q0[0] + ux2 * len, q0[1] + uz2 * len];
            const y0 = s.ay + 0.1, hw2 = 0.12, H = 0.75;
            for (const o of [-hw2, hw2]) {
              const A = [q0[0] + nx2 * o, q0[1] + nz2 * o], C = [q1[0] + nx2 * o, q1[1] + nz2 * o];
              W.pos.push(A[0], y0 - 0.4, A[1], C[0], y0 - 0.4, C[1], A[0], y0 + H, A[1], C[0], y0 - 0.4, C[1], C[0], y0 + H, C[1], A[0], y0 + H, A[1]);
              W.uv.push(0, -0.4, len, -0.4, 0, H, len, -0.4, len, H, 0, H);
              for (let q = 0; q < 6; q++) { W.a.push(2, len, 0, seed); W.b.push(0, -5); }
            }
            rails.push([q0[0], y0 + H, q0[1], q1[0], y0 + H, q1[1]]);
          }
        }
      }
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 0.05) continue;
      let nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L;
      if ((cx - a[0]) * nx + (cz - a[1]) * nz < 0) { nx = -nx; nz = -nz; }
      const k = Math.max(1, Math.round(L / 1.0));
      // eave line of this wall = lowest roof height just inside it (windows stay below it; gables above have none)
      let eave = Infinity;
      for (let s = 0; s <= k; s++) { const f = s / k; eave = Math.min(eave, roofAt(a[0] + (c[0] - a[0]) * f + nx * 0.7, a[1] + (c[1] - a[1]) * f + nz * 0.7)); }
      const nb = Math.max(1, Math.floor(L / 2.7));
      const doorBay = i === front && fd < 25 && !isShop && style !== 5 && area > 25 ? Math.floor(nb / 2) : -5;
      const shop = isShop && i === front ? 1 : 0;
      const wa = [style, L, eave, seed], wb = [shop, doorBay];
      for (let s = 0; s < k; s++) {
        const f0 = s / k, f1 = (s + 1) / k;
        const x0 = a[0] + (c[0] - a[0]) * f0, z0 = a[1] + (c[1] - a[1]) * f0, x1 = a[0] + (c[0] - a[0]) * f1, z1 = a[1] + (c[1] - a[1]) * f1;
        const h0 = roofAt(x0 + nx * 0.7, z0 + nz * 0.7), h1 = roofAt(x1 + nx * 0.7, z1 + nz * 0.7);
        const u0 = L * f0, u1 = L * f1, vb = base - b.y;
        W.pos.push(x0, base, z0, x1, base, z1, x0, b.y + h0, z0, x1, base, z1, x1, b.y + h1, z1, x0, b.y + h0, z0);
        W.uv.push(u0, vb, u1, vb, u0, h0, u1, vb, u1, h1, u0, h0);
        for (let q = 0; q < 6; q++) { W.a.push(...wa); W.b.push(...wb); }
      }
    }
    const covering = ROOF_TAG[(b.r_material || "").toLowerCase()] ?? (style === 5 ? 2 : seed * 7.3 % 1 < 0.68 ? 0 : 1);
    const tint = 0.85 + (seed * 13.7 % 1) * 0.3;
    if (grid && grid.model) {
      // fitted roof: sample it on lines that include the ridge so each slope is one flat plane, clipped to the footprint + eaves
      const { ux, uz } = grid, M = grid.model, o = 0.35;
      const lines = (a, b, extra) => { const v = new Set(); const n2 = Math.max(2, Math.ceil((b - a + 2 * o) / 0.75)); for (let i = 0; i <= n2; i++) v.add(+(a - o + ((b - a + 2 * o) * i) / n2).toFixed(3)); for (const e of extra) if (e > a - o && e < b + o) v.add(+e.toFixed(3)); return [...v].sort((p, q) => p - q); };
      const S = lines(M.sa, M.sb, [M.rc, M.sc - (M.hs - M.ht), M.sc + (M.hs - M.ht)]), T = lines(M.ta, M.tb, [M.rc, M.tc - (M.ht - M.hs), M.tc + (M.ht - M.hs)]);
      const alongS = M.type.endsWith("_s");
      const V = (s, t) => [s * ux - t * uz, b.y + M.fn(s, t), s * uz + t * ux, alongS ? s : t, alongS ? t : s];
      const tri = (A, B, C) => { for (const v of [A, B, C]) { R.pos.push(v[0], v[1], v[2]); R.ra.push(covering, v[3], tint, v[4]); } };
      for (let j = 0; j + 1 < T.length; j++) for (let i = 0; i + 1 < S.length; i++) {
        const ms = (S[i] + S[i + 1]) / 2, mt = (T[j] + T[j + 1]) / 2, mx = ms * ux - mt * uz, mz = ms * uz + mt * ux;
        if (!inPoly(pts, mx, mz) && distPoly(pts, mx, mz) > o + 0.05) continue;
        const A = V(S[i], T[j]), B = V(S[i + 1], T[j]), C = V(S[i], T[j + 1]), D = V(S[i + 1], T[j + 1]);
        tri(A, C, B); tri(B, C, D);
      }
      for (const [s2, t2, top] of b.rf.ch || []) chimney(s2, t2, top);
    } else if (grid) {
      const { ux, uz, s0, t0, ns, nt, st, at } = grid;
      const alongS = ns >= nt; // tiles run along the longer side
      const P = (i, j) => { const s = s0 + i * st, t = t0 + j * st; return [s * ux - t * uz, b.y + at(i, j), s * uz + t * ux, alongS ? s : t, alongS ? t : s]; };
      const tri = (A, B, C) => { for (const v of [A, B, C]) { R.pos.push(v[0], v[1], v[2]); R.ra.push(covering, v[3], tint, v[4]); } };
      for (let j = 0; j < nt - 1; j++) for (let i = 0; i < ns - 1; i++) {
        const a0 = at(i, j), a1 = at(i + 1, j), a2 = at(i, j + 1), a3 = at(i + 1, j + 1), cnt = !!a0 + !!a1 + !!a2 + !!a3;
        if (cnt < 3) continue;
        const A = P(i, j), B = P(i + 1, j), C = P(i, j + 1), D = P(i + 1, j + 1);
        if (cnt === 4) { tri(A, C, B); tri(B, C, D); }
        else if (!a0) tri(B, C, D); else if (!a1) tri(A, C, D); else if (!a2) tri(A, D, B); else tri(A, C, B);
      }
      for (const [s2, t2, top] of b.rf.ch || []) chimney(s2, t2, top);
    }
    function chimney(s, t, top) {
      {
        const { ux, uz } = grid;
        const x = s * ux - t * uz, z = s * uz + t * ux, y0 = b.y + top - 2.2, y1 = b.y + top - 0.25;
        const w = 0.45, d = 0.6, cs = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([a2, b2]) => [x + a2 * ux - b2 * uz, z + a2 * uz + b2 * ux]);
        for (let e = 0; e < 4; e++) {
          const A = cs[e], C = cs[(e + 1) % 4], L = Math.hypot(C[0] - A[0], C[1] - A[1]);
          W.pos.push(A[0], y0, A[1], C[0], y0, C[1], A[0], y1, A[1], C[0], y0, C[1], C[0], y1, C[1], A[0], y1, A[1]);
          W.uv.push(0, 0, L, 0, 0, y1 - y0, L, 0, L, y1 - y0, 0, y1 - y0);
          for (let q = 0; q < 6; q++) { W.a.push(2, L, 0, seed); W.b.push(0, -5); }
        }
        W.pos.push(cs[0][0], y1, cs[0][1], cs[1][0], y1, cs[1][1], cs[2][0], y1, cs[2][1], cs[0][0], y1, cs[0][1], cs[2][0], y1, cs[2][1], cs[3][0], y1, cs[3][1]);
        for (let q = 0; q < 6; q++) { W.uv.push(0, 0); W.a.push(2, 0.5, 0, seed); W.b.push(0, -5); }
        pots.push([x + 0.22 * uz, y1, z - 0.22 * ux], [x - 0.22 * uz, y1, z + 0.22 * ux]);
      }
    }
    if (!grid) {
      const contour = pts.map((q) => new THREE.Vector2(q[0], q[1]));
      let tris = []; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (_) { /* skip */ }
      for (const t of tris) for (const k of [t[0], t[2], t[1]]) { R.pos.push(pts[k][0], b.y + flatH, pts[k][1]); R.ra.push(2, pts[k][0], 1, pts[k][1]); }
    }
    // the real shop name on the fascia
    if (isShop && front >= 0 && lod <= 1) {
      const a = pts[front], c = pts[(front + 1) % pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2, dx = (c[0] - a[0]) / L, dz = (c[1] - a[1]) / L;
      let nx = dz, nz = -dx; if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
      const w = Math.min(L - 0.6, 6.5);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, Math.min(0.55, w / 8)), mats.signMat.clone());
      m.material.map = signTexture(b.shop);
      m.position.set(mx + nx * 0.04, b.y + 2.85, mz + nz * 0.04); m.rotation.y = Math.atan2(nx, nz);
      out.push(m);
    }
  });
  if (W.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(W.pos, 3)); g.setAttribute("wuv", new THREE.Float32BufferAttribute(W.uv, 2));
    g.setAttribute("wa", new THREE.Float32BufferAttribute(W.a, 4)); g.setAttribute("wb", new THREE.Float32BufferAttribute(W.b, 2));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats.wall); m.castShadow = m.receiveShadow = true; out.push(m);
  }
  if (R.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(R.pos, 3)); g.setAttribute("ra", new THREE.Float32BufferAttribute(R.ra, 4));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats.roof); m.castShadow = m.receiveShadow = true; out.push(m);
  }
  if (rails.length) {
    const pos = [], uv = [];
    for (const [x0, y0, z0, x1, y1, z1] of rails) {
      const L = Math.hypot(x1 - x0, z1 - z0), h = 0.65;
      pos.push(x0, y0, z0, x1, y1, z1, x0, y0 + h, z0, x1, y1, z1, x1, y1 + h, z1, x0, y0 + h, z0);
      uv.push(0, 0, L / 0.6, 0, 0, 1, L / 0.6, 0, L / 0.6, 1, 0, 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, railMaterial()); m.castShadow = true; out.push(m);
  }
  if (pots.length) {
    const pg = new THREE.CylinderGeometry(0.11, 0.13, 0.45, 8).translate(0, 0.22, 0);
    const im = new THREE.InstancedMesh(pg, mats.pot, pots.length), o = new THREE.Object3D();
    pots.forEach(([x, y, z], i) => { o.position.set(x, y, z); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.castShadow = true; im.computeBoundingSphere(); out.push(im);
  }
  return out;
}
