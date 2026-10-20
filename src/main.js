// Home Roads: boot, menu, the game loop (fixed 60 Hz physics), HUD, sprint challenge and the test hook.
import * as THREE from "three";
import { TEST, START, HOUR, RAIN } from "./env.js";
import { loadSave, save, writeSave } from "./save.js";
import { MapData } from "./mapdata.js";
import { Stage, autoQuality, dateAtUkHour } from "./scene.js";
import { World } from "./world.js";
import { Car } from "./car.js";
import { ChaseCam } from "./camera.js";
import { CARS, carSpec } from "./cars.js";
import { makeCar, wheelBlur } from "./carmodel.js";
import { input, bindPads, readControls } from "./input.js";
import { startAudio, updateAudio, setEngine, setMuted, setWeatherSound, thud, chime, suspend } from "./audio.js";
import { Minimap } from "./minimap.js";
import { Rain, Skids, addContactShadow, addBeams } from "./effects.js";

const $ = (id) => document.getElementById(id);
loadSave();
input.pro = true; // throttle / brake / handbrake controls

const G = { mode: "menu", t: 0, ticks: 0, fps: 0, sprint: null, rain: false, cloud: 0.35, hour: null };
const loadBar = $("loading").querySelector("i");
const setLoad = (f, msg) => { loadBar.style.width = Math.round(f * 100) + "%"; if (msg) $("loadMsg").textContent = msg; };

const CAR_CHOICES = ["vanta", "pico", "solace", "brute"].map((id) => CARS.find((c) => c.id === id) || CARS[0]);
const TIMES = [["real", "Now (UK)"], ["7.5", "Morning"], ["13", "Midday"], ["17.6", "Sunset"], ["22", "Night"]];
const WX = [["dry", "Dry"], ["rain", "Rain"], ["live", "Live weather"]];
const QS = [["auto", "Best (auto)"], ["high", "Sharp"], ["medium", "Balanced"], ["low", "Fast (older phones)"]];

async function boot() {
  const map = (G.map = await new MapData().load());
  setLoad(0.3, "Building the world…");
  const q = save.quality !== "auto" ? save.quality : autoQuality();
  G.q = q;
  const stage = (G.stage = new Stage($("stage"), q));
  G.world = new World(stage, map, stage.q.radius);
  G.cam = new ChaseCam(stage.camera); G.cam.mode = save.cam === "bonnet" ? "bonnet" : "chase";
  G.mini = new Minimap($("mini"), map.meta);
  G.rainFx = new Rain(stage.scene, 900);
  G.skids = new Skids(stage.scene, 600);
  addEventListener("resize", () => stage.resize());
  document.addEventListener("visibilitychange", () => suspend(document.hidden));
  bindPads($("pads"));
  setupMenu();
  // checkpoint marker for the sprint
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.35, 8, 40), new THREE.MeshBasicMaterial({ color: 0x4fc3ff, transparent: true, opacity: 0.75 }));
  ring.visible = false; stage.scene.add(ring); G.ring = ring;
  makePlayerCar();
  // show the world behind the menu at Overton
  const sp = map.meta.spawns[0];
  placeAt(sp);
  await warmUp();
  $("loading").style.opacity = 0; setTimeout(() => ($("loading").hidden = true), 400);
  if (START) startDrive(START === "sprint" ? "sprint" : START);
  else showMenu();
  requestAnimationFrame(frame);
}

function makePlayerCar() {
  const def = CAR_CHOICES.find((c) => c.id === save.car) || CAR_CHOICES[0];
  if (G.model) G.model.group.removeFromParent();
  const model = makeCar(def, save.paint || 0x1d5c8c, 1, 0);
  addContactShadow(model); addBeams(model);
  model.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  G.stage.scene.add(model.group);
  G.model = model; G.def = def;
  const spec = Object.assign({}, def, carSpec(def));
  if (G.car) G.car.spec = spec; else G.car = new Car(spec, G.map);
  setEngine(def.engine);
  // headlights: one real spotlight (cheap) for the road ahead at night
  const spot = new THREE.SpotLight(0xfff1d6, 0, 120, 0.55, 0.5, 1.2);
  spot.position.set(0, 0.8, 2.2); spot.target.position.set(0, 0, 22);
  model.group.add(spot, spot.target); G.spot = spot;
}

function placeAt(sp) {
  G.car.place(sp.x, sp.z, sp.h);
  G.world.update(sp.x, sp.z, 0);
  G.cam.snap(G.car);
}

async function warmUp() {
  // build the chunks around the car before showing it
  const t0 = performance.now();
  while (!G.world.ready() && performance.now() - t0 < 20000) {
    G.world.update(G.car.x, G.car.z, 3);
    setLoad(0.3 + 0.7 * Math.min(1, (performance.now() - t0) / 4000));
    await new Promise((r) => setTimeout(r, 16));
  }
  G.car.place(G.car.x, G.car.z, G.car.h);
}

// ---------------------------------------------------------------- menu
function seg(el, items, cur, on) {
  el.innerHTML = "";
  for (const [v, label] of items) {
    const b = document.createElement("button"); b.textContent = label; b.className = String(cur()) === v ? "on" : "";
    b.onclick = () => { on(v); seg(el, items, cur, on); };
    el.appendChild(b);
  }
}
function setupMenu() {
  const sb = $("spawnBtns"); sb.innerHTML = "";
  for (const sp of G.map.meta.spawns) {
    const b = document.createElement("button"); b.textContent = sp.name === "B3400" ? "On the B3400" : sp.name === "Hilltop" ? `Hilltop (${sp.road})` : sp.name + " centre";
    b.onclick = () => startDrive(sp.name); sb.appendChild(b);
  }
  $("sprintBtn").onclick = () => startDrive("sprint");
  seg($("timeSeg"), TIMES, () => save.time, (v) => { save.time = v; writeSave(); applyEnv(); });
  seg($("wxSeg"), WX, () => save.weather || "dry", (v) => { save.weather = v; writeSave(); if (v === "live") fetchLiveWeather(); else applyEnv(); });
  seg($("qSeg"), QS, () => save.quality, (v) => { save.quality = v; writeSave(); location.reload(); });
  seg($("carSeg"), CAR_CHOICES.map((c) => [c.id, c.name]), () => (CAR_CHOICES.find((c) => c.id === save.car) || CAR_CHOICES[0]).id, (v) => { save.car = v; writeSave(); makePlayerCar(); placeAt({ x: G.car.x, z: G.car.z, h: G.car.h }); });
  $("menuBtn").onclick = () => showMenu();
  $("camBtn").onclick = () => { G.cam.mode = G.cam.mode === "chase" ? "bonnet" : "chase"; save.cam = G.cam.mode; writeSave(); };
  $("resetBtn").onclick = () => resetCar();
  input.onKey = (k) => {
    if (k === "r" || k === "R") resetCar();
    else if (k === "c" || k === "C") $("camBtn").onclick();
    else if (k === "Escape" || k === "p") { if (G.mode === "drive") showMenu(); }
    else if (k === "m" || k === "M") { save.muted = !save.muted; setMuted(save.muted); writeSave(); }
  };
  updateBest();
}
function updateBest() { const b = save.best.sprint; $("bestV").textContent = b ? `Best: ${fmt(b)} (${(G.map.meta.sprint.length / 1609.34).toFixed(1)} miles)` : `${(G.map.meta.sprint.length / 1609.34).toFixed(1)} miles along the B3400. Checkpoints on the way.`; }

// Live weather is opt-in: one request to open-meteo.com from the menu, never while driving.
async function fetchLiveWeather() {
  toast("Asking open-meteo.com for the weather in Overton…", 2000);
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=51.24&longitude=-1.30&current=precipitation,rain,cloud_cover,weather_code", { cache: "no-store" });
    const j = await r.json(), c = j.current;
    G.live = { rain: (c.precipitation || 0) > 0.05 || (c.weather_code >= 51 && c.weather_code <= 82), cloud: (c.cloud_cover || 0) / 100 };
    toast(`Live: ${G.live.rain ? "raining" : "dry"}, ${c.cloud_cover}% cloud`, 2500);
  } catch (_) { G.live = null; toast("Couldn't get the live weather, using dry.", 2500); }
  applyEnv();
}

function applyEnv() {
  const wx = RAIN != null ? (RAIN ? "rain" : "dry") : save.weather || "dry";
  G.rain = wx === "rain" || (wx === "live" && G.live && G.live.rain);
  G.cloud = wx === "live" && G.live ? G.live.cloud : G.rain ? 0.95 : 0.35;
  G.hour = HOUR != null ? HOUR : save.time === "real" ? null : Number(save.time);
  updateSky(true);
  G.rainFx.lines.visible = G.rain; setWeatherSound(G.rain ? "rain" : "");
}
let skyT = 0;
function updateSky(force) {
  if (!force && performance.now() - skyT < 5000) return;
  skyT = performance.now();
  const date = G.hour == null ? new Date() : dateAtUkHour(G.hour);
  G.stage.setTime(date, G.cloud, G.rain);
  G.world.setWeather(G.rain ? 1 : 0, G.stage.night, G.t);
  const night = G.stage.night > 0.4;
  G.spot.intensity = night ? 60 : 0;
  if (G.model.beams) G.model.beams.visible = night;
}

function showMenu() { G.mode = "menu"; $("menu").hidden = false; $("hud").hidden = true; updateBest(); }

function startDrive(where) {
  startAudio(); setMuted(save.muted);
  const m = G.map.meta;
  $("menu").hidden = true; $("hud").hidden = false;
  G.sprint = null; G.mini.route = null; G.mini.target = null; G.ring.visible = false; $("sprintHud").hidden = true; $("arrow").hidden = true;
  if (where === "sprint") {
    placeAt(m.spawns[0]);
    // face along the route
    const r = m.sprint.route; G.car.h = Math.atan2(r[4] - r[0], r[5] - r[1]); G.cam.snap(G.car);
    G.sprint = { i: 0, t: 0, started: false, done: false };
    G.mini.route = r; $("sprintHud").hidden = false; $("arrow").hidden = false;
    toast("Sprint to Whitchurch! The clock starts when you move.", 2500);
  } else placeAt(m.spawns.find((s) => s.name === where) || m.spawns[0]);
  G.skids.clear();
  G.mode = "drive";
  applyEnv();
}

function resetCar() {
  // back onto the nearest road, pointing along it
  const r = G.map.roadAt(G.car.x, G.car.z, {});
  if (r.seg) {
    const s = r.seg, x = s.ax + (s.bx - s.ax) * r.t, z = s.az + (s.bz - s.az) * r.t;
    let h = r.h; if (Math.cos(h - G.car.h) < 0) h += Math.PI;
    G.car.place(x, z, h);
  } else G.car.place(G.car.x, G.car.z, G.car.h);
  G.cam.snap(G.car);
}

let toastT = 0;
function toast(msg, ms = 2000) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

// ---------------------------------------------------------------- loop
let last = performance.now(), acc = 0, fpsT = 0, fpsN = 0, roadShown = "";
const DT = 1 / 60;
function frame() {
  const now = performance.now();
  requestAnimationFrame(frame);
  const ms = Math.max(0, Math.min(100, now - last)); last = now;
  acc += ms / 1000;
  fpsN++; fpsT += ms; if (fpsT > 1000) { G.fps = (fpsN * 1000) / fpsT; fpsN = 0; fpsT = 0; }
  const car = G.car;
  let steps = 0;
  while (acc >= DT && steps < 5) {
    acc -= DT; steps++; G.t += DT; G.ticks++;
    const c = G.mode === "drive" ? readControls() : { steer: 0, throttle: 0, brake: 0, handbrake: false };
    if (G.auto) Object.assign(c, G.auto);
    c.wet = G.rain;
    car.step(DT, c);
    if (car.wallHit > 4) { thud(car.wallHit); G.cam.shake = Math.min(1, car.wallHit / 20); }
    if (G.sprint && G.mode === "drive") sprintTick(DT);
  }
  if (acc > DT * 5) acc = 0;
  G.world.update(car.x, car.z, 2);
  // car model
  const mg = G.model.group;
  mg.position.set(car.x, car.y, car.z);
  mg.rotation.set(0, 0, 0); mg.rotateY(car.h); mg.rotateX(-car.pitch); mg.rotateZ(car.roll);
  G.model.body.rotation.z = Math.max(-0.05, Math.min(0.05, -car.latAcc * 0.004));
  G.model.body.rotation.x = Math.max(-0.03, Math.min(0.03, car.lonAcc * 0.002));
  const spin = (car.vF / 0.36) * (ms / 1000);
  for (const w of G.model.wheels) w.rotation.x += spin;
  for (const s of G.model.steerers) s.rotation.y = -car.steer * 0.45;
  wheelBlur(G.model, car.speed);
  // skids
  const slip = Math.min(1, Math.abs(car.driftAngle) * 3);
  if (slip > 0.35 && car.speed > 8 && car.surface === "road") {
    const fx = Math.sin(car.h), fz = Math.cos(car.h), rx = -Math.cos(car.h), rz = Math.sin(car.h);
    G.skids.mark("rl", car.x - fx * 1.4 - rx * 0.85, car.y, car.z - fz * 1.4 - rz * 0.85, car.h, slip);
    G.skids.mark("rr", car.x - fx * 1.4 + rx * 0.85, car.y, car.z - fz * 1.4 + rz * 0.85, car.h, slip);
  } else { G.skids.mark("rl", 0, 0, 0, 0, 0); G.skids.mark("rr", 0, 0, 0, 0, 0); }
  if (!G.freeCam) G.cam.update(car, ms / 1000, 0);
  G.stage.follow(car.x, car.y, car.z);
  G.rainFx.update(ms / 1000, G.stage.camera.position, car.vx, car.vz);
  updateSky(false);
  G.world.mats.water.userData.uniforms.time.value = G.t;
  if (G.mode === "drive") {
    updateAudio(Math.abs(car.vF), car.spec.vmax, true, slip, false);
    $("spdV").textContent = Math.round(car.speed * 2.23694);
    const rn = car.roadName || (car.surface === "field" ? "Off road: in a field" : car.surface === "wood" ? "Off road: in the woods" : "");
    if (rn !== roadShown) { roadShown = rn; $("roadV").textContent = rn; }
    if (G.ticks % 2 === 0) G.mini.draw(car.x, car.z, car.h);
  } else updateAudio(0, car.spec.vmax, false, 0, false);
  G.stage.render();
  G.stage.adapt(ms);
}

function sprintTick(dt) {
  const S = G.sprint, m = G.map.meta.sprint, car = G.car;
  if (S.done) return;
  if (!S.started && car.speed > 0.5) S.started = true;
  if (S.started) S.t += dt;
  const cp = m.cps[S.i];
  const d = Math.hypot(car.x - cp[0], car.z - cp[1]);
  if (d < 22) {
    S.i++; chime();
    if (S.i >= m.cps.length) {
      S.done = true;
      const best = save.best.sprint, rec = !best || S.t < best;
      if (rec) { save.best.sprint = +S.t.toFixed(2); writeSave(); }
      toast(`Whitchurch! ${fmt(S.t)}${rec ? " — new best!" : ` (best ${fmt(best)})`}`, 6000);
      G.ring.visible = false; $("arrow").hidden = true; G.mini.target = null;
      return;
    }
  }
  const n = m.cps[S.i];
  G.mini.target = n;
  G.ring.visible = true; G.ring.position.set(n[0], G.map.heightAt(n[0], n[1]) + 7.5, n[1]);
  G.ring.rotation.y = Math.atan2(n[0] - car.x, n[1] - car.z) + Math.PI / 2;
  $("sprintTime").textContent = fmt(S.t);
  $("sprintCp").textContent = `Checkpoint ${S.i + 1}/${m.cps.length} · ${Math.round(d)} m`;
  const ang = Math.atan2(n[0] - car.x, n[1] - car.z) - car.h;
  $("arrow").style.transform = `rotate(${-ang - Math.PI / 2}rad)`;
}

// test hook
if (TEST) {
  window.__hr = {
    get G() { return G; },
    get car() { return { x: G.car.x, z: G.car.z, y: G.car.y, h: G.car.h, speed: G.car.speed, road: G.car.roadName, surface: G.car.surface }; },
    get fps() { return G.fps; },
    get ready() { return G.mode !== undefined && G.world && G.world.ready(); },
    drive(c) { G.auto = c; },
    // run the physics for `secs` seconds right now (no rendering), so tests don't depend on the software-GL frame rate
    sim(secs, c) {
      for (let i = 0; i < secs * 60; i++) { const k = Object.assign({ steer: 0, throttle: 0, brake: 0, handbrake: false }, c); G.car.step(1 / 60, k); if (i % 30 === 0) G.world.update(G.car.x, G.car.z, 0); }
      return this.car;
    },
    start(w) { startDrive(w); },
    // drive the sprint route with a simple robot driver (physics only) and report airtime and crashes
    robot(secs, speed = 25) {
      const r = G.map.meta.sprint.route, car = G.car; let i = 0; { let bd = 1e9; for (let k = 0; k < r.length; k += 2) { const d = Math.hypot(r[k] - car.x, r[k + 1] - car.z); if (d < bd) { bd = d; i = k; } } i = Math.min(r.length - 2, i + 2); } let maxAir = 0, hits = 0, worst = 0, maxY = 0;
      for (let k = 0; k < secs * 60; k++) {
        while (i < r.length - 2 && Math.hypot(r[i] - car.x, r[i + 1] - car.z) < 14) i += 2;
        const ang = Math.atan2(r[i] - car.x, r[i + 1] - car.z);
        let d = ang - car.h; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        car.step(1 / 60, { steer: Math.max(-1, Math.min(1, -d * 2.5)), throttle: car.vF < speed ? 1 : 0, brake: car.vF > speed + 3 ? 0.5 : 0 });
        if (k % 20 === 0) G.world.update(car.x, car.z, 0);
        const g = car.groundAt(car.x, car.z); maxAir = Math.max(maxAir, car.y - g); maxY = Math.max(maxY, car.vy);
        if (car.wallHit > 2) { hits++; worst = Math.max(worst, car.wallHit); }
      }
      return { x: car.x, z: car.z, i, of: r.length, maxAir, maxVy: maxY, hits, worst };
    },
    info() { const r = G.stage.renderer.info; return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries }; },
  };
}

boot().catch((e) => { console.error(e); $("loadMsg").textContent = "Couldn't load: " + e.message; });
