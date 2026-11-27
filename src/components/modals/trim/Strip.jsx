// Trim mode — the strip: filmstrip, in / out handles of every cut, zoom
// (magnifier, Alt + wheel), the play position and the ruler / waveform under it.

import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ScissorsIcon as Scissors, TrashIcon as Trash, ClockIcon as Clock, MusicIcon as Music } from "../../ui/AnimatedIcons";
import { setContextItems } from "../../ui/ContextMenu";
import { formatClock } from "../../../utils/trim";
import { Ruler, Waveform, MORPH_S, WAVE_BASE } from "./RulerWave";
import { useStripZoom } from "./useStripZoom";
import { useRangeGlide, useRulerMode, stripFrames } from "./hooks";
import { BIG_STEP, DOT_SPRING, ELASTIC, HANDLE_HALF, MIN_LEN, QUICK, STEP, STRIP_H, STRIP_INNER_R, clamp, endSec, roundSec } from "./shared";

// Filmstrip with the in / out handles.
export function Strip({ duration, storyboard, windows, start, end, others = [], lo = 0, hi = duration, playhead, onRange, onActivate, onAddCut, onRemoveCut, cutApi, url, getWaveform, formatType, onScrub, onSeek }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);   // time under the pointer (or being dragged)
  const drag = useRef(null);                  // { kind: 'start'|'end'|'move', offset, len, s, en }
  const [dragging, setDragging] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const show = (tm) => { setHover(tm); onScrub?.(tm); };

  // Zoom: magnifier, Alt + wheel, automatic re-fit to the cut (useStripZoom.js)
  const { zoomed, setZoomed, setView, viewRef, glideTo, zoomTarget, refit, toggleZoom, freeZoom, wheelRef, vs, ve, vlen } =
    useStripZoom({ duration, start, end, others, dragRef: drag, stripRef: ref });

  // Edge scroll while zoomed: holding a handle against (or past) the strip's
  // side widens the view that way, ~60 % of its length per second, so the
  // handle can travel beyond what was visible.
  const edge = useRef({ dir: 0, x: 0, raf: 0 });
  const stopEdge = () => { cancelAnimationFrame(edge.current.raf); edge.current.dir = 0; edge.current.raf = 0; };
  useEffect(() => stopEdge, []);

  // What the handles show (glides to a new range; useRangeGlide in hooks.js)
  const disp = useRangeGlide(start, end, drag);
  const shownWindows = [[disp.s, disp.e], ...others.map((r) => [r.start, r.end])].sort((a, b) => a[0] - b[0]);

  // The preview's play position, drawn straight to the DOM (no re-render).
  const lineRef = useRef(null);
  const lastFrac = useRef(null);

  // Ruler ⇄ sound waveform: the mode, its download-type rules and the waveform
  // data (useRulerMode in hooks.js)
  const { rulerMode, wavesLocked, chooseRuler, peaks, waveStatus } = useRulerMode({ formatType, url, getWaveform, duration });
  const rulerBoxRef = useRef(null);
  // The dot shows / hides with the mode (redrawn right when it changes).
  const rulerModeRef = useRef(rulerMode);
  rulerModeRef.current = rulerMode;
  useEffect(() => { if (playhead) drawPlayhead.current?.(playhead.value, true); }, [rulerMode]); // eslint-disable-line react-hooks/exhaustive-deps
  // The switch as a menu section (shared by the ruler and the strip's menus).
  const rulerItemRef = useRef(null);
  rulerItemRef.current = () => ({
    id: "ruler-mode",
    items: [rulerMode === "wave"
      ? { id: "show-ruler", icon: Clock, label: t('trim.show_ruler', { defaultValue: 'Show the time ruler' }), action: () => chooseRuler("ticks") }
      : { id: "show-wave", icon: Music, label: t('trim.show_wave', { defaultValue: 'Show the sound waves' }), disabled: wavesLocked, action: () => chooseRuler("wave") }],
  });
  useEffect(() => {
    const el = rulerBoxRef.current;
    if (!el) return undefined;
    return setContextItems(el, () => [rulerItemRef.current()]);
  }, []);
  const drawPlayhead = useRef(null); // (re)draws the play position (line + dot)
  const dotRef = useRef(null); // play position on the ruler
  // Dragging the dot scrubs the video: the preview shows that moment while
  // dragging (storyboard), and the video jumps there (seeks ≤ every 60 ms).
  const [dotDrag, setDotDragState] = useState(false);
  const dotDragRef = useRef(false); // (read by the drawing: no glide while dragging)
  const clickGlide = useRef(false);  // next drawing = a click on the ruler
  const [dotHover, setDotHover] = useState(false);
  const setDotDrag = (v) => { dotDragRef.current = v; setDotDragState(v); };
  const dotSeekAt = useRef(0);
  const dotTime = (e) => {
    const box = dotRef.current?.parentElement?.getBoundingClientRect();
    if (!box || !box.width) return null;
    const { s: a, e: b } = viewRef.current;
    return roundSec(clamp(a + ((e.clientX - box.left) / box.width) * (b - a), 0, duration));
  };
  const dotTo = (e, final) => {
    const tm = dotTime(e);
    if (tm == null) return;
    onScrub?.(final ? null : tm);
    playhead?.set(tm); // the dot and the line follow the pointer at once
    const now = performance.now();
    if (final || now - dotSeekAt.current > 60) { dotSeekAt.current = now; onSeek?.(tm); }
  };
  const onDotDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    clickGlide.current = true;
    dotTo(e, false);   // first: the dot darts (very quickly) to where you clicked…
    setDotDrag(true);  // …then follows the pointer directly while held
  };
  const onDotMove = (e) => { if (dotDrag) dotTo(e, false); };
  const onDotUp = (e) => {
    if (!dotDrag) return;
    setDotDrag(false);
    setDotHover(false); // let go: springs all the way back to its size, with a wobble
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dotTo(e, true);
  };
  const hoverRef = useRef(null);
  hoverRef.current = hover;
  useEffect(() => {
    if (!playhead) return undefined;
    // `instant`: the view changed (zoom gliding) — follow it without a glide.
    const draw = (v, instant = false) => {
      const el = lineRef.current;
      if (!el) return;
      const { s: a, e: b } = viewRef.current;
      const out = v != null && (v < a - 0.001 || v > b + 0.001);
      el.style.display = v != null && duration > 0 && hoverRef.current == null && !out ? "block" : "none";
      const dot = dotRef.current;
      if (dot) {
        // Hidden: no position yet, out of view, or in waveform mode (there the
        // bars' color shows the position — the dot's grip still works).
        const hide = v == null || out;
        dot.style.opacity = hide || rulerModeRef.current === "wave" ? "0" : "1";
        dot.style.pointerEvents = hide ? "none" : "auto";
      }
      if (v == null || !(duration > 0)) return;
      const f = clamp((v - a) / Math.max(0.5, b - a), 0, 1);
      // Same spot reported again (e.g. the preview confirming a seek): leave
      // it alone — touching the transition would cut a running glide short.
      if (!instant && lastFrac.current != null && Math.abs(f - lastFrac.current) < 1e-6) { clickGlide.current = false; return; }
      // A jump (reset, a handle moved, a seek) glides; small steps (the video
      // playing) and view changes follow directly. Near the ends the glide
      // doesn't overshoot (it would run past the edge).
      const jump = !instant && !dotDragRef.current && lastFrac.current != null && Math.abs(f - lastFrac.current) > 0.02;
      const clicked = !instant && clickGlide.current; // a click on the ruler: a very quick move to the pointer
      clickGlide.current = false;
      const nearEdge = f < 0.06 || f > 0.94;
      el.style.transition = clicked ? `left 0.16s ${QUICK}` : jump ? "left 0.45s cubic-bezier(0.22, 1, 0.36, 1)" : "none";
      lastFrac.current = f;
      el.style.left = `calc(${HANDLE_HALF}px + (100% - ${HANDLE_HALF * 2}px) * ${f})`;
      // The same position as a dot on the ruler's line.
      if (dot) {
        const glideEase = nearEdge ? "cubic-bezier(0.22, 1, 0.36, 1)" : ELASTIC;
        const topT = `top ${MORPH_S}s cubic-bezier(0.4, 0, 0.2, 1)`; // ruler line ⇄ wave baseline
        dot.style.transition = clicked ? `left 0.16s ${nearEdge ? "ease-out" : QUICK}, opacity 0.2s ease, ${topT}`
          : jump ? `left 0.55s ${glideEase}, opacity 0.2s ease, ${topT}` : `opacity 0.2s ease, ${topT}`;
        dot.style.left = `${f * 100}%`;
      }
    };
    drawPlayhead.current = draw;
    draw(playhead.value);
    return playhead.sub(draw);
  }, [playhead, duration]);
  // Wheel listeners (non-passive, so Alt + wheel can stop the card scrolling).
  useEffect(() => {
    const els = [ref.current, rulerBoxRef.current].filter(Boolean);
    const onWheel = (e) => wheelRef.current?.(e);
    els.forEach((el) => el.addEventListener("wheel", onWheel, { passive: false }));
    return () => els.forEach((el) => el.removeEventListener("wheel", onWheel));
  }, []);

  // The view moved (zoom in / out, edge scroll): the line and the dot follow.
  useEffect(() => { if (playhead) drawPlayhead.current?.(playhead.value, true); }, [vs, ve]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = lineRef.current;
    if (el && hover != null) el.style.display = "none";
    else if (el && playhead?.value != null) el.style.display = "block";
  }, [hover, playhead]);

  // Frames keep the storyboard tile's ratio at the strip's height and show the
  // moment at their middle (of the part of the video in view).
  // Frames sit on a time grid (one every `step` seconds, a power-of-two
  // multiple of the storyboard's tile time, as fine as fits one frame per
  // cell): while zooming they slide with the time instead of being re-sampled
  // (no flicker), and when the grid gets finer the new frames fade in between
  // the old ones (keyed by their time). A cell wider than a frame shows the
  // next tile of the sprite sheet in the extra space — the following moment.
  const frames = useMemo(() => stripFrames(storyboard, width, duration, vs, ve, vlen), [storyboard, width, duration, vs, ve, vlen]);

  // The time line runs HANDLE_HALF px in from each side, so a handle centred
  // on the very start / end still shows whole.
  const pct = (tm) => `calc(${HANDLE_HALF}px + (100% - ${HANDLE_HALF * 2}px) * ${clamp((tm - vs) / vlen, 0, 1).toFixed(6)})`;
  const timeAt = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    return clamp(vs + ((clientX - r.left - HANDLE_HALF) / Math.max(1, r.width - HANDLE_HALF * 2)) * vlen, vs, ve);
  };

  const apply = (tm) => {
    const d = drag.current;
    if (!d) return;
    const L = d.lo ?? lo, H = d.hi ?? hi; // room of the cut being dragged
    if (d.kind === "start") {
      const s = roundSec(clamp(tm, L, d.en - MIN_LEN));
      d.s = s; onRange(s, d.en); show(s);
    } else {
      const en = endSec(clamp(tm, d.s + MIN_LEN, H), H);
      d.en = en; onRange(d.s, en); show(en);
    }
  };

  // Clicking the strip moves the "in" handle there. If the click lands past
  // the "out" handle, "out" moves too, keeping the selection's length.
  const setIn = (tm, s, en) => {
    const ns = roundSec(clamp(tm, lo, hi - MIN_LEN));
    const nen = en - MIN_LEN >= ns ? en : endSec(Math.min(hi, ns + Math.max(MIN_LEN, en - s)), hi);
    onRange(ns, nen);
    show(ns);
    return { s: ns, en: nen };
  };

  const shiftRight = useRef(false); // Shift + right button: its context menu is cancelled
  const onPointerDown = (e) => {
    const shiftRightDown = e.button === 2 && e.shiftKey;
    if (shiftRightDown) shiftRight.current = true;
    if ((e.button !== 0 && !shiftRightDown) || !duration) return;
    e.preventDefault();
    const tm = timeAt(e.clientX);
    const handle = e.target.closest?.("[data-handle]")?.getAttribute("data-handle");
    let s = start, en = end;
    const fromWhole = !others.length && start <= 0.01 && end >= duration - 0.01;
    // A click on another cut makes it the one being edited (no handle moves).
    if (!handle && !shiftRightDown) {
      const k = others.findIndex((r) => tm >= r.start && tm <= r.end);
      if (k !== -1) { onActivate?.(k); onSeek?.(others[k].start); return; }
    }
    ref.current.setPointerCapture?.(e.pointerId);
    const cutAttr = e.target.closest?.("[data-handle]")?.getAttribute("data-cut");
    if (handle && cutAttr != null && cutAttr !== "edit") {
      // A handle of another cut: that cut becomes the edited one and its
      // handle follows the pointer right away.
      const k = Number(cutAttr);
      const r = others[k];
      if (r) {
        let L = 0, H = duration;
        for (const [a, b] of [[start, end], ...others.filter((_, i) => i !== k).map((o) => [o.start, o.end])]) {
          if (b <= r.start + 0.001) L = Math.max(L, b);
          if (a >= r.end - 0.001) H = Math.min(H, a);
        }
        onActivate?.(k);
        drag.current = { kind: handle, offset: tm - r.start, len: r.end - r.start, s: r.start, en: r.end, lo: L, hi: H, fromWhole: false };
        setDragging(handle);
        apply(tm);
        return;
      }
    }
    if (handle) {
      drag.current = { kind: handle, offset: tm - s, len: en - s, s, en, fromWhole };
      setDragging(handle);
      apply(tm);
      return;
    }
    // Shift + click — left or right button (manual cuts): "out" jumps there
    // and follows the pointer.
    if (e.shiftKey) {
      const r = setOutAt(tm);
      drag.current = { kind: "end", offset: 0, len: r.en - r.s, s: r.s, en: r.en, fromWhole: r.fromWhole };
      setDragging("end");
      return;
    }
    // Anywhere else (inside the selection too): "in" jumps there and follows
    // the pointer while the button is held.
    const r = setIn(tm, s, en);
    drag.current = { kind: "start", offset: 0, len: r.en - r.s, s: r.s, en: r.en, fromWhole };
    setDragging("start");
  };

  // Shift + click: the "out" handle jumps there (a plain click does it for
  // "in") and follows the pointer while it's held. Clicked before "in": "in"
  // moves too, keeping the cut's length.
  const setOutAt = (tm) => {
    const fromWhole = !others.length && start <= 0.01 && end >= duration - 0.01;
    const en = endSec(clamp(tm, lo + MIN_LEN, hi), hi);
    const ns = start + MIN_LEN <= en ? start : roundSec(Math.max(lo, en - Math.max(MIN_LEN, end - start)));
    onRange(ns, en);
    show(en);
    return { s: ns, en, fromWhole };
  };

  // The menu after a Shift + right-click on the timeline doesn't open.
  const onContextMenu = (e) => {
    if (!shiftRight.current && !e.shiftKey) return; // a plain right-click opens the menu
    e.preventDefault();
    shiftRight.current = false;
  };

  const onPointerMove = (e) => {
    if (!duration) return;
    const tm = timeAt(e.clientX);
    if (drag.current) {
      apply(tm);
      if (zoomed) {
        const r = ref.current.getBoundingClientRect();
        const dir = e.clientX <= r.left + HANDLE_HALF ? -1 : e.clientX >= r.right - HANDLE_HALF ? 1 : 0;
        edge.current.x = e.clientX;
        if (dir && !edge.current.raf) {
          edge.current.dir = dir;
          let last = performance.now();
          const step = (now) => {
            if (!drag.current || !edge.current.dir) { stopEdge(); return; }
            const dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            const v = viewRef.current;
            const grow = (v.e - v.s) * 0.6 * dt;
            const next = edge.current.dir < 0
              ? { s: Math.max(0, v.s - grow), e: v.e }
              : { s: v.s, e: Math.min(duration, v.e + grow) };
            viewRef.current = next;
            setView(next);
            apply(edge.current.dir < 0 ? next.s : next.e);
            edge.current.raf = requestAnimationFrame(step);
          };
          edge.current.raf = requestAnimationFrame(step);
        } else if (!dir) stopEdge();
      }
    } else show(tm);
  };
  const endDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    stopEdge();
    setDragging(null);
    ref.current?.releasePointerCapture?.(e.pointerId);
    if (zoomed && !freeZoom.current) refit(); // the zoom re-fits the new selection
    else if (d.fromWhole && (d.s > 0.01 || d.en < duration - 0.01)) {
      // The first cut was just made: zoom into it automatically.
      setZoomed(true);
      glideTo(zoomTarget());
    }
    // The preview lands on the edge that was moved.
    onSeek?.(d.kind === "end" ? d.en : d.s);
  };
  const leave = () => { if (!drag.current) { setHover(null); onScrub?.(null); } };

  // Right-click on the timeline: "Add a cut here" (in a free spot) and, with
  // more than one cut, "Remove this cut" (on a cut). Items go into the app's
  // right-click menu (ContextMenu → setContextItems).
  const ctxRef = useRef(null);
  ctxRef.current = { timeAt, others, start, end, vlen };
  // Shortcut (N by default): a new cut where the mouse is on the timeline —
  // only over a free spot (never on top of an existing cut).
  useEffect(() => {
    if (!cutApi) return undefined;
    cutApi.addCutAtPointer = () => {
      const tm = hoverRef.current;
      if (tm == null || drag.current) return;
      const c = ctxRef.current;
      const onCut = (tm >= c.start && tm <= c.end) || c.others.some((r) => tm >= r.start && tm <= r.end);
      if (!onCut) onAddCut?.(tm, c.vlen);
    };
    return () => { cutApi.addCutAtPointer = null; };
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    return setContextItems(el, (e) => {
      const c = ctxRef.current;
      if (!duration) return [];
      const tm = c.timeAt(e.clientX);
      const onCut = (tm >= c.start && tm <= c.end) || c.others.some((r) => tm >= r.start && tm <= r.end);
      const items = [];
      if (!onCut) items.push({ id: "add-cut", icon: Scissors, label: t('trim.add_cut', { defaultValue: 'Add a cut here' }), action: () => onAddCut?.(tm, c.vlen) });
      if (onCut && c.others.length) items.push({ id: "remove-cut", icon: Trash, label: t('trim.remove_cut', { defaultValue: 'Remove this cut' }), danger: true, action: () => onRemoveCut?.(tm) });
      // …and the ruler ⇄ sound waves switch, here too (not only on the ruler).
      const view = rulerItemRef.current?.();
      return [items.length ? { id: "trim-cuts", items } : null, view].filter(Boolean);
    });
  }, [duration, t, onAddCut, onRemoveCut]);

  // Keyboard: arrows move a focused handle (Shift = 10 s).
  const onHandleKey = (which) => (e) => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    if (which === "start") { const s = roundSec(clamp(start + dir * step, lo, end - MIN_LEN)); onRange(s, end); onSeek?.(s); }
    else { const en = endSec(clamp(end + dir * step, start + MIN_LEN, hi), hi); onRange(start, en); onSeek?.(en); }
  };

  // Gaps between the selected windows (and before / after them): dimmed.
  const dims = [];
  let cursor = 0;
  for (const [a, b] of shownWindows) { if (a > cursor) dims.push([cursor, a]); cursor = b; }
  if (cursor < duration) dims.push([cursor, duration]);

  const pillW = 64;
  const pillLeft = hover != null && width ? clamp(HANDLE_HALF + ((hover - vs) / vlen) * (width - HANDLE_HALF * 2) - pillW / 2, 0, Math.max(0, width - pillW)) : 0;
  // Nothing cut yet (the whole video selected): nothing to zoom into — the
  // magnifier stays hidden until there's a cut (it fades / scales in).
  const canZoom = zoomed || others.length > 0 || start > 0.01 || end < duration - 0.01;
  const outAtEdge = width > 0 && ((ve - end) / vlen) * width < 2;
  const zoomInset = outAtEdge ? ZOOM_INSET_HANDLE : ZOOM_GAP;
  const zoomLabel = zoomed ? t('trim.zoom_out', { defaultValue: 'Show the whole video' }) : t('trim.zoom_in', { defaultValue: 'Fine adjustment: zoom into the cut' });

  return (
    <div className="relative">
      {/* Time under the pointer, just above the strip */}
      <AnimatePresence>
        {hover != null && (
          <motion.div
            key="pill"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 3 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-[calc(100%+6px)] z-30 pointer-events-none flex justify-center"
            style={{ left: pillLeft, width: pillW }}
          >
            <span className="px-2 py-0.5 rounded-md bg-black/75 text-white text-[12px] font-bold tabular-nums">{formatClock(hover)}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative rounded-xl overflow-hidden bg-zinc-900/50 border border-white/5" style={{ height: STRIP_H }}>
      <div
        ref={ref}
        data-ctx-custom
        data-alt-wheel
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={leave}
        className="relative w-full h-full overflow-hidden select-none touch-none cursor-pointer"
      >
        {frames.map((f) => (
          <div key={f.key} className="tl-appear-fade absolute top-0 bottom-0" style={{ left: f.left, width: f.w + 0.5, ...f.style }} />
        ))}


        {/* Outside the selection: dimmed */}
        {/* A dimmed part that runs past the visible start / end (also when
            zoomed in) reaches the strip's edge, over the 6 px inset too. */}
        {dims.map(([a, b], i) => {
          const left = a <= vs + 0.001 ? "0px" : pct(a);
          const right = b >= ve - 0.001 ? "100%" : pct(b);
          if (b <= vs || a >= ve) return null; // out of view
          return (
            <div key={i} className="absolute top-0 bottom-0 bg-black/65 pointer-events-none"
              style={{ left, width: `calc(${right} - ${left})` }} />
          );
        })}

        {/* Selected windows: accent frame */}
        {/* (other cuts — not being edited — get a fainter frame; click one to edit it) */}
        {shownWindows.map(([a, b], i) => {
          const editing = Math.abs(a - disp.s) < 0.001;
          return (
            <div key={i} className={`absolute top-0 bottom-0 border-2 pointer-events-none transition-colors duration-200 ${editing ? "border-(--accent)" : "border-(--accent)/45"}`}
              style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, borderRadius: STRIP_INNER_R }} />
          );
        })}

        {/* In / out handles (manual range only) */}
        {/* In / out handles on every cut (manual cuts only): the edited cut's
            follow its gliding drawing; another cut's handle, when grabbed,
            makes that cut the edited one. */}
        {[{ id: "edit", s: disp.s, e: disp.e }, ...others.map((r, k) => ({ id: String(k), s: r.start, e: r.end }))].flatMap((cut) =>
          ["start", "end"].map((which) => {
          const tm = which === "start" ? cut.s : cut.e;
          const editing = cut.id === "edit";
          return (
            <div
              key={`${cut.id}-${which}`}
              data-handle={which}
              data-cut={cut.id}
              role="slider"
              tabIndex={editing ? 0 : -1}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(tm)}
              aria-valuetext={formatClock(tm)}
              onKeyDown={editing ? onHandleKey(which) : undefined}
              className={`absolute top-0 bottom-0 w-3 flex items-center justify-center cursor-ew-resize outline-none focus-visible:ring-2 focus-visible:ring-white transition-colors duration-200 ${editing ? "bg-(--accent) z-10" : "bg-(--accent)/60 z-[9]"}`}
              style={{
                left: `calc(${pct(tm)} - ${HANDLE_HALF}px)`, // centred: the white bar is the cut point
                borderRadius: which === "start" ? `${STRIP_INNER_R}px 0 0 ${STRIP_INNER_R}px` : `0 ${STRIP_INNER_R}px ${STRIP_INNER_R}px 0`,
              }}
            >
              {/* The cut point: a white line the full height of the timeline,
                  on both the "in" and the "out" handle, always. */}
              <span className={`w-0.5 h-full pointer-events-none shadow-[0_0_3px_rgba(0,0,0,0.45)] ${editing ? "bg-white" : "bg-white/75"}`} />
            </div>
          );
        }))}

        {/* Preview position (while the video plays / after a seek) */}
        <div
          ref={lineRef}
          className="absolute top-0 bottom-0 w-0.5 -ml-px bg-white pointer-events-none z-20 shadow-[0_0_4px_rgba(0,0,0,0.6)]"
          style={{ display: "none" }}
        />

        {/* Pointer position */}
        {hover != null && !dragging && (
          <div className="absolute top-0 bottom-0 w-0.5 -ml-px bg-white/90 pointer-events-none z-20" style={{ left: pct(hover) }} />
        )}
      </div>

      {/* Magnifier: fine adjustment (zoom into the selection) — a small
          button floating inside the timeline, on the right (clear of the
          "out" handle at the very end) */}
      <motion.button
        type="button"
        onClick={canZoom ? toggleZoom : undefined}
        onPointerDown={(e) => e.stopPropagation()}
        disabled={!canZoom}
        tabIndex={canZoom ? 0 : -1}
        aria-hidden={!canZoom}
        aria-pressed={zoomed}
        aria-label={zoomLabel}
        className={`glass-chip absolute top-1/2 -translate-y-1/2 z-30 w-8 h-8 flex items-center justify-center rounded-lg ${canZoom ? "cursor-pointer" : "pointer-events-none"}`}
        // Glides left / right when the "out" handle reaches / leaves the end
        // (framer: the glass style's own CSS transition can't animate "right").
        initial={false}
        animate={{ right: zoomInset, opacity: canZoom ? 1 : 0, scale: canZoom ? 1 : 0.8 }}
        transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.6 }}
      >
        {/* Active: a white fill fades in over the glass (a gradient can't be
            transitioned, so it's a layer) and the icon turns dark. */}
        <motion.span aria-hidden="true" className="absolute inset-0 rounded-lg bg-white shadow-lg pointer-events-none"
          initial={false} animate={{ opacity: zoomed ? 1 : 0 }} transition={ZOOM_MORPH} />
        {/* Magnifier ⇄ "−", one drawing morphing: the lens shrinks into its
            centre while the handle swings round and stretches into the minus
            bar (and back). Same strokes as the search bar's magnifier. */}
        <motion.svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"
          className="relative" style={{ overflow: "visible" }}
          initial={false} animate={{ color: zoomed ? "#000000" : "#ffffff" }} transition={ZOOM_MORPH}>
          <motion.circle cx="11" cy="11" initial={false}
            animate={zoomed ? { r: 0, opacity: 0 } : { r: 8, opacity: 1 }}
            transition={ZOOM_MORPH} />
          <motion.line initial={false}
            animate={zoomed ? { x1: 5, y1: 12, x2: 19, y2: 12, strokeWidth: 2.5 } : { x1: 16.7, y1: 16.7, x2: 21, y2: 21, strokeWidth: 2 }}
            transition={ZOOM_MORPH} />
        </motion.svg>
      </motion.button>
      </div>

      {/* Time ruler under the strip (same inset time line as the strip) */}
      <div style={{ paddingLeft: HANDLE_HALF, paddingRight: HANDLE_HALF }}>
        {/* flow-root: the ruler's top margin stays inside this box (no margin
            collapse), so the dot's 16 px really lands on the line */}
        {/* Clicking anywhere on the ruler moves the video there (and holding
            keeps scrubbing, like pulling the dot). */}
        {/* Right-click: switch between the time ruler and the sound waveform. */}
        <div
          ref={rulerBoxRef}
          data-ctx-custom
          data-alt-wheel
          className="relative flow-root cursor-pointer touch-none"
          onPointerDown={onDotDown}
          onPointerMove={onDotMove}
          onPointerUp={onDotUp}
          onPointerCancel={onDotUp}
        >
          {/* Ruler ⇄ waveform: a morph — the ticks fold into the line while the
              bars grow out of the baseline (staggered left to right), and back.
              Both overlap in the same 40 px box during the switch. */}
          <div className="relative" style={{ height: 40 }}>
            <AnimatePresence initial={false}>
              {rulerMode === "wave" ? (
                <motion.div key="wave" className="absolute inset-x-0 top-0">
                  <Waveform peaks={peaks} status={waveStatus} duration={duration} width={Math.max(1, width - HANDLE_HALF * 2)} from={vs} to={ve} windows={shownWindows} playhead={playhead} />
                </motion.div>
              ) : (
                <motion.div
                  key="ticks"
                  className="absolute inset-x-0 top-0"
                  initial={{ opacity: 0, scaleY: 0.2, filter: "blur(3px)" }}
                  animate={{ opacity: 1, scaleY: 1, filter: "blur(0px)", transition: { duration: MORPH_S * 1.1, ease: [0.22, 1, 0.36, 1], delay: MORPH_S * 0.45 } }}
                  exit={{ opacity: 0, scaleY: 0.2, transition: { duration: MORPH_S * 0.6, ease: [0.4, 0, 1, 1] } }}
                  style={{ transformOrigin: "50% 16px" }}
                >
                  <Ruler duration={duration} width={Math.max(1, width - HANDLE_HALF * 2)} from={vs} to={ve} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* Where the video is: a small dot in the background's main color on
              the ruler's line (8 px margin + half of the 16 px ticks = 16 px down) */}
          {/* Draggable: pulling it moves the video there (the preview shows
              the frame while dragging). A 20 px invisible grip around it. */}
          <div
            ref={dotRef}
            role="slider"
            aria-label={t('trim.position', { defaultValue: 'Video position' })}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            onPointerEnter={() => setDotHover(true)}
            onPointerLeave={() => setDotHover(false)}
            className={`group/dot absolute w-5 h-5 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center touch-none ${dotDrag ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ top: rulerMode === "wave" ? WAVE_BASE : 16, left: 0, opacity: 0, pointerEvents: "none" }}
          >
            {/* Springy size: grows on hover, more while dragged, and bounces back
                when let go (a soft spring that wobbles a little) */}
            <motion.span
              className="block w-2.5 h-2.5 rounded-full bg-(--accent) shadow-[0_0_8px_var(--accent),0_0_0_2px_rgba(0,0,0,0.35)]"
              initial={false}
              animate={{ scale: dotDrag ? 1.45 : dotHover ? 1.25 : 1 }}
              transition={DOT_SPRING}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
// Magnifier position from the strip's right edge: the same gap as above and
// below it (inner height 46 − button 32 = 14 → 7 px each side), so it sits
// evenly in the corner; while the "out" handle (12 px) is at the very end it
// moves left to leave the handle free.
const ZOOM_BTN = 32;
const ZOOM_GAP = (STRIP_H - 2 - ZOOM_BTN) / 2; // 7
const ZOOM_INSET_HANDLE = 12 + 6;
const ZOOM_MORPH = { duration: 0.32, ease: [0.4, 0, 0.2, 1] };
