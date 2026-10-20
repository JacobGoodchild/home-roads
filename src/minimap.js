// Heading-up round minimap drawn from the real OpenStreetMap roads (simplified in meta.json).
const COL = ["#ffd36a", "#ffd36a", "#ffd36a", "#f5c56b", "#efe6c8", "#e2e2da", "#d6d6d0", "#cfcfc8", "#9a9a94", "#8a7a5a"];
const WID = [5, 5, 4.5, 4.2, 3.6, 3, 2.6, 2.4, 1.6, 1.4];

export class Minimap {
  constructor(canvas, meta) {
    this.c = canvas; this.g = canvas.getContext("2d");
    this.lines = meta.mini.map((m) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < m.p.length; i += 2) { x0 = Math.min(x0, m.p[i]); x1 = Math.max(x1, m.p[i]); z0 = Math.min(z0, m.p[i + 1]); z1 = Math.max(z1, m.p[i + 1]); }
      return { ...m, x0, x1, z0, z1 };
    }).sort((a, b) => b.c - a.c);
    this.rail = meta.rail; this.range = 380; this.route = null; this.target = null;
  }
  draw(x, z, h) {
    const g = this.g, W = this.c.width, R = this.range, s = W / 2 / R;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, 7); g.clip();
    g.fillStyle = "rgba(34,52,36,.75)"; g.fillRect(0, 0, W, W);
    // world -> map: car at centre, heading up. Heading h faces (sin h, cos h) in x/z.
    g.translate(W / 2, W / 2); g.rotate(h - Math.PI); g.scale(s, s); g.translate(-x, -z);
    g.lineCap = g.lineJoin = "round";
    g.strokeStyle = "rgba(60,40,30,.9)"; g.lineWidth = 2 / s; g.setLineDash([6 / s, 4 / s]);
    for (const r of this.rail) { g.beginPath(); for (let i = 0; i < r.p.length; i += 3) i ? g.lineTo(r.p[i], r.p[i + 1]) : g.moveTo(r.p[i], r.p[i + 1]); g.stroke(); }
    g.setLineDash([]);
    if (this.route) {
      g.strokeStyle = "rgba(80,190,255,.55)"; g.lineWidth = 9 / s; g.beginPath();
      for (let i = 0; i < this.route.length; i += 2) i ? g.lineTo(this.route[i], this.route[i + 1]) : g.moveTo(this.route[i], this.route[i + 1]);
      g.stroke();
    }
    for (const l of this.lines) {
      if (l.x1 < x - R || l.x0 > x + R || l.z1 < z - R || l.z0 > z + R) continue;
      g.strokeStyle = COL[l.c] || "#ccc"; g.lineWidth = (WID[l.c] || 2) / s;
      g.beginPath(); for (let i = 0; i < l.p.length; i += 2) i ? g.lineTo(l.p[i], l.p[i + 1]) : g.moveTo(l.p[i], l.p[i + 1]); g.stroke();
    }
    if (this.target) { g.fillStyle = "#4fc3ff"; g.beginPath(); g.arc(this.target[0], this.target[1], 9 / s, 0, 7); g.fill(); }
    g.restore();
    // the car
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#ff5a3c"; g.strokeStyle = "#fff"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W / 2, W / 2 - 13); g.lineTo(W / 2 + 9, W / 2 + 10); g.lineTo(W / 2, W / 2 + 5); g.lineTo(W / 2 - 9, W / 2 + 10); g.closePath(); g.fill(); g.stroke();
  }
}
