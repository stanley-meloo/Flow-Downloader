// Hover tooltips: a small liquid-glass pill with centered text, anchored to the
// hovered element.
//
// Geometry: height 28 = 8 + 12 (line) + 8 → fully round ends (radius 14);
// horizontal padding 14 = the radius, so the text starts where the curve ends.
// 8 px gap from the element; kept 8 px inside the window.
// Placement: below, centered on the element; above if there's no room below;
// to the left for elements in the bottom-right corner (round buttons) so it
// never covers the button above them. data-tooltip-place forces a side.
//
// Also handles every element with a data-tooltip attribute (event delegation),
// so adding a tooltip anywhere is just data-tooltip="…". Longer help text:
// data-tooltip-variant="text" (normal case, 11 px, up to 288 px wide).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import LiquidGlass from "./liquidGlass/LiquidGlass";

const GAP = 8;
const EDGE = 8;
const TOOLTIP_GLASS = { blur: 1, preBlur: 8, darkTint: 0.55, edgeHighlight: 0.12, depth: 10, coreOpacity: 0.6 };

function choosePlace(rect, size, forced) {
  if (forced) return forced;
  const { innerWidth: W, innerHeight: H } = window;
  const nearRight = rect.right > W - 96;
  const roomBelow = H - rect.bottom >= size.h + GAP + EDGE;
  const roomAbove = rect.top >= size.h + GAP + EDGE;
  if (nearRight && !roomBelow) return "left";
  if (roomBelow) return "bottom";
  if (roomAbove) return "top";
  return "left";
}

function position(rect, size, place) {
  const { innerWidth: W, innerHeight: H } = window;
  let x, y;
  if (place === "left" || place === "right") {
    x = place === "left" ? rect.left - GAP - size.w : rect.right + GAP;
    y = rect.top + rect.height / 2 - size.h / 2;
  } else {
    x = rect.left + rect.width / 2 - size.w / 2;
    y = place === "top" ? rect.top - GAP - size.h : rect.bottom + GAP;
  }
  x = Math.min(Math.max(EDGE, x), W - EDGE - size.w);
  y = Math.min(Math.max(EDGE, y), H - EDGE - size.h);
  return { x, y };
}

export default function Tooltip({ api }) {
  const { tooltip, show, handleTooltipLeave } = api;
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: -9999, y: -9999, place: "bottom" });

  // Declarative tooltips: [data-tooltip]
  useEffect(() => {
    let current = null;
    const onOver = (e) => {
      const el = e.target instanceof Element ? e.target.closest("[data-tooltip]") : null;
      if (el === current) return;
      if (current && !el) { current = null; handleTooltipLeave(); return; }
      if (el) {
        current = el;
        const text = el.getAttribute("data-tooltip");
        if (text) show(el, text, el.getAttribute("data-tooltip-place"), "attr", el.getAttribute("data-tooltip-variant") || "label");
        else handleTooltipLeave();
      }
    };
    const onLeaveWindow = (e) => { if (!e.relatedTarget) { current = null; handleTooltipLeave(); } };
    const hide = () => { current = null; handleTooltipLeave(); };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onLeaveWindow);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onLeaveWindow);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [show, handleTooltipLeave]);

  // Hide if the anchor element disappears (e.g. its dialog closed).
  useEffect(() => {
    if (!tooltip.visible || !tooltip.el) return;
    const id = setInterval(() => { if (!tooltip.el.isConnected) handleTooltipLeave(); }, 250);
    return () => clearInterval(id);
  }, [tooltip, handleTooltipLeave]);

  // Measure the bubble, then place it.
  useLayoutEffect(() => {
    if (!tooltip.visible || !tooltip.rect || !ref.current) return;
    // Shrink-wrap wrapped text: a box that wraps keeps its max width even when
    // the longest line is much shorter, leaving wide empty sides. Measure the
    // real lines and size the bubble to the longest one (+ padding).
    const node = ref.current;
    node.style.width = "";
    const textEl = node.querySelector("[data-tooltip-text]");
    if (textEl && textEl.firstChild) {
      const range = document.createRange();
      range.selectNodeContents(textEl);
      const lines = Array.from(range.getClientRects());
      if (lines.length > 1) {
        // Rects include the enter animation's scale → undo it.
        const scale = node.getBoundingClientRect().width / (node.offsetWidth || 1) || 1;
        const longest = Math.max(...lines.map((l) => l.width)) / scale;
        const cs = getComputedStyle(node);
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        node.style.width = `${Math.ceil(longest + pad + 1)}px`;
      }
    }
    const size = { w: node.offsetWidth, h: node.offsetHeight };
    const place = choosePlace(tooltip.rect, size, tooltip.place);
    setPos({ ...position(tooltip.rect, size, place), place });
  }, [tooltip.visible, tooltip.rect, tooltip.text, tooltip.place]);

  // Follow the anchor while it's shown: every frame, read where the anchor is
  // and move the bubble there directly (no React re-render). Event-based
  // updates lagged behind smooth scrolling (Lenis) and the bubble drifted off
  // its element. Hidden once the anchor leaves its scrolling area.
  const placeRef = useRef(pos.place);
  placeRef.current = pos.place;
  useEffect(() => {
    if (!tooltip.visible || !tooltip.el) return;
    let raf = 0;
    let lastX = null, lastY = null;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const el = tooltip.el;
      const node = ref.current;
      if (!node) return;
      if (!el.isConnected) { handleTooltipLeave(); return; }
      const r = el.getBoundingClientRect();
      const area = el.parentElement?.closest(".overflow-y-auto")?.getBoundingClientRect();
      const top = area ? Math.max(0, area.top) : 0;
      const bottom = area ? Math.min(window.innerHeight, area.bottom) : window.innerHeight;
      // Only the part of the anchor that is actually visible in its area
      // counts: almost scrolled away → hide; otherwise anchor to that part and
      // flip above/below so the bubble stays inside the area (never off the
      // dialog or the window).
      const vis = { left: r.left, right: r.right, width: r.width, top: Math.max(r.top, top), bottom: Math.min(r.bottom, bottom) };
      vis.height = vis.bottom - vis.top;
      if (r.width === 0 || vis.height < Math.min(24, r.height)) { handleTooltipLeave(); return; }
      const size = { w: node.offsetWidth, h: node.offsetHeight };
      let place = placeRef.current;
      if (place === "bottom" && vis.bottom + GAP + size.h > bottom && vis.top - GAP - size.h >= top) place = "top";
      else if (place === "top" && vis.top - GAP - size.h < top && vis.bottom + GAP + size.h <= bottom) place = "bottom";
      const { x, y: rawY } = position(vis, size, place);
      // Keep it inside the area vertically, too.
      const y = Math.min(Math.max(rawY, top + 4), bottom - size.h - 4);
      if (x !== lastX || y !== lastY) {
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        lastX = x; lastY = y;
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tooltip.visible, tooltip.el, handleTooltipLeave]);

  // Small slide from the anchor's side.
  const from = { bottom: { y: -4 }, top: { y: 4 }, left: { x: 4 }, right: { x: -4 } }[pos.place] || {};

  return (
    <AnimatePresence>
      {tooltip.visible && (
        <motion.div
          key={`${tooltip.text}|${tooltip.rect?.left}|${tooltip.rect?.top}`}
          // Only ever point at the newest bubble: when moving from one element
          // to another, the old bubble finishes its fade-out AFTER the new one
          // mounted, and a plain ref would then be reset to null — the new
          // bubble lost its ref and stopped following the scroll.
          ref={(node) => { if (node) ref.current = node; }}
          role="tooltip"
          initial={{ opacity: 0, scale: 0.96, ...from }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{ position: "fixed", left: pos.x, top: pos.y, pointerEvents: "none", zIndex: 10030 }}
          // w-max: size from the text only. A fixed box otherwise shrinks to the
          // room left of its `left` (still the previous bubble's position on the
          // first render) — near the right edge it wrapped to a different width
          // each time.
          className={`isolate w-max min-h-7 px-3.5 py-2 rounded-[14px] flex ${tooltip.variant === "text" ? "max-w-[288px]" : "max-w-[280px]"} items-center justify-center text-center shadow-2xl backdrop-blur-md`}
        >
          <LiquidGlass
            variant="dark"
            settings={TOOLTIP_GLASS}
            radius={14}
            shared
            maxFps={30}
            className="absolute inset-0 -z-10 pointer-events-none rounded-[14px] overflow-hidden"
            fallbackClassName="bg-zinc-950/85 backdrop-blur-2xl border border-white/10"
          />
          <span data-tooltip-text className={tooltip.variant === "text"
            // min-w-0 + overflow-wrap:anywhere: long unbroken text (file names,
            // links) wraps inside the bubble instead of spilling out of it.
            ? "block min-w-0 max-w-full text-[11px] leading-4 font-medium text-zinc-200 text-center [overflow-wrap:anywhere]"   // a sentence: normal case, readable
            : "block min-w-0 max-w-full text-[10px] leading-3 font-bold text-zinc-200 uppercase tracking-widest text-center [overflow-wrap:anywhere]"}>
            {tooltip.text}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
