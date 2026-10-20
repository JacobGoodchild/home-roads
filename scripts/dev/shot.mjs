// Dev screenshots: node scripts/dev/shot.mjs <start> [w] [h] [extra query] [drive seconds]
import { chromium } from "@playwright/test";
const [start = "Overton", w = 412, h = 915, extra = "", secs = 0] = process.argv.slice(2);
const port = process.env.PW_PORT || 4173;
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, hasTouch: +w < 1000 });
const errs = [];
p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text()); });
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
await p.goto(`http://localhost:${port}/index.html?test=1&start=${start}${extra}`);
await p.waitForFunction(() => window.__hr && window.__hr.G.mode === "drive" && window.__hr.ready, null, { timeout: 120000 });
if (+secs) { await p.evaluate(() => window.__hr.drive({ throttle: 1, steer: 0 })); await p.waitForTimeout(+secs * 1000); await p.evaluate(() => window.__hr.drive(null)); }
console.log(JSON.stringify(await p.evaluate(() => window.__hr.info())));
await p.waitForTimeout(1500);
const out = `screenshots/dev-${start}-${w}x${h}${extra.replace(/[^a-z0-9]/gi, "")}.png`;
await p.screenshot({ path: out, timeout: 180000 });
console.log(out, JSON.stringify(await p.evaluate(() => ({ car: window.__hr.car, fps: window.__hr.fps, info: window.__hr.info() }))));
console.log(errs.slice(0, 10).join("\n"));
await b.close();
