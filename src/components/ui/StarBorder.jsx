// StarBorder — "stars" of light that run around a pill-shaped element, each
// with a trail that fades from `color` (head) to `trailColor` (tail), a soft
// glow and optional sparkles shed by the heads. Inspired by React Bits'
// StarBorder (https://reactbits.dev), rebuilt for the search bar:
//   - it's an OVERLAY (absolute, inset 0, no pointer events) instead of a
//     wrapper, so the bar keeps its own markup; the outline follows the bar's
//     size and is always a full pill (the bar is rounded-full);
//   - speed starts at one lap per `duration` seconds and ACCELERATES the
//     longer it runs (capped) — the search takes time, the ring gets busier;
//   - the heads leave from the middle of the right end (the search button);
//   - `vary`: random shades around `color` / `trailColor` — each star gets
//     its own shades and keeps drifting slowly to new ones, so two stars (or
//     two searches) rarely look the same;
//   - one canvas, drawn with requestAnimationFrame (no React re-render per frame).

import { useEffect, useRef } from 'react';

const MARGIN = 20;   // px around the bar for the glow and sparkles
const SEGMENTS = 48; // pieces per trail (smooth color/opacity falloff)
const FADE_IN = 0.45; // s for the trails to grow to full length

// Acceleration: speed multiplier = min(MAX, 1 + ACCEL · t)
const ACCEL = 0.625;
const MAX_MULT = 6;

const hexToRgb = hex => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex) || /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex);
  if (!m) return [255, 255, 255];
  return m.slice(1, 4).map(v => parseInt(v.length === 1 ? v + v : v, 16));
};
// Colors may also be CSS variables ("var(--accent)") — e.g. the accent that
// follows the background (utils/accentColor.js). Their current value is read
// from the page (re-read a few times per second, so changes flow in).
const varCache = new Map(); // name → { rgb, at }
function toRgb(color) {
  const m = /^var\((--[\w-]+)\)$/.exec(String(color).trim());
  if (!m) return hexToRgb(color);
  const now = performance.now();
  const hit = varCache.get(m[1]);
  if (hit && now - hit.at < 300) return hit.rgb;
  const value = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
  const rgb = value.startsWith("#") ? hexToRgb(value)
    : (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const out = rgb.length === 3 && rgb.every((v) => Number.isFinite(v)) ? rgb : (hit?.rgb || [255, 255, 255]);
  varCache.set(m[1], { rgb: out, at: now });
  return out;
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
// Color conversions for the `vary` mode (h in degrees, s/l in 0..1).
const rgbToHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const hslToRgb = ([h, s, l]) => {
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
};
const clamp01 = v => Math.min(1, Math.max(0, v));
// How far a random shade may stray from the base color.
const VARY = { hue: 8, sat: 0.12, light: 0.1 }; // small: stays the background's colors (a red never drifts to orange)
const randomShade = base => [
  base[0] + (Math.random() * 2 - 1) * VARY.hue,
  clamp01(base[1] + (Math.random() * 2 - 1) * VARY.sat),
  clamp01(base[2] + (Math.random() * 2 - 1) * VARY.light)
];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function StarBorder({
  color = '#931cb5',
  trailColor = '#118ada',
  duration = 4,          // seconds per lap at the start
  direction = 'clockwise',
  stars = 2,
  trailLength = 0.3,     // fraction of the perimeter
  thickness = 1,         // px
  glow = 1,              // 0 = none
  sparkle = true,
  accelerate = true,
  theme = 'dark',        // dark: additive light; light: normal blending
  vary = false,          // random shades around color / trailColor
  className = ''
}) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const propsRef = useRef(null);
  propsRef.current = { color, trailColor, duration, direction, stars, trailLength, thickness, glow, sparkle, accelerate, theme, vary };

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!root || !ctx) return undefined;
    const calm = reducedMotion();

    let w = 0;
    let h = 0;
    let ratio = 1;
    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      w = root.offsetWidth;
      h = root.offsetHeight;
      canvas.width = Math.max(1, Math.round((w + MARGIN * 2) * ratio));
      canvas.height = Math.max(1, Math.round((h + MARGIN * 2) * ratio));
      canvas.style.width = `${w + MARGIN * 2}px`;
      canvas.style.height = `${h + MARGIN * 2}px`;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    resize();

    // Pill outline (centered on the border line), clockwise from the top-left
    // end of the top edge. Returns [x, y] at arc length s.
    const geometry = () => {
      const inset = propsRef.current.thickness / 2;
      const bw = Math.max(0, w - inset * 2);
      const bh = Math.max(0, h - inset * 2);
      const r = bh / 2;
      const straight = Math.max(0, bw - 2 * r);
      const perimeter = 2 * straight + 2 * Math.PI * r;
      const x0 = MARGIN + inset;
      const y0 = MARGIN + inset;
      const at = s => {
        s = ((s % perimeter) + perimeter) % perimeter;
        if (s < straight) return [x0 + r + s, y0];
        s -= straight;
        if (s < Math.PI * r) { const a = -Math.PI / 2 + s / r; return [x0 + bw - r + r * Math.cos(a), y0 + r + r * Math.sin(a)]; }
        s -= Math.PI * r;
        if (s < straight) return [x0 + bw - r - s, y0 + bh];
        s -= straight;
        const a = Math.PI / 2 + s / r;
        return [x0 + r + r * Math.cos(a), y0 + r + r * Math.sin(a)];
      };
      return { perimeter, straight, r, at };
    };

    let g = geometry();
    // Start at the middle of the right end (the search button).
    let head = g.straight + (Math.PI * g.r) / 2;
    let elapsed = 0;
    let last = performance.now();
    let raf = 0;
    let sparkles = [];
    let spawnDebt = 0;
    // vary mode: every star has its own head/tail shades that ease toward new
    // random targets every few seconds (new shades on every search too).
    const shades = Array.from({ length: 8 }, () => {
      const make = base => { const now = randomShade(base); return { now, target: randomShade(base), wait: 1.5 + Math.random() * 2.5 }; };
      return { head: make(rgbToHsl(toRgb(propsRef.current.color))), tail: make(rgbToHsl(toRgb(propsRef.current.trailColor))) };
    });

    const tick = now => {
      const p = propsRef.current;
      const dt = Math.min(0.05, (now - last) / 1000); // clamp after a hidden window
      last = now;
      elapsed += dt;

      g = geometry();
      const { perimeter, at } = g;
      if (perimeter <= 0) { raf = requestAnimationFrame(tick); return; }
      const dir = p.direction === 'counterclockwise' ? -1 : 1;
      const lapsPerSecond = calm ? 0.06 : (1 / Math.max(0.1, p.duration)) * (p.accelerate ? Math.min(MAX_MULT, 1 + ACCEL * elapsed) : 1);
      head += dir * lapsPerSecond * perimeter * dt;

      const grow = calm ? 1 : 1 - Math.pow(1 - Math.min(1, elapsed / FADE_IN), 3);
      const trail = p.trailLength * perimeter * grow;
      const count = Math.max(1, Math.round(p.stars));
      const heads = Array.from({ length: count }, (_, i) => head + (i * perimeter) / count);
      // Color along a star's trail: t = 0 head … 1 tail.
      const fixedHead = toRgb(p.color);
      const fixedTail = toRgb(p.trailColor);
      let starColors = null;
      if (p.vary) {
        const bases = { head: rgbToHsl(fixedHead), tail: rgbToHsl(fixedTail) };
        const ease = 1 - Math.exp(-dt * 0.9); // slow, smooth drift
        shades.forEach(star => ['head', 'tail'].forEach(end => {
          const sh = star[end];
          sh.wait -= dt;
          if (sh.wait <= 0) { sh.target = randomShade(bases[end]); sh.wait = 1.5 + Math.random() * 2.5; }
          sh.now = sh.now.map((v, k) => v + (sh.target[k] - v) * ease);
        }));
        starColors = shades.map(star => [hslToRgb(star.head.now), hslToRgb(star.tail.now)]);
      }
      const colorAt = (i, t) => (starColors
        ? mix(starColors[i % starColors.length][0], starColors[i % starColors.length][1], t)
        : mix(fixedHead, fixedTail, t));

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = p.theme === 'light' ? 'source-over' : 'lighter';
      ctx.lineCap = 'round';

      const drawTrails = (width, alpha) => {
        heads.forEach((s0, i) => {
          let prev = at(s0);
          for (let j = 0; j < SEGMENTS; j++) {
            const t = (j + 1) / SEGMENTS;
            const point = at(s0 - dir * trail * t);
            ctx.strokeStyle = rgba(colorAt(i, t), alpha * Math.pow(1 - j / SEGMENTS, 1.5));
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(point[0], point[1]);
            ctx.stroke();
            prev = point;
          }
        });
      };

      // Glow pass (blurred, wider), then the crisp line.
      if (p.glow > 0) {
        ctx.filter = `blur(${(3 + 3 * p.glow).toFixed(1)}px)`;
        drawTrails(p.thickness * (2 + 2 * p.glow), Math.min(1, 0.55 * p.glow));
        ctx.filter = 'none';
      }
      drawTrails(p.thickness, 1);

      // Heads: a small bright core with a halo.
      heads.forEach((s0, i) => {
        const [x, y] = at(s0);
        const headRgb = colorAt(i, 0);
        const radius = 2 + 3 * p.glow + p.thickness;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(0.35, rgba(headRgb, 0.8));
        grad.addColorStop(1, rgba(headRgb, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      });

      // Sparkles: tiny twinkling dots shed by the heads, more as it speeds up.
      if (p.sparkle && !calm) {
        spawnDebt += dt * 26 * count * Math.min(3, lapsPerSecond * p.duration); // sparkles: capped lower than the speed
        while (spawnDebt >= 1) {
          spawnDebt -= 1;
          const star = Math.floor(Math.random() * count);
          const along = Math.random() * 0.35;
          const s0 = heads[star] - dir * along * trail;
          const [x, y] = at(s0);
          const angle = Math.random() * Math.PI * 2;
          const speed = 6 + Math.random() * 16;
          const pick = Math.random();
          sparkles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            age: 0,
            life: 0.45 + Math.random() * 0.5,
            size: 0.5 + Math.random() * 1.1,
            phase: Math.random() * 6.28,
            rgb: pick < 0.8 ? colorAt(star, along) : [255, 255, 255]
          });
        }
        sparkles = sparkles.filter(sp => {
          sp.age += dt;
          if (sp.age >= sp.life) return false;
          sp.x += sp.vx * dt;
          sp.y += sp.vy * dt;
          const a = (1 - sp.age / sp.life) * (0.55 + 0.45 * Math.sin(sp.age * 28 + sp.phase));
          ctx.fillStyle = rgba(sp.rgb, Math.max(0, a));
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
          ctx.fill();
          return true;
        });
      }

      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={rootRef} className={`absolute inset-0 pointer-events-none ${className}`.trim()} aria-hidden="true">
      <canvas ref={canvasRef} className="absolute" style={{ left: -MARGIN, top: -MARGIN }} />
    </div>
  );
}
