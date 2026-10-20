// Buildings from the real OpenStreetMap footprints, with heights measured from the Environment Agency LIDAR
// (surface model minus bare ground): walls to the eaves, pitched roofs (gable or hip) on house-shaped footprints,
// flat roofs on big or odd-shaped ones. Facades come from one atlas: brick, render, painted Georgian, shopfronts,
// industrial cladding, flint. Windows light up at night.
import * as THREE from "three";

const STYLES = 8; // atlas columns
let atlas = null;

function hash(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }

// Paint the facade atlas: 8 styles x (ground floor, upper floor), each cell one 3 m bay. Photo brick/render as the base.
function makeAtlas() {
  const S = 256, cv = document.createElement("canvas"), mk = document.createElement("canvas");
  cv.width = mk.width = S * STYLES; cv.height = mk.height = S * 2;
  const g = cv.getContext("2d"), m = mk.getContext("2d");
  m.fillStyle = "#000"; m.fillRect(0, 0, mk.width, mk.height);
  const tex = new THREE.CanvasTexture(cv), mtex = new THREE.CanvasTexture(mk);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; mtex.anisotropy = 4;
  const imgs = {}, need = ["brick", "render"];
  let left = need.length;
  const draw = () => {
    const cell = (col, row, fn) => { g.save(); m.save(); g.translate(col * S, row * S); m.translate(col * S, row * S); g.beginPath(); g.rect(0, 0, S, S); g.clip(); fn(); g.restore(); m.restore(); };
    const fillImg = (img, tint, alpha = 1) => { if (img) g.drawImage(img, 0, 0, S, S); else { g.fillStyle = tint; g.fillRect(0, 0, S, S); } if (tint && img) { g.globalAlpha = alpha; g.fillStyle = tint; g.fillRect(0, 0, S, S); g.globalAlpha = 1; } };
    const win = (x, y, w, h, { frame = "#f2f2ee", sash = false, sill = "#ddd", arch = null } = {}) => {
      if (arch) { g.fillStyle = arch; g.fillRect(x - 6, y - 14, w + 12, 14); }
      g.fillStyle = frame; g.fillRect(x - 5, y - 5, w + 10, h + 10);
      const grd = g.createLinearGradient(x, y, x + w, y + h); grd.addColorStop(0, "#2a333b"); grd.addColorStop(0.5, "#4b5862"); grd.addColorStop(1, "#1d2328");
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(255,255,255,0.12)"; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w * 0.5, y); g.lineTo(x + w * 0.75, y); g.lineTo(x + w * 0.2, y + h); g.fill();
      g.fillStyle = frame;
      if (sash) { g.fillRect(x, y + h / 2 - 3, w, 6); for (let k = 1; k < 3; k++) { g.fillRect(x + (w * k) / 3 - 1.5, y, 3, h); } g.fillRect(x, y + h / 4 - 1.5, w, 3); g.fillRect(x, y + (3 * h) / 4 - 1.5, w, 3); }
      else { g.fillRect(x + w / 2 - 3, y, 6, h); g.fillRect(x, y + h * 0.3 - 3, w / 2, 6); }
      g.fillStyle = sill; g.fillRect(x - 9, y + h + 4, w + 18, 9);
      m.fillStyle = "#fff"; m.fillRect(x, y, w, h);
    };
    const door = (x, w, h, col) => { g.fillStyle = "#eee"; g.fillRect(x - 5, S - h - 5, w + 10, h + 5); g.fillStyle = col; g.fillRect(x, S - h, w, h); g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(x + 8, S - h + 10, w - 16, h * 0.35); g.fillStyle = "#c9a84a"; g.fillRect(x + w - 16, S - h * 0.5, 6, 6); };
    // 0 red brick house, uPVC windows
    cell(0, 1, () => { fillImg(imgs.brick); win(68, 60, 120, 110); });
    cell(0, 0, () => { fillImg(imgs.brick); win(40, 70, 110, 100); door(170, 62, 170, "#24364d"); });
    // 1 cream render
    cell(1, 1, () => { fillImg(imgs.render, "#efe4c8", 0.55); win(68, 60, 120, 110); });
    cell(1, 0, () => { fillImg(imgs.render, "#efe4c8", 0.55); win(40, 70, 110, 100); door(170, 62, 170, "#5b2121"); });
    // 2 white painted Georgian, sash windows
    cell(2, 1, () => { fillImg(imgs.render, "#f4f2ec", 0.7); win(80, 40, 96, 150, { sash: true }); });
    cell(2, 0, () => { fillImg(imgs.render, "#f4f2ec", 0.7); win(80, 50, 96, 150, { sash: true }); g.fillStyle = "#cfcac0"; g.fillRect(0, S - 18, S, 18); });
    // 3 older darker brick with sash windows under brick arches
    cell(3, 1, () => { fillImg(imgs.brick, "#5a2a1c", 0.35); win(84, 52, 88, 140, { sash: true, arch: "#8a3f2a" }); });
    cell(3, 0, () => { fillImg(imgs.brick, "#5a2a1c", 0.35); win(84, 62, 88, 140, { sash: true, arch: "#8a3f2a" }); });
    // 4 shop: big glazed front + fascia (ground), brick upper floor
    cell(4, 1, () => { fillImg(imgs.render, "#e8dcc0", 0.5); win(80, 46, 96, 140, { sash: true }); });
    cell(4, 0, () => {
      g.fillStyle = "#1f2a33"; g.fillRect(0, 0, S, S);
      g.fillStyle = "#26323c"; g.fillRect(0, 0, S, 46);
      const grd = g.createLinearGradient(0, 60, 0, S); grd.addColorStop(0, "#56656f"); grd.addColorStop(1, "#28333b"); g.fillStyle = grd; g.fillRect(14, 62, S - 28, S - 82);
      g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(30, 70, 40, S - 100);
      g.fillStyle = "#1a1f24"; g.fillRect(S / 2 - 3, 62, 6, S - 82); g.fillStyle = "#3b3b3b"; g.fillRect(0, S - 20, S, 20);
      m.fillStyle = "#fff"; m.fillRect(14, 62, S - 28, S - 82);
    });
    // 5 industrial cladding
    cell(5, 1, () => { g.fillStyle = "#8e979c"; g.fillRect(0, 0, S, S); for (let x = 0; x < S; x += 16) { g.fillStyle = x % 32 ? "#7f888d" : "#9aa3a8"; g.fillRect(x, 0, 8, S); } g.fillStyle = "#2c3a44"; g.fillRect(0, 30, S, 40); m.fillStyle = "#fff"; m.fillRect(0, 30, S, 40); });
    cell(5, 0, () => { g.fillStyle = "#8e979c"; g.fillRect(0, 0, S, S); for (let x = 0; x < S; x += 16) { g.fillStyle = x % 32 ? "#7f888d" : "#9aa3a8"; g.fillRect(x, 0, 8, S); } g.fillStyle = "#6b6f71"; g.fillRect(0, S - 40, S, 40); });
    // 6 flint with brick quoins and lancet (church / old cottages)
    cell(6, 1, () => {
      g.fillStyle = "#8d8a83"; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 900; i++) { const x = (hash(i * 3 + 1) * S) | 0, y = (hash(i * 3 + 2) * S) | 0, r = 3 + hash(i * 3 + 3) * 7; g.fillStyle = `hsl(${30 + hash(i) * 30},${5 + hash(i + 9) * 10}%,${30 + hash(i + 5) * 50}%)`; g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0, 0, 7); g.fill(); }
      g.fillStyle = "#c9c2b4"; g.fillRect(0, 0, 22, S); g.fillRect(S - 22, 0, 22, S);
      g.fillStyle = "#c9c2b4"; g.beginPath(); g.moveTo(94, 210); g.lineTo(94, 90); g.quadraticCurveTo(128, 30, 162, 90); g.lineTo(162, 210); g.fill();
      g.fillStyle = "#2b3138"; g.beginPath(); g.moveTo(104, 204); g.lineTo(104, 94); g.quadraticCurveTo(128, 46, 152, 94); g.lineTo(152, 204); g.fill();
      m.fillStyle = "#fff"; m.fillRect(104, 94, 48, 110);
    });
    cell(6, 0, () => {
      g.fillStyle = "#8d8a83"; g.fillRect(0, 0, S, S);
      for (let i = 0; i < 900; i++) { const x = (hash(i * 3 + 7) * S) | 0, y = (hash(i * 3 + 8) * S) | 0, r = 3 + hash(i * 3 + 9) * 7; g.fillStyle = `hsl(${30 + hash(i + 2) * 30},${5 + hash(i + 11) * 10}%,${30 + hash(i + 6) * 50}%)`; g.beginPath(); g.ellipse(x, y, r, r * 0.75, 0, 0, 7); g.fill(); }
      g.fillStyle = "#c9c2b4"; g.fillRect(0, 0, 22, S); g.fillRect(S - 22, 0, 22, S); g.fillRect(0, S - 26, S, 26);
    });
    // 7 plain brick (gables, garages, outbuildings)
    cell(7, 1, () => { fillImg(imgs.brick, "#3a1a10", 0.12); });
    cell(7, 0, () => { fillImg(imgs.brick, "#3a1a10", 0.12); });
    tex.needsUpdate = true; mtex.needsUpdate = true;
  };
  for (const n of need) {
    const im = new Image();
    im.onload = () => { imgs[n] = im; if (--left === 0) draw(); };
    im.onerror = () => { if (--left === 0) draw(); };
    im.src = new URL(`../assets/tex/${n}.jpg`, import.meta.url).href;
  }
  draw();
  return { tex, mtex };
}

export function buildingMaterials() {
  atlas = atlas || makeAtlas();
  const wall = new THREE.MeshStandardMaterial({ map: atlas.tex, roughness: 0.92 });
  wall.userData.uniforms = { night: { value: 0 }, mask: { value: atlas.mtex } };
  wall.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, wall.userData.uniforms);
    sh.vertexShader = "attribute vec2 fs; varying vec2 vFs;\n" + sh.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n vFs = fs;");
    sh.fragmentShader = "uniform float night; uniform sampler2D mask; varying vec2 vFs;\n" + sh.fragmentShader
      .replace("#include <map_fragment>", `
        // uv.x in bays, uv.y in floors; fs.x = style column, fs.y = building seed
        float row = vMapUv.y < 1.0 ? 0.0 : 1.0;
        vec2 cellUv = vec2((vFs.x + fract(vMapUv.x)) / ${STYLES}.0, (1.0 - row + 1.0 - fract(vMapUv.y)) / 2.0);
        vec2 dx = dFdx(vMapUv) / vec2(${STYLES}.0, 2.0), dy = dFdy(vMapUv) / vec2(${STYLES}.0, 2.0);
        vec4 sampledDiffuseColor = textureGrad(map, cellUv, dx, dy);
        float h = fract(sin(dot(floor(vMapUv) + vFs.y, vec2(12.9898, 78.233))) * 43758.5453);
        sampledDiffuseColor.rgb *= 0.88 + 0.2 * fract(vFs.y * 7.13);
        diffuseColor *= sampledDiffuseColor;
        float winMask = textureGrad(mask, cellUv, dx, dy).r;
      `)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0, 0.72, 0.42) * winMask * night * step(0.45, h) * (0.7 + 0.6 * fract(h * 13.7));");
  };
  wall.customProgramCacheKey = () => "wall1";
  const roof = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  const tTile = new THREE.TextureLoader().load(new URL("../assets/tex/rooftile.jpg", import.meta.url).href);
  const tSlate = new THREE.TextureLoader().load(new URL("../assets/tex/slate.jpg", import.meta.url).href);
  for (const t of [tTile, tSlate]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  roof.onBeforeCompile = (sh) => {
    sh.uniforms.tTile = { value: tTile }; sh.uniforms.tSlate = { value: tSlate };
    sh.vertexShader = "attribute vec2 rs; varying vec2 vRs; varying vec2 vRuv;\n" + sh.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n vRs = rs; vRuv = uv;");
    sh.fragmentShader = "uniform sampler2D tTile, tSlate; varying vec2 vRs; varying vec2 vRuv;\n" + sh.fragmentShader.replace("#include <map_fragment>", `
      vec3 c;
      if (vRs.x < 0.5) c = texture2D(tTile, vRuv / 2.5).rgb * vec3(0.95, 0.82, 0.75);
      else if (vRs.x < 1.5) c = texture2D(tSlate, vRuv / 2.5).rgb * 0.8;
      else c = texture2D(tSlate, vRuv / 6.0).rgb * vec3(0.38, 0.38, 0.4);
      c *= 0.85 + 0.25 * vRs.y;
      diffuseColor.rgb *= c;`);
  };
  roof.customProgramCacheKey = () => "roof1";
  return { wall, roof };
}

// minimum-area rectangle around a footprint (rotating calipers over the convex hull)
function minRect(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    let mn0 = Infinity, mx0 = -Infinity, mn1 = Infinity, mx1 = -Infinity;
    for (const p of hull) { const s = p[0] * ux + p[1] * uz, t = -p[0] * uz + p[1] * ux; mn0 = Math.min(mn0, s); mx0 = Math.max(mx0, s); mn1 = Math.min(mn1, t); mx1 = Math.max(mx1, t); }
    const area = (mx0 - mn0) * (mx1 - mn1);
    if (!best || area < best.area) best = { area, ux, uz, mn0, mx0, mn1, mx1 };
  }
  return best;
}
function polyArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return a / 2; }

function styleFor(b, seed, area) {
  const t = b.t;
  if (b.shop) return 4;
  if (t === "church") return 6;
  if (["industrial", "warehouse", "commercial", "retail", "farm_auxiliary", "barn", "hangar", "factory", "service"].includes(t) || area > 700) return 5;
  if (["garage", "garages", "shed", "roof", "greenhouse", "carport", "hut"].includes(t) || area < 22) return 7;
  const r = seed;
  if (r < 0.5) return 0; if (r < 0.68) return 1; if (r < 0.8) return 3; if (r < 0.9) return 2; return 6;
}

export function buildBuildings(chunk, mats) {
  const W = { pos: [], uv: [], fs: [], idx: [] }, R = { pos: [], uv: [], rs: [], idx: [] };
  const wv = (x, y, z, u, v, st, sd) => { W.pos.push(x, y, z); W.uv.push(u, v); W.fs.push(st, sd); return W.pos.length / 3 - 1; };
  const rv = (x, y, z, u, v, k, sh) => { R.pos.push(x, y, z); R.uv.push(u, v); R.rs.push(k, sh); return R.pos.length / 3 - 1; };
  (chunk.f.bld || []).forEach((b, bi) => {
    const p = b.p, n = p.length / 2;
    let pts = []; for (let i = 0; i < n; i++) pts.push([p[i * 2], p[i * 2 + 1]]);
    let area = polyArea(pts);
    if (area < 0) { pts.reverse(); area = -area; }
    if (area < 4) return;
    const seed = hash((chunk.ci * 7919 + chunk.cj * 104729 + bi * 31) | 0);
    const style = styleFor(b, seed, area);
    const base = b.y - 0.4, pitch = b.h - b.e;
    const rect = minRect(pts);
    const rectFit = area / rect.area;
    const pitched = pitch > 1.0 && rectFit > 0.82 && area < 450 && style !== 5;
    const eave = b.y + (pitched ? b.e : Math.max(b.e, b.h * 0.92));
    const floorH = style === 5 ? 4 : 2.8;
    const roofKind = style === 5 ? 2 : pitched ? (seed > 0.72 || style === 3 || style === 2 ? 1 : 0) : 2;
    // walls
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 0.05) continue;
      const bays = Math.max(1, Math.round(L / 3.1));
      const st = L < 2.2 ? 7 : style;
      const v0 = (base - b.y) / floorH, v1 = (eave - b.y) / floorH;
      const k = wv(a[0], base, a[1], 0, v0, st, seed); wv(c[0], base, c[1], bays, v0, st, seed); wv(a[0], eave, a[1], 0, v1, st, seed); wv(c[0], eave, c[1], bays, v1, st, seed);
      W.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    if (pitched) {
      const { ux, uz, mn0, mx0, mn1, mx1 } = rect, o = 0.3;
      const along = mx0 - mn0 >= mx1 - mn1;
      // rectangle corners in (s, t) space, ridge along the long side
      const P = (s, t, y) => [s * ux - t * uz, y, s * uz + t * ux];
      const s0 = mn0 - o, s1 = mx0 + o, t0 = mn1 - o, t1 = mx1 + o, sm = (mn0 + mx0) / 2, tm = (mn1 + mx1) / 2;
      const top = b.y + b.h, ey = eave - (o * pitch) / Math.max(1, (along ? mx1 - mn1 : mx0 - mn0) / 2);
      const hip = seed > 0.6 || style === 2;
      const halfShort = (along ? mx1 - mn1 : mx0 - mn0) / 2;
      const inset = hip ? Math.min(halfShort, (along ? mx0 - mn0 : mx1 - mn1) / 2 - 0.5) : 0;
      let r0, r1; // ridge ends
      if (along) { r0 = P(mn0 + inset, tm, top); r1 = P(mx0 - inset, tm, top); } else { r0 = P(sm, mn1 + inset, top); r1 = P(sm, mx1 - inset, top); }
      const c00 = P(s0, t0, ey), c10 = P(s1, t0, ey), c11 = P(s1, t1, ey), c01 = P(s0, t1, ey);
      const sh = 0.9 + seed * 0.2;
      const tri = (A, B, Cc) => { const k = R.pos.length / 3; for (const q of [A, B, Cc]) { const u = q[0] * ux + q[2] * uz, v = -q[0] * uz + q[2] * ux; rv(q[0], q[1], q[2], u + v * 0.3, q[1] * 1.6 + (u - v) * 0.0, roofKind, sh); } R.idx.push(k, k + 1, k + 2); };
      const quad = (A, B, Cc, D) => { tri(A, B, Cc); tri(A, Cc, D); };
      // roof planes: uv uses distance along the eave and up the slope so the tiles run the right way
      const plane = (A, B, Cc, D, dirX, dirZ) => {
        const k = R.pos.length / 3;
        for (const q of [A, B, Cc, D]) { const u = q[0] * dirX + q[2] * dirZ, v = -q[0] * dirZ + q[2] * dirX; rv(q[0], q[1], q[2], u, v * 1.0 + q[1] * 0.5, roofKind, sh); }
        R.idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      };
      if (along) {
        plane(c00, c10, r1, r0, ux, uz); plane(c11, c01, r0, r1, ux, uz);
        if (hip) { tri(c10, c11, r1); tri(c01, c00, r0); }
      } else {
        plane(c10, c11, r1, r0, -uz, ux); plane(c01, c00, r0, r1, -uz, ux);
        if (hip) { tri(c11, c01, r1); tri(c00, c10, r0); }
      }
      if (!hip) {
        // gable ends in plain wall
        const g0 = along ? [P(mn0, mn1, eave), P(mn0, mx1, eave), P(mn0, tm, top)] : [P(mx0, mn1, eave), P(mn0, mn1, eave), P(sm, mn1, top)];
        const g1 = along ? [P(mx0, mx1, eave), P(mx0, mn1, eave), P(mx0, tm, top)] : [P(mn0, mx1, eave), P(mx0, mx1, eave), P(sm, mx1, top)];
        for (const gt of [g0, g1]) {
          const k = W.pos.length / 3, L = Math.hypot(gt[1][0] - gt[0][0], gt[1][2] - gt[0][2]);
          wv(gt[0][0], gt[0][1], gt[0][2], 0, 3.5, 7, seed); wv(gt[1][0], gt[1][1], gt[1][2], L / 3.1, 3.5, 7, seed); wv(gt[2][0], gt[2][1], gt[2][2], L / 6.2, 3.5 + pitch / 2.8, 7, seed);
          W.idx.push(k, k + 1, k + 2);
        }
      }
    } else {
      // flat roof with a little parapet lip
      const contour = pts.map((q) => new THREE.Vector2(q[0], q[1]));
      let tris = [];
      try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (_) { /* skip */ }
      const k = R.pos.length / 3;
      for (const q of pts) rv(q[0], eave + 0.05, q[1], q[0], q[1], roofKind, 0.9 + seed * 0.2);
      for (const t of tris) R.idx.push(k + t[0], k + t[2], k + t[1]);
    }
  });
  const out = [];
  if (W.idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(W.pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(W.uv, 2)); g.setAttribute("fs", new THREE.Float32BufferAttribute(W.fs, 2));
    g.setIndex(W.idx); const ng = g.toNonIndexed(); ng.computeVertexNormals(); ng.computeBoundingSphere();
    const m = new THREE.Mesh(ng, mats.wall); m.castShadow = m.receiveShadow = true; out.push(m);
  }
  if (R.idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(R.pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(R.uv, 2)); g.setAttribute("rs", new THREE.Float32BufferAttribute(R.rs, 2));
    g.setIndex(R.idx); const ng = g.toNonIndexed(); ng.computeVertexNormals(); ng.computeBoundingSphere();
    const m = new THREE.Mesh(ng, mats.roof); m.castShadow = m.receiveShadow = true; out.push(m);
  }
  return out;
}
