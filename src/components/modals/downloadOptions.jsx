// Shared pieces of the two download dialogs (single video: MediaModal,
// playlist: PlaylistModal): quality / audio / format options, the editor
// warning rule, duration formatting and the dropdown control.

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDownIcon as ChevronDown } from "../ui/AnimatedIcons";
import { Swap } from "../ui/Motion";
import SmoothScroll from "../ui/SmoothScroll";

// Used when yt-dlp didn't report the available heights.
const FALLBACK_QUALITIES = [2160, 1440, 1080, 720, 480, 360, 240, 144];

export const qualitiesOf = (mediaData) =>
  mediaData?.availableQualities?.length > 0 ? mediaData.availableQualities : FALLBACK_QUALITIES;

// The quality pre-selected in a dialog: the Settings default if the video has
// it, otherwise the closest lower one (or the best available).
export function initialQuality(availableQualities, defaultQuality) {
  const best = availableQualities[0].toString();
  if (!defaultQuality || defaultQuality === "best") return best;
  const target = parseInt(String(defaultQuality).replace("p", ""), 10);
  if (availableQualities.includes(target)) return target.toString();
  const closest = availableQualities.find((q) => q <= target);
  return closest ? closest.toString() : best;
}

export const qualityOptionsOf = (availableQualities) =>
  availableQualities.map((q) => ({ value: q.toString(), label: `${q}p` }));

// YouTube's real audio ceiling is ~160 kbps (Opus) / 128 kbps (AAC) — there is
// no 320 kbps source, so these are the honest tiers.
export const audioOptionsOf = (t) => [
  { value: "160kb", label: t("media_modal.audio_best", { defaultValue: "Best (~160 kbps)" }) },
  { value: "128kb", label: t("media_modal.audio_medium", { defaultValue: "Medium (128 kbps)" }) },
  { value: "96kb", label: t("media_modal.audio_low", { defaultValue: "Low (96 kbps)" }) },
];

export const formatOptionsOf = (selectedFormat) =>
  selectedFormat === "audio"
    ? [".mp3", ".wav", ".m4a", ".aac"].map((v) => ({ value: v, label: v }))
    : [".mp4", ".mkv", ".webm"].map((v) => ({ value: v, label: v }));

// Editor-compatibility warning. YouTube always serves H.264 (avc1) up to 1080p;
// ONLY above 1080p is the stream VP9/AV1, which many editors (Premiere/DaVinci)
// can't open. So warn strictly above 1080p — never at 1080p or below (the
// detected h264MaxHeight can under-report and cause false warnings).
export const needsEditorWarning = (selectedFormat, quality) => {
  const height = parseInt(quality, 10);
  return selectedFormat !== "audio" && !Number.isNaN(height) && height > 1080;
};

// The card's options, remembered between sessions (settings.lastDownloadPreset):
// quality, audio bitrate and the format of each type (audio / video), so e.g.
// someone who only downloads MP3s never has to pick it again. Starts from the
// saved preset (quality: same height or the closest lower one; falls back to
// Settings → default quality) and saves every change right away via
// `remember(partial)`. The type and the folder are remembered by App.jsx.
const extGroup = (type) => (type === "audio" ? "audio" : "video");
export function useRememberedOptions({ availableQualities, defaultQuality, selectedFormat, preset, remember }) {
  const p = preset || {};
  const extFor = (type) => {
    const saved = p.exts?.[extGroup(type)];
    const valid = formatOptionsOf(type).some((o) => o.value === `.${saved}`);
    return valid ? `.${saved}` : type === "audio" ? ".mp3" : ".mp4";
  };
  const [quality, setQuality] = useState(() => initialQuality(availableQualities, p.res ?? defaultQuality));
  const [audioKbps, setAudioKbps] = useState(() => (["160", "128", "96"].includes(String(p.audio)) ? `${p.audio}kb` : "160kb"));
  const [formatExt, setFormatExt] = useState(() => extFor(selectedFormat));

  // Switching the type: that type's remembered format (not on the first render).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setFormatExt(extFor(selectedFormat));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFormat]);

  return {
    quality,
    audioKbps,
    formatExt,
    setQuality: (v) => { setQuality(v); remember?.({ res: String(v) }); },
    setAudioKbps: (v) => { setAudioKbps(v); remember?.({ audio: String(v).replace("kb", "") }); },
    setFormatExt: (v) => {
      setFormatExt(v);
      const ext = String(v).replace(".", "");
      remember?.({ ext, exts: { ...(p.exts || {}), [extGroup(selectedFormat)]: ext } });
    },
  };
}

// Opening animation of both download cards: the whole card appears at once —
// a blur fade with a slight travel up (Apple-like: no bounce, long soft
// ease-out). Exit: a short, quiet fade.
const CARD_EASE = [0.16, 1, 0.3, 1];
export const CARD_IN = {
  hidden: { opacity: 0, y: 18, scale: 0.985, filter: "blur(12px)" },
  shown: {
    opacity: 1, y: 0, scale: 1, filter: "blur(0px)",
    transition: { duration: 0.6, ease: CARD_EASE, opacity: { duration: 0.4, ease: "easeOut" } },
    transitionEnd: { filter: "none" },
  },
  exit: { opacity: 0, y: 8, scale: 0.99, filter: "blur(6px)", transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
};

// 3:07 / 1:02:45 ("" when unknown).
export function formatDuration(seconds) {
  const s = Number(seconds);
  if (!s || Number.isNaN(s) || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const pad = (n) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(secs)}` : `${m}:${pad(secs)}`;
}

// Labeled dropdown (Quality / Format / Audio). Opens upward.
export function DropdownConfigBox({ label, icon: Icon, valueLabel, options, active, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <label className="text-[13px] font-black text-zinc-300 uppercase tracking-widest px-1 mb-1.5">{label}</label>
      <div className="relative">
        <button
          onClick={() => active && setIsOpen(!isOpen)}
          className={`w-full flex items-center justify-between p-2.5 px-3 rounded-xl border transition-all duration-500 ease-in-out h-[44px] ${active
            ? isOpen
              ? "bg-zinc-800 border-white/20 shadow-inner"
              : "bg-zinc-900/40 border-white/5 hover:bg-zinc-900 hover:border-white/10 cursor-pointer active:scale-95"
            : "opacity-10 grayscale cursor-not-allowed"
          }`}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <Icon size={18} className="text-zinc-300 shrink-0" />
            <Swap id={valueLabel} className="block min-w-0 text-[12.5px] font-bold text-zinc-200 truncate">{valueLabel}</Swap>
          </div>
          {active && <ChevronDown size={16} className={`text-zinc-300 transition-transform duration-300 shrink-0 ${isOpen ? "rotate-180" : ""}`} />}
        </button>

        <AnimatePresence>
          {isOpen && active && (
            <>
              <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-40 overflow-hidden ring-1 ring-black/50 origin-bottom"
              >
                <SmoothScroll className="max-h-48 overflow-y-auto custom-scrollbar" contentClassName="py-1">
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { onSelect(opt.value); setIsOpen(false); }}
                    className={`w-full text-left px-3 py-2.5 text-[13px] font-bold transition-colors hover:bg-zinc-800 ${valueLabel === opt.label ? "text-white bg-zinc-800/50" : "text-zinc-300"}`}
                  >
                    {opt.label}
                  </button>
                ))}
                </SmoothScroll>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
