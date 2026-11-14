// Dark-on-light switch for a few UI elements (the search bar's placeholder,
// the Settings gear): when what's really behind one of them is light, it gets
// data-on-light="true" and App.css turns it dark, so it stays readable.
//
// "What's really behind" = the liquid glass the element sits on, composited
// over the background — not the background alone: a white wallpaper seen
// through the dark-tinted glass is mid-grey, and the element has to contrast
// with THAT. The glass canvas keeps its last frame (preserveDrawingBuffer,
// liquidGlass/renderer.js), so it can be read back; where it's transparent
// (the clear core) the background snapshot (liquidGlass/backdrop.js) shows.
//
// Mark an element with data-contrast. In `tauri dev` its measured brightness
// is written to data-contrast-lum — handy to check in the dev tools.

import { getBackdrop } from "../components/ui/liquidGlass/backdrop";

const INTERVAL = 300;   // ms between checks
// Only for extreme cases (almost white behind it): a bright but colorful
// background (grass, sky, sunset) keeps the normal light element.
const ON = 0.78;        // brightness above which it counts as light…
const OFF = 0.7;        // …and below which it's dark again (hysteresis: no flicker)
const CHROMA = 0.22;    // max average colorfulness for "almost white"
const MID = 0.28;       // above this (but not light): mid-grey
const SW = 24, SH = 8;  // sample size

// sRGB channel (0–255) → linear light.
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
// Perceived brightness (CIE L*, 0–1).
const lightness = (r, g, b) => {
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y) / 100;
};

// The liquid-glass canvas under an element: inside it (a button holding its
// glass) or a direct child of one of its ancestors (an input in a glass bar).
function glassCanvasOf(el) {
  const inside = el.querySelector?.("canvas");
  if (inside) return inside;
  for (let n = el.parentElement, i = 0; n && i < 4; n = n.parentElement, i++) {
    const c = Array.from(n.children).find((k) => k.tagName === "CANVAS");
    if (c) return c;
  }
  return null;
}

export function startContrastWatch() {
  if (typeof window === "undefined" || window.__contrastWatch) return;
  window.__contrastWatch = true;

  const bgCanvas = document.createElement("canvas");
  bgCanvas.width = SW; bgCanvas.height = SH;
  const bgCtx = bgCanvas.getContext("2d", { willReadFrequently: true });
  const glCanvas = document.createElement("canvas");
  glCanvas.width = SW; glCanvas.height = SH;
  const glCtx = glCanvas.getContext("2d", { willReadFrequently: true });

  const measure = (el, backdrop) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;

    // 1) The background under it.
    const src = backdrop.canvas;
    const base = backdrop.rect();
    if (!src.width || !base.width) return null;
    const sx = src.width / base.width, sy = src.height / base.height;
    bgCtx.clearRect(0, 0, SW, SH);
    bgCtx.drawImage(src, (r.left - base.left) * sx, (r.top - base.top) * sy, r.width * sx, r.height * sy, 0, 0, SW, SH);
    const bg = bgCtx.getImageData(0, 0, SW, SH).data;

    // 2) The glass over it (if any), same area.
    let gl = null;
    const glass = glassCanvasOf(el);
    if (glass && glass.width > 0) {
      const gr = glass.getBoundingClientRect();
      const kx = glass.width / Math.max(1, gr.width), ky = glass.height / Math.max(1, gr.height);
      glCtx.clearRect(0, 0, SW, SH);
      try {
        glCtx.drawImage(glass, (r.left - gr.left) * kx, (r.top - gr.top) * ky, r.width * kx, r.height * ky, 0, 0, SW, SH);
        gl = glCtx.getImageData(0, 0, SW, SH).data;
      } catch { gl = null; }
    }

    // 3) Glass over background, averaged.
    let sum = 0, chroma = 0;
    for (let i = 0; i < bg.length; i += 4) {
      let rr = bg[i], gg = bg[i + 1], bb = bg[i + 2];
      if (gl) {
        const a = gl[i + 3] / 255;
        rr = gl[i] * a + rr * (1 - a);
        gg = gl[i + 1] * a + gg * (1 - a);
        bb = gl[i + 2] * a + bb * (1 - a);
      }
      sum += lightness(rr, gg, bb);
      chroma += (Math.max(rr, gg, bb) - Math.min(rr, gg, bb)) / 255;
    }
    const n = bg.length / 4;
    return { lum: sum / n, chroma: chroma / n };
  };

  const tick = () => {
    if (document.hidden) return;
    const els = document.querySelectorAll("[data-contrast]");
    if (!els.length) return;
    let backdrop;
    try { backdrop = getBackdrop(); backdrop.capture(); } catch { return; }
    els.forEach((el) => {
      try {
        const m = measure(el, backdrop);
        if (!m) return;
        const { lum, chroma } = m;
        if (import.meta.env.DEV) el.setAttribute("data-contrast-lum", `${lum.toFixed(2)} / chroma ${chroma.toFixed(2)}`);
        const light = el.getAttribute("data-on-light") === "true";
        // "Light" = very bright AND close to white/grey (little color).
        const next = light ? lum > OFF && chroma < CHROMA + 0.05 : lum > ON && chroma < CHROMA;
        if (next !== light) el.setAttribute("data-on-light", next ? "true" : "false");
        // Mid-grey (neither dark nor light): the default dim grey of the
        // placeholder would vanish there — App.css makes it lighter.
        const mid = !next && lum > MID;
        if ((el.getAttribute("data-on-mid") === "true") !== mid) el.setAttribute("data-on-mid", mid ? "true" : "false");
      } catch (e) {
        console.warn("[contrast]", e);
      }
    });
  };

  setTimeout(tick, 600);
  setInterval(tick, INTERVAL);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}
