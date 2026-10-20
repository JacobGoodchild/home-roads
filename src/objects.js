// Street objects exactly where OpenStreetMap maps them: power poles and pylons (with their lines), give-way and stop
// signs, bus stops, traffic signals, post boxes, phone boxes, benches, grit bins, litter bins, bollards, gates,
// street lamps. Nothing is placed where the map has nothing. Sizes are standard UK defaults (the map has no sizes).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const M = {
  wood: new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8b9094, roughness: 0.5, metalness: 0.6 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2d3033, roughness: 0.6, metalness: 0.3 }),
  red: new THREE.MeshStandardMaterial({ color: 0xc3141b, roughness: 0.45 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xd9a514, roughness: 0.6 }),
  green: new THREE.MeshStandardMaterial({ color: 0x2f4a36, roughness: 0.7 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xddd6c8, emissive: 0xffc27a, emissiveIntensity: 0, roughness: 0.4 }),
  pool: new THREE.MeshBasicMaterial({ color: 0xffb877, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8 }),
};
export const objectMats = M;
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const cyl = (r0, r1, h, x = 0, y = 0, z = 0, seg = 8) => new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y + h / 2, z);

let SHAPES = null;
function shapes() {
  if (SHAPES) return SHAPES;
  const tri = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 3).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(0, 2.0, 0);
  const oct = new THREE.CylinderGeometry(0.38, 0.38, 0.04, 8).rotateX(Math.PI / 2).translate(0, 2.0, 0);
  SHAPES = {
    pole: [[mergeGeometries([cyl(0.13, 0.16, 9), box(1.6, 0.1, 0.1, 0, 8.4)]), M.wood]],
    tower: [[mergeGeometries([box(0.3, 26, 0.3, -1.6, 0, -1.6), box(0.3, 26, 0.3, 1.6, 0, -1.6), box(0.3, 26, 0.3, -1.6, 0, 1.6), box(0.3, 26, 0.3, 1.6, 0, 1.6), box(9, 0.3, 0.4, 0, 20), box(7, 0.3, 0.4, 0, 24), box(3.4, 0.2, 0.2, 0, 8), box(3.4, 0.2, 0.2, 0, 14)]), M.steel]],
    give_way: [[cyl(0.04, 0.04, 2, 0, 0, 0, 6), M.steel], [tri, M.red]],
    stop: [[cyl(0.04, 0.04, 2, 0, 0, 0, 6), M.steel], [oct, M.red]],
    sign: [[mergeGeometries([cyl(0.04, 0.04, 2.2, 0, 0, 0, 6), box(0.6, 0.6, 0.04, 0, 1.8)]), M.white]],
    bus_stop: [[cyl(0.05, 0.05, 2.8, 0, 0, 0, 6), M.steel], [box(0.5, 0.5, 0.05, 0, 2.3), M.red]],
    signals: [[cyl(0.07, 0.07, 3, 0, 0, 0, 6), M.dark], [box(0.32, 0.9, 0.25, 0, 2.2), M.dark]],
    post_box: [[mergeGeometries([cyl(0.27, 0.27, 1.45, 0, 0, 0, 16), new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.45, 0)]), M.red]],
    telephone: [[box(0.95, 2.5, 0.95), M.red]],
    bench: [[mergeGeometries([box(1.6, 0.06, 0.45, 0, 0.42), box(1.6, 0.4, 0.05, 0, 0.5, -0.22), box(0.06, 0.42, 0.4, -0.7), box(0.06, 0.42, 0.4, 0.7)]), M.wood]],
    grit_bin: [[box(0.8, 0.7, 0.6), M.yellow]],
    waste_basket: [[cyl(0.22, 0.22, 0.85, 0, 0, 0, 10), M.dark]],
    recycling: [[box(1.6, 1.4, 1.2), M.green]],
    bollard: [[cyl(0.1, 0.1, 0.9, 0, 0, 0, 8), M.dark]],
    block: [[box(0.6, 0.6, 0.6), M.white]],
    gate: [[mergeGeometries([box(3.2, 0.08, 0.06, 0, 0.35), box(3.2, 0.08, 0.06, 0, 0.7), box(3.2, 0.08, 0.06, 0, 1.05), box(0.12, 1.2, 0.12, -1.65), box(0.12, 1.2, 0.12, 1.65)]), M.wood]],
    stile: [[box(1.2, 0.08, 0.3, 0, 0.45), M.wood]],
    cycle_barrier: [[box(1.5, 1.0, 0.06), M.steel]],
    lamp: [[cyl(0.06, 0.09, 7), M.steel], [box(0.28, 0.12, 0.6, 0, 6.9, 0.3), M.lamp]],
  };
  return SHAPES;
}
const tmp = new THREE.Object3D();

export function buildObjects(chunk, heightAt, roadAt) {
  const S = shapes(), byKind = {};
  for (const o of chunk.f.obj || []) {
    const [k, x, z] = o;
    if (!S[k]) continue;
    let px = x, pz = z, h = 0;
    const r = roadAt(x, z);
    if (r.seg) {
      h = r.h;
      // signs mapped on the road's centre line stand at the kerb (left side, facing traffic, as in the UK)
      if (["give_way", "stop", "sign", "signals", "bus_stop"].includes(k) && r.d < 0) {
        const s = r.seg, o2 = s.hw + 0.6, nx = Math.cos(h), nz = -Math.sin(h);
        const side = o[3] === "backward" ? -1 : 1;
        px = x + nx * o2 * side; pz = z + nz * o2 * side; if (side < 0) h += Math.PI;
      }
    }
    (byKind[k] = byKind[k] || []).push([px, pz, h]);
  }
  const out = [];
  for (const k in byKind) {
    const list = byKind[k];
    for (const [geo, mat] of S[k]) {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, h], i) => { tmp.position.set(x, heightAt(x, z), z); tmp.rotation.set(0, h, 0); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); });
      m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere();
      out.push(m);
    }
  }
  return out;
}

// Power lines along the mapped routes, from pole top to pole top with a little sag.
export function buildPower(power, heightAt) {
  const pos = [];
  for (const l of power) {
    const p = l.p, top = l.k ? 23.5 : 8.4, arms = l.k ? [-4.2, -1.4, 1.4, 4.2] : [-0.7, 0, 0.7];
    for (let i = 0; i + 3 < p.length; i += 3) {
      const ax = p[i], az = p[i + 1], ay = p[i + 2] + top, bx = p[i + 3], bz = p[i + 4], by = p[i + 5] + top;
      const L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L, sag = Math.min(3, L * 0.012), K = 8;
      for (const o of arms) for (let s = 0; s < K; s++) {
        const f0 = s / K, f1 = (s + 1) / K;
        const y0 = ay + (by - ay) * f0 - sag * 4 * f0 * (1 - f0), y1 = ay + (by - ay) * f1 - sag * 4 * f1 * (1 - f1);
        pos.push(ax + (bx - ax) * f0 + nx * o, y0, az + (bz - az) * f0 + nz * o, ax + (bx - ax) * f1 + nx * o, y1, az + (bz - az) * f1 + nz * o);
      }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.7 }));
}
