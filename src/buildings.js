// Buildings from real data only.
// - Footprint: OpenStreetMap.
// - Roof shape (pitch, direction, ridge line, hips, dormers, chimneys big enough to show): the Environment Agency LIDAR
//   first-return surface over the footprint, baked as a 1 m height grid aligned with the building (scripts/bake.py).
// - Wall tops follow that roof line, so gable ends come from the scan too.
// - Wall/roof material and colour: OSM tags (building:material, roof:material, building:colour, roof:colour) where mapped;
//   otherwise a plain neutral finish (no invented windows or brick colours).
// - Shop / pub / cafe names: OSM names, shown on a plain sign on the wall nearest the road.
import * as THREE from "three";
import { photo } from "./photo.js";

const WALL_MAT = { brick: 1, render: 2, plaster: 2, stone: 3, flint: 3, sandstone: 3, limestone: 3, wood: 4, timber_framing: 4, metal: 5, concrete: 5, glass: 5, cement_block: 5 };
const ROOF_MAT = { roof_tiles: 1, tile: 1, tiles: 1, clay: 1, slate: 2, metal: 3, concrete: 3, tar_paper: 3, eternit: 3, thatch: 4, grass: 4 };
const NEUTRAL_WALL = new THREE.Color(0xc9c2b6), NEUTRAL_ROOF = new THREE.Color(0x6a625c);

export function buildingMaterials() {
  const tex = { brick: photo("brick"), render: photo("render"), stone: photo("concrete"), tile: photo("rooftile"), slate: photo("slate") };
  const wall = new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true });
  wall.userData.uniforms = { night: { value: 0 } };
  wall.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, wall.userData.uniforms, { tBrick: { value: tex.brick }, tRender: { value: tex.render }, tStone: { value: tex.stone } });
    sh.vertexShader = "attribute float wm; attribute vec2 wuv; varying float vWm; varying vec2 vWuv;\n" + sh.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n vWm = wm; vWuv = wuv;");
    sh.fragmentShader = "uniform sampler2D tBrick, tRender, tStone; varying float vWm; varying vec2 vWuv;\n" + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      vec3 t = vec3(1.0);
      if (vWm > 0.5 && vWm < 1.5) t = texture2D(tBrick, vWuv / 2.0).rgb * 1.6;
      else if (vWm > 1.5 && vWm < 2.5) t = texture2D(tRender, vWuv / 3.0).rgb * 1.15;
      else if (vWm > 2.5 && vWm < 3.5) t = texture2D(tStone, vWuv / 2.5).rgb * 1.3;
      else t = vec3(0.96 + 0.04 * sin(vWuv.x * 0.7) * sin(vWuv.y * 1.3));
      diffuseColor.rgb *= t;
      // a little contact darkening where walls meet the ground (lighting, not detail)
      diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 1.2, vWuv.y + 0.3));`);
  };
  wall.customProgramCacheKey = () => "wall2";
  const roof = new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  roof.onBeforeCompile = (sh) => {
    sh.uniforms.tTile = { value: tex.tile }; sh.uniforms.tSlate = { value: tex.slate };
    sh.vertexShader = "attribute float rm; attribute vec2 ruv; varying float vRm; varying vec2 vRuv;\n" + sh.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n vRm = rm; vRuv = ruv;");
    sh.fragmentShader = "uniform sampler2D tTile, tSlate; varying float vRm; varying vec2 vRuv;\n" + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      vec3 t = vec3(1.0);
      if (vRm > 0.5 && vRm < 1.5) t = texture2D(tTile, vRuv / 2.5).rgb * 1.5;
      else if (vRm > 1.5 && vRm < 2.5) t = texture2D(tSlate, vRuv / 2.5).rgb * 1.4;
      diffuseColor.rgb *= t;`);
  };
  roof.customProgramCacheKey = () => "roof2";
  const sign = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  return { wall, roof, signMat: sign };
}

function polyArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return a / 2; }
function colourOf(tag, fallback) { if (!tag) return fallback; try { return new THREE.Color(tag.trim().toLowerCase()); } catch (_) { return fallback; } }

// the baked roof grid as a height lookup
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
    let best = 0, bd = 1e9; // nearest node with data
    for (let dj = -2; dj <= 3; dj++) for (let di = -2; di <= 3; di++) { const h = at(i + di, j + dj); if (h > 0) { const d = (di - a) ** 2 + (dj - b) ** 2; if (d < bd) { bd = d; best = h; } } }
    return best;
  };
  return { ux, uz, s0, t0, ns, nt, st, at, height };
}

let signCanvas = null;
function signTexture(text) {
  signCanvas = signCanvas || document.createElement("canvas");
  const c = document.createElement("canvas"); c.width = 512; c.height = 80;
  const g = c.getContext("2d");
  g.fillStyle = "#1d2b26"; g.fillRect(0, 0, 512, 80);
  g.fillStyle = "#f1ece0"; g.font = "bold 44px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle";
  let size = 44; while (g.measureText(text).width > 480 && size > 18) { size -= 2; g.font = `bold ${size}px Georgia, serif`; }
  g.fillText(text, 256, 42);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildBuildings(chunk, mats, lod = 0) {
  const W = { pos: [], col: [], wm: [], uv: [] }, R = { pos: [], col: [], rm: [], uv: [] };
  const out = [];
  const segs = chunk.segs || [];
  for (const b of chunk.f.bld || []) {
    const p = b.p, n = p.length / 2;
    let pts = []; for (let i = 0; i < n; i++) pts.push([p[i * 2], p[i * 2 + 1]]);
    let area = polyArea(pts);
    if (area < 0) { pts.reverse(); area = -area; }
    if (area < 3) continue;
    const wm = WALL_MAT[(b.b_material || "").toLowerCase()] || 0, rm = ROOF_MAT[(b.r_material || "").toLowerCase()] || 0;
    const wc = colourOf(b.b_colour, wm ? new THREE.Color(1, 1, 1) : NEUTRAL_WALL), rc = colourOf(b.r_colour, rm ? new THREE.Color(1, 1, 1) : NEUTRAL_ROOF);
    const base = b.y - 0.4;
    const grid = b.rf ? roofGrid(b.rf) : null;
    // default when the scan has nothing: OSM levels (3 m each) or a plain 5 m box with a flat top
    const flatH = b.nodata ? (b.b_levels ? +b.b_levels * 3 : 5) : b.h;
    const roofAt = (x, z) => (grid ? grid.height(x, z) : flatH);
    let cx = 0, cz = 0; for (const q of pts) { cx += q[0]; cz += q[1]; } cx /= n; cz /= n;
    // walls: ~1 m pieces whose top follows the roof just inside the wall (so gables are the real shape)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 0.05) continue;
      // inward normal (footprint is counter-clockwise in x/z after the area check)
      let nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L;
      if ((cx - a[0]) * nx + (cz - a[1]) * nz < 0) { nx = -nx; nz = -nz; }
      const k = Math.max(1, Math.round(L / 1.0));
      let u = 0;
      for (let s = 0; s < k; s++) {
        const f0 = s / k, f1 = (s + 1) / k;
        const x0 = a[0] + (c[0] - a[0]) * f0, z0 = a[1] + (c[1] - a[1]) * f0, x1 = a[0] + (c[0] - a[0]) * f1, z1 = a[1] + (c[1] - a[1]) * f1;
        const h0 = roofAt(x0 + nx * 0.7, z0 + nz * 0.7), h1 = roofAt(x1 + nx * 0.7, z1 + nz * 0.7);
        const y0 = b.y + h0, y1 = b.y + h1, du = L / k;
        W.pos.push(x0, base, z0, x1, base, z1, x0, y0, z0, x1, base, z1, x1, y1, z1, x0, y0, z0);
        W.uv.push(u, base - b.y, u + du, base - b.y, u, h0, u + du, base - b.y, u + du, h1, u, h0);
        for (let q = 0; q < 6; q++) { W.col.push(wc.r, wc.g, wc.b); W.wm.push(wm); }
        u += du;
      }
    }
    // roof
    if (grid) {
      const { ux, uz, s0, t0, ns, nt, st, at } = grid;
      const P = (i, j) => { const s = s0 + i * st, t = t0 + j * st; return [s * ux - t * uz, b.y + at(i, j), s * uz + t * ux, s, t]; };
      for (let j = 0; j < nt - 1; j++) for (let i = 0; i < ns - 1; i++) {
        if (!(at(i, j) && at(i + 1, j) && at(i, j + 1) && at(i + 1, j + 1))) continue;
        const A = P(i, j), B = P(i + 1, j), C = P(i, j + 1), D = P(i + 1, j + 1);
        for (const v of [A, C, B, B, C, D]) { R.pos.push(v[0], v[1], v[2]); R.uv.push(v[3], v[4]); R.col.push(rc.r, rc.g, rc.b); R.rm.push(rm); }
      }
    } else {
      const contour = pts.map((q) => new THREE.Vector2(q[0], q[1]));
      let tris = []; try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (_) { /* skip */ }
      for (const t of tris) for (const k of [t[0], t[2], t[1]]) { R.pos.push(pts[k][0], b.y + flatH, pts[k][1]); R.uv.push(pts[k][0], pts[k][1]); R.col.push(rc.r, rc.g, rc.b); R.rm.push(rm); }
    }
    // shop / pub name on the wall that faces the nearest road
    if (b.shop && lod === 0 && segs.length) {
      let best = null;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 3) continue;
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        for (const s of segs) { const d = Math.hypot(mx - (s.ax + s.bx) / 2, mz - (s.az + s.bz) / 2); if (!best || d < best.d) best = { d, a, c, L, mx, mz }; }
      }
      if (best && best.d < 40) {
        const { a, c, L, mx, mz } = best, w = Math.min(L - 0.6, 5), dx = (c[0] - a[0]) / L, dz = (c[1] - a[1]) / L;
        let nx = dz, nz = -dx; if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 80 / 512 * 1.6), mats.signMat.clone());
        m.material.map = signTexture(b.shop);
        m.position.set(mx + nx * 0.08, b.y + Math.min(3.1, roofAt(mx - nx, mz - nz) - 0.6), mz + nz * 0.08);
        m.rotation.y = Math.atan2(nx, nz);
        out.push(m);
      }
    }
  }
  if (W.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(W.pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(W.col, 3));
    g.setAttribute("wm", new THREE.Float32BufferAttribute(W.wm, 1)); g.setAttribute("wuv", new THREE.Float32BufferAttribute(W.uv, 2));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats.wall); m.castShadow = m.receiveShadow = true; out.push(m);
  }
  if (R.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(R.pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(R.col, 3));
    g.setAttribute("rm", new THREE.Float32BufferAttribute(R.rm, 1)); g.setAttribute("ruv", new THREE.Float32BufferAttribute(R.uv, 2));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats.roof); m.castShadow = m.receiveShadow = true; out.push(m);
  }
  return out;
}
