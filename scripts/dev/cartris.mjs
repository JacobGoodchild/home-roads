import { chromium } from "@playwright/test";
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.goto(`http://localhost:4173/index.html?test=1&start=Overton&quality=low`);
await p.waitForFunction(() => window.__hr && window.__hr.G.mode === "drive", null, { timeout: 120000 });
console.log(await p.evaluate(async () => {
  const out = [];
  const G = window.__hr.G; let n = 0, tris = 0;
  G.world.root.traverse((o) => { if (o.isInstancedMesh && o.count > 5) { n++; tris += o.geometry.attributes.position.count / 3 * o.count; out.push([o.geometry.attributes.position.count / 3 | 0, o.count, o.material.name || o.material.color?.getHexString(), o.material.roughness]); } });
  return JSON.stringify(out.slice(0, 40));
}));
await b.close();
