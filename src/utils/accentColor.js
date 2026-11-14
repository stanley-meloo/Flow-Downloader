// Accent color that follows the background.
//
// Every few seconds a tiny copy of the current background is read — the same
// live snapshot the liquid glass uses (liquidGlass/backdrop.js), so it works
// for every kind of background: WebGL engines, wallpapers (animated too),
// colors, gradients, photos. Its most prominent color (by hue, weighting
// saturated and bright pixels; the dark parts are ignored) becomes the app's
// accent: --accent (icons, text) and --accent-strong (fills: switches,
// selected segments, buttons), always tuned to read well on the dark UI.
// The second most prominent color is --accent-2; --glow-1 / --glow-2 are
// both colors more saturated, for the search bar's light effects.
// The change fades in smoothly (@property + transition in App.css).
// With no real color in the background (black, grey…) the default indigo is used.

import { getBackdrop } from "../components/ui/liquidGlass/backdrop";

const W = 64, H = 36;          // sample size
const INTERVAL = 2500;         // ms between samples
const BINS = 24;               // hue buckets (15° each)
const DEFAULT = { accent: "#818cf8", strong: "#6366f1", second: "#38bdf8", glow1: "#7a6cf0", glow2: "#3db4ee" }; // indigo / sky

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

// Dominant hue of the pixels → { accent, strong } hex colors (null = no color).
export function dominantAccent(data) {
  const weight = new Float64Array(BINS);
  const sumR = new Float64Array(BINS), sumG = new Float64Array(BINS), sumB = new Float64Array(BINS);
  let colorful = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max / 255;
    const s = max ? (max - min) / max : 0;
    if (v < 0.14 || s < 0.25) continue; // dark or greyish: not a color
    let h;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h = ((h * 60) + 360) % 360;
    const bin = Math.floor(h / (360 / BINS)) % BINS;
    const w = s * v * v; // vivid + bright pixels count most
    weight[bin] += w; sumR[bin] += r * w; sumG[bin] += g * w; sumB[bin] += b * w;
    colorful += 1;
  }
  if (colorful < (data.length / 4) * 0.015) return null; // < 1.5% colored pixels
  // Hue score: a bin smoothed with its neighbours (a color spread over two bins).
  const score = (i) => weight[i] + 0.5 * (weight[(i + 1) % BINS] + weight[(i + BINS - 1) % BINS]);
  let best = 0;
  for (let i = 1; i < BINS; i++) if (score(i) > score(best)) best = i;
  const tone = (bin) => {
    let R = 0, G = 0, B = 0, Wt = 0;
    for (const i of [bin, (bin + 1) % BINS, (bin + BINS - 1) % BINS]) {
      R += sumR[i]; G += sumG[i]; B += sumB[i]; Wt += weight[i];
    }
    return toHsl(R / Wt, G / Wt, B / Wt);
  };
  const [h, s0] = tone(best);
  const s = Math.min(0.95, Math.max(0.55, s0));
  // Second color: the strongest hue clearly different from the first (≥ 45°
  // away) that's still a real part of the picture. Without one, the second
  // stays the SAME hue (a deeper shade) — a red background gives two reds,
  // never a made-up orange.
  let second = -1;
  for (let i = 0; i < BINS; i++) {
    const dist = Math.min(Math.abs(i - best), BINS - Math.abs(i - best)) * (360 / BINS);
    if (dist < 45 || score(i) < score(best) * 0.12) continue;
    if (second < 0 || score(i) > score(second)) second = i;
  }
  const [h2, s2raw] = second >= 0 ? tone(second) : [h, s0];
  const sameHue = second < 0;
  const s2 = Math.min(0.95, Math.max(0.55, s2raw));
  return {
    accent: hslToHex(h, s, 0.7),
    strong: hslToHex(h, Math.min(0.9, s), 0.56),
    second: hslToHex(h2, s2, sameHue ? 0.52 : 0.66),
    // More saturated versions of both (between the UI accent and full
    // saturation), only for the search bar's light effects.
    glow1: hslToHex(h, 0.8, 0.63),
    glow2: hslToHex(h2, 0.8, sameHue ? 0.5 : 0.61),
  };
}

// r, g, b (0–255) → [hue°, saturation 0–1]
function toHsl(R, G, B) {
  const r = R / 255, g = G / 255, b = B / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = ((h * 60) + 360) % 360;
  const l = (max + min) / 2;
  return [h, d ? d / (1 - Math.abs(2 * l - 1)) : 0];
}

export function startAccentColor() {
  if (typeof window === "undefined" || window.__accentColor) return;
  window.__accentColor = true;
  const sample = document.createElement("canvas");
  sample.width = W; sample.height = H;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  const rootStyle = document.documentElement.style;
  let last = "";

  const apply = ({ accent, strong, second, glow1, glow2 }) => {
    const key = accent + strong + second + glow1 + glow2;
    if (key === last) return;
    last = key;
    rootStyle.setProperty("--accent", accent);
    rootStyle.setProperty("--accent-strong", strong);
    rootStyle.setProperty("--accent-2", second);
    rootStyle.setProperty("--glow-1", glow1);
    rootStyle.setProperty("--glow-2", glow2);
  };

  const tick = () => {
    if (document.hidden) return;
    try {
      const backdrop = getBackdrop();
      backdrop.capture();
      const src = backdrop.canvas;
      if (!src.width || !src.height) return;
      ctx.drawImage(src, 0, 0, W, H);
      apply(dominantAccent(ctx.getImageData(0, 0, W, H).data) || DEFAULT);
    } catch {
      /* unreadable frame: keep the current accent */
    }
  };

  setTimeout(tick, 800); // after the first background frames
  setInterval(tick, INTERVAL);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}
