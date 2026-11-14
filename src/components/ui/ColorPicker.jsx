// Custom color picker (replaces the system one): dark glass popover with a
// saturation/brightness square, hue bar, eyedropper (picks a color from the
// app's background — the webview's own EyeDropper doesn't work in the app),
// HEX + R/G/B fields and a few quick colors. Changes are reported live while
// dragging; the caller decides how often to apply them.
//
// Geometry: popover padding 12 + controls radius 8 → popover radius 20.
// Opens below the anchor (above if there's no room), kept inside the window.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import LiquidGlass from "./liquidGlass/LiquidGlass";
import { getBackdrop } from "./liquidGlass/backdrop";
import { invoke } from "@tauri-apps/api/core";

const PICKER_GLASS = { blur: 1, preBlur: 10, darkTint: 0.6, edgeHighlight: 0.12, depth: 14, coreOpacity: 0.6 };

const W = 248; // popover width

// Only one picker at a time: opening one closes the one already open.
let closeOpenPicker = null;

// --- color math -----------------------------------------------------------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function hexToRgb(hex) {
  let h = String(hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const toHex = ({ r, g, b }) => "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToRgb({ h, s, v }) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// Drag helper: calls fn(x01, y01) on pointer down + move (pointer captured).
function makeDrag(fn) {
  return (e) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    // The knobs travel 8 px inside the edges (so they're never cut off): the
    // same inset here keeps the knob exactly under the pointer.
    const I = 8;
    const send = (ev) => fn(
      clamp((ev.clientX - rect.left - I) / Math.max(1, rect.width - 2 * I), 0, 1),
      clamp((ev.clientY - rect.top - I) / Math.max(1, rect.height - 2 * I), 0, 1),
    );
    send(e);
    const move = (ev) => send(ev);
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
}

export default function ColorPicker({ anchor, value, onChange, onClose }) {
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(value) || { r: 0, g: 0, b: 0 }));
  const [hexText, setHexText] = useState(value?.toUpperCase() || "#000000");
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const rgb = hsvToRgb(hsv);
  const hex = toHex(rgb);

  // Report + mirror into the HEX field.
  const set = (next) => {
    setHsv(next);
    const h = toHex(hsvToRgb(next));
    setHexText(h.toUpperCase());
    onChange(h);
  };
  const setFromHex = (h) => {
    const c = hexToRgb(h);
    if (!c) return;
    const next = rgbToHsv(c);
    // Keep the hue when the color is gray (hue undefined).
    setHsv((prev) => ({ ...next, h: next.s === 0 ? prev.h : next.h }));
    onChange(toHex(c));
  };

  // Placement next to the anchor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = el.offsetHeight;
    const below = r.bottom + 8 + h <= window.innerHeight - 8;
    const left = clamp(r.left + r.width / 2 - W / 2, 8, window.innerWidth - W - 8);
    setPos({ left, top: below ? r.bottom + 8 : Math.max(8, r.top - 8 - h), from: below ? -6 : 6 });
  }, [anchor]);

  // Single instance: close whichever picker was open, and register this one.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const mine = () => closeRef.current();
    if (closeOpenPicker) closeOpenPicker();
    closeOpenPicker = mine;
    return () => { if (closeOpenPicker === mine) closeOpenPicker = null; };
  }, []);

  // Eyedropper mode: a crosshair over the whole window and a loupe showing the
  // background color under the pointer (read from the background itself, not
  // dimmed by the dialog). Click = take it; Esc / right-click = cancel.
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  pickingRef.current = picking;
  const [loupe, setLoupe] = useState(null); // { x, y, hex }
  // The color is read from the real screen pixel under the cursor (Rust:
  // screen_color_at_cursor / eyedropper_tick) — exactly what the user sees,
  // inside the app (icons, buttons, dimmed background…) and outside it.
  // Outside, on Windows a tiny click-through window (public/eyedropper.html)
  // follows the cursor with the color; elsewhere the loupe waits at the
  // window edge. Clicking somewhere else takes the window's focus away →
  // that color is taken. If the screen can't be read (macOS without the
  // Screen Recording permission…), inside the app the background is sampled.
  useEffect(() => {
    if (!picking) return undefined;
    const backdrop = getBackdrop();
    let timer = 0, outside = false, done = false, edge = null, ptr = null, lastHex = null;
    let screenOk = true; // reading the screen works (else: background sampling)
    // Creating the loupe window may briefly move the focus: ignore that blur.
    let blurGuard = true;
    invoke("eyedropper_prepare").catch(() => {}).finally(() => setTimeout(() => { blurGuard = false; }, 250));
    const apply = (hex) => {
      if (done || !hex) return;
      done = true;
      setFromHex(hex);
      setHexText(hex.toUpperCase());
      setPicking(false);
    };
    const screenColor = () => invoke("screen_color_at_cursor").catch(() => null);
    // One loop for the whole session: inside → loupe at the pointer; outside →
    // the floating loupe (or the edge one).
    const tick = async () => {
      if (done) return;
      const t0 = performance.now();
      let delay = 16;
      if (outside) {
        const r = await invoke("eyedropper_tick").catch(() => null);
        if (done) return;
        if (!outside) { if (r?.follows) invoke("eyedropper_hide").catch(() => {}); }
        else if (r?.hex) {
          lastHex = r.hex;
          setLoupe(r.follows ? null : { ...(edge || { x: 0, y: 0 }), hex: r.hex, outside: true });
        }
        if (!r?.follows) delay = 90;
      } else if (ptr) {
        const hex = screenOk ? await screenColor() : null;
        if (done) return;
        if (!hex) screenOk = false;
        if (!outside && ptr) {
          lastHex = hex || backdrop.sampleAt(ptr.x, ptr.y);
          setLoupe({ ...ptr, hex: lastHex });
        }
      }
      // A slow screen read (macOS captures the whole screen) waits longer
      // before the next one, so it never keeps the CPU busy.
      timer = setTimeout(tick, Math.max(delay, (performance.now() - t0) * 2));
    };
    tick();
    const move = (e) => {
      if (outside) { outside = false; invoke("eyedropper_hide").catch(() => {}); }
      ptr = { x: e.clientX, y: e.clientY };
      // The loupe moves with the pointer right away (never lags onto the pixel
      // being read); its color follows from the screen loop.
      const hex = screenOk ? lastHex : backdrop.sampleAt(ptr.x, ptr.y);
      if (hex) setLoupe({ ...ptr, hex });
    };
    const leave = (e) => {
      if (e.relatedTarget) return; // still inside the page
      setLoupe(null); // the floating loupe (or the edge one) takes over
      ptr = null;
      // Edge loupe position (when the floating one isn't available).
      const m = 72;
      edge = {
        x: Math.min(window.innerWidth - m, Math.max(4, e.clientX - 16)),
        y: Math.min(window.innerHeight - m, Math.max(4, e.clientY - 16)),
      };
      outside = true;
    };
    const blur = async () => {
      if (blurGuard) return;
      // A click on another window / the desktop: take the color under the cursor.
      const hex = await screenColor();
      if (hex) apply(hex); else setPicking(false);
    };
    const down = async (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (e.button !== 0) { setPicking(false); return; }
      const { clientX: x, clientY: y } = e;
      const hex = screenOk ? await screenColor() : null;
      apply(hex || lastHex || backdrop.sampleAt(x, y));
    };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setPicking(false); } };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    document.addEventListener("mouseout", leave, true);
    window.addEventListener("blur", blur);
    return () => {
      done = true;
      clearTimeout(timer);
      invoke("eyedropper_close").catch(() => {});
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("mouseout", leave, true);
      window.removeEventListener("blur", blur);
      setLoupe(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  // Close: click outside, Esc (without closing Settings), window blur.
  useEffect(() => {
    const down = (e) => {
      if (pickingRef.current) return; // the eyedropper handles this click
      const inside = ref.current?.contains(e.target) || anchor?.contains(e.target);
      if (!inside) closeRef.current();
    };
    const key = (e) => { if (pickingRef.current) return; if (e.key === "Escape" || e.key === "Enter") { e.stopImmediatePropagation(); e.preventDefault(); closeRef.current(); } };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("keydown", key, true); };
  }, [anchor]);

  // Drags read the latest value through a ref (the handlers outlive renders).
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const dragSVLive = makeDrag((x, y) => set({ ...hsvRef.current, s: x, v: 1 - y }));
  const dragHueLive = makeDrag((x) => set({ ...hsvRef.current, h: x * 360 }));

  const pick = () => setPicking(true);
  // Loupe below-right of the pointer, flipped near the window's right/bottom
  // edge so it's never cut off (same as the floating one outside).
  const loupeStyle = (l) => {
    if (l.outside) return { left: l.x, top: l.y };
    const W = 64, H = 76, off = 14;
    const left = l.x + off + W > window.innerWidth ? l.x - off - W : l.x + off;
    const top = l.y + off + H > window.innerHeight ? l.y - off - H : l.y + off;
    return { left, top, width: W };
  };

  const hueColor = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
  const field = "h-8 w-full rounded-lg bg-zinc-950/70 border border-white/10 focus:border-(--accent)/60 outline-none text-center text-[12.5px] font-semibold tabular-nums text-zinc-100 transition-colors";

  return createPortal(
    <>
    {/* Eyedropper: crosshair over everything + a loupe with the color under the pointer */}
    {picking && (
      <div className="fixed inset-0 z-[10080] cursor-crosshair" aria-hidden="true">
        {loupe && (
          <div className="absolute pointer-events-none flex flex-col items-center gap-1" style={loupeStyle(loupe)}>
            <div className="w-12 h-12 rounded-full ring-2 ring-white shadow-[0_4px_16px_rgba(0,0,0,0.5)]" style={{ backgroundColor: loupe.hex }} />
            <span className="px-1.5 py-0.5 rounded-md bg-black/70 text-[11px] font-bold tabular-nums text-white">{loupe.hex.toUpperCase()}</span>
          </div>
        )}
      </div>
    )}
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96, y: pos?.from || -6 }}
      animate={{ opacity: pos ? 1 : 0, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: W, zIndex: 10020 }}
      // No CSS background: the liquid glass below draws it (same glass as the
      // right-click menu), with a plain dark blur as fallback.
      className="isolate p-3 pb-8 rounded-[20px] shadow-2xl shadow-black/60 backdrop-blur-md space-y-3 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <LiquidGlass
        variant="dark"
        settings={PICKER_GLASS}
        radius={20}
        maxFps={30}
        className="absolute inset-0 -z-10 pointer-events-none rounded-[20px]"
        fallbackClassName="bg-zinc-950/85 backdrop-blur-2xl border border-white/10"
      />
      {/* Saturation (x) / brightness (y) */}
      <div
        onPointerDown={dragSVLive}
        className="relative h-36 rounded-lg cursor-crosshair touch-none overflow-hidden"
        style={{ backgroundColor: hueColor, backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)" }}
      >
        <div
          className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_2px_6px_rgba(0,0,0,0.5)] pointer-events-none"
          // Kept fully inside the field (never cut at its edges/corners).
          style={{ left: `calc(8px + ${hsv.s} * (100% - 16px))`, top: `calc(8px + ${1 - hsv.v} * (100% - 16px))`, backgroundColor: hex }}
        />
      </div>

      {/* Eyedropper · preview · hue */}
      <div className="flex items-center gap-2.5">
        <button onClick={pick} className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${picking ? "text-white bg-white/15" : "text-zinc-300 hover:text-white hover:bg-white/10"}`} aria-label="Eyedropper">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" /><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" /></svg>
        </button>
        <div className="w-8 h-8 shrink-0 rounded-full ring-1 ring-inset ring-white/20" style={{ backgroundColor: hex }} />
        <div
          onPointerDown={dragHueLive}
          className="relative flex-1 h-3 rounded-full cursor-pointer touch-none"
          style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
        >
          <div
            className="absolute top-1/2 w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_2px_6px_rgba(0,0,0,0.5)] pointer-events-none"
            style={{ left: `calc(8px + ${hsv.h / 360} * (100% - 16px))`, backgroundColor: hueColor }}
          />
        </div>
      </div>

      {/* HEX · R · G · B */}
      <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-1.5">
        <input
          value={hexText}
          onChange={(e) => { const v = e.target.value.toUpperCase(); setHexText(v); if (/^#?[0-9A-F]{6}$/.test(v)) setFromHex(v.startsWith("#") ? v : `#${v}`); }}
          onBlur={() => setHexText(hex.toUpperCase())}
          spellCheck={false}
          className={field}
        />
        {["r", "g", "b"].map((k) => (
          <input
            key={k}
            value={Math.round(rgb[k])}
            inputMode="numeric"
            onChange={(e) => {
              const n = clamp(parseInt(e.target.value.replace(/\D/g, "") || "0", 10), 0, 255);
              const c = { r: rgb.r, g: rgb.g, b: rgb.b, [k]: n };
              setFromHex(toHex(c));
              setHexText(toHex(c).toUpperCase());
            }}
            className={field}
          />
        ))}
        <span className="text-center text-[10.5px] font-bold text-neutral-300 uppercase tracking-widest">Hex</span>
        {["R", "G", "B"].map((l) => <span key={l} className="text-center text-[10.5px] font-bold text-neutral-300">{l}</span>)}
      </div>
    </motion.div>
    </>,
    document.body
  );
}
