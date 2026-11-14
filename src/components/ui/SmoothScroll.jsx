// <SmoothScroll> — a scrollable area with Lenis smooth scrolling
// (https://github.com/darkroomengineering/lenis, MIT).
//
// Renders: wrapper (the element that scrolls — give it the overflow classes)
//   └─ content (one stable child Lenis measures — `contentClassName`)
// The ref points to the wrapper, so existing code that reads scrollTop /
// listens to "scroll" (ScrollThumb, the Settings bottom fade) keeps working.
//
// Nested areas (a dropdown list inside the Settings scroller) pass `nested`:
// the outer scroller then leaves their wheel events alone (data-lenis-prevent),
// while they still scroll smoothly themselves.
// With "reduce motion" turned on in the OS, it stays a normal native scroller.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import Lenis from "lenis";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const SmoothScroll = forwardRef(function SmoothScroll(
  { className = "", contentClassName = "", nested = false, children, ...rest },
  ref
) {
  const wrapperRef = useRef(null);
  const contentRef = useRef(null);
  useImperativeHandle(ref, () => wrapperRef.current, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content || prefersReducedMotion()) return;
    const lenis = new Lenis({
      wrapper,
      content,
      eventsTarget: wrapper,
      autoRaf: true,     // Lenis runs its own requestAnimationFrame loop
      smoothWheel: true,
      lerp: 0.12,        // glide: lower = smoother / longer
      wheelMultiplier: 1,
      // Touchpads/touch keep the system's own momentum.
      syncTouch: false,
    });
    // Exposed so code inside the area can glide it programmatically
    // (e.g. a dropdown making room for itself) instead of jumping.
    wrapper.lenis = lenis;
    return () => { delete wrapper.lenis; lenis.destroy(); };
  }, []);

  return (
    <div ref={wrapperRef} className={className} data-lenis-prevent={nested ? "" : undefined} {...rest}>
      {/* shrink-0: if the wrapper is a flex container, the content would
          otherwise be squashed to the wrapper's height (its children just
          overflow), so it never "grows", Lenis never re-measures and the
          scroll stops before the end. */}
      <div ref={contentRef} className={`shrink-0 ${contentClassName}`}>
        {children}
      </div>
    </div>
  );
});

export default SmoothScroll;
