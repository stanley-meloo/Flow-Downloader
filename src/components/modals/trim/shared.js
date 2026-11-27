// Trim mode — shared sizes, timings and helpers (used by the preview, the
// timeline, the strip and the ruler / waveform).

export const STRIP_H = 48;        // filmstrip height
// Inside corner of the strip (rounded-xl 12 − 1 px border): the selection
// frame and the handles use it, so at the ends no bit of film peeks out
// between their corner and the strip's.
export const STRIP_INNER_R = 11;
export const QUICK = "cubic-bezier(0.25, 1.25, 0.5, 1)"; // fast, with a hint of overshoot
export const ELASTIC = "cubic-bezier(0.34, 1.7, 0.5, 1)"; // overshoots, then settles (the position dot)
export const DOT_SPRING = { type: "spring", stiffness: 520, damping: 11, mass: 0.6 }; // the dot's size: bouncy
export const HANDLE_HALF = 6; // handles are 12 px wide, centred on their time
export const MIN_LEN = 1;  // shortest part (s)
export const STEP = 1, BIG_STEP = 10; // arrow keys on a handle (Shift = big)

// Cut points are whole seconds.
export const roundSec = (v) => Math.round(v);
export const endSec = (v, duration) => Math.min(duration, Math.round(v)); // never past the video's end
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));


// Tiny value + listeners (the preview's play position → the timeline's line),
// so a playing video doesn't re-render the whole card every frame.
export function createSignal() {
  const subs = new Set();
  return {
    value: null,
    set(v) { this.value = v; subs.forEach((f) => f(v)); },
    sub(f) { subs.add(f); return () => subs.delete(f); },
  };
}

// What's selected, as windows (the cuts, in time order).
// Manual cuts: `start`/`end` is the cut being edited (it has the handles),
// `others` the rest ([{ start, end }], never overlapping it or each other).
export function trimWindows(trim) {
  return [[trim.start, trim.end], ...(trim.others || []).map((r) => [r.start, r.end])].sort((a, b) => a[0] - b[0]);
}

// Room the edited cut has between its neighbours: [lo, hi].
export function cutBounds(trim, duration) {
  let lo = 0, hi = duration;
  for (const r of trim.others || []) {
    if (r.end <= trim.start + 0.001) lo = Math.max(lo, r.end);
    if (r.start >= trim.end - 0.001) hi = Math.min(hi, r.start);
  }
  return [lo, hi];
}


// The player's state for the timeline's button: { playing, available } +
// toggle(), filled in by TrimPreview.
export function createPlayer() {
  const p = createSignal();
  p.value = { playing: false, available: false };
  p.toggle = null;
  return p;
}
