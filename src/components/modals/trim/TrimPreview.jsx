// Trim mode — the big preview inside the grown thumbnail box: the real video
// of the selected part (a light local clip fetched on Play), storyboard frames
// while scrubbing, play / pause, time and volume.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence, animate } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon as ChevronDown } from "../../ui/AnimatedIcons";
import { formatClock, tileAt, tileStyle } from "../../../utils/trim";
import { streamSrc } from "../../../utils/mediaSrc";

// ---------------------------------------------------------------------------
// Big preview (inside the grown thumbnail box)
// ---------------------------------------------------------------------------
export function TrimPreview({ thumbnail, aspect, storyboard, url, getClip, windows, scrub, seek, playhead, player, overlay, onBack, backLabel }) {
  const boxRef = useRef(null);
  const videoRef = useRef(null);
  const vertical = aspect > 0 && aspect < 0.95;
  const [box, setBox] = useState({ w: 0, h: 0 });
  // The real video of the selected part (a light local clip, fetched on Play):
  // { src, base, from, to } — base = the video time where the clip starts.
  const [clip, setClip] = useState(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const [clipFailed, setClipFailed] = useState(false);
  // The video part couldn't be fetched: say so for a moment (the preview then
  // plays the storyboard frames, without sound).
  const [failNotice, setFailNotice] = useState(false);
  useEffect(() => {
    if (!clipFailed) return undefined;
    setFailNotice(true);
    const id = setTimeout(() => setFailNotice(false), 3500);
    return () => clearTimeout(id);
  }, [clipFailed]);
  const [playing, setPlaying] = useState(false);
  const [boardTime, setBoardTime] = useState(null); // storyboard playback (fallback)
  const [now, setNow] = useState(windows[0][0]);
  const [hovered, setHovered] = useState(false);
  // Every video opens at half volume (DEFAULT_VOLUME); the slider changes it.
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  // Muted is remembered between videos / sessions (MUTE_KEY).
  const [muted, setMutedState] = useState(() => { try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } });
  const setMuted = (m) => { setMutedState(m); try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* storage unavailable */ } };
  // What's really applied (and drawn in the bar): follows the slider
  // directly, but muting / unmuting glides it to 0 / back (MUTE_FADE), so the
  // sound and the white level fade out and in instead of cutting.
  const [level, setLevel] = useState(() => (muted ? 0 : DEFAULT_VOLUME));
  const fadeRef = useRef(null);
  const levelRef = useRef(level);
  levelRef.current = level;
  const fadeTo = (target) => {
    fadeRef.current?.stop();
    fadeRef.current = animate(levelRef.current, target, { ...MUTE_FADE, onUpdate: setLevel });
  };
  useEffect(() => () => fadeRef.current?.stop(), []);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = Math.min(1, Math.max(0, level));
  });
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const wantPlay = useRef(false);
  const request = useRef(0);
  // "video" = the clip; "board" = storyboard frames in real time (only if the
  // clip can't be fetched); null = nothing to play.
  const mode = !clipFailed && getClip && url ? "video" : storyboard ? "board" : null;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const report = (v) => { setNow(v); playhead?.set(v); };
  // The timeline knows where the preview is from the start (its line / dot).
  useEffect(() => { if (playhead && playhead.value == null) playhead.set(windows[0][0]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const nowRef = useRef(now);
  nowRef.current = now;

  const span = () => { const ws = windowsRef.current; return [ws[0][0], ws[ws.length - 1][1]]; };
  // Does the clip cover the whole selection? (A shorter range inside the
  // previous one reuses it.)
  const covers = (c) => { const [a, b] = span(); return c && a >= c.from - 0.05 && b <= c.to + 0.05; };

  const stop = () => {
    wantPlay.current = false;
    const v = videoRef.current;
    if (v && !v.paused) v.pause();
    setPlaying(false);
    setBoardTime(null);
  };

  // A handle was moved / the range typed: stop and show that moment.
  useEffect(() => {
    if (!seek) return;
    stop();
    const v = videoRef.current;
    const c = clipRef.current;
    if (v && c && covers(c)) { try { v.currentTime = Math.max(0, seek.t - c.base); } catch { /* ignore */ } }
    report(seek.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek]);

  // Starts the clip at the selection's start (or where it was paused inside it).
  const startClip = () => {
    const v = videoRef.current;
    const c = clipRef.current;
    if (!v || !c) return;
    const ws = windowsRef.current;
    const at = c.base + v.currentTime;
    const inside = ws.some(([a, b]) => at >= a && at < b - 0.1);
    if (!inside) v.currentTime = Math.max(0, ws[0][0] - c.base);
    v.play().then(() => setPlaying(true)).catch((e) => { console.warn("[trim] preview:", e); setClipFailed(true); setPlaying(false); });
  };

  // While playing: follow the time and stay inside the selection (jump over
  // the gaps between cuts; at the end, stop and go back to the start).
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    let last = performance.now();
    let boardPos = nowRef.current;
    const tick = (ts) => {
      const ws = windowsRef.current;
      const v = videoRef.current;
      const c = clipRef.current;
      const video = modeRef.current === "video" && v && c;
      let time;
      if (video) time = c.base + v.currentTime;
      else { boardPos += Math.min(0.25, (ts - last) / 1000); time = boardPos; }
      last = ts;
      const i = ws.findIndex(([, b]) => time < b - 0.02);
      if (i === -1 || (video && v.ended)) {
        if (video) { v.pause(); v.currentTime = Math.max(0, ws[0][0] - c.base); }
        setPlaying(false);
        setBoardTime(null);
        report(ws[0][0]);
        return;
      }
      if (time < ws[i][0] - 0.05) {
        time = ws[i][0];
        if (video) v.currentTime = time - c.base; else boardPos = time;
      }
      if (!video) setBoardTime(time);
      report(time);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const togglePlay = () => {
    if (playing || loading) { stop(); setLoading(false); request.current++; return; }
    const m = modeRef.current;
    if (m === "board") {
      const ws = windowsRef.current;
      const at = nowRef.current;
      const from = ws.some(([a, b]) => at >= a && at < b - 0.1) ? at : ws[0][0];
      report(from);
      setBoardTime(from);
      setPlaying(true);
      return;
    }
    if (m !== "video") return;
    if (covers(clipRef.current)) { startClip(); return; }
    // Fetch the clip of the current selection, then play it.
    const [a, b] = span();
    const id = ++request.current;
    setLoading(true);
    wantPlay.current = true;
    getClip(url, a, b)
      .then((res) => {
        if (id !== request.current) return;
        // `base` is corrected when the clip loads (it may start at an earlier keyframe).
        setClip({ src: streamSrc(res.path), base: res.start, from: res.start, to: res.end });
      })
      .catch((e) => {
        if (id !== request.current) return;
        console.warn("[trim] preview clip:", e);
        setLoading(false);
        setClipFailed(true);
        // Couldn't fetch it: play the storyboard frames instead (if any).
        if (storyboard) { report(a); setBoardTime(a); setPlaying(true); }
      });
  };

  // Hovering / scrubbing the timeline while it plays: the video pauses (the
  // preview shows the frames under the pointer) and carries on by itself
  // when the pointer leaves the timeline — from where it was, or from where a
  // handle was moved to.
  const resumeAfterScrub = useRef(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  useEffect(() => {
    if (scrub != null) {
      if (playingRef.current && !resumeAfterScrub.current) {
        resumeAfterScrub.current = true;
        const v = videoRef.current;
        if (v && !v.paused) v.pause();
        setPlaying(false);
      }
    } else if (resumeAfterScrub.current) {
      // (the flag stays set until it plays again: no play button flashing in between)
      requestAnimationFrame(() => { resumeAfterScrub.current = false; if (!playingRef.current) togglePlay(); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub]);

  // The timeline's play button drives this player too.
  useEffect(() => {
    if (!player) return;
    player.toggle = togglePlay;
    const v = player.value || {};
    const busy = playing || loading;
    if (v.playing !== busy || v.available !== !!mode || v.loading !== loading) player.set({ playing: busy, loading, available: !!mode });
  });
  useEffect(() => () => { if (player) { player.toggle = null; player.set({ playing: false, loading: false, available: false }); } }, [player]);

  // Storyboard frame (scrubbing, or the fallback playback), fitted in the box.
  // A sprite sheet that hasn't loaded yet (long videos have many, e.g. while
  // sweeping fast over a 5 h timeline) never shows as a blank: the last frame
  // that could be drawn stays until it arrives (and it's fetched right away).
  const [, setSheetsTick] = useState(0);
  const lastTile = useRef(null);
  // After a seek (the dot / ruler let go, a handle moved…) with no video clip
  // to show that moment, its storyboard frame stays — not the thumbnail.
  const clipHere = !!clip && !clipFailed && covers(clip) && (playing || clip.loaded);
  const boardAt = scrub ?? (mode === "board" && boardTime != null ? boardTime : (seek && !clipHere ? now : null));
  let boardStyle = null;
  if (boardAt != null && storyboard && box.w && box.h) {
    const ratio = storyboard.width / storyboard.height;
    const h = Math.min(box.h, box.w / ratio);
    let tile = tileAt(storyboard, boardAt);
    if (tile && !sheetReady(tile.url, () => setSheetsTick((n) => n + 1))) tile = lastTile.current;
    else lastTile.current = tile;
    boardStyle = { width: h * ratio, height: h, ...(tile ? tileStyle(storyboard, tile, h) : {}) };
  }

  const clipShown = !!clip && !clipFailed && covers(clip) && (playing || clip.loaded);
  const showChrome = !playing || hovered;
  const showPlay = !playing && !loading && scrub == null && !resumeAfterScrub.current;

  return (
    <div
      ref={boxRef}
      className={`absolute inset-0 bg-black overflow-hidden ${playing ? "cursor-pointer" : ""}`}
      // Playing (the play button is hidden): a click anywhere on the picture pauses.
      onClick={(e) => { if (playing && !e.target.closest("button, input, video")) togglePlay(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {thumbnail && (vertical ? (
        // Vertical video: the thumbnail as it is, with only its sides blurred
        // (a backdrop blur limited to each side — the bright middle never
        // bleeds into them as a glow). Stays under the playing video too.
        <>
          <img src={thumbnail} alt="" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
          <SideBlur aspect={aspect} />
        </>
      ) : (
        <>
          {/* Backdrop: the thumbnail, blurred, fills the box around the picture */}
          <img src={thumbnail} alt="" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50 pointer-events-none" />
          {/* The picture: the thumbnail until the clip plays */}
          <img src={thumbnail} alt="" referrerPolicy="no-referrer" className={`absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-300 ${clipShown ? "opacity-0" : "opacity-100"}`} />
        </>
      ))}
      {clip && !clipFailed && (
        <video
          key={clip.src}
          ref={videoRef}
          src={clip.src}
          preload="auto"
          playsInline
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            v.volume = Math.min(1, Math.max(0, levelRef.current));
            // Starts at the keyframe before the cut: shift so times line up.
            const extra = Math.max(0, (v.duration || 0) - (clip.to - clip.from));
            setClip((c) => (c && c.src === clip.src ? { ...c, base: c.from - extra, loaded: true } : c));
          }}
          onCanPlay={() => {
            if (!wantPlay.current) return;
            wantPlay.current = false;
            setLoading(false);
            requestAnimationFrame(startClip);
          }}
          onError={(e) => { console.warn("[trim] preview clip failed to play:", e.currentTarget.error?.message || e.currentTarget.error?.code); setLoading(false); setClipFailed(true); }}
          onPause={() => { if (modeRef.current === "video") setPlaying(false); }}
          onClick={togglePlay}
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${clipShown ? "opacity-100 cursor-pointer" : "opacity-0 pointer-events-none"}`}
        />
      )}

      {/* Storyboard frame: scrubbing, or the fallback playback */}
      {boardStyle && (
        // Vertical videos keep the blurred sides around the frame; others get
        // a plain black backdrop (the frame fills the box anyway).
        <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${vertical ? "" : "bg-black"}`}>
          <div className="rounded-sm shadow-2xl" style={boardStyle} />
        </div>
      )}

      {/* The video part couldn't be fetched (frames only, no sound) */}
      <AnimatePresence>
        {failNotice && (
          <motion.div
            key="fail"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute bottom-14 left-1/2 -translate-x-1/2 px-3 h-7 flex items-center rounded-full bg-zinc-950/80 backdrop-blur-md ring-1 ring-white/10 text-[11.5px] font-semibold text-zinc-200 whitespace-nowrap pointer-events-none"
            role="status"
          >
            {t("trim.preview_failed", { defaultValue: "Couldn't load the video — showing frames without sound" })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fetching the part to play */}
      <AnimatePresence>
        {loading && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/45 pointer-events-none">
            <div className="w-8 h-8 border-[3px] border-white/20 border-t-white rounded-full animate-spin" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top: back + title (over a soft gradient); hides while playing */}
      <motion.div
        animate={{ opacity: showChrome ? 1 : 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-x-0 top-0 p-3 pb-8 flex items-start gap-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent"
        style={{ pointerEvents: showChrome ? "auto" : "none" }}
      >
        <button
          type="button"
          onClick={onBack}
          data-tooltip={backLabel}
          aria-label={backLabel}
          className="glass-chip w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-white cursor-pointer"
        >
          <ChevronDown size={18} className="rotate-90" />
        </button>
        <div className="flex-1 min-w-0 pr-10 pt-0.5">{overlay}</div>
      </motion.div>

      {/* Center: big play / pause (hidden while the part is being fetched —
          the spinner sits there) */}
      {mode && (
        <motion.div
          initial={false}
          // Only while stopped: playing, the video is clear (click it, or press
          // Space, to pause).
          // (also hidden while previewing frames from the timeline)
          animate={{ opacity: showPlay ? 1 : 0, scale: showPlay ? 1 : 0.9 }}
          transition={{ duration: 0.2 }}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
          style={{ pointerEvents: showPlay ? "auto" : "none" }}
        >
          <PlayButton playing={playing} onClick={togglePlay} size={26} className="glass-chip w-16 h-16 text-white [transition:background-color_0.2s_ease]" /* framer drives the scale: no CSS transform transition */ />
        </motion.div>
      )}

      {/* Bottom left: time */}
      {mode && (
        <motion.div
          animate={{ opacity: showChrome ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          className="absolute left-3 bottom-3 h-10 flex items-center pointer-events-none"
        >
          <span className="px-2 py-1 rounded-md bg-black/60 text-white text-[12px] font-bold tabular-nums">
            {formatClock(scrub ?? now)}
          </span>
        </motion.div>
      )}

      {/* Bottom right: volume */}
      {mode === "video" && (
        <motion.div
          animate={{ opacity: showChrome ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          className="absolute right-3 bottom-3 h-10 flex items-center"
          style={{ pointerEvents: showChrome ? "auto" : "none" }}
        >
          <VolumeControl
            level={level}
            silent={muted || volume === 0}
            folded={muted} /* only a real mute folds it (dragging to 0 keeps the slider) */
            onVolume={(v) => { fadeRef.current?.stop(); setVolume(v); setLevel(v); if (v > 0) setMuted(false); }}
            onToggleMute={() => {
              if (muted || volume === 0) {
                const back = volume === 0 ? DEFAULT_VOLUME : volume;
                setMuted(false); setVolume(back); fadeTo(back);
              } else { setMuted(true); fadeTo(0); }
            }}
          />
        </motion.div>
      )}
    </div>
  );
}

// Blurs only the two sides around a centered picture of the given shape.
export function SideBlur({ aspect }) {
  return (
    <div className="absolute inset-0 flex pointer-events-none">
      <div className="flex-1 backdrop-blur-[6px] backdrop-brightness-75" />
      <div className="h-full shrink-0" style={{ aspectRatio: aspect }} />
      <div className="flex-1 backdrop-blur-[6px] backdrop-brightness-75" />
    </div>
  );
}

const DEFAULT_VOLUME = 0.5;
const MUTE_KEY = "flow.trimPreviewMuted";
const MUTE_FADE = { duration: 0.35, ease: [0.4, 0, 0.2, 1] }; // mute / unmute glide // 50 % of the video's own volume

// Volume slider — From Uiverse.io by Galahhad - https://uiverse.io/Galahhad/happy-dodo-17
// MIT License, Copyright (c) Galahhad (Galahad)
// Styles: .fd-volume in App.css (scoped name). Speaker icon + a bar that
// thickens on hover; the white level is painted by the thumb's shadow.
// Additions: hovering the icon makes its sound waves ripple; clicking it
// mutes (the waves give way to a small ×) and clicking again unmutes.
const WAVE = (delay) => ({
  idle: { opacity: 1, scale: 1, x: 0 },
  ripple: { opacity: [1, 0.25, 1], x: [0, 1, 0], transition: { duration: 0.6, delay, ease: "easeInOut" } },
  muted: { opacity: 0, scale: 0.6, x: -2, transition: { duration: 0.18 } },
});
const WAVE_IN = WAVE(0);
const WAVE_OUT = WAVE(0.12);
const CROSS = {
  hidden: { pathLength: 0, opacity: 0, transition: { duration: 0.15 } },
  shown: { pathLength: 1, opacity: 1, transition: { duration: 0.25, ease: "easeOut", delay: 0.08 } },
};

function VolumeControl({ level, silent, folded, onVolume, onToggleMute }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const waves = silent ? "muted" : hover ? "ripple" : "idle";
  const label = silent ? t('trim.unmute', { defaultValue: 'Unmute' }) : t('trim.mute', { defaultValue: 'Mute' });
  return (
    // Liquid-glass pill, 36 px tall. Muted, it folds into a 36 px circle with
    // just the icon (the slider slides away); unmuted it unfolds again.
    <motion.div
      className="glass-chip h-9 flex items-center rounded-full"
      initial={false}
      animate={{ paddingLeft: 8, paddingRight: folded ? 8 : 12 }}
      transition={VOL_FOLD}
    >
    <div className="fd-volume" style={{ "--icon-size": "20px", "--icon-margin": "0px" }}>
      <motion.div
        className="flex items-center overflow-hidden"
        initial={false}
        animate={{ width: folded ? 0 : 80, marginLeft: folded ? 0 : 10, opacity: folded ? 0 : 1 }}
        transition={VOL_FOLD}
        aria-hidden={folded}
      >
        <input
          type="range"
          className="fd-volume__level"
          min={0} max={100} step={1}
          tabIndex={folded ? -1 : 0}
          value={Math.round(level * 100)}
          aria-label={t('trim.volume', { defaultValue: 'Volume' })}
          onChange={(e) => onVolume(Number(e.target.value) / 100)}
        />
      </motion.div>
      <button
        type="button"
        onClick={onToggleMute}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        data-tooltip={label}
        aria-label={label}
        aria-pressed={silent}
        className="fd-volume__button cursor-pointer"
        // White while there's sound, dark grey when muted (set here so no
        // other style can override it); muted + hover: a bit lighter.
        style={{ color: silent ? (hover ? "rgb(120, 120, 120)" : "rgb(82, 82, 82)") : "#fff" }}
      >
        <svg className="fd-volume__icon cursor-pointer" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" style={{ overflow: "visible" }}>
          {/* outer wave */}
          <motion.path variants={WAVE_OUT} initial={false} animate={waves} style={{ transformOrigin: "13px 12px", transformBox: "view-box" }}
            d="M18.36 19.36a1 1 0 0 1-.705-1.71C19.167 16.148 20 14.142 20 12s-.833-4.148-2.345-5.65a1 1 0 1 1 1.41-1.419C20.958 6.812 22 9.322 22 12s-1.042 5.188-2.935 7.069a.997.997 0 0 1-.705.291z" fill="currentColor" />
          {/* inner wave */}
          <motion.path variants={WAVE_IN} initial={false} animate={waves} style={{ transformOrigin: "13px 12px", transformBox: "view-box" }}
            d="M15.53 16.53a.999.999 0 0 1-.703-1.711C15.572 14.082 16 13.054 16 12s-.428-2.082-1.173-2.819a1 1 0 1 1 1.406-1.422A6 6 0 0 1 18 12a6 6 0 0 1-1.767 4.241.996.996 0 0 1-.703.289z" fill="currentColor" />
          {/* speaker */}
          <path d="M12 22a1 1 0 0 1-.707-.293L6.586 17H4c-1.103 0-2-.897-2-2V9c0-1.103.897-2 2-2h2.586l4.707-4.707A.998.998 0 0 1 13 3v18a1 1 0 0 1-1 1z" fill="currentColor" />
          {/* muted: small × where the waves were */}
          <motion.g initial={false} animate={silent ? "shown" : "hidden"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <motion.path variants={CROSS} d="M16.5 9.5 21.5 14.5" />
            <motion.path variants={CROSS} d="M21.5 9.5 16.5 14.5" />
          </motion.g>
        </svg>
      </button>
    </div>
    </motion.div>
  );
}
const VOL_FOLD = { duration: 0.3, ease: [0.4, 0, 0.2, 1] };

// Storyboard sprite sheets: loaded once, remembered for the session.
// sheetReady(url, onLoad) → true when it can be drawn; otherwise starts
// loading it and calls onLoad when it's there.
const sheets = new Map(); // url → "loading" | "ok" | "error"
const sheetWaiters = new Map();
function sheetReady(url, onLoad) {
  const st = sheets.get(url);
  if (st === "ok") return true;
  if (st === "error") return false;
  if (onLoad) { if (!sheetWaiters.has(url)) sheetWaiters.set(url, new Set()); sheetWaiters.get(url).add(onLoad); }
  if (!st) {
    sheets.set(url, "loading");
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    const done = (ok) => {
      sheets.set(url, ok ? "ok" : "error");
      sheetWaiters.get(url)?.forEach((f) => f());
      sheetWaiters.delete(url);
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  }
  return false;
}

// Round play / pause button (preview + timeline).
function PlayButton({ playing, onClick, className = "", size = 16, disabled = false }) {
  const { t } = useTranslation();
  const label = playing ? t('trim.pause', { defaultValue: 'Pause' }) : t('trim.play', { defaultValue: 'Preview the cut' });
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label} /* no tooltip: the icon says it */
      whileHover={disabled ? undefined : { scale: 1.08 }}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      transition={PLAY_SPRING}
      className={`relative shrink-0 flex items-center justify-center rounded-full ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${className}`}
    >
      {/* Play ⇄ pause: one shape morphing into the other — the triangle is
          two halves (split at x = 13.5) that slide into the two bars. Same
          points in the same order, so the paths interpolate cleanly. The
          thin round stroke softens the corners. */}
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="block"
        fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <motion.path initial={false} animate={{ d: playing ? PAUSE_L : PLAY_L }} transition={ICON_MORPH} />
        <motion.path initial={false} animate={{ d: playing ? PAUSE_R : PLAY_R }} transition={ICON_MORPH} />
      </svg>
    </motion.button>
  );
}
const PLAY_SPRING = { type: "tween", duration: 0.06, ease: "easeOut" };
const ICON_MORPH = { duration: 0.18, ease: [0.4, 0, 0.2, 1] };
// Triangle (7,4)–(20,12)–(7,20) in two halves ↔ two bars (x 6–10 and 14–18).
const PLAY_L = "M7 4 L13.5 8 L13.5 16 L7 20 Z";
const PLAY_R = "M13.5 8 L20 12 L20 12 L13.5 16 Z";
const PAUSE_L = "M6 4 L10 4 L10 20 L6 20 Z";
const PAUSE_R = "M14 4 L18 4 L18 20 L14 20 Z";
