import { useEffect, useRef, useState } from "react";

// Custom scrollbar thumb drawn over a scroll container whose native scrollbar
// is hidden (class "no-scrollbar"). The native one gets a gutter that the
// webview paints in its own shade, which never quite matches translucent /
// blurred cards — this one has no track at all, just the bar.
//
// Usage: put it next to the scroll container, inside a `relative` wrapper that
// has the same top/bottom as the container:
//   <div className="relative ..."><div ref={ref} className="no-scrollbar overflow-y-auto ..."/><ScrollThumb scrollRef={ref}/></div>
// The thumb can be dragged; the wheel/touchpad scroll the container as usual.

const MIN_THUMB = 28; // px
const INSET = 4;      // default px of space above and below the bar
const RIGHT = 4;      // default px from the right edge

export default function ScrollThumb({ scrollRef, className = "", inset = INSET, right = RIGHT }) {
  const [metrics, setMetrics] = useState({ top: 0, height: 0, visible: false });
  const dragRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight + 1) {
        setMetrics((m) => (m.visible ? { ...m, visible: false } : m));
        return;
      }
      const track = clientHeight - inset * 2;
      const height = Math.max(MIN_THUMB, (track * clientHeight) / scrollHeight);
      const top = (scrollTop / (scrollHeight - clientHeight)) * (track - height);
      setMetrics({ top, height, visible: true });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Content size changes (tab switch, sections opening) change the ratio.
    const resize = new ResizeObserver(update);
    const observeChildren = () => Array.from(el.children).forEach((c) => resize.observe(c));
    resize.observe(el);
    observeChildren();
    const mutations = new MutationObserver(() => { observeChildren(); update(); });
    mutations.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [scrollRef, inset]);

  // Dragging the thumb scrolls proportionally.
  const onPointerDown = (e) => {
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { y: e.clientY, scrollTop: el.scrollTop };
  };
  const onPointerMove = (e) => {
    const el = scrollRef.current;
    const drag = dragRef.current;
    if (!el || !drag) return;
    const { scrollHeight, clientHeight } = el;
    const free = clientHeight - inset * 2 - metrics.height;
    if (free <= 0) return;
    el.scrollTop = drag.scrollTop + ((e.clientY - drag.y) * (scrollHeight - clientHeight)) / free;
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div className={`absolute w-1.5 pointer-events-none ${className}`} style={{ top: inset, bottom: inset, right }} aria-hidden="true">
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="w-full rounded-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 pointer-events-auto cursor-pointer transition-[background-color,opacity] duration-200"
        style={{
          height: metrics.height,
          transform: `translateY(${metrics.top}px)`,
          opacity: metrics.visible ? 1 : 0,
          pointerEvents: metrics.visible ? "auto" : "none",
        }}
      />
    </div>
  );
}
