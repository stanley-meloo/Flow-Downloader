// Trim mode — under the strip: the time ruler, or the sound waveform.

import { useEffect, useRef, useState, useMemo } from "react";
import { animate, usePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { formatClock } from "../../../utils/trim";
import { clamp } from "./shared";

// Time ruler with steps picked from the video's length and the strip's width:
// - big, labelled ticks: the smallest "round" step (1 s, 2 s, 5 s, 10 s, 15 s,
//   30 s, 1 min, 2 min, 5 min…) that gives about one label per ~110 px —
//   between 4 and 10 labels, so a 20 s clip still gets several and a 3 h
//   video isn't crowded;
// - small ticks between them: the finest round step that divides the big one
//   evenly, stays ≥ 8 px apart and makes at most 10 per big step.
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];
const LABEL_SPACING = 110; // px aimed between labels
const MIN_TICK_GAP = 7;    // px between small ticks

function rulerSteps(span, width) {
  const pxPerSec = width / span;
  const labels = clamp(Math.round(width / LABEL_SPACING), 4, 10);
  const major = NICE_STEPS.find((st) => st >= span / labels) || NICE_STEPS[NICE_STEPS.length - 1];
  const minor = NICE_STEPS.find((st) => st < major && major % st === 0 && st * pxPerSec >= MIN_TICK_GAP && major / st <= 10) || null;
  return { major, minor };
}

export const WAVE_KEY = "flow.trimRuler"; // "ticks" | "wave" (remembered)
export const waveCache = new Map();       // url → peaks (this session)
export const wavePending = new Map();     // url → request in progress

// The video's sound under the strip, in place of the ruler, drawn like an
// equalizer: evenly spaced rounded bars standing on a baseline, their height
// the loudness of their slice. Inside the cuts in the accent color,
// outside them dimmed. Same height as the ruler (32 + 8 px), so nothing below
// moves; the position dot rides on the baseline (WAVE_BASE).
const WAVE_H = 32;
export const MORPH_S = 0.45; // ruler ⇄ waveform morph (s)
export const WAVE_BASE = 29;   // baseline (px from the top of the area)
const PLACEHOLDER_OUT_S = 0.5; // loading / error line + message → ruler (s)
const BAR_W = 3.5, BAR_GAP = 3; // bar width / space between bars
export function Waveform({ peaks, status, duration, width, from, to, windows, playhead }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const H = WAVE_H, MID = WAVE_BASE;
  // Morph in / out: `grow` 0 → 1 makes the bars rise out of the baseline,
  // left to right; when switching away they sink back before it's removed.
  const [isPresent, safeToRemove] = usePresence();
  const [grow, setGrow] = useState(0);
  const growRef = useRef(0);
  growRef.current = grow;
  useEffect(() => {
    if (status !== "ready" && isPresent) return undefined;
    const ctl = animate(growRef.current, isPresent ? 1 : 0, {
      // (no bars yet — loading / error: the line still glides up to the
      // ruler's place and the message fades out, so give it the same time)
      duration: isPresent ? MORPH_S * 1.2 : status === "ready" ? MORPH_S * 0.7 : PLACEHOLDER_OUT_S,
      ease: isPresent ? [0.22, 1, 0.36, 1] : [0.4, 0, 1, 1],
      delay: isPresent ? MORPH_S * 0.25 : 0,
      onUpdate: setGrow,
      onComplete: () => { if (!isPresent) safeToRemove?.(); },
    });
    return () => ctl.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent, status]);
  // Where the video is: bars up to that time turn the accent color (the
  // waveform's "position", instead of the ruler's dot). Redrawn straight from
  // the play position signal — no re-render while it plays.
  const pos = useRef(playhead?.value ?? null);
  const drawRef = useRef(null);
  useEffect(() => {
    if (!playhead) return undefined;
    return playhead.sub((v) => { pos.current = v; drawRef.current?.(); });
  }, [playhead]);
  useEffect(() => {
    drawRef.current = draw;
    draw();
    function draw() {
    const c = ref.current;
    if (!c || !width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(H * dpr);
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, H);
    if (!peaks?.length || !duration) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#fff";
    const at = pos.current;
    const span = Math.max(0.5, to - from);
    // Bars sit on a time grid (like the filmstrip): one every `tStep` seconds,
    // a power-of-two multiple of a peak's time, as fine as the bar + gap fits.
    // While zooming they slide with the time instead of shimmering.
    const pxPerSec = width / span;
    let tStep = duration / n;
    while (tStep * pxPerSec < BAR_W + BAR_GAP) tStep *= 2;
    const step = tStep * pxPerSec;
    const n = peaks.length;
    const avail = WAVE_BASE - 1;            // tallest bar
    for (let k = Math.floor(from / tStep); k * tStep < Math.min(duration, to); k++) {
      const t0 = k * tStep, t1 = t0 + tStep;
      const x = (t0 - from) * pxPerSec + (step - BAR_W) / 2;
      if (x + BAR_W < 0 || x > width) continue;
      let i0 = Math.floor((t0 / duration) * n), i1 = Math.max(i0 + 1, Math.ceil((t1 / duration) * n));
      i0 = Math.max(0, Math.min(n - 1, i0)); i1 = Math.min(n, i1);
      let max = 0, sum = 0;
      for (let i = i0; i < i1; i++) { max = Math.max(max, peaks[i]); sum += peaks[i]; }
      const mean = sum / Math.max(1, i1 - i0);
      const tm = (t0 + t1) / 2;
      // White, turning the accent color up to the video's position; outside
      // the cuts both are dimmed.
      const inCut = windows.some(([a, b]) => tm >= a && tm <= b);
      const played = at != null && tm <= at;
      ctx.globalAlpha = inCut ? 1 : 0.32;
      ctx.fillStyle = played ? accent : "#ffffff";
      // One rounded bar per slice, standing on the baseline: its height is the
      // slice's loudness (between its average and its peak), never shorter
      // than a small pill.
      // (morph: each bar rises a little after the one on its left)
      const g = Math.min(1, Math.max(0, grow * 1.5 - (x / width) * 0.5));
      const barH = Math.max(BAR_W + 2, (mean * 0.6 + max * 0.4) * avail) * g;
      if (barH < 0.5) continue;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, WAVE_BASE - barH, BAR_W, barH, BAR_W / 2);
      else ctx.rect(x, WAVE_BASE - barH, BAR_W, barH);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    }
  }, [peaks, duration, width, from, to, windows, grow]);
  return (
    <div className="relative mb-2 select-none pointer-events-none" style={{ height: H }} aria-hidden="true">
      <canvas ref={ref} className="absolute inset-0" style={{ width, height: H }} />
      {status !== "ready" && (
        <>
          {/* Not there yet: the ruler's line, softly pulsing while it loads;
              red with a light running along it when the sound can't be read.
              Leaving (back to the ruler), it glides up to the ruler's line
              (16 px) and turns white, so the ticks unfold right out of it. */}
          <div
            className={`absolute inset-x-0 h-px overflow-hidden ${status === "loading" && isPresent ? "animate-pulse" : ""}`}
            style={{
              top: isPresent ? MID : 16,
              background: status === "error" && isPresent ? "rgba(248,113,113,0.55)" : "rgba(255,255,255,0.6)",
              transition: `top ${PLACEHOLDER_OUT_S}s cubic-bezier(0.4, 0, 0.2, 1), background-color ${PLACEHOLDER_OUT_S}s ease`,
            }}
          >
            {status === "error" && isPresent && <span className="wave-error-line" />}
          </div>
          <span
            key={status} /* error replaces "loading": its entrance plays */
            className={`absolute left-1/2 px-2 text-[10.5px] font-semibold rounded leading-4 whitespace-nowrap ${status === "error" ? "wave-error-pill" : "text-zinc-300 bg-zinc-950/70"}`}
            style={{
              top: MID - 8,
              opacity: isPresent ? 1 : 0,
              filter: isPresent ? "blur(0px)" : "blur(4px)",
              transform: `translateX(-50%) translateY(${isPresent ? 0 : -6}px) scale(${isPresent ? 1 : 0.96})`,
              transition: `opacity ${PLACEHOLDER_OUT_S * 0.8}s ease, filter ${PLACEHOLDER_OUT_S * 0.8}s ease, transform ${PLACEHOLDER_OUT_S}s cubic-bezier(0.4, 0, 0.2, 1)`,
            }}
          >
            {status === "error"
              ? <span className="wave-error-text">{t('trim.wave_error', { defaultValue: "Couldn't load the sound waves" })}</span>
              : t('trim.wave_loading', { defaultValue: 'Loading the sound waves…' })}
          </span>
        </>
      )}
    </div>
  );
}

// from / to: the part of the video in view (the whole video unless zoomed).
export function Ruler({ duration, width, from = 0, to = duration }) {
  const span = Math.max(0.5, to - from);
  const marks = useMemo(() => {
    if (!duration || !width) return [];
    const { major, minor } = rulerSteps(span, width);
    const step = minor || major;
    const out = [];
    for (let i = Math.ceil(from / step - 1e-6); i * step <= to + 0.001; i++) {
      const tm = i * step;
      const isMajor = tm % major === 0;
      out.push({ tm, isMajor, label: isMajor });
    }
    return out;
  }, [duration, width, from, to, span]);

  // Ruler style: thin 1 px ticks centred on a 1 px line through their middle,
  // short ones between taller labelled ones; the video's end gets a tall tick.
  const TICKS_H = 16; // px, tallest tick
  const frac = (tm) => (tm - from) / span;
  const pct = (tm) => `${frac(tm) * 100}%`;
  const labels = marks.filter((m) => m.label);
  const endInView = to >= duration - 0.01;
  return (
    <div className="relative mt-2 select-none pointer-events-none" style={{ height: TICKS_H + 16 }} aria-hidden="true">
      {/* Ticks — one translucent layer, so they all share the same transparency */}
      <div className="absolute inset-x-0 top-0 opacity-85" style={{ height: TICKS_H }}>
        {/* Line through the middle of the ticks (same 1 px, same layer) */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white" />
        {marks.filter((m) => !endInView || duration - m.tm > 0.5).map(({ tm, isMajor }) => (
          <div key={tm} className={`tl-appear absolute top-1/2 -translate-y-1/2 w-px bg-white transition-[height] duration-300 ${isMajor ? "h-4" : "h-2.5"}`} style={{ left: pct(tm) }} />
        ))}
        {/* End of the video: a tall tick */}
        {endInView && <div className="absolute top-1/2 -translate-y-1/2 right-0 w-px h-4 bg-white" />}
      </div>
      {labels.map(({ tm }) => (
        <span key={tm} className={`tl-appear-label absolute ${frac(tm) * width < 16 ? "translate-x-0" : (1 - frac(tm)) * width < 16 ? "-translate-x-full" : "-translate-x-1/2"} text-[10px] font-semibold text-white/85 tabular-nums whitespace-nowrap leading-none`} style={{ left: pct(tm), top: TICKS_H + 5 }}>
          {formatClock(tm)}
        </span>
      ))}
    </div>
  );
}
