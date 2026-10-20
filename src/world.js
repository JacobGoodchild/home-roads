// Streams the map around the car: chunks near the car get full detail (2 m ground, roads, buildings, trees),
// rings further out get coarser ground and cheaper trees, and the coarse whole-box mesh fills in the distance.
// Meshes are built a few per frame so driving never stalls on a big town chunk.
import * as THREE from "three";
import { groundMaterial, chunkGeometry, farGeometry } from "./terrain.js";
import { roadMaterial, paveMaterial, stoneMaterial, buildRoads, buildRail, buildWater, waterMaterial } from "./roads.js";
import { buildingMaterials, buildBuildings } from "./buildings.js";
import { buildTrees } from "./vegetation.js";
import { buildObjects, buildPower, objectMats } from "./objects.js";
import { buildParked } from "./parked.js";

export class World {
  constructor(stage, map, radius) {
    this.stage = stage; this.map = map; this.radius = radius;
    this.root = new THREE.Group(); stage.scene.add(this.root);
    const ground = groundMaterial();
    this.mats = { ground, road: roadMaterial(), pave: paveMaterial(), stone: stoneMaterial(), water: waterMaterial(), ...buildingMaterials() };
    this.mats.pave.side = THREE.DoubleSide; this.mats.stone.side = THREE.DoubleSide; this.mats.wall.side = THREE.DoubleSide;
    // far ground with a mask of chunks that have their own detailed mesh
    this.mask = new THREE.DataTexture(new Uint8Array(map.CI * map.CJ * 4), map.CI, map.CJ, THREE.RGBAFormat);
    this.mask.magFilter = this.mask.minFilter = THREE.NearestFilter; this.mask.needsUpdate = true;
    const farMat = groundMaterial();
    farMat.userData.uniforms.isFar.value = 1; farMat.userData.uniforms.farMask.value = this.mask;
    farMat.userData.uniforms.maskBox.value.set(map.box.x0, map.box.z0, map.CI * map.size, map.CJ * map.size);
    farMat.customProgramCacheKey = () => "groundFar";
    this.farMat = farMat;
    this.far = new THREE.Mesh(farGeometry(map), farMat); this.far.receiveShadow = false; this.far.frustumCulled = false;
    this.root.add(this.far);
    const m = map.meta;
    this.rail = buildRail(m.rail); this.root.add(this.rail);
    this.water = buildWater(m.water, m.streams, this.mats.water); this.root.add(this.water);
    this.power = buildPower(m.power || [], (x, z) => map.heightAt(x, z)); this.root.add(this.power);
    this.live = new Map(); // key -> { lod, group, ci, cj }
    this.queue = [];
    this.centre = null;
  }

  // lod 0 = full detail, 1 = medium, 2 = far ring
  lodFor(d) { return Math.min(3, d); }

  // parked cars and lamp posts: one instanced layer for everything within ~170 m, rebuilt as the car moves
  updateParked(x, z) {
    if (this.pk && Math.hypot(x - this.pk.x, z - this.pk.z) < 35 && this.pk.n === this.live.size) return;
    if (this.pk) for (const m of this.pk.meshes) { m.removeFromParent(); m.dispose(); }
    const spots = { cars: [], lamps: [] }, R = 170;
    for (const c of this.live.values()) {
      const d = this.map.loaded(c.ci, c.cj); if (!d || !d.parked) continue;
      for (const s of d.parked.cars) if (Math.hypot(s[0] - x, s[1] - z) < R) spots.cars.push(s);
      for (const s of d.parked.lamps) if (Math.hypot(s[0] - x, s[1] - z) < R * 1.6) spots.lamps.push(s);
    }
    const meshes = buildParked(spots, (a, b) => this.map.heightAt(a, b), objectMats.lamp);
    for (const m of meshes) this.root.add(m);
    this.pk = { x, z, n: this.live.size, meshes };
  }

  update(x, z, budget = 2) {
    this.updateParked(x, z);
    const [ci, cj] = this.map.chunkIndex(x, z), R = this.radius;
    const key = ci + "," + cj;
    if (key !== this.centre) {
      this.centre = key;
      const want = new Map();
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= this.map.CI || j >= this.map.CJ) continue;
        want.set(this.map.key(i, j), { i, j, lod: this.lodFor(Math.max(Math.abs(di), Math.abs(dj))), d: Math.hypot(di, dj) });
      }
      for (const [k, c] of this.live) if (!want.has(k)) { this.disposeChunk(c); this.live.delete(k); this.map.drop(c.ci, c.cj); this.setMask(c.ci, c.cj, 0); }
      this.queue = [...want.values()].filter((w) => { const c = this.live.get(this.map.key(w.i, w.j)); return !c || c.lod !== w.lod; }).sort((a, b) => a.d - b.d);
    }
    let built = 0;
    while (this.queue.length && built < budget) {
      const w = this.queue[0], data = this.map.loaded(w.i, w.j);
      if (!data) { this.map.getChunk(w.i, w.j); if (this.queue.length > 1 && this.queue.every((q) => !this.map.loaded(q.i, q.j))) { this.queue.forEach((q) => this.map.getChunk(q.i, q.j)); } break; }
      this.queue.shift();
      this.buildChunk(data, w.lod);
      built++;
    }
    for (const q of this.queue.slice(0, 6)) this.map.getChunk(q.i, q.j);
    return this.queue.length;
  }

  buildChunk(c, lod) {
    const k = this.map.key(c.ci, c.cj), old = this.live.get(k);
    if (old) this.disposeChunk(old);
    const g = new THREE.Group(), h = (x, z) => this.map.heightAt(x, z);
    const step = [1, 2, 4, 8][lod];
    const ground = new THREE.Mesh(chunkGeometry(c, this.map.n, this.map.g, step), this.mats.ground);
    ground.receiveShadow = lod <= 1; g.add(ground);
    if (lod <= 2) for (const m of buildRoads(c, h, this.mats)) { if (lod > 0) m.castShadow = false; g.add(m); }
    if (lod <= 2) for (const m of buildBuildings(c, this.mats, lod)) { if (lod > 0) m.castShadow = false; g.add(m); }
    for (const m of buildTrees(c, h, lod === 0, [1, 1, 0.7, 0.4][lod])) { if (lod > 0) m.castShadow = false; g.add(m); }
    if (lod <= 1) for (const m of buildObjects(c, h, (x, z) => this.map.roadAt(x, z, {}))) { if (lod > 0) m.castShadow = false; g.add(m); }
    this.root.add(g);
    this.live.set(k, { lod, group: g, ci: c.ci, cj: c.cj });
    this.setMask(c.ci, c.cj, 255);
  }

  setMask(i, j, v) { const d = this.mask.image.data, o = (j * this.map.CI + i) * 4; if (d[o] !== v) { d[o] = v; this.mask.needsUpdate = true; } }

  disposeChunk(c) {
    c.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    c.group.removeFromParent();
  }

  // ready when the chunks around the car have been built
  ready() { return this.queue.filter((q) => q.d <= 1.5).length === 0; }

  setWeather(wet, night, time) {
    this.mats.ground.userData.uniforms.wet.value = wet; this.farMat.userData.uniforms.wet.value = wet;
    this.mats.road.userData.uniforms.wet.value = wet;
    this.mats.wall.userData.uniforms.night.value = night;
    this.mats.water.userData.uniforms.time.value = time;
    objectMats.lamp.emissiveIntensity = night > 0.3 ? 3 : 0;
  }
}
