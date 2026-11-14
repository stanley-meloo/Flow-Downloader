// A small explosion of light from the search button when a search starts:
// a bright core flashes and expands, and a spray of sparks shoots out in all
// directions, slowing down (drag) and fading — in the background's two
// colors (--glow-1 / --glow-2, utils/accentColor.js) plus a little white.
// Plays once on mount (the search overlay mounts when the search starts),
// ~0.9 s, one canvas, then stops drawing. Off with reduced motion.
// Also used anywhere else through fireBurst(x, y) + <BurstLayer /> (the
// "Support Flow Downloader" heart and menu item).

import { useEffect, useRef, useState } from "react";

const W = 420, H = 260;        // canvas (centered on the button)
const SPARKS = 34;
const DURATION = 1.0;          // s until everything has faded

const readColor = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (v.startsWith("#") && v.length >= 7) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  const m = v.match(/[\d.]+/g);
  return m && m.length >= 3 ? m.slice(0, 3).map(Number) : fallback;
};
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export default function SearchBurst({ at }) { // at = { x, y } in the window (fixed); default: the search button
  const ref = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return undefined;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const c1 = readColor("--glow-1", [122, 108, 240]);
    const c2 = readColor("--glow-2", [61, 180, 238]);
    const cx = W / 2, cy = H / 2;

    const sparks = Array.from({ length: SPARKS }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 160 + Math.random() * 360;          // px/s
      const pick = Math.random();
      return {
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.75,            // a bit flatter: follows the bar
        life: 0.45 + Math.random() * 0.5,
        size: 1 + Math.random() * 1.8,
        color: pick < 0.45 ? c1 : pick < 0.85 ? c2 : [255, 255, 255],
      };
    });

    const start = performance.now();
    let last = start;
    let raf = 0;
    const frame = (now) => {
      const t = (now - start) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      // Core: a bright flash that swells and fades fast.
      if (t < 0.45) {
        const k = t / 0.45;
        const r = 14 + 70 * (1 - Math.pow(1 - k, 3));
        const a = (1 - k) * (1 - k);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba([255, 255, 255], 0.9 * a));
        g.addColorStop(0.3, rgba(c1, 0.75 * a));
        g.addColorStop(0.7, rgba(c2, 0.25 * a));
        g.addColorStop(1, rgba(c2, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sparks: short streaks along their direction, slowing down.
      const drag = Math.pow(0.04, dt); // keeps ~4% of the speed per second
      ctx.lineCap = "round";
      for (const s of sparks) {
        if (t > s.life) continue;
        s.vx *= drag; s.vy *= drag;
        s.x += s.vx * dt; s.y += s.vy * dt;
        const a = 1 - t / s.life;
        const tail = 0.035;
        ctx.strokeStyle = rgba(s.color, a);
        ctx.lineWidth = s.size;
        ctx.beginPath();
        ctx.moveTo(s.x - s.vx * tail, s.y - s.vy * tail);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      if (t < DURATION) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="absolute pointer-events-none"
      // Centered on the search button: w-12 inside the bar's p-2 → 32 px from the right.
      style={at
        ? { position: "fixed", zIndex: 10060, width: W, height: H, left: at.x - W / 2, top: at.y - H / 2 }
        : { width: W, height: H, right: 32 - W / 2, top: "50%", marginTop: -H / 2 }}
    />
  );
}

// --- Bursts anywhere: fireBurst(x, y) → <BurstLayer /> (mounted once in App) ---
export function fireBurst(x, y) {
  window.dispatchEvent(new CustomEvent("fd:burst", { detail: { x, y } }));
}

export function BurstLayer() {
  const [bursts, setBursts] = useState([]);
  useEffect(() => {
    let n = 0;
    const onBurst = (e) => {
      const id = ++n;
      setBursts((list) => [...list, { id, x: e.detail.x, y: e.detail.y }]);
      setTimeout(() => setBursts((list) => list.filter((b) => b.id !== id)), (DURATION + 0.2) * 1000);
    };
    window.addEventListener("fd:burst", onBurst);
    return () => window.removeEventListener("fd:burst", onBurst);
  }, []);
  return bursts.map((b) => <SearchBurst key={b.id} at={b} />);
}
