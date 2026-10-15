// Shared pieces of the two download dialogs (single video: MediaModal,
// playlist: PlaylistModal): quality / audio / format options, the editor
// warning rule, duration formatting and the dropdown control.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDownIcon as ChevronDown } from "../ui/AnimatedIcons";
import { Swap } from "../ui/Motion";

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
      <label className="text-[12px] font-black text-zinc-600 uppercase tracking-widest px-1 mb-1.5">{label}</label>
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
            <Icon size={14} className="text-zinc-500 shrink-0" />
            <Swap id={valueLabel} className="block min-w-0 text-[11.5px] font-bold text-zinc-200 truncate">{valueLabel}</Swap>
          </div>
          {active && <ChevronDown size={12} className={`text-zinc-500 transition-transform duration-300 shrink-0 ${isOpen ? "rotate-180" : ""}`} />}
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
                className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-40 overflow-hidden py-1 max-h-48 overflow-y-auto custom-scrollbar ring-1 ring-black/50 origin-bottom"
              >
                {options.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { onSelect(opt.value); setIsOpen(false); }}
                    className={`w-full text-left px-3 py-2.5 text-[12px] font-bold transition-colors hover:bg-zinc-800 ${valueLabel === opt.label ? "text-white bg-zinc-800/50" : "text-zinc-400"}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
