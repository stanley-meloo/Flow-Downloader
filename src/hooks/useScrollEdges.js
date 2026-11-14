import { useEffect, useState } from "react";

/**
 * Which edges of a scrolling element still have content beyond them
 * ({ top, bottom }), kept up to date on scroll and resize. Used for the soft
 * "scroll-fade" edges (App.css) of the download queue and the playlist list:
 * content dissolves only on the side where there's more to scroll.
 */
export default function useScrollEdges(ref) {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", update); observer.disconnect(); };
  }, [ref]);
  return edges;
}
