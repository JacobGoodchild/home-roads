// Parked cars along the kerbs of town streets, and lamp posts along the pavements. Neither is in the map data, so
// both are styled defaults (see CLAUDE.md): placed deterministically from the real roads (left-hand kerb of town
// roads with pavements, clear of junctions), so they are always in the same places.
// The cars are generic hatchbacks/estates built with Apex Ring's car body generator (original shapes, no brands),
// merged per material and instanced, so ~4 variants x a few materials draw calls in total.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeCar } from "./carmodel.js";

function hash(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }

// spots along roads in a chunk: [x, z, heading, variant, colour]
export function parkingSpots(chunk, keepClear = []) {
  const out = [], lamps = [];
  for (const r of chunk.f.roads || []) {
    if (!r.s || r.b || r.w < 5 || r.r > 6) continue;
    const p = r.p; let acc = 0, lacc = 12;
    for (let i = 4; i < p.length; i += 4) {
      const ax = p[i - 4], az = p[i - 3], bx = p[i], bz = p[i + 1], d = Math.hypot(bx - ax, bz - az);
      if (d < 0.01) continue;
      const h = Math.atan2(bx - ax, bz - az), lx = Math.cos(h), lz = -Math.sin(h);
      for (let s = acc; s < d; s += 5.6) {
        const f = s / d, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
        if ((p[i - 1] & 4) || (p[i + 3] & 4)) continue;
        for (const side of [1, -1]) {
          const k = hash((Math.round(x * 4) * 7919) ^ (Math.round(z * 4) * 104729) ^ (side > 0 ? 1 : 77));
          if (k < 0.5 || keepClear.some((c) => Math.hypot(c.x - x, c.z - z) < 35)) continue;
          const o = r.w / 2 - 1.05;
          out.push([x + lx * o * side, z + lz * o * side, side > 0 ? h : h + Math.PI, Math.floor(k * 997) % 4, Math.floor(k * 7919) % 7]);
        }
      }
      acc = (acc + 5.6 - (d % 5.6)) % 5.6;
      lacc += d;
      if (lacc > 32 && !(p[i + 3] & 4)) { lacc = 0; const o = r.w / 2 + 0.55, side = Math.floor(i / 4) % 2 ? 1 : -1; lamps.push([bx + lx * o * side, bz + lz * o * side, side > 0 ? h - Math.PI / 2 : h + Math.PI / 2]); }
    }
  }
  return { cars: out, lamps };
}

const VARIANTS = [
  { id: "hatch", shape: { len: 4.0, wid: 0.92, n: 3.0, tumble: 0.85, bulge: 0.0, waist: 0.98, nose: 0.62, hood: 0.84, deck: 1.22, tail: 1.18, cabinZ: -0.25, cabinLen: 2.45, cabinH: 1.48, cabinW: 0.78, wing: "none", wheelR: 0.31, intake: false, splitter: false, lights: 1 } },
  { id: "estate", shape: { len: 4.6, wid: 0.95, n: 3.0, tumble: 0.86, bulge: 0.0, waist: 0.98, nose: 0.64, hood: 0.86, deck: 1.24, tail: 1.2, cabinZ: -0.45, cabinLen: 2.9, cabinH: 1.45, cabinW: 0.78, wing: "none", wheelR: 0.32, intake: false, splitter: false, lights: 0 } },
  { id: "suv", shape: { len: 4.5, wid: 1.0, n: 3.4, tumble: 0.88, bulge: 0.02, waist: 1.0, nose: 0.8, hood: 1.0, deck: 1.4, tail: 1.36, cabinZ: -0.35, cabinLen: 2.7, cabinH: 1.68, cabinW: 0.8, wing: "none", wheelR: 0.36, intake: false, splitter: false, lights: 2 } },
  { id: "saloon", shape: { len: 4.7, wid: 0.95, n: 3.0, tumble: 0.8, bulge: 0.0, waist: 0.97, nose: 0.6, hood: 0.8, deck: 1.0, tail: 0.98, cabinZ: -0.15, cabinLen: 2.4, cabinH: 1.38, cabinW: 0.76, wing: "none", wheelR: 0.32, intake: false, splitter: false, lights: 1 } },
];
const COLOURS = [0xb8bcc0, 0x1a1c20, 0x2b3550, 0x8a1a1e, 0xe8e8e6, 0x5a5e62, 0x40505a];

let built = null;
// For each variant: a list of [geometry, material] with everything merged per material (paint shared, recoloured per instance).
function variants() {
  if (built) return built;
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.45 });
  built = VARIANTS.map((v) => {
    const model = makeCar({ id: v.id, doors: "none", shape: v.shape }, 0xffffff, 0, 0);
    model.group.updateMatrixWorld(true);
    const byMat = new Map();
    const wheelPos = model.wheels.map((w) => new THREE.Vector3().setFromMatrixPosition(w.matrixWorld));
    const skip = new Set(); model.wheels.forEach((w) => w.parent.traverse((o) => skip.add(o)));
    model.group.traverse((o) => {
      if (!o.isMesh || !o.visible || skip.has(o) || (o.material && o.material.transparent)) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const mat = o.material === model.paint ? paint : o.material;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push(g.index ? g.toNonIndexed() : g);
    });
    // simple wheels (a parked car's wheels don't need spokes)
    const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const r = v.shape.wheelR || 0.32;
    byMat.set(tyre, wheelPos.map((p) => new THREE.CylinderGeometry(r, r, 0.22, 14).rotateZ(Math.PI / 2).translate(p.x, p.y, p.z).toNonIndexed()));
    return [...byMat.entries()].map(([m, gs]) => [mergeGeometries(gs), m]);
  });
  return built;
}

const tmp = new THREE.Object3D(), col = new THREE.Color();
let poolTex = null;
export function buildParked(spots, heightAt, lampMat, poolMat) {
  const V = variants(), out = [];
  for (let vi = 0; vi < V.length; vi++) {
    const list = spots.cars.filter((s) => s[3] === vi);
    if (!list.length) continue;
    for (const [geo, mat] of V[vi]) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, h, , c], k) => {
        tmp.position.set(x, heightAt(x, z) + 0.05, z); tmp.rotation.set(0, h, 0); tmp.updateMatrix(); im.setMatrixAt(k, tmp.matrix);
        if (mat.color && mat.metalness > 0.4 && mat.roughness < 0.4) { col.setHex(COLOURS[c]); im.setColorAt(k, col); }
      });
      im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); out.push(im);
    }
  }
  if (spots.lamps.length) {
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 6, 8).translate(0, 3, 0);
    const arm = new THREE.TorusGeometry(0.45, 0.04, 6, 12, Math.PI / 2).rotateY(Math.PI / 2).translate(0, 5.55, 0.45);
    const head = new THREE.CylinderGeometry(0.12, 0.28, 0.32, 8).translate(0, 5.82, 0.9);
    const black = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.4 });
    for (const [g, m] of [[mergeGeometries([pole, arm]), black], [head, lampMat]]) {
      const im = new THREE.InstancedMesh(g, m, spots.lamps.length);
      spots.lamps.forEach(([x, z, h], k) => { tmp.position.set(x, heightAt(x, z), z); tmp.rotation.set(0, h, 0); tmp.updateMatrix(); im.setMatrixAt(k, tmp.matrix); });
      im.castShadow = true; im.computeBoundingSphere(); out.push(im);
    }
    // a soft pool of lamplight on the ground (visible at night)
    if (!poolTex) { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.5, "rgba(255,255,255,.35)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); poolTex = new THREE.CanvasTexture(c); }
    poolMat.map = poolTex;
    const pg = new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2).translate(0, 0.2, 1);
    const pm = new THREE.InstancedMesh(pg, poolMat, spots.lamps.length);
    spots.lamps.forEach(([x, z, h], k) => { tmp.position.set(x, heightAt(x, z), z); tmp.rotation.set(0, h, 0); tmp.updateMatrix(); pm.setMatrixAt(k, tmp.matrix); });
    pm.computeBoundingSphere(); out.push(pm);
  }
  return out;
}
