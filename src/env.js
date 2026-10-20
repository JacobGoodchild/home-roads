// Reads URL options. Test mode (?test=1) fixes the random seed, speeds up nothing, and exposes a hook for tests.
const q = new URLSearchParams(globalThis.location ? location.search : "");
export const TEST = q.has("test");
export const FORCE_QUALITY = q.get("quality"); // low | medium | high
export const START = q.get("start");           // spawn name, skips the menu (tests + screenshots)
export const HOUR = q.has("hour") ? Number(q.get("hour")) : null; // force a time of day
export const RAIN = q.has("rain") ? q.get("rain") === "1" : null;
export const SAVE_KEY = TEST ? "homeroads.test.save" : "homeroads.save.v1";
