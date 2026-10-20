// Top-down / free camera view: node scripts/dev/top.mjs <start> <height> [lookx lookz] [eyeOffsetX eyeOffsetZ]
import { chromium } from "@playwright/test";
const [start = "Overton", hgt = 120, ox = 0, oz = 0, ex = 0, ez = 0.01, w = 900, h = 900] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.goto(`http://localhost:4173/index.html?test=1&start=${start}&quality=high`);
await p.waitForFunction(() => window.__hr && window.__hr.G.mode === "drive" && window.__hr.ready, null, { timeout: 120000 });
await p.evaluate(([hgt, ox, oz, ex, ez]) => {
  const G = window.__hr.G, c = G.car, cam = G.stage.camera; G.freeCam = true;
  document.getElementById("hud").hidden = true;
  const tx = c.x + ox, tz = c.z + oz, ty = G.map.heightAt(tx, tz);
  cam.position.set(tx + ex, ty + hgt, tz + ez); cam.up.set(0, 1, 0); cam.fov = 50; cam.updateProjectionMatrix(); cam.lookAt(tx, ty, tz);
}, [+hgt, +ox, +oz, +ex, +ez]);
await p.waitForTimeout(2500);
await p.screenshot({ path: `screenshots/dev-top-${start}.png` });
await b.close();
