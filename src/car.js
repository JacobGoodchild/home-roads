// Free-roaming car physics, adapted from Apex Ring's arcade model (src/vehicle.js there).
// The car keeps a world velocity and a heading; steering turns the heading and tyre grip pulls the velocity back in
// line, so too much steering at speed slides. Here there is no track: the ground is the LIDAR height map, grip and
// rolling drag depend on the surface under the car (tarmac, gravel, grass, ploughed field), and buildings, walls and
// hedges are solid.
const wrapA = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// land class -> [grip factor, rolling drag m/s², top speed factor]
const SURF = { road: [1, 0, 1], gravel: [0.72, 1.2, 0.7], grass: [0.55, 2.6, 0.55], field: [0.45, 4.0, 0.42], wood: [0.5, 3.5, 0.45], paved: [0.95, 0.2, 0.95], water: [0.3, 6, 0.25] };
const CLASS_SURF = ["grass", "field", "grass", "wood", "grass", "paved", "water", "gravel", "wood", "grass", "paved"];

export class Car {
  constructor(spec, map) {
    this.spec = spec; this.map = map;
    this.road = {}; this.col = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
    this.place(0, 0, 0);
  }

  place(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    this.vx = 0; this.vz = 0; this.vF = 0; this.vL = 0; this.vy = 0;
    this.yawRate = 0; this.steer = 0; this.latAcc = 0; this.lonAcc = 0; this.pitch = 0; this.roll = 0;
    this.drifting = false; this.driftAngle = 0; this.wallHit = 0; this.surface = "road"; this.roadName = "";
    this.y = this.groundAt(x, z); this.gPrev = null; this.air = false;
  }

  groundAt(x, z) {
    const r = this.map.roadAt(x, z, this.road);
    const t = this.map.heightAt(x, z);
    if (r.seg && r.d < 0.3) return r.seg.b ? r.y + 0.05 : Math.max(t, r.y + 0.05);
    if (r.seg && r.seg.pave && r.d < r.seg.pave && !r.seg.b) return Math.max(t, r.y + 0.18);
    return t;
  }

  step(dt, c) {
    const s = this.spec;
    let fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -Math.cos(this.h), rz = Math.sin(this.h);
    let vF = this.vx * fx + this.vz * fz, vL = this.vx * rx + this.vz * rz;

    // what are we driving on?
    const r = this.map.roadAt(this.x, this.z, this.road);
    let surf;
    if (r.seg && r.d < 0.4) surf = r.seg.g ? "gravel" : "road";
    else if (r.seg && r.seg.pave && r.d < r.seg.pave) surf = "paved";
    else surf = CLASS_SURF[this.map.classAt(this.x, this.z) & 0x7f] || "grass";
    this.surface = surf;
    this.roadName = r.seg && r.d < 6 ? this.map.meta.names[r.seg.n] || "" : "";
    const [gripK, roll, vK] = SURF[surf];
    const wet = c.wet ? 0.82 : 1;

    // steering is smoothed; less lock at speed keeps it stable
    const sIn = clamp(c.steer, -1, 1);
    this.steer += (sIn - this.steer) * Math.min(1, dt * (Math.abs(sIn) > Math.abs(this.steer) ? 7 : 10));

    // handbrake kicks the tail out
    if (c.handbrake && !this.drifting && vF > 12 && Math.abs(this.steer) > 0.2) { this.drifting = true; this.driftDir = Math.sign(this.steer); this.yawRate += this.driftDir * 0.35; }
    if (this.drifting && (!c.handbrake && (vF < 8 || Math.abs(this.driftAngle) < 0.08 || this.steer * this.driftDir < 0.2))) this.drifting = false;

    // longitudinal: throttle, brakes, reverse, drag, slopes
    const vmax = s.vmax * vK;
    let a = 0, decel = 0;
    if (c.throttle > 0) a = s.accel * Math.max(0, 1 - (Math.max(0, vF) / vmax) ** 2) * c.throttle * (gripK < 0.6 ? 0.7 : 1);
    if (c.brake > 0) {
      if (vF > 0.5) decel = 30 * c.brake * Math.min(1, gripK + 0.25) * wet;
      else a -= 7 * c.brake * (vF > -9 ? 1 : 0); // reverse
    }
    if (c.handbrake) decel += vF > 0 ? 6 : 0;
    if (!c.throttle && !c.brake) decel += 1.6;
    if (vF > vmax) decel = Math.max(decel, (vF - vmax) * 0.9);
    const drag = 0.0009 * vF * Math.abs(vF) + roll * Math.sign(vF) * Math.min(1, Math.abs(vF)) + vL * vL * 0.0;
    const slopeA = -9.8 * Math.sin(this.pitch);
    const prevVF = vF;
    vF += (a + slopeA - drag) * dt;
    if (decel) { const d = decel * dt; vF = Math.abs(vF) <= d ? 0 : vF - Math.sign(vF) * d; }
    this.lonAcc += ((vF - prevVF) / dt - this.lonAcc) * Math.min(1, dt * 6);

    // lateral grip
    const grip = s.grip * gripK * wet * (this.air ? 0.1 : 1);
    const latCap = grip * (this.drifting ? 0.75 : 1);
    const dvL = Math.min(Math.abs(vL), latCap * dt);
    vL -= Math.sign(vL) * dvL;

    // yaw: kinematic yaw from steering, capped by what the grip can hold
    const lock = 0.62 / (1 + Math.abs(vF) * s.steerFalloff);
    const kin = vF * Math.tan(this.steer * lock) / 2.7;
    const limit = (grip * 1.05) / Math.max(6, Math.abs(vF));
    let target = clamp(kin, -limit, limit);
    if (this.drifting) {
      target = this.driftDir * limit * (1.1 + 0.4 * clamp(Math.abs(this.steer), 0, 1));
      if (Math.abs(this.driftAngle) > 0.5) target = this.driftDir * limit * 0.8;
    }
    this.yawRate += (target - this.yawRate) * Math.min(1, dt * s.response);
    this.h = wrapA(this.h - this.yawRate * dt);
    this.latAcc += (vF * this.yawRate - this.latAcc) * Math.min(1, dt * 5);

    this.vx = fx * vF + rx * vL; this.vz = fz * vF + rz * vL;
    this.x += this.vx * dt; this.z += this.vz * dt;

    // solid things: two circles along the car (front and back)
    this.wallHit = 0;
    fx = Math.sin(this.h); fz = Math.cos(this.h);
    for (const off of [1.25, -1.25]) {
      const cx = this.x + fx * off, cz = this.z + fz * off;
      const res = this.map.collide(cx, cz, 1.0, this.col);
      if (res.hit) {
        this.x += res.x - cx; this.z += res.z - cz;
        const vn = this.vx * res.nx + this.vz * res.nz;
        if (vn < 0) {
          const k = res.soft ? 1.0 : 1.25;
          this.vx -= res.nx * vn * k; this.vz -= res.nz * vn * k;
          const scrub = res.soft ? 0.9 : 1 - Math.min(0.3, -vn * 0.012);
          this.vx *= scrub; this.vz *= scrub;
          this.wallHit = Math.max(this.wallHit, -vn);
          this.yawRate *= 0.5; this.drifting = false;
        }
      }
    }
    // the edge of the map is a wall
    const b = this.map.box, m = 30;
    if (this.x < b.x0 + m) { this.x = b.x0 + m; this.vx = Math.abs(this.vx) * 0.3; }
    if (this.x > b.x1 - m) { this.x = b.x1 - m; this.vx = -Math.abs(this.vx) * 0.3; }
    if (this.z < b.z0 + m) { this.z = b.z0 + m; this.vz = Math.abs(this.vz) * 0.3; }
    if (this.z > b.z1 - m) { this.z = b.z1 - m; this.vz = -Math.abs(this.vz) * 0.3; }

    rx = -Math.cos(this.h); rz = Math.sin(this.h);
    this.vF = this.vx * fx + this.vz * fz; this.vL = this.vx * rx + this.vz * rz;
    this.driftAngle = Math.atan2(this.vL, Math.max(1, Math.abs(this.vF)));

    // vertical: follow the ground, leave it over crests at speed
    const g = this.groundAt(this.x, this.z);
    const gF = this.groundAt(this.x + fx * 1.4, this.z + fz * 1.4), gB = this.groundAt(this.x - fx * 1.4, this.z - fz * 1.4);
    const gR = this.groundAt(this.x + rx * 0.9, this.z + rz * 0.9), gL = this.groundAt(this.x - rx * 0.9, this.z - rz * 0.9);
    const pitchT = Math.atan2(gF - gB, 2.8), rollT = Math.atan2(gR - gL, 1.8);
    this.vy -= 9.8 * dt; this.y += this.vy * dt;
    if (this.y <= g) {
      const land = -this.vy;
      // keep the ground's upward speed so the car can leave crests; ignore jumps from data swaps or steps
      const gv = (g - (this.gPrev ?? g)) / dt;
      this.vy = this.speed > 12 && gv < 8 ? Math.max(0, gv) * 0.85 : 0;
      this.y = g; this.air = false;
      if (land > 6) this.landed = land;
    } else if (this.y > g + 0.25) this.air = true;
    this.gPrev = g;
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 10);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 10);
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
}
