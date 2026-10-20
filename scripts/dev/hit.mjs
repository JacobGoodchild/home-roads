import { chromium } from "@playwright/test";
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 300, height: 200 } });
await p.goto(`http://localhost:4173/index.html?test=1&start=sprint&quality=low`);
await p.waitForFunction(() => window.__hr && window.__hr.G.mode === "drive" && window.__hr.ready, null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(() => {
  const G = window.__hr.G, r = G.map.meta.sprint.route, car = G.car, out = [];
  out.push({ car: [car.x, car.z, car.h], r0: r.slice(0, 12) });
  // which solids/walls touch the first 300 m of the route?
  for (let k = 0; k < 60; k += 2) {
    const res = G.map.collide(r[k], r[k + 1], 1.0);
    if (res.hit) out.push({ k, at: [r[k], r[k + 1]], push: [res.x - r[k], res.z - r[k + 1]], soft: res.soft });
  }
  return out;
})));
await b.close();
