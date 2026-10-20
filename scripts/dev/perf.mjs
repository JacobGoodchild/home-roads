// Triangle/draw-call breakdown at a spawn: node scripts/dev/perf.mjs Overton [quality]
import { chromium } from "@playwright/test";
const [start = "Overton", q = "medium"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 412, height: 915 } });
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.goto(`http://localhost:4173/index.html?test=1&start=${start}&quality=${q}`);
await p.waitForFunction(() => window.__hr && window.__hr.G.mode === "drive" && window.__hr.ready, null, { timeout: 120000 });
await p.waitForTimeout(2000);
console.log(JSON.stringify(await p.evaluate(() => {
  const G = window.__hr.G, out = {};
  G.world.root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    const k = (o.material.customProgramCacheKey && o.material.customProgramCacheKey()) || o.material.type;
    out[k] = out[k] || { tris: 0, meshes: 0 }; out[k].tris += Math.round(n); out[k].meshes++;
  });
  return { out, info: window.__hr.info() };
}), null, 1));
await b.close();
