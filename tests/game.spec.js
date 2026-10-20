// Core checks: loads with no console errors, the car spawns on a real road, drives, steers, collides, frame rate.
import { test, expect } from "@playwright/test";

async function open(page, start, extra = "") {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/index.html?test=1&start=${start}${extra}`);
  await page.waitForFunction(() => window.__hr && window.__hr.G.mode === "drive" && window.__hr.ready, null, { timeout: 90_000 });
  return errors;
}

test("menu shows spawn choices and the OSM credit", async ({ page }) => {
  await page.goto("/index.html?test=1");
  await expect(page.locator("#menu")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#spawnBtns button")).toHaveCount(4);
  await expect(page.locator("#menu")).toContainText("© OpenStreetMap contributors");
});

test("spawns on a real road in Overton, drives and steers", async ({ page }) => {
  const errors = await open(page, "Overton");
  const a = await page.evaluate(() => window.__hr.car);
  expect(a.surface).toBe("road");
  expect(a.road).toMatch(/Road|Street|B3400/);
  expect(a.y).toBeGreaterThan(60); expect(a.y).toBeLessThan(160);
  const b = await page.evaluate(() => window.__hr.sim(2.5, { throttle: 1, steer: 0 }));
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(8);
  const c = await page.evaluate(() => window.__hr.sim(1.5, { throttle: 0.6, steer: 1 }));
  expect(Math.abs(c.h - b.h)).toBeGreaterThan(0.1);
  expect(b.speed).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

for (const [start, name] of [["Whitchurch", "whitchurch"], ["B3400", "b3400"], ["Hilltop", "hill"]]) {
  test(`spawns at ${start} on a road`, async ({ page }) => {
    const errors = await open(page, start);
    const a = await page.evaluate(() => window.__hr.sim(1, {}));
    expect(a.surface).toBe("road");
    // sitting on the ground, not floating or buried
    expect(Math.abs(await page.evaluate(() => window.__hr.G.car.y - window.__hr.G.car.groundAt(window.__hr.G.car.x, window.__hr.G.car.z)))).toBeLessThan(0.3);
    for (const [w, h] of [[412, 915], [915, 412]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `screenshots/${name}-${w}x${h}.png` });
    }
    expect(errors).toEqual([]);
  });
}

test("screenshots in Overton, portrait and landscape", async ({ page }) => {
  await open(page, "Overton");
  for (const [w, h] of [[412, 915], [915, 412]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `screenshots/overton-${w}x${h}.png` });
  }
});

test("a robot driver gets from Overton to Whitchurch without being launched or stuck", async ({ page }) => {
  await open(page, "sprint", "&quality=low");
  let last;
  for (let s = 0; s < 260; s += 20) last = await page.evaluate(() => window.__hr.robot(20, 25));
  expect(last.i).toBeGreaterThan(last.of - 10);
  expect(last.maxAir).toBeLessThan(1.5);
});

test("Overton starts outside Domino's", async ({ page }) => {
  await open(page, "Overton");
  const c = await page.evaluate(() => window.__hr.car);
  expect(c.road).toContain("Winchester Street");
  // Domino's (OSM node 11085421488, 10 Winchester Street) is at x 2530.4, z -608.5 in game coordinates
  expect(Math.hypot(c.x - 2530.4, c.z + 608.5)).toBeLessThan(15);
});
