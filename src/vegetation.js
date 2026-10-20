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

// Leaf-cluster texture drawn once on a canvas: hundreds of small leaves in mixed greens, transparent between them.
function leafTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  for (let i = 0; i < 520; i++) {
    const a = hash(i * 3 + 1) * Math.PI * 2, r = Math.sqrt(hash(i * 3 + 2)) * 118, x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
    const L = 22 + hash(i * 7) * 30;
    g.fillStyle = `hsl(${88 + hash(i * 5) * 34},${32 + hash(i * 11) * 28}%,${18 + hash(i * 13) * 30}%)`;
    g.save(); g.translate(x, y); g.rotate(hash(i * 17) * Math.PI * 2);
    g.beginPath(); g.ellipse(0, 0, 6 + hash(i) * 5, L * 0.35, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// crown made of leaf cards scattered through an ellipsoid; normals point out from the centre so it shades like a canopy
function cardCrown(seed, N = 32) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let k = 0; k < N; k++) {
    const u = hash(seed * 131 + k * 7 + 1), v = hash(seed * 131 + k * 7 + 2), w = hash(seed * 131 + k * 7 + 3);
    const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), rr = 0.45 + 0.55 * Math.cbrt(w);
    const cx = Math.sin(ph) * Math.cos(th) * rr * 1.05, cy = 0.68 + Math.cos(ph) * rr * 0.29, cz = Math.sin(ph) * Math.sin(th) * rr * 1.05;
    const sz = 0.55 + hash(seed + k * 13) * 0.35;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(hash(k * 5 + seed) * 6.28, hash(k * 9 + seed) * 6.28, hash(k * 11 + seed) * 6.28));
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(sz * 0.5), ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(sz * 0.5 * 0.42 / 0.36);
    ay.y *= 0.36 / 0.42;
    const base = pos.length / 3;
    for (const [a, b, s, t] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      const px = cx + ax.x * a + ay.x * b, py = cy + ax.y * a + ay.y * b, pz = cz + ax.z * a + ay.z * b;
      pos.push(px, py, pz);
      const n = new THREE.Vector3(px, (py - 0.6) * 2.2, pz).normalize(); nor.push(n.x, n.y, n.z);
      uv.push(s, t);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function trunkWithBranches() {
  const parts = [new THREE.CylinderGeometry(0.03, 0.055, 0.62, 7).translate(0, 0.31, 0)];
  for (let k = 0; k < 4; k++) {
    const b = new THREE.CylinderGeometry(0.008, 0.018, 0.35, 5).translate(0, 0.175, 0);
    b.rotateZ(0.75 + hash(k) * 0.3); b.rotateY(k * 1.6 + 0.3); b.translate(0, 0.42 + k * 0.05, 0); parts.push(b);
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}

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
  const cards = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
  shared = {
    leaf, bark, cards, cardCrowns: [cardCrown(1), cardCrown(2), cardCrown(3)], cardCrownsLo: [cardCrown(4, 12), cardCrown(5, 12), cardCrown(6, 12)], coreLo: (() => { const g = new THREE.IcosahedronGeometry(0.7, 0); g.scale(1.05, 0.38, 1.05); g.translate(0, 0.68, 0); return g; })(), core: (() => { const g = new THREE.IcosahedronGeometry(0.62, 1); g.scale(1.05, 0.36, 1.05); g.translate(0, 0.68, 0); return g; })(),
    crown: [crownGeo(true, 1.3, false), crownGeo(true, 4.1, false)], crownLo: crownGeo(false, 2, false),
    conifer: crownGeo(true, 0, true), coniferLo: crownGeo(false, 0, true),
    trunk: trunkWithBranches(),
    bush: (() => { const g = new THREE.IcosahedronGeometry(1, 1); g.scale(1, 0.75, 1); g.translate(0, 0.5, 0); return g; })(),
  };
  return shared;
}

// October in Hampshire: mostly green, some turning yellow, orange and brown
const LEAF = [0x5f7d3a, 0x6c8a40, 0x587538, 0x739245, 0x648238, 0x6a8a3c, 0x7d8f42, 0x5b7a36, 0x8a9a48];
const CONIFER = [0x24382a, 0x2c4130, 0x30442a];
const tmp = new THREE.Object3D(), col = new THREE.Color();

export function buildTrees(chunk, heightAt, near, density = 1, mid = false) {
  const S = getShared();
  const t = chunk.f.trees || [], n = t.length / 4;
  const pick = [];
  for (let i = 0; i < n; i++) if (density >= 1 || hash(i * 13 + chunk.ci * 7 + chunk.cj) < density) pick.push(i);
  const out = [];
  if (pick.length) {
    const seedOf = (i) => hash((Math.round(t[i * 4] * 10) * 73856093) ^ (Math.round(t[i * 4 + 1] * 10) * 19349663));
    // species aren't in the data: every tree is drawn as a broadleaf (styled default), at its LIDAR position, height and width
    const cards = near || mid;
    const groups = cards ? [[], [], []] : [[]];
    for (const i of pick) groups[cards ? Math.floor(seedOf(i) * 3) : 0].push(i);
    groups.forEach((g, gi) => {
      if (!g.length) return;
      const meshes = near ? [new THREE.InstancedMesh(S.core, S.leaf, g.length), new THREE.InstancedMesh(S.cardCrowns[gi], S.cards, g.length)] : mid ? [new THREE.InstancedMesh(S.coreLo, S.leaf, g.length), new THREE.InstancedMesh(S.cardCrownsLo[gi], S.cards, g.length)] : [new THREE.InstancedMesh(S.crownLo, S.leaf, g.length)];
      g.forEach((i, k) => {
        const x = t[i * 4], z = t[i * 4 + 1], h = Math.max(3, t[i * 4 + 2]), r = Math.max(1.2, t[i * 4 + 3]), s = seedOf(i);
        const y = heightAt(x, z);
        tmp.position.set(x, y, z); tmp.rotation.set(0, s * 6.28, 0);
        const cr = Math.min(r * 0.95, h * 0.7);
        tmp.scale.set(cr, h, cr); tmp.updateMatrix();
        col.setHex(LEAF[(s * 97 * LEAF.length | 0) % LEAF.length]).multiplyScalar(0.9 + hash(i) * 0.2);
        for (const m of meshes) { m.setMatrixAt(k, tmp.matrix); m.setColorAt(k, m.material === S.cards ? col.clone().multiplyScalar(1.6) : col.clone().multiplyScalar(0.3)); }
      });
      for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); out.push(m); }
    });
    if (near) {
      const trunks = new THREE.InstancedMesh(S.trunk, S.bark, pick.length);
      pick.forEach((i, k) => {
        const x = t[i * 4], z = t[i * 4 + 1], h = Math.max(3, t[i * 4 + 2]);
        tmp.position.set(x, heightAt(x, z) - 0.2, z); tmp.rotation.set(0, 0, 0); tmp.scale.set(h * 0.6, h, h * 0.6); tmp.updateMatrix(); trunks.setMatrixAt(k, tmp.matrix);
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
