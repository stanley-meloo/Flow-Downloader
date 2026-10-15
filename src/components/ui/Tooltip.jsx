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
    window.addEventListener("wheel", hide, { passive: true });
    window.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onLeaveWindow);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("wheel", hide);
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
    const size = { w: ref.current.offsetWidth, h: ref.current.offsetHeight };
    const place = choosePlace(tooltip.rect, size, tooltip.place);
    setPos({ ...position(tooltip.rect, size, place), place });
  }, [tooltip.visible, tooltip.rect, tooltip.text, tooltip.place]);

  // Small slide from the anchor's side.
  const from = { bottom: { y: -4 }, top: { y: 4 }, left: { x: 4 }, right: { x: -4 } }[pos.place] || {};

  return (
    <AnimatePresence>
      {tooltip.visible && (
        <motion.div
          key={`${tooltip.text}|${tooltip.rect?.left}|${tooltip.rect?.top}`}
          ref={ref}
          role="tooltip"
          initial={{ opacity: 0, scale: 0.96, ...from }}
          animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{ position: "fixed", left: pos.x, top: pos.y, pointerEvents: "none", zIndex: 10030 }}
          className={`isolate min-h-7 px-3.5 py-2 rounded-[14px] flex ${tooltip.variant === "text" ? "max-w-[288px]" : "max-w-[280px]"} items-center justify-center text-center shadow-2xl backdrop-blur-md`}
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
          <span className={tooltip.variant === "text"
            ? "block text-[11px] leading-4 font-medium text-zinc-200 text-center break-words"   // a sentence: normal case, readable
            : "block text-[10px] leading-3 font-bold text-zinc-200 uppercase tracking-widest text-center break-words"}>
            {tooltip.text}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
