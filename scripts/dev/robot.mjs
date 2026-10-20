import { chromium } from "@playwright/test";
const [start = "sprint", secs = 60, speed = 25] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 300, height: 200 } });
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.goto(`http://localhost:4173/index.html?test=1&start=${start}&quality=low`);
await p.waitForFunction(() => window.__hr && window.__hr.G.mode === "drive" && window.__hr.ready, null, { timeout: 120000 });
for (let s = 0; s < +secs; s += 20) console.log(JSON.stringify(await p.evaluate(([n, v]) => window.__hr.robot(n, v), [20, +speed])));
await b.close();
