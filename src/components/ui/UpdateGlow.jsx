import { useEffect, useRef } from "react";

// First launch after an app update: a premium light show over the whole
// window, once (~3 s), never blocking clicks (App.css .ug-*):
//   1. a soft accent bloom swells from the middle of the window and fades;
//   2. a light ring runs around the window's edge (accent + white highlight),
//      with a blurred copy behind it as its glow, plus an inner edge glow;
//   3. a diagonal sheen sweeps across everything.
// Colors follow the current accent (var(--accent) / --accent-strong).

const DURATION_MS = 3600;

export default function UpdateGlow({ onDone }) {
  // Latest callback in a ref: App re-renders must not restart the timer.
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => done.current?.(), DURATION_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="ug-root fixed inset-0 z-[10060] pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="ug-bloom absolute inset-0" />
      <div className="ug-edge absolute inset-0" />
      <div className="ug-ring ug-ring--glow absolute inset-0" />
      <div className="ug-ring absolute inset-0" />
      <div className="ug-sheen absolute inset-y-0" />
    </div>
  );
}
