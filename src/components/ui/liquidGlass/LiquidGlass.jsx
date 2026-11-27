// <LiquidGlass> — a container whose background is real refractive "liquid
// glass" (WebGL), based on LiquidGlass OSS (MIT, see LICENSE.md).
//
// The glass is drawn on a canvas slightly larger than the container (so the
// focus "stretch" never gets clipped) and placed behind the children. The
// shape is a pill/rounded rect that always matches the container's size.
// What it refracts is a live snapshot of the app background (backdrop.js).
//
// If WebGL isn't available, it falls back to `fallbackClassName` (plain CSS
// blur), so the UI never breaks.

import { useEffect, useMemo, useRef, useState } from "react";
import { LiquidGlassRenderer } from "./renderer";
import { getBackdrop } from "./backdrop";
import { resolveLiquidGlassSettings } from "./presets";

const PAD = 16; // px of canvas around the container
const CANVAS_STEP = 32; // canvas size granularity (px) — see measure()
const stepUp = (v) => Math.ceil(v / CANVAS_STEP) * CANVAS_STEP;

export default function LiquidGlass({
  variant = "dark",
  settings,
  focused = false,
  radius,                // corner radius in px; default = fully round (pill)
  maxFps = 0,            // cap redraws (0 = every frame); use ~30 for big panels
  paused = false,        // stop rendering (e.g. hidden behind a dialog)
  shared = false,        // share one WebGL context (use for surfaces that can be many, e.g. list items)
  className = "",
  fallbackClassName = "",
  style,
  children,
  ...rest
}) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const clipRef = useRef(null);
  const rendererRef = useRef(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const [failed, setFailed] = useState(false);

  const settingsKey = JSON.stringify(settings || {});
  const material = useMemo(
    () => resolveLiquidGlassSettings(variant, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variant, settingsKey]
  );

  // Pushes the current size / material / focus into the renderer.
  const syncRef = useRef(() => {});
  syncRef.current = () => {
    const renderer = rendererRef.current;
    const { w, h } = sizeRef.current;
    if (!renderer || !w || !h) return;
    renderer.setSettings({
      ...material,
      lensWidth: w,
      lensHeight: h,
      radius: radius ?? h / 2,
      depth: Math.min(material.depth, h * 0.42),
    });
    // No focus "stretch" (the original widens the lens on focus): the size stays fixed.
    renderer.setGeometry(PAD + w / 2, PAD + h / 2, 0, false);
  };

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    try {
      rendererRef.current = new LiquidGlassRenderer(canvas, material, getBackdrop(), { shared });
      rendererRef.current.maxFps = maxFps;
    } catch (error) {
      console.warn("[LiquidGlass] falling back to CSS:", error);
      setFailed(true);
      return;
    }
    const onLost = (e) => { e.preventDefault(); setFailed(true); };
    canvas.addEventListener("webglcontextlost", onLost);

    // offsetWidth/Height ignore CSS transforms (entrance scale animations).
    // While a surface grows or shrinks (e.g. a dialog's height animating), its
    // canvas is NOT reallocated every frame: a new canvas size wipes the
    // drawing, which showed as the glass blinking out. The canvas keeps a size
    // rounded up to steps of CANVAS_STEP (the extra area stays transparent) and
    // is only reallocated when it really must; the glass is redrawn right away,
    // in the same frame, so it never shows empty.
    const canvasSize = { w: 0, h: 0 };
    const measure = () => {
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      if (w === sizeRef.current.w && h === sizeRef.current.h) return;
      sizeRef.current = { w, h };
      // The visible area is exactly the surface + PAD: the rounded-up canvas
      // is clipped to it, so it never makes a scroll container scrollable.
      const clip = clipRef.current;
      if (clip) { clip.style.width = `${w + PAD * 2}px`; clip.style.height = `${h + PAD * 2}px`; }
      const cw = stepUp(w + PAD * 2), ch = stepUp(h + PAD * 2);
      const tooBig = cw < canvasSize.w - CANVAS_STEP * 2 || ch < canvasSize.h - CANVAS_STEP * 2;
      if (cw > canvasSize.w || ch > canvasSize.h || tooBig) {
        canvasSize.w = cw; canvasSize.h = ch;
        rendererRef.current?.resize(cw, ch);
      }
      syncRef.current();
      rendererRef.current?.redrawNow();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);

    return () => {
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // The renderer is created once; later changes go through syncRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { syncRef.current(); }, [material, focused, radius]);
  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.paused = paused;
    if (!paused) rendererRef.current.dirty = true; // redraw right away when shown again
  }, [paused]);

  return (
    <div
      ref={rootRef}
      className={`${/\b(absolute|fixed|sticky)\b/.test(className) ? "" : "relative"} isolate ${className} ${failed ? fallbackClassName : ""}`}
      style={style}
      {...rest}
    >
      {!failed && (
        <div
          ref={clipRef}
          data-glass-clip
          aria-hidden="true"
          className="absolute pointer-events-none overflow-hidden"
          style={{
            left: -PAD,
            top: -PAD,
            zIndex: -1, // behind the children (the root isolates the stacking context)
          }}
        >
          {/* No brightness boost on focus: while the background dims (focus),
              a brighter glass read as a flash of light on the bar. */}
          <canvas ref={canvasRef} className="absolute left-0 top-0 pointer-events-none" />
        </div>
      )}
      {children}
    </div>
  );
}
