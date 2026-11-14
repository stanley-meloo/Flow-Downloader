import { useMemo } from "react";

// Film grain with a light chromatic aberration, drawn over the whole app.
//
// Built to be nearly free:
// - The grain is ONE small noise tile (256×256) generated once at startup.
//   Each RGB channel gets its own independent noise, so the specks come out
//   slightly colored (red / green / blue fringes) — the chromatic-aberration
//   look of real film, without re-processing the app's pixels.
// - It "moves" by jumping a pre-tiled layer to random offsets a few times per
//   second with a CSS transform animation, which runs on the GPU compositor:
//   no JavaScript per frame, no repaints.
// - A faint red/cyan fringe toward the window edges adds the lens-style
//   aberration.
// - With the OS "reduce motion" setting the grain stays still.
// - Pointer events pass straight through it.

const TILE = 256;

function makeNoiseTile() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(TILE, TILE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // Mostly gray grain with a small independent offset per channel.
    const base = Math.random() * 255;
    d[i] = Math.min(255, Math.max(0, base + (Math.random() - 0.5) * 70));
    d[i + 1] = Math.min(255, Math.max(0, base + (Math.random() - 0.5) * 70));
    d[i + 2] = Math.min(255, Math.max(0, base + (Math.random() - 0.5) * 70));
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// Default intensity (also used for the old on/off setting: true → default).
const DEFAULT_GRAIN = 15;

// Intensity 0–100 (0 = off).
export function grainIntensity(value) {
  if (value === false) return 0;
  if (value === true || value == null) return DEFAULT_GRAIN;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : DEFAULT_GRAIN;
}

export default function FilmGrain({ intensity }) {
  // Generated once (~10 ms) and reused for the whole session.
  const tile = useMemo(() => (typeof document !== "undefined" ? makeNoiseTile() : ""), []);
  const level = grainIntensity(intensity) / 100; // 0..1
  if (level <= 0 || !tile) return null;          // 0 = nothing rendered at all

  return (
    <div className="film-grain" aria-hidden="true">
      {/* 50 % ≈ grain opacity 0.075; 100 % = 0.15 */}
      <div className="film-grain__noise" style={{ backgroundImage: `url(${tile})`, opacity: 0.15 * level }} />
      {/* Color fringe grows with the intensity (full strength at 100 %) */}
      <div className="film-grain__fringe" style={{ opacity: level }} />
    </div>
  );
}
