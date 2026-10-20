import { chromium } from "@playwright/test";
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 600, height: 400 } });
p.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 300)));
p.on("pageerror", (e) => console.log("PAGEERROR", e.message, e.stack));
await p.goto(`http://localhost:4173/index.html?test=1&start=Overton`);
await p.waitForFunction(() => window.__hr && window.__hr.G.mode === "drive" && window.__hr.ready, null, { timeout: 120000 });
await p.evaluate(() => window.__hr.drive({ throttle: 1, steer: 0 }));
for (let i = 0; i < 6; i++) { await p.waitForTimeout(500); console.log(JSON.stringify(await p.evaluate(() => { const c = window.__hr.G.car; return { x: c.x, z: c.z, vF: c.vF, wall: c.wallHit, surf: c.surface, fps: window.__hr.fps, t: window.__hr.G.ticks, pitch: c.pitch }; }))); }
console.log(await p.evaluate(() => new Promise((res) => { let n = 0, t0 = performance.now(), mx = 0, lt = t0; const f = () => { const t = performance.now(); mx = Math.max(mx, t - lt); lt = t; n++; if (t - t0 < 3000) requestAnimationFrame(f); else res({ n, mx, ticks: window.__hr.G.ticks }); }; requestAnimationFrame(f); })));
console.log(await p.evaluate(() => Promise.race([new Promise((r) => requestAnimationFrame((t) => r('raf ' + t))), new Promise((r) => setTimeout(() => r('timeout'), 5000))])));
console.log(await p.evaluate(() => { const t0 = performance.now(); window.__hr.G.stage.render(); const gl = window.__hr.G.stage.renderer.getContext(); gl.finish(); return performance.now() - t0; }));
await b.close();
