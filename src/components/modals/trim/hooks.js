// Trim strip — smaller pieces of its logic: the handles' glide to a new
// range, the ruler ⇄ waveform mode (and its data), and the filmstrip layout.

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { tileAt, tileStyle } from "../../../utils/trim";
import { WAVE_KEY, waveCache, wavePending } from "./RulerWave";
import { HANDLE_HALF, STRIP_H } from "./shared";

const RANGE_GLIDE = { duration: 0.45, ease: [0.22, 1, 0.36, 1] }; // handles gliding to a new range

/** What the handles show: start / end, gliding to a new range (not while dragging). */
export function useRangeGlide(start, end, dragRef) {
  // What the handles show: the real range while dragging; any other change
  // (reset, typed times, another cut picked…) glides there (RANGE_GLIDE) — only
  // the drawing moves, the range itself is already the new one.
  const [disp, setDisp] = useState({ s: start, e: end });
  const dispRef = useRef(disp);
  dispRef.current = disp;
  const dispAnim = useRef(null);
  useEffect(() => () => dispAnim.current?.stop(), []);
  useEffect(() => {
    dispAnim.current?.stop();
    const from = dispRef.current;
    if (dragRef.current || (Math.abs(from.s - start) < 0.01 && Math.abs(from.e - end) < 0.01)) {
      setDisp({ s: start, e: end });
      return;
    }
    dispAnim.current = animate(0, 1, {
      ...RANGE_GLIDE,
      onUpdate: (k) => setDisp({ s: from.s + (start - from.s) * k, e: from.e + (end - from.e) * k }),
      onComplete: () => setDisp({ s: start, e: end }),
    });
  }, [start, end]);
  return disp;
}

/** The ruler / waveform mode under the strip, and the waveform's data. */
// How long "couldn't read the sound" stays before the ruler returns.
const WAVE_ERROR_MS = 1500;

export function useRulerMode({ formatType, url, getWaveform, duration }) {
  // --- Ruler ⇄ sound waveform (right-click on the ruler) ---
  // The choice is remembered (WAVE_KEY). The waveform is fetched once per
  // video (and kept for the session: waveCache) the first time it's shown.
  // Follows the download type: "Audio only" switches to the waves (the ruler
  // stays available), "Video only" (no sound) locks the ruler, and back to
  // "Video + audio" the user's own choice returns.
  const savedRuler = () => { try { return localStorage.getItem(WAVE_KEY) === "wave" ? "wave" : "ticks"; } catch { return "ticks"; } };
  const [chosenRuler, setRulerMode] = useState(() => (formatType === "audio" ? "wave" : savedRuler()));
  const wavesLocked = formatType === "video_only";
  const rulerMode = wavesLocked ? "ticks" : chosenRuler;
  const prevFormat = useRef(formatType);
  useEffect(() => {
    if (prevFormat.current === formatType) return;
    prevFormat.current = formatType;
    if (formatType === "audio") setRulerMode("wave");
    else if (formatType === "video") setRulerMode(savedRuler());
  }, [formatType]);
  const chooseRuler = (m) => {
    if (m === "wave" && waveStatus === "error") setWaveStatus("idle"); // try again
    setRulerMode(m);
    try { localStorage.setItem(WAVE_KEY, m); } catch { /* storage unavailable */ }
  };
  const [peaks, setPeaks] = useState(() => (url && waveCache.get(url)) || null);
  const [waveStatus, setWaveStatus] = useState(peaks ? "ready" : "idle"); // idle | loading | ready | error
  // (`mounted` only stops updates after the card closes: the effect re-runs
  // when the status changes, which must not cancel the request in flight.)
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (rulerMode !== "wave" || !url || !getWaveform || waveStatus !== "idle") return;
    setWaveStatus("loading");
    // One request per video at a time (shared if asked again meanwhile).
    let req = wavePending.get(url);
    if (!req) {
      req = getWaveform(url, duration).finally(() => wavePending.delete(url));
      wavePending.set(url, req);
    }
    req
      .then((p) => { waveCache.set(url, p); if (mounted.current) { setPeaks(p); setWaveStatus("ready"); } })
      .catch((e) => { console.warn("[trim] waveform:", e); if (mounted.current) setWaveStatus("error"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulerMode, url, waveStatus]);
  // Waves that couldn't be read: the error message shows for 1.5 s, then the
  // ruler comes back by itself (same morph as switching by hand). Not saved:
  // the user's choice stays "waves", and choosing them again retries.
  const showingError = rulerMode === "wave" && waveStatus === "error";
  useEffect(() => {
    if (!showingError) return undefined;
    const id = setTimeout(() => setRulerMode("ticks"), WAVE_ERROR_MS);
    return () => clearTimeout(id);
  }, [showingError]);

  return { rulerMode, wavesLocked, chooseRuler, peaks, waveStatus };
}

// Filmstrip layout for the view [vs, ve]: [{ key, left, w, style }].
export function stripFrames(storyboard, width, duration, vs, ve, vlen) {
  if (!storyboard || !width || !duration) return [];
  const fw = (STRIP_H * storyboard.width) / storyboard.height;
  const inner = Math.max(1, width - HANDLE_HALF * 2);
  const pxPerSec = inner / vlen;
  let step = Math.max(0.05, storyboard.perTile || 1);
  while (step * pxPerSec < fw) step *= 2;
  const out = [];
  const first = Math.max(0, Math.floor((vs - (HANDLE_HALF / pxPerSec)) / step));
  for (let k = first; k * step < Math.min(duration, ve + (HANDLE_HALF + fw) / pxPerSec); k++) {
    const tm = k * step;
    out.push({
      key: tm.toFixed(3), // by time: frames kept across grid changes stay put
      left: HANDLE_HALF + (tm - vs) * pxPerSec,
      w: step * pxPerSec,
      style: tileStyle(storyboard, tileAt(storyboard, Math.min(tm + step / 2, duration)), STRIP_H),
    });
  }
  return out;
}
