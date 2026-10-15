// "Snake" of RGB light that runs around a pill-shaped element (the search bar
// while a link is analyzed).
//
// - Shape: an SVG rounded rect with pathLength=100. The snake is made of many
//   tiny dashes laid end to end; their opacity falls off from head to tail, so
//   the tail fades smoothly (no visible steps).
// - Colors: each dash gets its own hue, shifting a little from one to the next
//   and drifting over time → the colors blend continuously, with no point where
//   one ends and the next begins.
// - Speed: starts calm and accelerates progressively the longer the search
//   takes (capped). Driven by requestAnimationFrame, writing the SVG attributes
//   directly (no React re-render per frame).
// - Start: the head leaves from the middle of the bar's right end (where the
//   search button is) and the snake grows out of it, together with a short RGB
//   shockwave around the button — as if the click released it.

import { useEffect, useRef, useState } from "react";

const STROKE = 1.5;        // px, line thickness
const HALO = STROKE * 3.5; // px, soft halo under the line
const SEGMENTS = 32;       // tiny dashes that make up the snake
const LENGTH = 30;         // snake length, % of the perimeter
const HUE_SPAN = 150;      // hue difference between head and tail (degrees)
const HUE_DRIFT = 70;      // how fast the colors drift (degrees / s)
const GROW = 0.5;          // s for the snake to come out of the button at full length

// Speed in laps per second: v = min(MAX, START + ACCEL · t)
const SPEED_START = 1.6;
const SPEED_ACCEL = 0.6;   // laps/s gained every second
const SPEED_MAX = 4;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function SearchSnake({ className = "" }) {
  const rootRef = useRef(null);
  const lineRefs = useRef([]);
  const haloRefs = useRef([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Follow the bar's size.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Animation loop (restarts from the calm speed each time the snake appears).
  useEffect(() => {
    if (!size.w || !size.h) return;
    const calm = reducedMotion();
    const all = () => [...lineRefs.current, ...haloRefs.current];

    // Where the middle of the right end sits on the outline (the rect path starts
    // at the top-left, right after the corner, and runs clockwise).
    const r = (size.h - STROKE) / 2;
    const straight = Math.max(0, size.w - STROKE - 2 * r);
    const perimeter = 2 * straight + 2 * Math.PI * r;
    let head = ((straight + (Math.PI * r) / 2) / perimeter) * 100; // 0..100
    let seg = -1;
    let hue = 190;     // head hue (starts on cyan)
    let elapsed = 0;
    let last = performance.now();
    let frame = 0;

    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); // clamp after a hidden tab
      last = now;
      elapsed += dt;
      const speed = calm ? 0.12 : Math.min(SPEED_MAX, SPEED_START + SPEED_ACCEL * elapsed);

      // Snake grows out of the button during the first GROW seconds (ease-out).
      const grow = calm ? 1 : Math.min(1, elapsed / GROW);
      const nextSeg = (LENGTH * (1 - Math.pow(1 - grow, 3))) / SEGMENTS;
      if (nextSeg !== seg) {
        seg = nextSeg;
        const dash = `${seg + 0.05} ${100 - seg - 0.05}`; // ~half-pixel overlap hides the seams
        all().forEach((el) => el?.setAttribute("stroke-dasharray", dash));
      }
      head = (head + speed * 100 * dt) % 100;
      hue = (hue + (calm ? 15 : HUE_DRIFT) * dt) % 360;

      for (let j = 0; j < SEGMENTS; j++) {
        // dash j covers [head - (j+1)·seg, head - j·seg]
        const start = head - (j + 1) * seg;
        const offset = (-start).toFixed(3);
        const fade = Math.pow(1 - j / SEGMENTS, 1.7);
        const color = `hsl(${(hue - (j * HUE_SPAN) / SEGMENTS + 360) % 360} 95% 64%)`;
        const line = lineRefs.current[j];
        const halo = haloRefs.current[j];
        if (line) {
          line.setAttribute("stroke-dashoffset", offset);
          line.setAttribute("stroke", color);
          line.setAttribute("stroke-opacity", fade.toFixed(3));
        }
        if (halo) {
          halo.setAttribute("stroke-dashoffset", offset);
          halo.setAttribute("stroke", color);
          halo.setAttribute("stroke-opacity", fade.toFixed(3));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [size.w, size.h]);

  const burst = !reducedMotion();

  const { w, h } = size;
  const geometry = {
    x: STROKE / 2,
    y: STROKE / 2,
    width: Math.max(0, w - STROKE),
    height: Math.max(0, h - STROKE),
    rx: Math.max(0, (h - STROKE) / 2),
    pathLength: 100,
    fill: "none",
    stroke: "transparent",
    strokeLinecap: "butt",
  };
  const indexes = Array.from({ length: SEGMENTS }, (_, i) => i);

  return (
    <div ref={rootRef} className={`absolute inset-0 pointer-events-none ${className}`} aria-hidden="true">
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="absolute inset-0 overflow-visible">
          {/* faint halo right on the line */}
          <g className="search-snake__halo">
            {indexes.map((j) => (
              <rect key={j} ref={(el) => (haloRefs.current[j] = el)} {...geometry} strokeWidth={HALO} />
            ))}
          </g>
          <g>
            {indexes.map((j) => (
              <rect key={j} ref={(el) => (lineRefs.current[j] = el)} {...geometry} strokeWidth={STROKE} />
            ))}
          </g>
        </svg>
      )}
      {/* RGB shockwave around the search button when the snake is released */}
      {burst && (
        <>
          <span className="search-snake-burst-halo"><span className="search-snake-burst" /></span>
          <span className="search-snake-burst" />
        </>
      )}
    </div>
  );
}
