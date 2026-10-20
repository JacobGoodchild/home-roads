// Road, pavement, bridge, railway and water meshes from the baked OpenStreetMap ways.
// Roads are ribbons at their real (OSM or typical UK) width, sitting on LIDAR heights, with UK markings drawn in
// the shader (dashed centre lines, edge lines on B roads), raised kerbs and paved footways in town.
import * as THREE from "three";
import { photo } from "./photo.js";

export function roadMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const tA = photo("asphalt"), tG = photo("gravel");
  mat.userData.uniforms = { wet: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.uniforms, { tA: { value: tA }, tG: { value: tG } });
    sh.vertexShader = "attribute vec4 rd; varying vec4 vRd; varying vec3 vWP;\n" + sh.vertexShader
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vRd = rd; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = "uniform sampler2D tA, tG; uniform float wet; varying vec4 vRd; varying vec3 vWP;\n" + sh.fragmentShader
      .replace("#include <map_fragment>", `
        // rd: x = across (m from centre), y = along (m), z = width, w = markings (0 none, 1 centre dashes, 2 + edge lines, 3 gravel)
        vec2 wp = vWP.xz;
        vec3 a = texture2D(tA, wp * 0.18).rgb * 0.62 + texture2D(tA, wp * 0.031).rgb * 0.4;
        a *= 0.82;
        float wear = smoothstep(0.35, 0.0, abs(abs(vRd.x) - vRd.z * 0.25)) * 0.12;   // darker tyre tracks
        a *= 1.0 - wear;
        if (vRd.w > 2.5) a = texture2D(tG, wp * 0.3).rgb * vec3(0.95, 0.9, 0.8);
        // darker, dirtier gutter by the kerb; repair patches; slightly polished wheel paths
        float gut = smoothstep(vRd.z * 0.5 - 0.45, vRd.z * 0.5 - 0.05, abs(vRd.x));
        a = mix(a, a * vec3(0.72, 0.7, 0.66), gut * 0.7);
        vec2 pc = floor(vec2(vRd.y / 4.0, (vRd.x + 10.0) / 1.6));
        float ph = fract(sin(dot(pc, vec2(12.9898, 78.233))) * 43758.5453);
        vec2 pf = fract(vec2(vRd.y / 4.0, (vRd.x + 10.0) / 1.6));
        float patchM = step(0.93, ph) * step(0.08, pf.x) * step(pf.x, 0.92) * step(0.1, pf.y) * step(pf.y, 0.9);
        a = mix(a, a * 0.78 + vec3(0.01), patchM);
        float m = 0.0;
        if (vRd.w > 0.5 && vRd.w < 2.5) {
          float dash = step(fract(vRd.y / 9.0), 0.34);
          m = max(m, (1.0 - smoothstep(0.05, 0.075, abs(vRd.x))) * dash);
        }
        if (vRd.w > 1.5 && vRd.w < 2.5) m = max(m, 1.0 - smoothstep(0.05, 0.07, abs(abs(vRd.x) - (vRd.z * 0.5 - 0.35))));
        a = mix(a, vec3(0.86, 0.86, 0.82), m * 0.9);
        diffuseColor.rgb *= a;
      `)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.18, wet);");
  };
  mat.customProgramCacheKey = () => "road1";
  return mat;
}

export function paveMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: photo("paving", { repeat: [1, 1] }), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  return m;
}
export function stoneMaterial() { return new THREE.MeshStandardMaterial({ map: photo("concrete"), color: 0xc8c0b0, roughness: 0.95 }); }

// Offset a polyline sideways (per-point normals averaged at the joints).
function frames(p, stride) {
  const n = p.length / stride, out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = p[b * stride] - p[a * stride], dz = p[b * stride + 1] - p[a * stride + 1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    out.push([dz, -dx, dx, dz]); // right-hand normal (nx, nz) and tangent
  }
  return out;
}

class GeoBuf {
  constructor(extra) { this.pos = []; this.uv = []; this.idx = []; this.ex = extra ? [] : null; this.nor = []; }
  v(x, y, z, u, w, e, nx = 0, ny = 1, nz = 0) { this.pos.push(x, y, z); this.uv.push(u, w); this.nor.push(nx, ny, nz); if (this.ex) this.ex.push(...e); return this.pos.length / 3 - 1; }
  quad(a, b, c, d) { this.idx.push(a, c, b, b, c, d); }
  build(exName = "rd", exSize = 4) {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.ex) g.setAttribute(exName, new THREE.Float32BufferAttribute(this.ex, exSize));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Build the road meshes for one chunk. heightAt(x, z) gives the bare ground for the road edges.
export function buildRoads(chunk, heightAt, mats) {
  const road = new GeoBuf(true), pave = new GeoBuf(false), stone = new GeoBuf(false);
  for (const r of chunk.f.roads || []) {
    const p = r.p, n = p.length / 4, hw = r.w / 2, fr = frames(p, 4);
    const mk = r.g ? 3 : 0;
    let along = 0, prev = -1, prevP = [-1, -1];
    const ys = [], al = [];
    for (let i = 0; i < n; i++) {
      const x = p[i * 4], z = p[i * 4 + 1], y = p[i * 4 + 2], f = fr[i];
      if (i) along += Math.hypot(x - p[i * 4 - 4], z - p[i * 4 - 3]);
      const lx = x - f[0] * hw, lz = z - f[1] * hw, rx = x + f[0] * hw, rz = z + f[1] * hw;
      let yl = y, yr = y;
      if (!r.b) { yl = Math.max(y, heightAt(lx, lz) - 0.05); yr = Math.max(y, heightAt(rx, rz) - 0.05); }
      ys.push([yl, yr]); al.push(along);
      const marks = mk || (p[i * 4 + 3] & 3);
      const a = road.v(lx, yl + 0.05, lz, 0, along, [-hw, along, r.w, marks]);
      road.v(rx, yr + 0.05, rz, 1, along, [hw, along, r.w, marks]);
      if (prev >= 0) road.quad(prev, prev + 1, a, a + 1);
      prev = a;
    }
    // round caps fill junction corners
    for (const i of [0, n - 1]) {
      const x = p[i * 4], z = p[i * 4 + 1], y = p[i * 4 + 2] + 0.045, c = road.v(x, y, z, 0.5, 0, [0, 0, r.w, mk]);
      const K = 10; let first = -1, last = -1;
      for (let k = 0; k <= K; k++) {
        const a = (k / K) * Math.PI * 2, ex = x + Math.cos(a) * hw, ez = z + Math.sin(a) * hw;
        const v = road.v(ex, Math.max(y, r.b ? y : heightAt(ex, ez) - 0.05 + 0.045), ez, 0, 0, [hw, 0, r.w, mk]);
        if (last >= 0) road.idx.push(c, v, last); else first = v;
        last = v;
      }
    }
    // pavements with a kerb, broken at junctions
    if (r.s) for (const side of [-1, 1]) {
      if ((side < 0 && !(r.s & 1)) || (side > 0 && !(r.s & 2))) continue;
      let pv = -1;
      for (let i = 0; i < n; i++) {
        const x = p[i * 4], z = p[i * 4 + 1], f = fr[i], near = p[i * 4 + 3] & 4;
        if (near) { pv = -1; continue; }
        const yE = ys[i][side < 0 ? 0 : 1] + 0.05;
        const ix = x + side * f[0] * hw, iz = z + side * f[1] * hw, ox = x + side * f[0] * (hw + 1.9), oz = z + side * f[1] * (hw + 1.9);
        const yT = Math.max(yE + 0.13, r.b ? 0 : heightAt(ox, oz) + 0.04);
        const v = al[i] / 1.5;
        const k0 = pave.v(ix, yE - 0.02, iz, 0, v);
        pave.v(ix, yE + 0.13, iz, 0.1, v);
        pave.v(ix, yE + 0.13, iz, 0.1, v);
        pave.v(ox, yT, oz, 1.37, v);
        if (pv >= 0) { if (side > 0) { pave.quad(pv, pv + 1, k0, k0 + 1); pave.quad(pv + 2, pv + 3, k0 + 2, k0 + 3); } else { pave.quad(k0, k0 + 1, pv, pv + 1); pave.quad(k0 + 2, k0 + 3, pv + 2, pv + 3); } }
        pv = k0;
      }
    }
    // bridge parapets and deck edge
    if (r.b) for (const side of [-1, 1]) {
      let pv = -1;
      for (let i = 0; i < n; i++) {
        const x = p[i * 4], z = p[i * 4 + 1], y = p[i * 4 + 2], f = fr[i], o = hw + 0.35;
        const ex = x + side * f[0] * o, ez = z + side * f[1] * o;
        const a = stone.v(ex, y - 1.4, ez, along / 2, 0, null, side * f[0], 0, side * f[1]);
        stone.v(ex, y + 1.0, ez, along / 2, 1.2, null, side * f[0], 0, side * f[1]);
        if (pv >= 0) side > 0 ? stone.quad(pv, pv + 1, a, a + 1) : stone.quad(a, a + 1, pv, pv + 1);
        pv = a;
      }
    }
  }
  const out = [];
  const g1 = road.build(); if (g1) { const m = new THREE.Mesh(g1, mats.road); m.receiveShadow = true; out.push(m); }
  const g2 = pave.build(); if (g2) { g2.computeVertexNormals(); const m = new THREE.Mesh(g2, mats.pave); m.receiveShadow = true; out.push(m); }
  const g3 = stone.build(); if (g3) { g3.computeVertexNormals(); const m = new THREE.Mesh(g3, mats.stone); m.castShadow = m.receiveShadow = true; out.push(m); }
  return out;
}

// Railway: ballast bed with sleepers drawn in the shader, and two steel rails per track.
export function buildRail(rail) {
  const bed = new GeoBuf(false), steel = new GeoBuf(false);
  for (const r of rail) {
    const p = r.p, n = p.length / 3, fr = frames(p, 3);
    let along = 0, pb = -1, ps = [-1, -1];
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], z = p[i * 3 + 1], y = p[i * 3 + 2] + 0.05, f = fr[i];
      if (i) along += Math.hypot(x - p[i * 3 - 3], z - p[i * 3 - 2]);
      const a = bed.v(x - f[0] * 2.4, y - 0.15, z - f[1] * 2.4, 0, along);
      bed.v(x - f[0] * 1.6, y + 0.25, z - f[1] * 1.6, 0.15, along);
      bed.v(x + f[0] * 1.6, y + 0.25, z + f[1] * 1.6, 0.85, along);
      bed.v(x + f[0] * 2.4, y - 0.15, z + f[1] * 2.4, 1, along);
      if (pb >= 0) for (let k = 0; k < 3; k++) bed.quad(pb + k, pb + k + 1, a + k, a + k + 1);
      pb = a;
      ["l", "r"].forEach((_, s) => {
        const o = s ? 0.72 : -0.72, rx = x + f[0] * o, rz = z + f[1] * o;
        const b = steel.v(rx - f[0] * 0.04, y + 0.42, rz - f[1] * 0.04, 0, along);
        steel.v(rx + f[0] * 0.04, y + 0.42, rz + f[1] * 0.04, 1, along);
        steel.v(rx + f[0] * 0.04, y + 0.27, rz + f[1] * 0.04, 1, along);
        if (ps[s] >= 0) { steel.quad(ps[s], ps[s] + 1, b, b + 1); steel.quad(ps[s] + 1, ps[s] + 2, b + 1, b + 2); }
        ps[s] = b;
      });
    }
  }
  const bedMat = new THREE.MeshStandardMaterial({ map: photo("gravel"), color: 0x9a8f84, roughness: 1 });
  bedMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `
      vec4 sampledDiffuseColor = texture2D(map, vec2(vMapUv.x * 1.6, vMapUv.y * 0.4));
      float sl = step(0.62, fract(vMapUv.y / 0.65)) * step(0.12, vMapUv.x) * step(vMapUv.x, 0.88);
      sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(0.32, 0.27, 0.22), sl * 0.85);
      diffuseColor *= sampledDiffuseColor;`);
  };
  const out = new THREE.Group();
  const g = bed.build(); if (g) { g.computeVertexNormals(); const m = new THREE.Mesh(g, bedMat); m.receiveShadow = true; out.add(m); }
  const s = steel.build(); if (s) { s.computeVertexNormals(); out.add(new THREE.Mesh(s, new THREE.MeshStandardMaterial({ color: 0x8a8580, metalness: 0.8, roughness: 0.35 }))); }
  return out;
}

// River Test, lakes and streams: real outlines from OSM, surface heights from the LIDAR along the banks.
export function buildWater(water, streams, mat) {
  const pos = [], idx = [];
  for (const w of water) {
    for (const ring of w.o) {
      const pts = [];
      for (let i = 0; i < ring.length; i += 3) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
      const ys = [], al = []; for (let i = 0; i < ring.length; i += 3) ys.push(ring[i + 2]);
      const holes = w.i.map((h) => { const a = []; for (let i = 0; i < h.length; i += 3) a.push(new THREE.Vector2(h[i], h[i + 1])); return a; });
      const holeYs = w.i.map((h) => { const a = []; for (let i = 0; i < h.length; i += 3) a.push(h[i + 2]); return a; });
      let tris;
      try { tris = THREE.ShapeUtils.triangulateShape(pts, holes); } catch (_) { continue; }
      const all = pts.concat(...holes), allY = ys.concat(...holeYs);
      const base = pos.length / 3;
      // a big polygon spans a long stretch of river: smooth the bank heights so the surface doesn't ripple
      for (let i = 0; i < all.length; i++) pos.push(all[i].x, allY[i] - 0.25, all[i].y);
      for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1]);
    }
  }
  for (const s of streams) {
    const p = s.p, n = p.length / 3, fr = frames(p, 3), hw = s.w / 2;
    let pv = -1;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], z = p[i * 3 + 1], y = p[i * 3 + 2] - 0.2, f = fr[i];
      pos.push(x - f[0] * hw, y, z - f[1] * hw, x + f[0] * hw, y, z + f[1] * hw);
      const a = pos.length / 3 - 2;
      if (pv >= 0) idx.push(pv, a, pv + 1, pv + 1, a, a + 1);
      pv = a;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.attributes.normal.array; for (let i = 0; i < nor.length; i += 3) { nor[i] = 0; nor[i + 1] = 1; nor[i + 2] = 0; }
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

export function waterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1e2f2c, roughness: 0.06, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  mat.userData.uniforms = { time: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.vertexShader = "varying vec3 vWP;\n" + sh.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = "uniform float time; varying vec3 vWP;\n" + sh.fragmentShader.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      vec2 q = vWP.xz;
      vec3 rip = vec3(sin(q.x * 1.3 + time * 1.7) * 0.5 + sin(q.y * 2.1 - time * 1.3 + q.x * 0.7) * 0.5, 0.0, cos(q.y * 1.1 + time * 1.5) * 0.5 + sin(q.x * 2.7 + q.y * 0.9 + time * 2.1) * 0.4);
      normal = normalize(normal + (viewMatrix * vec4(rip * 0.06, 0.0)).xyz);`);
  };
  return mat;
}
