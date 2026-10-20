import { chromium } from "@playwright/test";
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 400, height: 300 } });
await p.goto(`http://localhost:4173/index.html?test=1&start=B3400`);
await p.waitForFunction(() => window.__hr && window.__hr.G.mode === "drive" && window.__hr.ready, null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(() => { const G = window.__hr.G, c = G.car, m = G.map; const r = m.roadAt(c.x, c.z, {}); return { car: [c.x, c.y, c.z], h: m.heightAt(c.x, c.z), far: m.farHeight(c.x, c.z), r: { d: r.d, y: r.y, b: r.seg && r.seg.b, ay: r.seg && r.seg.ay, by: r.seg && r.seg.by }, ground: c.groundAt(c.x, c.z) }; })));
await b.close();
