// Renderer, sky, sun, fog and weather. The sun is placed from the real date and time at Overton's latitude and
// longitude, so the light matches the time of day in the UK (or a time picked in the menu).
// The sky shader and quality presets come from Apex Ring's scene.js.
import * as THREE from "three";
import { TEST, FORCE_QUALITY } from "./env.js";

// high = the screen's full sharpness (default everywhere); adaptive resolution only steps down a little if frames get slow
export const QUALITY = {
  low: { pr: 1, shadows: false, shadowSize: 1024, radius: 2, aa: false, floor: 0.6 },
  medium: { pr: 1.75, shadows: true, shadowSize: 1024, radius: 3, aa: true, floor: 0.7 },
  high: { pr: 3, shadows: true, shadowSize: 2048, radius: 3, aa: true, floor: 0.8 },
};
export function autoQuality() {
  if (FORCE_QUALITY && QUALITY[FORCE_QUALITY]) return FORCE_QUALITY;
  if (TEST) return "low";
  return "high";
}

const LAT = 51.24, LON = -1.30;
// Sun altitude/azimuth (radians, azimuth from north towards east) for a Date. Standard low-precision solar formulae.
export function sunPosition(date) {
  const rad = Math.PI / 180, d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = (gmst * 15 + LON) * rad - ra, lat = LAT * rad;
  const alt = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { alt, az };
}

// The current time in the UK as hours (handles BST via Intl).
export function ukHour(date = new Date()) {
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
    const h = +p.find((x) => x.type === "hour").value, m = +p.find((x) => x.type === "minute").value;
    return h + m / 60;
  } catch (_) { return date.getUTCHours() + date.getUTCMinutes() / 60; }
}
// A Date today at a given UK hour (approximate: uses the current UK offset).
export function dateAtUkHour(hour) {
  const now = new Date(), off = ukHour(now) - (now.getUTCHours() + now.getUTCMinutes() / 60);
  const d = new Date(now); d.setUTCHours(0, 0, 0, 0); d.setTime(d.getTime() + (hour - off) * 3600e3);
  return d;
}

const lerpC = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t)));

export class Stage {
  constructor(container, qname) {
    this.q = QUALITY[qname]; this.qname = qname;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: this.q.aa, powerPreference: "high-performance", preserveDrawingBuffer: TEST }));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = this.q.shadows; r.shadowMap.type = THREE.PCFShadowMap;
    this.maxPR = TEST ? 1 : Math.min(window.devicePixelRatio || 1, this.q.pr); this.prScale = 1;
    r.setPixelRatio(this.maxPR);
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.3, 4000);
    this.scene.add(this.camera);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, stars: { value: 0 }, clouds: { value: 0 }, cloudCol: { value: new THREE.Color() }, time: { value: 0 } },
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float stars; uniform float clouds; uniform vec3 cloudCol; uniform float time; varying vec3 vP;
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
        float cfbm(vec2 p){ float s = 0.0, a = 0.5; for (int o = 0; o < 5; o++) { s += vn(p)*a; p = p*2.07 + 3.1; a *= 0.5; } return s; }
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        void main(){ vec3 d = normalize(vP); float h = d.y;
          vec3 c = mix(hor, mid, smoothstep(-0.02, 0.22, h)); c = mix(c, top, smoothstep(0.22, 0.75, h));
          float s = max(dot(d, sunDir), 0.0); c += sunCol*(pow(s, 600.0)*2.0 + pow(s, 40.0)*0.25 + pow(s,6.0)*0.08) * (1.0 - clouds * 0.8);
          if (h > 0.0) { vec2 cp = d.xz / (h + 0.1) * 1.3 + vec2(time * 0.004, time * 0.002); float n = cfbm(cp);
            float cov = smoothstep(0.58 - clouds*0.45, 0.86 - clouds*0.3, n) * smoothstep(0.0, 0.12, h);
            vec3 cc = mix(cloudCol, cloudCol*0.6 + hor*0.2, smoothstep(0.5, 0.95, n)) + sunCol*pow(s, 8.0)*0.3*(1.0-clouds); c = mix(c, cc, cov*0.95); }
          if (stars > 0.0) { vec3 q = floor(d*420.0); float st = step(0.9975, hash(q)); c += vec3(st)*stars*smoothstep(0.05,0.3,h)*(1.0-clouds); }
          gl_FragColor = vec4(c,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), this.skyMat); this.sky.renderOrder = -1; this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.skyMat));
    const grd = new THREE.Mesh(new THREE.CircleGeometry(45, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3d4630 }));
    grd.position.y = -2; this.envScene.add(grd); this.envGround = grd;
    this.scene.environmentIntensity = 0.7;
    this.hemi = new THREE.HemisphereLight(0xb8c8e0, 0x3a3a2a, 0.7); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2); this.sun.castShadow = this.q.shadows;
    const sc = this.sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 400;
    this.sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize); this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.scene.fog = new THREE.FogExp2(0xc0c8d0, 0.0008);
    this.night = 0; this.wet = 0; this.cloud = 0.35;
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(this.maxPR * this.prScale);
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  adapt(frameMs) {
    if (TEST) return;
    this.ft = this.ft == null ? frameMs : this.ft * 0.95 + frameMs * 0.05;
    this.adaptT = (this.adaptT || 0) + frameMs; if (this.adaptT < 2000) return; this.adaptT = 0;
    let k = this.prScale;
    const fl = this.q.floor;
    if (this.ft > 22 && k > fl) k = Math.max(fl, k - 0.05); else if (this.ft < 15 && k < 1) k = Math.min(1, k + 0.05);
    if (k !== this.prScale) { this.prScale = k; this.resize(); }
  }

  // Set the light for a date, cloud cover 0..1 and rain on/off.
  setTime(date, cloud = 0.35, rain = false) {
    const { alt, az } = sunPosition(date);
    this.sunAlt = alt;
    const dir = this.sunDir.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt)).normalize();
    const sd = Math.sin(alt); // -1..1
    const day = Math.max(0, Math.min(1, (sd + 0.05) / 0.3)), golden = Math.max(0, 1 - Math.abs(sd - 0.06) / 0.14);
    this.night = 1 - Math.max(0, Math.min(1, (sd + 0.1) / 0.16));
    this.cloud = rain ? Math.max(0.85, cloud) : cloud;
    const oc = this.cloud;
    const u = this.skyMat.uniforms;
    u.top.value.copy(lerpC(0x03060d, 0x2f6fbf, day)).lerp(new THREE.Color(0x7d858e).multiplyScalar(0.25 + 0.75 * day), oc * 0.8);
    u.mid.value.copy(lerpC(0x0a1322, 0x6f9fd6, day)).lerp(new THREE.Color(0x9aa1a8).multiplyScalar(0.2 + 0.8 * day), oc * 0.8);
    u.hor.value.copy(lerpC(0x101826, 0xc7d6e6, day)).lerp(new THREE.Color(0xe59a5a), golden * 0.6 * (1 - oc)).lerp(new THREE.Color(0xa9aeb2).multiplyScalar(0.2 + 0.8 * day), oc * 0.7);
    u.sunDir.value.copy(dir);
    u.sunCol.value.copy(lerpC(0xffffff, 0xff9a4a, golden)).multiplyScalar(day);
    u.stars.value = this.night; u.clouds.value = oc;
    u.cloudCol.value.copy(lerpC(0x1a2030, 0xf4f5f7, day)).lerp(new THREE.Color(0xff9a66), golden * 0.5).multiplyScalar(1 - oc * 0.35);
    this.sun.color.copy(lerpC(0xfff4e6, 0xffa560, golden));
    this.sun.intensity = 3.0 * day * (1 - oc * 0.75);
    this.sun.visible = day > 0.02;
    this.hemi.color.copy(lerpC(0x1a2340, 0xbfd0ea, day)); this.hemi.groundColor.copy(lerpC(0x0a0a0e, 0x4a4632, day));
    this.hemi.intensity = (0.25 + 0.95 * day + oc * 0.35 * day) * 0.55; // the sky reflection map adds the rest
    this.scene.fog.color.copy(u.hor.value).lerp(u.mid.value, 0.25);
    this.scene.fog.density = 0.0007 + oc * 0.00035 + (rain ? 0.0009 : 0) + this.night * 0.0002;
    this.renderer.toneMappingExposure = 0.95 + this.night * 0.4;
    this.wet = rain ? 1 : 0;
    // rebuild the reflection map from this sky (cheap enough every few minutes)
    if (!this.envT || Math.abs(this.envAlt - alt) > 0.02 || this.envCloud !== oc) {
      this.envT = 1; this.envAlt = alt; this.envCloud = oc;
      this.envGround.material.color.copy(lerpC(0x0c0e0c, 0x4b5238, day));
      const old = this.envRT; this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
      this.scene.environment = this.envRT.texture; if (old) old.dispose();
    }
  }

  // keep the shadow camera around the car
  follow(x, y, z) {
    const d = this.sunDir;
    this.sun.position.set(x + d.x * 200, y + Math.max(0.1, d.y) * 200, z + d.z * 200);
    this.sun.target.position.set(x, y, z);
    this.sky.position.set(x, 0, z);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
