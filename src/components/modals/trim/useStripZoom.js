// Trim strip — zoom: the magnifier (zoom into the cut, re-fitting it as it
// changes), Alt + mouse wheel (smooth zoom around the pointer, like Premiere),
// and the view the strip, the ruler and the waveform show.

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { altHeld } from "../../../utils/altKey";
import { HANDLE_HALF, clamp } from "./shared";

const MIN_VIEW = 2;        // shortest view with Alt + wheel (s)
const WHEEL_LERP = 0.16;   // Alt + wheel smoothing (share of the way per frame, like Lenis' lerp)
const VIEW_GLIDE = { duration: 0.4, ease: [0.4, 0, 0.2, 1] };

/**
 * dragRef: the strip's drag in progress (null when none); stripRef: the strip
 * element (for the pointer position on Alt + wheel).
 * Returns the view ({ s, e } → vs / ve / vlen) and the zoom controls.
 */
export function useStripZoom({ duration, start, end, others, dragRef, stripRef }) {
  // --- Fine adjustment (magnifier) ---
  // Zoomed in, the strip shows only the selection plus a margin on each side
  // (25 % of its length, at least 2 s), so the handles move in small steps.
  // The view is set when zooming (and follows a selection typed outside it);
  // dragging stays inside it. Zooming in / out glides (VIEW_GLIDE).
  const [zoomed, setZoomed] = useState(false);
  const [view, setView] = useState({ s: 0, e: duration });
  const viewRef = useRef(view);
  viewRef.current = view;
  const glide = useRef(null);
  const span = () => [start, end];
  const zoomTarget = (ra, rb) => {
    const [a, b] = ra != null ? [ra, rb] : span();
    const pad = Math.max(2, (b - a) * 0.25);
    return { s: Math.max(0, a - pad), e: Math.min(duration, b + pad) };
  };
  const glideTo = (to) => {
    glide.current?.stop();
    wheelTarget.current = null; // (a running Alt + wheel zoom gives way)
    const from = viewRef.current;
    glide.current = animate(0, 1, { ...VIEW_GLIDE, onUpdate: (p) => setView({ s: from.s + (to.s - from.s) * p, e: from.e + (to.e - from.e) * p }) });
  };
  useEffect(() => () => glide.current?.stop(), []);
  const toggleZoom = () => {
    const next = !zoomed;
    freeZoom.current = false;
    setZoomed(next);
    glideTo(next ? zoomTarget() : { s: 0, e: duration });
  };

  // --- Alt + mouse wheel: zoom around the pointer (like Premiere) ---
  // The time under the pointer stays under it while the view narrows / widens.
  // A zoom set this way is left alone (no automatic re-fit to the cut) until
  // the magnifier button or "Reset cut" takes over again.
  const freeZoom = useRef(false);
  // Smooth like Lenis: each wheel step moves a target view; the shown view
  // glides toward it every frame (WHEEL_LERP of the remaining distance), so
  // quick wheel spins blend into one fluid zoom.
  const wheelTarget = useRef(null);
  const wheelRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(wheelRaf.current), []);
  const wheelStep = () => {
    const tg = wheelTarget.current;
    const v = viewRef.current;
    if (!tg) { wheelRaf.current = 0; return; }
    const ns = v.s + (tg.s - v.s) * WHEEL_LERP;
    const ne = v.e + (tg.e - v.e) * WHEEL_LERP;
    const done = Math.abs(tg.s - ns) < 0.002 * (tg.e - tg.s) && Math.abs(tg.e - ne) < 0.002 * (tg.e - tg.s);
    const next = done ? { ...tg } : { s: ns, e: ne };
    viewRef.current = next;
    setView(next);
    if (done) { wheelTarget.current = null; wheelRaf.current = 0; return; }
    wheelRaf.current = requestAnimationFrame(wheelStep);
  };
  const wheelZoom = (e) => {
    if (!altHeld(e) || !duration) return; // only while Alt is really held
    e.preventDefault();
    e.stopPropagation(); // not a scroll of the card
    const el = stripRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const frac = clamp((e.clientX - r.left - HANDLE_HALF) / Math.max(1, r.width - HANDLE_HALF * 2), 0, 1);
    // Steps add up on the target (where the view is heading), anchored at the
    // pointer.
    const base = wheelTarget.current || viewRef.current;
    const span = base.e - base.s;
    const at = base.s + frac * span;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1) || e.deltaX;
    const nextSpan = clamp(span * Math.exp(dy * 0.0016), Math.min(duration, MIN_VIEW), duration);
    const s0 = clamp(at - frac * nextSpan, 0, duration - nextSpan);
    glide.current?.stop();
    wheelTarget.current = { s: s0, e: s0 + nextSpan };
    if (!wheelRaf.current) wheelRaf.current = requestAnimationFrame(wheelStep);
    const z = nextSpan < duration - 0.01;
    freeZoom.current = z;
    if (z !== zoomed) setZoomed(z);
  };
  const wheelRef = useRef(wheelZoom);
  wheelRef.current = wheelZoom;
  // Zoomed: the zoom follows the selection. Any change made outside a drag
  // (typed times, reset, a cut added…) re-fits it right away; a drag re-fits it
  // when released (during the drag the view stays still under the pointer,
  // except that pushing a handle against an edge scrolls the view — below).
  const refit = () => {
    const to = zoomTarget();
    const v = viewRef.current;
    if (Math.abs(to.s - v.s) > 0.05 || Math.abs(to.e - v.e) > 0.05) glideTo(to);
  };
  const wasWhole = useRef(true);
  useEffect(() => {
    const whole = !others.length && start <= 0.01 && end >= duration - 0.01;
    const becameWhole = whole && !wasWhole.current;
    const becameCut = !whole && wasWhole.current;
    wasWhole.current = whole;
    // A first cut made outside a drag (typed times, a cut added): zoom
    // straight into it. (A drag's first cut zooms in when it's released.)
    if (becameCut && !zoomed && !dragRef.current) {
      setZoomed(true);
      glideTo(zoomTarget());
      return;
    }
    if (!zoomed || dragRef.current) return;
    // The selection just went back to the whole video (e.g. "Reset cut"):
    // leave zoom mode (the button shows the magnifier again).
    if (becameWhole) {
      freeZoom.current = false;
      setZoomed(false);
      glideTo({ s: 0, e: duration });
      return;
    }
    if (freeZoom.current) return; // zoomed by hand (Alt + wheel): keep that view
    refit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, zoomed, others.length]);

  const vs = view.s, ve = Math.max(view.s + 0.5, view.e), vlen = ve - vs;
  return { zoomed, setZoomed, view, setView, viewRef, glideTo, zoomTarget, refit, toggleZoom, freeZoom, wheelRef, vs, ve, vlen };
}
