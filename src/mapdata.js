import { parkingSpots } from "./parked.js";
// The baked map: meta.json (spawns, minimap roads, railway, water), a coarse height grid for the whole box,
// and 250 m chunks (2 m heights + land classes, plus roads, buildings, trees...) loaded around the car.
// Everything comes from files in data/ (made by scripts/bake.py); nothing is fetched from the internet.
// World axes: x = east, z = south, y = up (metres above sea level).

async function gunzip(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const raw = new Uint8Array(await res.arrayBuffer());
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw.buffer; // already decoded by the server
  const ds = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(ds).arrayBuffer();
}

export class MapData {
  async load(base = "data/") {
    this.base = base;
    this.meta = await (await fetch(base + "meta.json")).json();
    const m = this.meta;
    this.box = m.box; this.size = m.chunk; this.g = m.grid; this.n = m.chunk / m.grid + 1; this.CI = m.ci; this.CJ = m.cj;
    const fb = await gunzip(base + "far.bin.gz");
    const fn = m.far.nx * m.far.ny;
    const fh = new Uint16Array(fb.slice(0, fn * 2));
    this.far = { nx: m.far.nx, ny: m.far.ny, step: m.far.step, h: Float32Array.from(fh, (v) => v * m.hscale), c: new Uint8Array(fb.slice(fn * 2, fn * 3)) };
    this.chunks = new Map();
    this.cls = m.classes;
    return this;
  }

  key(ci, cj) { return ci + "_" + cj; }
  chunkIndex(x, z) { return [Math.floor((x - this.box.x0) / this.size), Math.floor((z - this.box.z0) / this.size)]; }
  inBox(x, z, pad = 0) { const b = this.box; return x > b.x0 + pad && x < b.x1 - pad && z > b.z0 + pad && z < b.z1 - pad; }

  // Load one chunk (cached). Resolves to { ci, cj, x0, z0, h, cls, vari, f } or null outside the box.
  getChunk(ci, cj) {
    if (ci < 0 || cj < 0 || ci >= this.CI || cj >= this.CJ) return Promise.resolve(null);
    const k = this.key(ci, cj);
    if (!this.chunks.has(k)) {
      const p = Promise.all([gunzip(`${this.base}c/${k}.bin.gz`), fetch(`${this.base}c/${k}.json`).then((r) => r.json())]).then(([buf, f]) => {
        const n = this.n, nn = n * n;
        const hq = new Uint16Array(buf.slice(0, nn * 2));
        const c = { ci, cj, x0: this.box.x0 + ci * this.size, z0: this.box.z0 + cj * this.size, h: new Float32Array(nn), cls: new Uint8Array(buf.slice(nn * 2, nn * 3)), vari: new Uint8Array(buf.slice(nn * 3, nn * 4)), f };
        for (let i = 0; i < nn; i++) c.h[i] = hq[i] * this.meta.hscale;
        this.prepare(c);
        c.ready = true;
        return c;
      });
      p.then((c) => { p.value = c; });
      this.chunks.set(k, p);
    }
    return this.chunks.get(k);
  }
  loaded(ci, cj) { const p = this.chunks.get(this.key(ci, cj)); return p && p.value; }
  drop(ci, cj) { this.chunks.delete(this.key(ci, cj)); }

  // Precompute collision shapes and road segments for quick queries.
  prepare(c) {
    const f = c.f;
    c.segs = [];
    for (const r of f.roads || []) {
      const p = r.p, hw = r.w / 2, pave = r.s ? 2.0 : 0;
      for (let i = 0; i + 4 < p.length; i += 4) c.segs.push({ ax: p[i], az: p[i + 1], ay: p[i + 2], bx: p[i + 4], bz: p[i + 5], by: p[i + 6], hw, pave, n: r.n, r: r.r, g: r.g, b: r.b });
    }
    c.solids = [];
    for (const b of f.bld || []) {
      const p = b.p; let cx = 0, cz = 0;
      for (let i = 0; i < p.length; i += 2) { cx += p[i]; cz += p[i + 1]; }
      cx /= p.length / 2; cz /= p.length / 2;
      let r = 0; for (let i = 0; i < p.length; i += 2) r = Math.max(r, Math.hypot(p[i] - cx, p[i + 1] - cz));
      c.solids.push({ poly: p, cx, cz, r });
    }
    // parked cars are solid too
    c.parked = parkingSpots(c, this.meta.spawns);
    for (const [x, z, h] of c.parked.cars) {
      const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h), L = 2.15, W = 0.9;
      c.solids.push({ poly: [x + fx * L + rx * W, z + fz * L + rz * W, x + fx * L - rx * W, z + fz * L - rz * W, x - fx * L - rx * W, z - fz * L - rz * W, x - fx * L + rx * W, z - fz * L + rz * W], cx: x, cz: z, r: 2.4 });
    }
    c.walls = [];
    for (const w of [...(f.walls || []), ...(f.hedges || [])]) {
      const p = w.p;
      for (let i = 0; i + 3 < p.length; i += 3) c.walls.push({ ax: p[i], az: p[i + 1], bx: p[i + 3], bz: p[i + 4], soft: !w.k });
    }
  }

  // Ground height: 2 m LIDAR grid where the chunk is loaded, the coarse grid elsewhere.
  heightAt(x, z) {
    const [ci, cj] = this.chunkIndex(x, z);
    const c = this.loaded(ci, cj);
    if (c) {
      const n = this.n, g = this.g;
      let fx = (x - c.x0) / g, fz = (z - c.z0) / g;
      fx = Math.min(n - 1.0001, Math.max(0, fx)); fz = Math.min(n - 1.0001, Math.max(0, fz));
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, h = c.h, o = j * n + i;
      return h[o] * (1 - u) * (1 - v) + h[o + 1] * u * (1 - v) + h[o + n] * (1 - u) * v + h[o + n + 1] * u * v;
    }
    return this.farHeight(x, z);
  }
  farHeight(x, z) {
    const F = this.far;
    let fx = (x - this.box.x0) / F.step, fz = (z - this.box.z0) / F.step;
    fx = Math.min(F.nx - 1.0001, Math.max(0, fx)); fz = Math.min(F.ny - 1.0001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, h = F.h, o = j * F.nx + i, n = F.nx;
    return h[o] * (1 - u) * (1 - v) + h[o + 1] * u * (1 - v) + h[o + n] * (1 - u) * v + h[o + n + 1] * u * v;
  }
  classAt(x, z) {
    const [ci, cj] = this.chunkIndex(x, z), c = this.loaded(ci, cj);
    if (!c) return 0;
    const i = Math.round((x - c.x0) / this.g), j = Math.round((z - c.z0) / this.g);
    return c.cls[Math.max(0, Math.min(this.n - 1, j)) * this.n + Math.max(0, Math.min(this.n - 1, i))];
  }

  // Nearest road segment to (x, z) among the loaded chunks around it.
  roadAt(x, z, out = {}) {
    const [ci, cj] = this.chunkIndex(x, z);
    out.d = Infinity; out.seg = null;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const c = this.loaded(ci + di, cj + dj); if (!c) continue;
      for (const s of c.segs) {
        const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1;
        let t = ((x - s.ax) * dx + (z - s.az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = s.ax + dx * t, pz = s.az + dz * t, d = Math.hypot(x - px, z - pz) - s.hw;
        // prefer bridges when on top of one (a bridge and the road under it overlap in plan)
        if (d < out.d - (s.b ? 0.5 : 0)) { out.d = d; out.seg = s; out.t = t; out.y = s.ay + (s.by - s.ay) * t; out.h = Math.atan2(dx, dz); }
      }
    }
    return out;
  }

  // Push a circle (x, z, r) out of buildings and walls. Returns { x, z, nx, nz, hit } (n = push direction).
  collide(x, z, r, out = { x: 0, z: 0, nx: 0, nz: 0, hit: false, soft: false }) {
    out.x = x; out.z = z; out.hit = false; out.soft = false;
    const [ci, cj] = this.chunkIndex(x, z);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const c = this.loaded(ci + di, cj + dj); if (!c) continue;
      for (const s of c.solids) {
        if (Math.hypot(out.x - s.cx, out.z - s.cz) > s.r + r) continue;
        const p = s.poly, n = p.length / 2;
        let inside = false, best = Infinity, bx = 0, bz = 0;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
          if ((zi > out.z) !== (zj > out.z) && out.x < ((xj - xi) * (out.z - zi)) / (zj - zi) + xi) inside = !inside;
          const dx = xj - xi, dz = zj - zi, L2 = dx * dx + dz * dz || 1;
          let t = ((out.x - xi) * dx + (out.z - zi) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = xi + dx * t, pz = zi + dz * t, d = Math.hypot(out.x - px, out.z - pz);
          if (d < best) { best = d; bx = px; bz = pz; }
        }
        if (inside || best < r) {
          let nx = out.x - bx, nz = out.z - bz; const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
          if (inside) { nx = -nx; nz = -nz; }
          const push = inside ? best + r : r - best;
          out.x += nx * push; out.z += nz * push; out.nx = nx; out.nz = nz; out.hit = true;
        }
      }
      for (const w of c.walls) {
        const dx = w.bx - w.ax, dz = w.bz - w.az, L2 = dx * dx + dz * dz || 1;
        let t = ((out.x - w.ax) * dx + (out.z - w.az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = w.ax + dx * t, pz = w.az + dz * t, d = Math.hypot(out.x - px, out.z - pz), rr = r + (w.soft ? 0.5 : 0.15);
        if (d < rr) {
          const nx = (out.x - px) / (d || 1), nz = (out.z - pz) / (d || 1);
          out.x += nx * (rr - d); out.z += nz * (rr - d); out.nx = nx; out.nz = nz; out.hit = true; out.soft = w.soft;
        }
      }
    }
    return out;
  }
}
