import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { pressable } from "../../utils/a11y"; // keyboard access for clickable non-buttons
import { motion } from "framer-motion";
import { MusicIcon as Music, ClapIcon as Clap, EarOffIcon as EarOff, MonitorCogIcon as MonitorCog, FolderInputIcon as FolderInput, ImageIcon as ImageIcon, TriangleAlertIcon as AlertTriangle, PencilIcon as Pencil, XIcon as X } from "../ui/AnimatedIcons"; // animated
import { FolderOpenIcon as FolderOpen, DownloadIcon as Download, RotateCcwIcon as RotateCcw, ExternalLinkIcon as ExternalLink, CheckIcon as Check } from "../ui/AnimatedIcons"; // animated (lucide-animated)
import { openMediaLocation, saveBestThumbnail } from "../../utils/fileSystem";
import { pickFolder } from "../../utils/folderPicker";
import { Swap, Collapse, Pop, TAP } from "../ui/Motion";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import { DIALOG_GLASS } from "../ui/liquidGlass/presets";
import { DEFAULT_KEYBINDS, matchesBind, bindLabel } from "../../utils/keybinds";
import { isYouTubeExtractor, sanitizeTitle } from "../../utils/media";
import { qualitiesOf, qualityOptionsOf, audioOptionsOf, formatOptionsOf, needsEditorWarning, formatDuration, DropdownConfigBox, useRememberedOptions, CARD_IN } from "./downloadOptions";

import { useTranslation } from 'react-i18next';

export default function MediaModal({
  mediaData,
  close,
  onConfirm,
  selectedFormat,
  setSelectedFormat,
  downloadPath,
  setDownloadPath,
  showToast,
  tooltipHandlers,
  defaultQuality,
  keybinds,
  preset,   // remembered card options (settings.lastDownloadPreset)
  remember  // saves changes to them
}) {
  const { t } = useTranslation();
  const kb = keybinds || DEFAULT_KEYBINDS;

  // Qualities yt-dlp reported (shared helpers: ./downloadOptions)
  const availableQualities = qualitiesOf(mediaData);

  // --- STATES ---
  // Quality / audio / format: remembered between sessions (./downloadOptions)
  const { quality, setQuality, audioKbps, setAudioKbps, formatExt, setFormatExt } =
    useRememberedOptions({ availableQualities, defaultQuality, selectedFormat, preset, remember });

  const [thumbStatus, setThumbStatus] = useState("idle");
  const [savedThumbPath, setSavedThumbPath] = useState("");

  // --- CUSTOM TITLE ---
  // The user can rename the download. The (custom) title becomes the filename,
  // still sanitized by the downloader (spaces -> "_", illegal chars removed).
  const originalTitle = mediaData?.title || '';
  const [customTitle, setCustomTitle] = useState(originalTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(originalTitle);

  // The dialog widens for long titles (within design limits) instead of only
  // growing taller: the title is measured and the card gets the width that
  // fits it in 2 lines — between max-w-3xl (768) and 1024 px, never wider
  // than the window allows.
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Thumbnail follows the info column's height (keeping 16:9), so a tall
  // 2-line title doesn't leave an empty gap under it: width = height · 16/9,
  // between 192 (md:w-48) and THUMB_MAX_W. Only in the side-by-side layout.
  const infoRef = useRef(null);
  const [thumbW, setThumbW] = useState(THUMB_MIN_W);
  // Measured before the first paint (layout effect), so the card opens with
  // its final sizes — no thumbnail "growing" while it appears. Size changes
  // only animate afterwards (e.g. after editing the title).
  const [animateSize, setAnimateSize] = useState(false);
  useEffect(() => {
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setAnimateSize(true)); });
    return () => cancelAnimationFrame(raf);
  }, []);
  useLayoutEffect(() => {
    const el = infoRef.current;
    if (!el) return;
    const measure = () => {
      if (window.innerWidth < 768) { setThumbW(THUMB_MIN_W); return; } // stacked layout (below md)
      const w = Math.round(Math.min(THUMB_MAX_W, Math.max(THUMB_MIN_W, (el.offsetHeight * 16) / 9)));
      setThumbW((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The card also gives back the room the bigger thumbnail takes.
  const cardWidth = useMemo(
    () => dialogWidthForTitle(customTitle, viewportW, thumbW - THUMB_MIN_W),
    [customTitle, viewportW, thumbW]
  );
  const titleChanged = customTitle !== originalTitle;

  const startEditTitle = () => { tooltipHandlers?.leave(); setDraftTitle(customTitle); setEditingTitle(true); };
  const commitTitle = () => { tooltipHandlers?.leave(); setCustomTitle(draftTitle.trim() || originalTitle); setEditingTitle(false); };
  const cancelEditTitle = () => { tooltipHandlers?.leave(); setDraftTitle(customTitle); setEditingTitle(false); };
  const resetTitle = () => { tooltipHandlers?.leave(); setCustomTitle(originalTitle); setDraftTitle(originalTitle); };

  // Set once the download was submitted, so double-clicks / a held Enter key
  // can't add the same video to the queue twice.
  const submittedRef = useRef(false);
  const confirmRef = useRef(null);

  // Modal shortcuts (configurable in Settings → Shortcuts): download (Enter by
  // default) and close (Escape by default). Ignored while typing in an input,
  // e.g. while editing the title (that input handles its own Enter/Escape).
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (matchesBind(e, kb.closeModal)) { e.preventDefault(); close(); return; }
      if (matchesBind(e, kb.download)) {
        e.preventDefault(); // also stops a focused button from being "clicked" by Enter
        if (!e.repeat) confirmRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, kb.closeModal, kb.download]);

  useEffect(() => {
    return () => tooltipHandlers?.leave();
  }, []);


  // --- DROPDOWN OPTIONS ---
  const qualityOptions = qualityOptionsOf(availableQualities);
  const audioOptions = audioOptionsOf(t);
  const currentAudioLabel = audioOptions.find(o => o.value === audioKbps)?.label || audioOptions[0].label;
  const warnCodec = mediaData?.highResCodec || 'AV1';
  const showEditorWarning = needsEditorWarning(selectedFormat, quality);
  const formatOptions = formatOptionsOf(selectedFormat);

  async function downloadThumbnail() {
    setThumbStatus("downloading");
    try {
      // Highest resolution available (YouTube: maxres -> sd -> hq), then the
      // URL yt-dlp reported. Saved (with the signature) by the Rust side.
      const savedPath = await saveBestThumbnail({
        videoId: mediaData.id,
        isYouTube: isYouTubeExtractor(mediaData.extractor_key),
        fallbackUrl: mediaData.thumbnail,
        title: customTitle,
      });
      setSavedThumbPath(savedPath);
      setThumbStatus("success");
      showToast("success_thumb", "success");
    } catch (err) {
      console.error("Failed to download thumbnail:", err);
      setThumbStatus("idle");
      showToast("error_thumb", "error");
    }
  }

  const handleConfirm = () => {
    if (submittedRef.current) return; // already submitted — ignore repeats
    submittedRef.current = true;
    // If the title editor is still open, use what's typed there.
    const finalTitle = editingTitle ? (draftTitle.trim() || originalTitle) : customTitle;
    // Refused (e.g. not enough disk space) → the card stays open and usable.
    Promise.resolve(onConfirm(
      { res: quality, ext: formatExt.replace('.', ''), audio: audioKbps.replace('kb', '') },
      selectedFormat,
      { ...mediaData, title: finalTitle }
    )).then((ok) => { if (ok === false) submittedRef.current = false; });
  };
  confirmRef.current = handleConfirm;

  // Exact filename the download will get (same sanitizing as the downloader).
  const previewExt = formatExt.replace('.', '');
  const fileNamePreview = `${sanitizeTitle(editingTitle ? (draftTitle.trim() || originalTitle) : customTitle)}.${previewExt}`;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={close}
        // No dark tint here: the dimming is done inside the app background
        // (App.jsx), so this dialog's liquid glass sees it too.
        className="absolute inset-0 backdrop-blur-sm"
      />

      <motion.div
        variants={CARD_IN} initial="hidden" animate="shown" exit="exit"
        style={{ maxWidth: cardWidth }}
        className={`relative isolate w-full rounded-[36px] shadow-2xl overflow-visible backdrop-blur-md ${animateSize ? "transition-[max-width] duration-300 ease-out" : ""}`} /* no CSS bg/border: the glass draws them */
      >
        {/* Liquid glass background — same material as the Settings dialog.
            Behind all the content (negative z inside the isolated dialog). */}
        <LiquidGlass
          variant="dark"
          settings={DIALOG_GLASS}
          radius={36}
          className="absolute inset-0 -z-10 pointer-events-none rounded-[36px]"
          fallbackClassName="bg-zinc-950/80 backdrop-blur-2xl border border-white/10"
        />
        <div className="p-6 flex flex-col md:flex-row gap-5 border-b border-white/5 bg-transparent">

          {/* Thumbnail */}
          <motion.div
            style={viewportW >= 768 ? { width: thumbW } : undefined}
            className={`w-full aspect-video md:self-center rounded-xl overflow-hidden isolate [transform:translateZ(0)] shrink-0 relative group ${animateSize ? "transition-[width] duration-300 ease-out" : ""} 
            ${thumbStatus === 'success' ? 'ring-1 ring-emerald-500 cursor-default' : 'cursor-pointer'} 
          `}
            onClick={thumbStatus === 'idle' ? downloadThumbnail : undefined}
            data-ctx="media-thumb" /* right-click menu */
          >
            <img
              src={mediaData.thumbnail}
              className="w-full h-full object-cover transition-all duration-500 group-hover:blur-[2px] group-hover:scale-105"
              referrerPolicy="no-referrer"
            />

            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-300">
              {/* idle → downloading → success crossfade into each other */}
              <Swap id={thumbStatus} as="div" className="flex flex-col items-center justify-center">
              {thumbStatus === 'idle' && (
                <>
                  <ImageIcon size={22} className="text-white mb-1" />
                  <span className="text-[12px] font-bold text-white uppercase tracking-tighter">
                    {t('media_modal.download_png', { defaultValue: 'Download Image' })}
                  </span>
                </>
              )}

              {thumbStatus === 'downloading' && (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              )}

              {thumbStatus === 'success' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tooltipHandlers) tooltipHandlers.leave();
                    const dir = savedThumbPath.substring(0, savedThumbPath.lastIndexOf('/'));
                    const fullName = savedThumbPath.substring(savedThumbPath.lastIndexOf('/') + 1);
                    // Pass the exact filename so the file itself gets highlighted
                    // in the folder (revealItemInDir), like the download queue does.
                    openMediaLocation(dir, fullName, '', '', showToast);
                  }}
                  onMouseEnter={(e) => tooltipHandlers?.enter(e, t('media_modal.open_folder', { defaultValue: 'Open file location' }), "left", "top")}
                  onMouseMove={tooltipHandlers?.move}
                  onMouseLeave={tooltipHandlers?.leave}
                  className="bg-emerald-500 text-white p-2 rounded-full hover:scale-110 transition-transform shadow-lg cursor-pointer pointer-events-auto z-20 relative"
                >
                  <ExternalLink size={18} />
                </button>
              )}
              </Swap>
            </div>

            <Pop show={thumbStatus === 'success'} as="div" className="absolute top-2 right-2 bg-emerald-500 text-white p-1 rounded shadow-lg pointer-events-none">
              <Check size={10} strokeWidth={4} />
            </Pop>
          </motion.div>

          {/* Video Info */}
          <motion.div ref={infoRef} className="flex-1 min-w-0 flex flex-col justify-center pt-1">
            <span className="text-[13px] font-black text-zinc-300 uppercase tracking-widest mb-1">
              {mediaData.extractor_key || "Web"}
            </span>
            {/* Title — editable: the (custom) title becomes the downloaded filename.
                The title and its editor crossfade into each other. */}
            <Swap id={editingTitle ? 'editing' : 'view'} as="div" className="block">
            {editingTitle ? (
              <div className="flex items-center gap-1.5 mb-1 pr-8">
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelEditTitle(); }
                  }}
                  placeholder={t('media_modal.title_placeholder', { defaultValue: 'Custom title…' })}
                  className="flex-1 min-w-0 bg-zinc-900/70 border border-(--accent-strong)/50 focus:border-(--accent) rounded-md px-2.5 py-1.5 text-white text-[16px] font-bold outline-none"
                />
                <TitleButton onClick={commitTitle} label={t('media_modal.save_title', { defaultValue: 'Save title' })} tooltipHandlers={tooltipHandlers} className="text-emerald-400 hover:bg-emerald-500/10">
                  <Check size={16} strokeWidth={3} />
                </TitleButton>
                <TitleButton onClick={cancelEditTitle} label={t('media_modal.cancel_edit', { defaultValue: 'Cancel' })} tooltipHandlers={tooltipHandlers} className="text-zinc-300 hover:text-white hover:bg-white/5">
                  <X size={16} />
                </TitleButton>
              </div>
            ) : (
              <div className="flex items-start gap-1 mb-0.5 pr-8">
                <Swap id={customTitle} as="h3" className="text-white text-xl font-bold leading-snug line-clamp-2">
                  {customTitle}
                </Swap>
                <TitleButton onClick={startEditTitle} label={t('media_modal.edit_title', { defaultValue: 'Edit title' })} tooltipHandlers={tooltipHandlers} className="text-zinc-300 hover:text-white hover:bg-white/5 mt-0.5">
                  <Pencil size={18} />
                </TitleButton>
                <Pop show={titleChanged} className="flex">
                  <TitleButton onClick={resetTitle} label={t('media_modal.reset_title', { defaultValue: 'Restore original title' })} tooltipHandlers={tooltipHandlers} className="text-zinc-300 hover:text-amber-300 hover:bg-white/5 mt-0.5">
                    <RotateCcw size={17} />
                  </TitleButton>
                </Pop>
              </div>
            )}
            </Swap>
            <p className="text-zinc-300 text-[15px] font-semibold hover:text-zinc-200 transition-colors cursor-default">
              {mediaData.uploader || t('playlist_modal.unknown_uploader', { defaultValue: 'Unknown channel' })}
            </p>
            <div className="flex items-center gap-1 text-zinc-300 text-[13px] font-semibold mt-1">
              <span>{formatDuration(mediaData.duration)}</span>
            </div>
            {/* Filename preview (shows the "_" for spaces rule) */}
            <div className="text-[12px] text-zinc-300 mt-1 truncate pr-8">
              {t('media_modal.file_name', { defaultValue: 'File name' })}:{' '}
              <span className={`font-mono transition-colors duration-300 ${titleChanged ? 'text-(--accent)' : 'text-zinc-300'}`}>{fileNamePreview}</span>
            </div>
          </motion.div>

          <button onClick={close} aria-label={t('tooltips.close', { defaultValue: 'Close' })} className="absolute top-4 right-4 p-1 text-zinc-300 hover:text-white hover:bg-white/5 rounded-full transition-all cursor-pointer">
            <X size={22} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-5">

            {/* Type Selector */}
            <motion.div className="md:col-span-3 space-y-2.5">
              <label className="text-[13px] font-black text-zinc-300 uppercase tracking-widest px-1">
                {t('media_modal.output_format', { defaultValue: 'Choose what you want to download' })}
              </label>
              <div className="flex bg-zinc-900/50 p-1 h-[44px] rounded-xl border border-white/5 relative">
                {[
                  { id: 'video', icon: Clap, labelKey: 'media_modal.format_video_audio', defaultLabel: 'Video + Audio' },
                  { id: 'video_only', icon: EarOff, labelKey: 'media_modal.format_video_only', defaultLabel: 'Apenas Video' },
                  { id: 'audio', icon: Music, labelKey: 'media_modal.format_audio_only', defaultLabel: 'Apenas Audio' },
                ].map((type) => {
                  const isActive = selectedFormat === type.id;
                  return (
                    <button
                      key={type.id}
                      onClick={() => setSelectedFormat(type.id)}
                      className={`relative flex-1 flex items-center justify-center h-full px-2 rounded-lg cursor-pointer outline-none transition-colors z-10 ${isActive ? "text-black font-bold" : "text-zinc-300 hover:text-white font-medium"}`}
                    >
                      {isActive && <motion.div layoutId="activeFormatBackground" className="absolute inset-0 bg-white rounded-lg shadow-sm" transition={{ type: "spring", stiffness: 350, damping: 25 }} />}
                      <span className="relative z-20 flex items-center gap-1.5">
                        <type.icon size={19} />
                        <span className="text-[12px] tracking-wide whitespace-nowrap">
                          {t(type.labelKey, { defaultValue: type.defaultLabel })}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>

            {/* Path */}
            <motion.div className="md:col-span-2 space-y-2.5">
              <label className="text-[13px] font-black text-zinc-300 uppercase tracking-widest px-1">
                {t('media_modal.destination', { defaultValue: 'Destination' })}
              </label>
              <div
                {...pressable}
                onClick={() => pickFolder(downloadPath).then(s => s && setDownloadPath(s))}
                className="flex items-center gap-3 p-1.5 pl-3 h-[44px] bg-zinc-900/50 border border-white/5 rounded-xl hover:border-white/10 transition-all cursor-pointer group"
              >
                <FolderOpen size={18} className="text-zinc-300 group-hover:text-white shrink-0 transition-colors" />
                <Swap id={downloadPath} className="flex-1 min-w-0 block text-[13px] text-zinc-300 truncate font-path">{downloadPath || "Downloads"}</Swap>
                <div className="px-2.5 py-1 bg-zinc-800 rounded-md text-[12.5px] font-bold text-zinc-300 group-hover:text-white shrink-0 uppercase transition-colors">
                  {t('media_modal.change', { defaultValue: 'Change' })}
                </div>
              </div>
            </motion.div>
          </div>

          {/* CONFIG BOXES */}
          <motion.div className="grid grid-cols-3 gap-3">
            <DropdownConfigBox
              label={t('media_modal.quality', { defaultValue: 'Quality' })}
              icon={MonitorCog}
              valueLabel={`${quality}p`}
              options={qualityOptions}
              active={selectedFormat !== 'audio'}
              onSelect={(val) => setQuality(val)}
            />
            <DropdownConfigBox
              label={t('media_modal.format', { defaultValue: 'Format' })}
              icon={FolderInput}
              valueLabel={formatExt}
              options={formatOptions}
              active={true}
              onSelect={(val) => setFormatExt(val)}
            />
            <DropdownConfigBox
              label={t('media_modal.audio', { defaultValue: 'Audio' })}
              icon={Music} /* same icon as "Audio Only" */
              valueLabel={currentAudioLabel}
              options={audioOptions}
              active={selectedFormat !== 'video_only'}
              onSelect={(val) => setAudioKbps(val)}
            />
          </motion.div>

          {/* Editor-compatibility warning (shown for >1080p VP9/AV1 downloads).
              Slides open/closed; gap = this container's space-y-6 (24px). */}
          <Collapse show={showEditorWarning} gap={24}>
            <div className="flex items-start gap-2.5 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-amber-200/90 leading-snug">
                {t('media_modal.editor_warning', {
                  codec: warnCodec,
                  defaultValue: `Resolutions above 1080p come in {{codec}}, which video editors (Premiere, DaVinci…) can't open. Choose 1080p or lower to get H.264, or convert this file to H.264 with an online converter.`
                })}
              </p>
            </div>
          </Collapse>

          {/* START DOWNLOAD BUTTON */}
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99, transition: TAP }}
            onClick={handleConfirm}
            data-tooltip={bindLabel(kb.download) || undefined} /* only the shortcut: the button already says what it does */
            className="relative w-full py-4 rounded-xl accent-button text-white font-black text-sm flex items-center justify-center gap-3 cursor-pointer group overflow-hidden transition-all"
          >
            <motion.div
              animate={{ left: ["-100%", "200%"] }}
              transition={{
                duration: 2,
                ease: "easeInOut",
                repeat: Infinity,
                repeatDelay: 2
              }}
              className="absolute top-0 bottom-0 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 z-0"
            />

            <div className="relative z-10 flex items-center gap-2.5">
              <motion.div
                animate={{ y: [0, 3, 0] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                <Download size={22} strokeWidth={2.5} />
              </motion.div>

              <span className="uppercase tracking-widest text-[14px] drop-shadow-md">
                {t('media_modal.start_download', { defaultValue: 'Download' })}
              </span>
            </div>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

// Small icon button used by the title editor (edit / save / cancel / reset),
// with the app's tooltip.
// stopPropagation keeps clicks from bubbling to parents (e.g. a selectable card).
function TitleButton({ onClick, label, tooltipHandlers, className = '', children }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={(e) => tooltipHandlers?.enter?.(e, label, "left", "top")}
      onMouseMove={tooltipHandlers?.move}
      onMouseLeave={tooltipHandlers?.leave}
      aria-label={label}
      className={`p-1 rounded-md transition-colors cursor-pointer shrink-0 ${className}`}
    >
      {children}
    </button>
  );
}

// --- Dialog width for a title ----------------------------------------------
// Card layout (md+): 24 padding · 192 thumbnail · 20 gap · title column · 32
// right space for the ✕ · 24 padding; the title row also holds the edit button
// (~30 px). The title is text-xl bold (20 px Poppins) and may use 2 lines.
const DIALOG_MIN_W = 768;   // max-w-3xl, the original width
const DIALOG_MAX_W = 1024;  // design limit
const DIALOG_CHROME_W = 24 + 192 + 20 + 32 + 24 + 30;
const THUMB_MIN_W = 192;    // md:w-48
const THUMB_MAX_W = 288;    // 162 px tall at 16:9
let measureCtx = null;

function dialogWidthForTitle(title, viewportW, extraThumbW = 0) {
  const fitWindow = Math.max(320, viewportW - 48); // the overlay's p-6 on both sides
  let wanted = DIALOG_MIN_W;
  try {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    measureCtx.font = "700 20px Poppins, ui-sans-serif, system-ui, sans-serif";
    const textW = measureCtx.measureText(title || "").width;
    // half the text per line, +12 % because lines break at word boundaries
    wanted = Math.ceil((textW / 2) * 1.12 + DIALOG_CHROME_W + extraThumbW);
  } catch {
    /* no canvas: keep the default width */
  }
  return Math.min(fitWindow, Math.max(DIALOG_MIN_W, Math.min(DIALOG_MAX_W, wanted)));
}
