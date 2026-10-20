// Trees, bushes and hedges. Tree positions, heights and crown sizes come straight from the LIDAR canopy
// (local peaks of surface-minus-ground), so every tree, copse, wood and hedgerow tree stands where it really is.
// Drawn as instanced meshes per chunk: two crown shapes (broadleaf, conifer), with a cheaper crown further away.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { photo } from "./photo.js";

function hash(n) { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }

// lumpy crown: a few displaced spheres merged (unit: height 0..1, radius ~1)
function crownGeo(detail, seed, conifer) {
  const parts = [];
  if (conifer) {
    for (let k = 0; k < 3; k++) {
      const g = new THREE.ConeGeometry(1 - k * 0.22, 0.45, detail ? 9 : 6, 1); g.translate(0, 0.35 + k * 0.2, 0); parts.push(g);
    }
  } else {
    const blobs = detail ? [[0.2, 0.66, 0.1, 0.58], [-0.28, 0.64, -0.15, 0.52]] : [[0, 0.63, 0, 0.7]];
    blobs.forEach(([x, y, z, r], i) => {
      const g = new THREE.IcosahedronGeometry(r, detail ? 1 : 0);
      const p = g.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const px = p.getX(v), py = p.getY(v), pz = p.getZ(v);
        const n = 1 + 0.16 * Math.sin(px * 9 + seed + i) * Math.sin(py * 8 + i * 2) * Math.sin(pz * 10 + seed);
        p.setXYZ(v, px * n * 1.25, py * n * (detail ? 0.75 : 0.85), pz * n * 1.25);
      }
      g.translate(x * 1.1, y, z * 1.1); parts.push(g);
    });
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  g.computeVertexNormals();
  // stretch radius so a scale of (r, h, r) gives the right size
  return g;
}
function trunkGeo() { const g = new THREE.CylinderGeometry(0.035, 0.06, 0.6, 6, 1, true); g.translate(0, 0.3, 0); return g; }

let shared = null;
function getShared() {
  if (shared) return shared;
  const leaf = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  leaf.onBeforeCompile = (sh) => {
    sh.vertexShader = "varying vec3 vOP;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vOP = position;");
    sh.fragmentShader = `varying vec3 vOP;
      float hsh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hsh(i), hsh(i+vec3(1,0,0)), f.x), mix(hsh(i+vec3(0,1,0)), hsh(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hsh(i+vec3(0,0,1)), hsh(i+vec3(1,0,1)), f.x), mix(hsh(i+vec3(0,1,1)), hsh(i+vec3(1,1,1)), f.x), f.y), f.z); }
      ` + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
        float l = vn(vOP * 14.0) * 0.6 + vn(vOP * 40.0) * 0.4;
        diffuseColor.rgb *= (0.55 + 0.75 * l) * (0.55 + 0.6 * smoothstep(0.2, 1.0, vOP.y));`);
  };
  leaf.customProgramCacheKey = () => "leaf1";
  const bark = new THREE.MeshStandardMaterial({ map: photo("bark", { repeat: [2, 2] }), roughness: 1 });
  shared = {
    leaf, bark,
    crown: [crownGeo(true, 1.3, false), crownGeo(true, 4.1, false)], crownLo: crownGeo(false, 2, false),
    conifer: crownGeo(true, 0, true), coniferLo: crownGeo(false, 0, true),
    trunk: trunkGeo(),
    bush: (() => { const g = new THREE.IcosahedronGeometry(1, 1); g.scale(1, 0.75, 1); g.translate(0, 0.5, 0); return g; })(),
  };
  return shared;
}

// October in Hampshire: mostly green, some turning yellow, orange and brown
const LEAF = [0x3f5a28, 0x4a6a2e, 0x55702f, 0x3a5426, 0x6b7a30, 0x8a7a2a, 0x9a6a26, 0x7a5a2a, 0x47612b];
const CONIFER = [0x24382a, 0x2c4130, 0x30442a];
const tmp = new THREE.Object3D(), col = new THREE.Color();

export function buildTrees(chunk, heightAt, near, density = 1) {
  const S = getShared();
  const t = chunk.f.trees || [], n = t.length / 4;
  const pick = [];
  for (let i = 0; i < n; i++) if (density >= 1 || hash(i * 13 + chunk.ci * 7 + chunk.cj) < density) pick.push(i);
  const out = [];
  if (pick.length) {
    const seedOf = (i) => hash((Math.round(t[i * 4] * 10) * 73856093) ^ (Math.round(t[i * 4 + 1] * 10) * 19349663));
    const groups = near ? [[], [], []] : [[], []];
    for (const i of pick) {
      const s = seedOf(i), h = t[i * 4 + 2];
      const con = s < 0.08 && h > 8;
      groups[con ? groups.length - 1 : near ? (s < 0.54 ? 0 : 1) : 0].push(i);
    }
    const geos = near ? [S.crown[0], S.crown[1], S.conifer] : [S.crownLo, S.coniferLo];
    groups.forEach((g, gi) => {
      if (!g.length) return;
      const con = gi === groups.length - 1;
      const crown = new THREE.InstancedMesh(geos[gi], S.leaf, g.length);
      g.forEach((i, k) => {
        const x = t[i * 4], z = t[i * 4 + 1], h = Math.max(3, t[i * 4 + 2]), r = Math.max(1.2, t[i * 4 + 3]) * (con ? 0.55 : 0.82), s = seedOf(i);
        const y = heightAt(x, z);
        tmp.position.set(x, y + (con ? 0 : h * 0.06), z); tmp.rotation.set(0, s * 6.28, 0);
        const ch = con ? h : h * 0.94, cr = Math.min(r, ch * 0.75);
        tmp.scale.set(cr, ch, cr); tmp.updateMatrix(); crown.setMatrixAt(k, tmp.matrix);
        col.setHex(con ? CONIFER[(s * 31 * CONIFER.length | 0) % CONIFER.length] : LEAF[(s * 97 * LEAF.length | 0) % LEAF.length]).multiplyScalar(0.85 + hash(i) * 0.3);
        crown.setColorAt(k, col);
      });
      crown.castShadow = true; crown.receiveShadow = true;
      crown.computeBoundingSphere();
      out.push(crown);
    });
    if (near) {
      const trunks = new THREE.InstancedMesh(S.trunk, S.bark, pick.length);
      pick.forEach((i, k) => {
        const x = t[i * 4], z = t[i * 4 + 1], h = Math.max(3, t[i * 4 + 2]);
        tmp.position.set(x, heightAt(x, z) - 0.2, z); tmp.rotation.set(0, 0, 0); tmp.scale.set(h * 0.9, h, h * 0.9); tmp.updateMatrix(); trunks.setMatrixAt(k, tmp.matrix);
      });
      trunks.computeBoundingSphere();
      out.push(trunks);
    }
  }
  // bushes and hedgerow shrubs from the LIDAR (1-3 m high)
  const b = chunk.f.bush || [], nb = b.length / 3;
  if (nb && near) {
    const m = new THREE.InstancedMesh(S.bush, S.leaf, nb);
    for (let i = 0; i < nb; i++) {
      const x = b[i * 3], z = b[i * 3 + 1], h = b[i * 3 + 2], s = hash(i * 7 + 3);
      tmp.position.set(x, heightAt(x, z) - 0.1, z); tmp.rotation.set(0, s * 6.28, 0); tmp.scale.set(h * 0.8 + 0.4, h, h * 0.8 + 0.4); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix);
      col.setHex(LEAF[(s * 53 * LEAF.length | 0) % 5]).multiplyScalar(0.8 + s * 0.3); m.setColorAt(i, col);
    }
    m.receiveShadow = true; m.computeBoundingSphere(); out.push(m);
  }
  // mapped hedges: a leafy wall along the line
  const hed = chunk.f.hedges || [];
  if (hed.length && near) {
    const pos = [], idx = [], cols = [];
    for (const hg of hed) {
      const p = hg.p, n2 = p.length / 3;
      for (let i = 0; i + 1 < n2; i++) {
        const ax = p[i * 3], az = p[i * 3 + 1], bx = p[i * 3 + 3], bz = p[i * 3 + 4];
        const L = Math.hypot(bx - ax, bz - az); if (L < 0.1) continue;
        const nx = -(bz - az) / L * 0.7, nz = (bx - ax) / L * 0.7;
        const ya = heightAt(ax, az) - 0.2, yb = heightAt(bx, bz) - 0.2, H = 1.9 + hash(i + n2) * 0.5;
        const k = pos.length / 3;
        pos.push(ax - nx, ya, az - nz, bx - nx, yb, bz - nz, ax - nx * 0.6, ya + H, az - nz * 0.6, bx - nx * 0.6, yb + H, bz - nz * 0.6,
          ax + nx * 0.6, ya + H, az + nz * 0.6, bx + nx * 0.6, yb + H, bz + nz * 0.6, ax + nx, ya, az + nz, bx + nx, yb, bz + nz);
        for (let q = 0; q < 8; q++) cols.push(0.29, 0.4, 0.19);
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2, k + 2, k + 3, k + 4, k + 3, k + 5, k + 4, k + 4, k + 5, k + 6, k + 5, k + 7, k + 6);
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3)); g.setIndex(idx);
      g.computeVertexNormals();
      const mat = getHedgeMat();
      const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; out.push(m);
    }
  }
  return out;
}
let hedgeMat = null;
function getHedgeMat() {
  if (hedgeMat) return hedgeMat;
  hedgeMat = getShared().leaf.clone(); hedgeMat.vertexColors = true; hedgeMat.side = THREE.DoubleSide;
  hedgeMat.onBeforeCompile = getShared().leaf.onBeforeCompile; hedgeMat.customProgramCacheKey = () => "hedge1";
  return hedgeMat;
}
