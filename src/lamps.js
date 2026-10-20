// Street lights: the ones mapped in OpenStreetMap plus lamp posts every ~35 m along town roads with pavements.
// Instanced posts, glowing heads at night and a soft pool of light on the ground (no real lights: cheap on phones).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { softDot } from "./textures.js";

let geos = null;
export function lampMaterials() {
  return {
    lampPole: new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.6, metalness: 0.5 }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0xddd6c8, emissive: 0xffc27a, emissiveIntensity: 0, roughness: 0.4 }),
    lampPool: new THREE.MeshBasicMaterial({ map: softDot("255,190,120"), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8 }),
  };
}
function getGeos() {
  if (geos) return geos;
  const pole = new THREE.CylinderGeometry(0.06, 0.09, 7, 6); pole.translate(0, 3.5, 0);
  const arm = new THREE.BoxGeometry(0.08, 0.08, 1.2); arm.translate(0, 6.95, 0.55);
  const head = new THREE.BoxGeometry(0.28, 0.12, 0.6); head.translate(0, 6.9, 1.15);
  const pool = new THREE.PlaneGeometry(14, 14); pool.rotateX(-Math.PI / 2); pool.translate(0, 0.15, 1.5);
  geos = { pole: mergeGeometries([pole, arm]), head, pool };
  return geos;
}
const tmp = new THREE.Object3D();

export function buildLamps(c, heightAt, mats) {
  const spots = [];
  const L = c.f.lamps || [];
  for (let i = 0; i < L.length; i += 2) spots.push([L[i], L[i + 1], null]);
  // along roads with pavements: every 35 m, alternating sides, arm reaching over the road
  for (const r of c.f.roads || []) {
    if (!r.s || r.b) continue;
    const p = r.p; let acc = 17, side = 1;
    for (let i = 4; i < p.length; i += 4) {
      const ax = p[i - 4], az = p[i - 3], bx = p[i], bz = p[i + 1], d = Math.hypot(bx - ax, bz - az);
      if (d < 0.01) continue;
      acc += d;
      if (acc >= 35 && !(p[i + 3] & 4)) {
        acc = 0; side = -side;
        const nx = (bz - az) / d, nz = -(bx - ax) / d, o = r.w / 2 + 1.5;
        spots.push([bx + nx * o * side, bz + nz * o * side, Math.atan2(-nx * side, -nz * side)]);
      }
    }
  }
  if (!spots.length) return [];
  const G = getGeos();
  const pole = new THREE.InstancedMesh(G.pole, mats.lampPole, spots.length), head = new THREE.InstancedMesh(G.head, mats.lampHead, spots.length), pool = new THREE.InstancedMesh(G.pool, mats.lampPool, spots.length);
  spots.forEach(([x, z, h], k) => {
    tmp.position.set(x, heightAt(x, z), z); tmp.rotation.set(0, h ?? 0, 0); tmp.scale.set(1, 1, 1); tmp.updateMatrix();
    pole.setMatrixAt(k, tmp.matrix); head.setMatrixAt(k, tmp.matrix); pool.setMatrixAt(k, tmp.matrix);
  });
  for (const m of [pole, head, pool]) m.computeBoundingSphere();
  pole.castShadow = true;
  return [pole, head, pool];
}
