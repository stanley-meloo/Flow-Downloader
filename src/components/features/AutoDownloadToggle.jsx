// "Auto Download" switch — bottom-left corner.
// On: a searched video skips the download card and goes straight to the queue
// with the options of the last download made from the card (useDownloader;
// playlists still open their card). Off: the card opens as usual.
// Hovering shows its name above it (the app's liquid-glass tooltip); the "?"
// next to it explains what it does.
//
// Look: the switch from Uiverse.io (by vihstorck) on a liquid-glass track —
// a white knob with an icon (pause when off, play when on) that pops between
// them, plus a small white dash that slides to the free side. Styles: App.css
// ("Auto Download switch").
//
// Geometry: 46×24 track · 18 px knob 3 px from the edges → travels 22 px.
// 24 px from the left edge. Its bottom (30 px above the window edge) is the
// app's bottom line: the Settings gear and the download queue end there too.

import { motion } from "framer-motion";
import { TAP } from "../ui/Motion"; // fast, hard button press
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import { CircleHelpIcon as HelpCircle } from "../ui/AnimatedIcons";

const GLASS = { blur: 0.65, darkTint: 0.22, edgeHighlight: 0.2, coreOpacity: 0.25 }; // light tint: the background shows through

export default function AutoDownloadToggle({ active, onToggle, label, info, tooltip, glassPaused = false, delay = 0 }) {
  return (
    <motion.div
      // Movement only; the fade is on the glass and the "?" themselves
      // (.glass-fade-in): a fading parent switches the glass blur off.
      initial={{ scale: 0.6 }}
      animate={{ scale: 1, transition: { type: "spring", stiffness: 260, damping: 20, delay } }}
      style={{ transformOrigin: "left center" }}
      className="fixed left-6 bottom-[30px] z-20 flex items-center gap-1.5 pointer-events-auto"
    >
    <motion.button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={label}
      whileTap={{ scale: 0.97, transition: TAP }}
      onMouseDown={(e) => e.preventDefault()} /* no lingering focus ring after a click */
      onClick={(e) => { e.currentTarget.blur(); onToggle(); }}
      onMouseEnter={(e) => tooltip?.show(e.currentTarget, label, "top")}
      onMouseLeave={() => tooltip?.leave()}
      className={`auto-dl relative flex rounded-full cursor-pointer ${active ? "is-on" : ""}`}
    >
      {/* Soft white glow while on */}
      <span aria-hidden="true" className="auto-dl__glow" />
      <LiquidGlass
        variant="dark"
        settings={GLASS}
        paused={glassPaused}
        className="glass-fade-in auto-dl__track rounded-full backdrop-blur-md shadow-[0_6px_20px_rgba(0,0,0,0.3)]"
        style={{ "--fade-delay": `${delay}s`, "--fade-duration": "0.35s" }}
        fallbackClassName="backdrop-blur-2xl border border-white/10 bg-zinc-950/60"
      >
        <span aria-hidden="true" className="auto-dl__tint" />
        <span aria-hidden="true" className="auto-dl__line" />
        <span aria-hidden="true" className="auto-dl__circle">
          {/* Off: pause */}
          <svg className="auto-dl__pause" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="3" width="5" height="18" rx="1.5" />
            <rect x="14" y="3" width="5" height="18" rx="1.5" />
          </svg>
          {/* On: play */}
          <svg className="auto-dl__play" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 4.6v14.8a1.2 1.2 0 0 0 1.84 1.02l11.6-7.4a1.2 1.2 0 0 0 0-2.04l-11.6-7.4A1.2 1.2 0 0 0 7 4.6z" />
          </svg>
        </span>
      </LiquidGlass>
    </motion.button>

      {/* What it does */}
      <span
        data-tooltip={info}
        data-tooltip-variant="text"
        data-tooltip-place="top"
        className="glass-fade-in flex p-1 cursor-help text-white/60 hover:text-white transition-colors"
        style={{ "--fade-delay": `${delay}s`, "--fade-duration": "0.35s" }}
      >
        <HelpCircle size={15} />
      </span>
    </motion.div>
  );
}
