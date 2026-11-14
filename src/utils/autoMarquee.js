// Auto-marquee: any truncated text (Tailwind `truncate`, i.e. one line ending
// in "…") that doesn't fit slowly scrolls to its end and back, so it can be
// read. Works app-wide without touching the components:
//   - finds `.truncate` elements (plus opt-in `[data-marquee]`); only the ones
//     whose content changed, new ones, or resized ones are re-checked;
//   - only elements whose text really overflows are animated;
//   - the animation moves the element's own scrollLeft (it's overflow:hidden),
//     so React's markup is never changed; while it runs the "…" is swapped for
//     soft faded edges ([data-marquee-on] + CSS in App.css);
//   - back and forth: pause at the start, glide to the end, pause, glide back;
//   - one shared requestAnimationFrame loop, idle when nothing overflows;
//     off with prefers-reduced-motion (the "…" stays).
// Opt out on an element with data-marquee="off".

const SELECTOR = ".truncate, [data-marquee]";
const SPEED = 32;         // px per second
const MIN_LEG = 1.2;      // s, shortest glide
const PAUSE = 1.8;        // s, rest at each end
const FADE = 14;          // px, faded edge while scrolled

const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

export function startAutoMarquee() {
  if (typeof window === "undefined" || window.__autoMarquee) return;
  window.__autoMarquee = true;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const active = new Map(); // element → { start, distance }
  let raf = 0;

  const stop = (el) => {
    if (!active.has(el)) return;
    active.delete(el);
    el.scrollLeft = 0;
    el.removeAttribute("data-marquee-on");
    el.style.removeProperty("--mq-l");
    el.style.removeProperty("--mq-r");
  };

  const check = (el) => {
    if (!el.isConnected || el.getAttribute("data-marquee") === "off") { stop(el); return; }
    const distance = el.scrollWidth - el.clientWidth;
    if (el.clientWidth > 0 && distance > 2) {
      const state = active.get(el);
      if (state) state.distance = distance;
      else {
        active.set(el, { start: performance.now(), distance });
        el.setAttribute("data-marquee-on", "");
      }
      if (!raf) raf = requestAnimationFrame(frame);
    } else stop(el);
  };

  const frame = (now) => {
    raf = 0;
    if (document.hidden) return; // resumes on visibilitychange
    active.forEach((state, el) => {
      if (!el.isConnected) { stop(el); observed.delete(el); resizeObserver.unobserve(el); return; }
      const leg = Math.max(MIN_LEG, state.distance / SPEED);
      const cycle = 2 * (PAUSE + leg);
      const t = ((now - state.start) / 1000) % cycle;
      let p; // 0 = start, 1 = end
      if (t < PAUSE) p = 0;
      else if (t < PAUSE + leg) p = easeInOut((t - PAUSE) / leg);
      else if (t < 2 * PAUSE + leg) p = 1;
      else p = 1 - easeInOut((t - 2 * PAUSE - leg) / leg);
      const x = p * state.distance;
      el.scrollLeft = x;
      // Faded edge only on the side where text is hidden.
      el.style.setProperty("--mq-l", `${Math.min(FADE, x)}px`);
      el.style.setProperty("--mq-r", `${Math.min(FADE, state.distance - x)}px`);
    });
    if (active.size) raf = requestAnimationFrame(frame);
  };

  const observed = new Set();
  const resizeObserver = new ResizeObserver((entries) => entries.forEach((e) => check(e.target)));

  const track = (el) => {
    if (!observed.has(el)) { observed.add(el); resizeObserver.observe(el); }
    check(el);
  };
  const forget = () => {
    observed.forEach((el) => {
      if (!el.isConnected) { observed.delete(el); resizeObserver.unobserve(el); stop(el); }
    });
  };
  const scanAll = () => document.querySelectorAll(SELECTOR).forEach(track);

  // Only what changed is re-checked (reading scrollWidth forces layout, and
  // the queue updates its progress text many times per second): new elements
  // and the truncated text a changed node belongs to. Batched per frame.
  const dirty = new Set();
  let added = [];
  let removed = false;
  let pending = 0;
  const flush = () => {
    pending = 0;
    for (const node of added) {
      if (!node.isConnected) continue;
      if (node.matches(SELECTOR)) track(node);
      node.querySelectorAll(SELECTOR).forEach(track);
    }
    dirty.forEach((el) => { if (el.isConnected) track(el); });
    if (removed) forget();
    added = []; dirty.clear(); removed = false;
  };
  const onMutations = (records) => {
    for (const r of records) {
      const target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      const owner = target?.closest?.(SELECTOR);
      if (owner) dirty.add(owner);
      if (r.type === "childList") {
        r.addedNodes.forEach((n) => { if (n.nodeType === 1) added.push(n); });
        if (r.removedNodes.length) removed = true;
      }
    }
    if (!pending) pending = requestAnimationFrame(flush);
  };
  new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && active.size && !raf) raf = requestAnimationFrame(frame); });
  document.fonts?.ready.then(scanAll); // widths change once the font loads
  scanAll();
}
