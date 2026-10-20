// Settings and best times in localStorage (always in try/catch: private mode or blocked storage just means no saving).
import { SAVE_KEY } from "./env.js";
const defaults = () => ({ quality: "auto", time: "real", weather: "live", cam: "chase", muted: false, best: {}, controls: "touch" });
export let save = defaults();
export function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); if (s) save = Object.assign(defaults(), s); } catch (_) { /* no storage */ }
  return save;
}
export function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) { /* no storage */ } }
