// Ground meshes from the LIDAR height grid. Near chunks use the 2 m grid (4 m / 8 m further out),
// and one coarse mesh covers the whole box for the distant hills. The ground shader blends grass, crops/plough,
// woodland floor and paving from the baked OpenStreetMap land classes, with field rows in each field's own direction.
import * as THREE from "three";
import { photo } from "./photo.js";

const CL = { grass: 0, farm: 1, meadow: 2, wood: 3, resi: 4, paved: 5, water: 6, rail: 7, scrub: 8, park: 9, yard: 10 };

// land class -> blend weights (grass, field, wood floor, paved) + garden flag
function weights(c, out) {
  out[0] = out[1] = out[2] = out[3] = out[4] = 0;
  switch (c & 0x7f) {
    case CL.farm: out[1] = 1; break;
    case CL.wood: out[2] = 1; break;
    case CL.scrub: out[0] = 0.5; out[2] = 0.5; break;
    case CL.paved: case CL.yard: out[3] = 1; break;
    case CL.rail: out[3] = 0.6; out[2] = 0.4; break;
    case CL.resi: out[0] = 1; out[4] = 1; break;
    case CL.water: out[2] = 0.6; out[0] = 0.4; break;
    case CL.park: out[0] = 1; out[4] = 0.5; break;
    default: out[0] = 1;
  }
  return out;
}

export function groundMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const tGrass = photo("grass", { repeat: [1, 1] }), tDry = photo("drygrass"), tSoil = photo("soil"), tLeaf = photo("forest"), tPave = photo("concrete");
  mat.userData.uniforms = { wet: { value: 0 }, farMask: { value: null }, isFar: { value: 0 }, maskBox: { value: new THREE.Vector4() } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.uniforms, { tGrass: { value: tGrass }, tDry: { value: tDry }, tSoil: { value: tSoil }, tLeaf: { value: tLeaf }, tPave: { value: tPave } });
    sh.vertexShader = "attribute vec4 lc; attribute vec2 lc2; varying vec4 vLc; varying vec2 vLc2; varying vec3 vWP;\n" + sh.vertexShader
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vLc = lc; vLc2 = lc2; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = `uniform sampler2D tGrass, tDry, tSoil, tLeaf, tPave, farMask; uniform float wet, isFar; uniform vec4 maskBox; varying vec4 vLc; varying vec2 vLc2; varying vec3 vWP;
      float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hsh(i), hsh(i+vec2(1,0)), f.x), mix(hsh(i+vec2(0,1)), hsh(i+vec2(1,1)), f.x), f.y); }
      ` + sh.fragmentShader
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
        if (isFar > 0.5) { vec2 mu = (vWP.xz - maskBox.xy) / maskBox.zw; if (mu.x > 0.0 && mu.y > 0.0 && mu.x < 1.0 && mu.y < 1.0 && texture2D(farMask, mu).r > 0.5) discard; }`)
      .replace("#include <map_fragment>", `
        vec2 wp = vWP.xz;
        float macro = vnoise(wp * 0.02) * 0.6 + vnoise(wp * 0.11) * 0.4;
        vec3 grass = texture2D(tGrass, wp * 0.21).rgb * 0.75 + texture2D(tGrass, wp * 0.037).rgb * 0.35;
        grass *= mix(vec3(0.82, 0.86, 0.74), vec3(1.08, 1.04, 0.92), macro);
        vec3 dry = texture2D(tDry, wp * 0.17).rgb;
        grass = mix(grass, dry * vec3(0.9, 0.95, 0.75), smoothstep(0.62, 0.9, vnoise(wp * 0.05)) * 0.35);
        // fields: drill rows and tramlines in each field's own direction; the crop depends on the field
        float fv = vLc2.y; float ang = fv * 6.2831853; vec2 dir = vec2(cos(ang), sin(ang));
        float along = dot(wp, dir);
        float rows = 0.5 + 0.5 * sin(along * 7.85);
        float tram = smoothstep(0.965, 0.995, abs(sin(along * 0.1309)));
        vec3 soil = texture2D(tSoil, wp * 0.25).rgb;
        vec3 field;
        if (fv < 0.42) field = mix(soil * 0.8, grass * vec3(0.85, 1.05, 0.7), 0.55 + 0.25 * rows);          // winter wheat coming through
        else if (fv < 0.72) field = soil * (0.82 + 0.25 * rows);                                           // ploughed / drilled
        else if (fv < 0.88) field = mix(dry * vec3(1.05, 0.95, 0.7), soil, 0.25 + 0.2 * rows);             // stubble
        else field = grass * vec3(0.95, 1.0, 0.85) * (0.92 + 0.1 * rows);                                  // grass ley
        field = mix(field, soil * 0.7, tram * 0.8);
        vec3 leaf = texture2D(tLeaf, wp * 0.2).rgb * mix(0.75, 1.05, macro);
        vec3 pave = texture2D(tPave, wp * 0.15).rgb * 0.85;
        vec3 garden = mix(grass * 1.06, pave, smoothstep(0.55, 0.75, vnoise(wp * 0.09)) * 0.35);
        vec4 w = vLc; float tot = max(0.001, w.x + w.y + w.z + w.w);
        vec3 col = (mix(grass, garden, vLc2.x) * w.x + field * w.y + leaf * w.z + pave * w.w) / tot;
        diffuseColor.rgb *= col;
      `)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.45, wet * (0.4 + 0.6 * vLc.w));");
  };
  mat.customProgramCacheKey = () => "ground1";
  return mat;
}

// One chunk's ground mesh at grid step s (1 = 2 m, 2 = 4 m, 4 = 8 m), with skirts so LOD seams don't show gaps.
export function chunkGeometry(c, n, g, s) {
  const m = Math.floor((n - 1) / s) + 1, N = m * m, h = c.h, cls = c.cls, vari = c.vari;
  const skirt = 4 * (m - 1);
  const pos = new Float32Array((N + skirt * 2) * 3), nor = new Float32Array((N + skirt * 2) * 3);
  const lc = new Float32Array((N + skirt * 2) * 4), lc2 = new Float32Array((N + skirt * 2) * 2);
  const w = [0, 0, 0, 0, 0];
  const H = (i, j) => h[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let jj = 0; jj < m; jj++) for (let ii = 0; ii < m; ii++) {
    const i = ii * s, j = jj * s, k = jj * m + ii, o = j * n + i;
    const road = cls[o] & 0x80;
    pos[k * 3] = c.x0 + i * g; pos[k * 3 + 1] = h[o] - (road ? 0.35 : 0); pos[k * 3 + 2] = c.z0 + j * g;
    const dx = H(i + s, j) - H(i - s, j), dz = H(i, j + s) - H(i, j - s), L = Math.hypot(dx, 2 * s * g, dz);
    nor[k * 3] = -dx / L; nor[k * 3 + 1] = (2 * s * g) / L; nor[k * 3 + 2] = -dz / L;
    weights(cls[o], w);
    lc[k * 4] = w[0]; lc[k * 4 + 1] = w[1]; lc[k * 4 + 2] = w[2]; lc[k * 4 + 3] = w[3]; lc2[k * 2] = w[4]; lc2[k * 2 + 1] = vari[o] / 255;
  }
  const idx = [];
  for (let jj = 0; jj < m - 1; jj++) for (let ii = 0; ii < m - 1; ii++) {
    const a = jj * m + ii, b = a + 1, c2 = a + m, d = c2 + 1;
    idx.push(a, c2, b, b, c2, d);
  }
  // skirts: copy each edge vertex 3 m down
  const edge = [];
  for (let i = 0; i < m - 1; i++) edge.push(i);
  for (let j = 0; j < m - 1; j++) edge.push(j * m + m - 1);
  for (let i = m - 1; i > 0; i--) edge.push((m - 1) * m + i);
  for (let j = m - 1; j > 0; j--) edge.push(j * m);
  let v = N;
  for (let e = 0; e < edge.length; e++) {
    const a = edge[e], b = edge[(e + 1) % edge.length];
    for (const src of [a, b]) {
      pos[v * 3] = pos[src * 3]; pos[v * 3 + 1] = pos[src * 3 + 1] - 3; pos[v * 3 + 2] = pos[src * 3 + 2];
      nor.copyWithin(v * 3, src * 3, src * 3 + 3); lc.copyWithin(v * 4, src * 4, src * 4 + 4); lc2.copyWithin(v * 2, src * 2, src * 2 + 2);
      v++;
    }
    const sa = v - 2, sb = v - 1;
    idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("lc", new THREE.BufferAttribute(lc, 4));
  geo.setAttribute("lc2", new THREE.BufferAttribute(lc2, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// The whole box at 40 m, sunk a little so near chunks always win; it discards itself where near chunks are shown.
export function farGeometry(map) {
  const F = map.far, s = 2, nx = Math.floor((F.nx - 1) / s) + 1, ny = Math.floor((F.ny - 1) / s) + 1;
  const pos = new Float32Array(nx * ny * 3), lc = new Float32Array(nx * ny * 4), lc2 = new Float32Array(nx * ny * 2), w = [0, 0, 0, 0, 0];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, o = j * s * F.nx + i * s;
    pos[k * 3] = map.box.x0 + i * s * F.step; pos[k * 3 + 1] = F.h[o] - 1.2; pos[k * 3 + 2] = map.box.z0 + j * s * F.step;
    weights(F.c[o], w); lc.set(w.slice(0, 4), k * 4); lc2[k * 2] = w[4]; lc2[k * 2 + 1] = ((i * 7 + j * 13) % 17) / 17;
  }
  const idx = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, c, b, b, c, d); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("lc", new THREE.BufferAttribute(lc, 4));
  geo.setAttribute("lc2", new THREE.BufferAttribute(lc2, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
