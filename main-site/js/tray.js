// The edge tray, per edge-tray-spec.md: the app's global actions as a
// column of icon buttons at the top right, with a tab that slides them off
// the edge and back. Remembered per browser; open unless it was left shut.
//
// The head's pre-paint script adds .tray-start-collapsed for somebody who
// left it shut, so it does not visibly slide closed on load. That class
// comes off a frame after the real state is set, so later toggles animate.

import { store } from "./ui.js";

const TRAY_KEY = "pokeguessr.trayOpen";

const $ = (id) => document.getElementById(id);

function setTray(open, { save = true } = {}) {
  const tray = $("tray");
  const tab = $("trayTab");
  tray.classList.toggle("collapsed", !open);
  tab.setAttribute("aria-expanded", String(open));
  tab.setAttribute("aria-label", open ? "Hide menu" : "Show menu");
  tab.title = open ? "Hide menu" : "Show menu";
  // Off-screen buttons must not take focus or clicks.
  $("trayButtons").inert = !open;
  document.body.classList.toggle("tray-open", open);
  if (save) store.set(TRAY_KEY, open ? "1" : "0");
}

export function initTray() {
  setTray(store.get(TRAY_KEY) !== "0", { save: false });
  requestAnimationFrame(() => document.documentElement.classList.remove("tray-start-collapsed"));
  $("trayTab").addEventListener("click", () => setTray($("tray").classList.contains("collapsed")));
}
