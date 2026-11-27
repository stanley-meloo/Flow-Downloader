import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { pressable } from "../../utils/a11y"; // keyboard access for clickable non-buttons
import { motion, AnimatePresence } from "framer-motion";
import { MusicIcon as Music, ClapIcon as Clap, EarOffIcon as EarOff, MonitorCogIcon as MonitorCog, FolderInputIcon as FolderInput, ImageIcon as ImageIcon, TriangleAlertIcon as AlertTriangle, PencilIcon as Pencil, XIcon as X, ScissorsIcon as Scissors } from "../ui/AnimatedIcons"; // animated
import { FolderOpenIcon as FolderOpen, RotateCcwIcon as RotateCcw, ExternalLinkIcon as ExternalLink, CheckIcon as Check } from "../ui/AnimatedIcons"; // animated (lucide-animated)
import { openMediaLocation, saveBestThumbnail } from "../../utils/fileSystem";
import { pickFolder } from "../../utils/folderPicker";
import { Swap, Collapse, Pop, TAP } from "../ui/Motion";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import { DIALOG_GLASS } from "../ui/liquidGlass/presets";
import { DEFAULT_KEYBINDS, matchesBind, bindLabel } from "../../utils/keybinds";
import { isYouTubeExtractor, sanitizeTitle } from "../../utils/media";
import { useBackLayer } from "../../utils/mouseNavigation";
import ScrollThumb from "../ui/ScrollThumb";
import { altHeld } from "../../utils/altKey";
import DownloadButton from "../ui/DownloadButton";
import SmoothScroll from "../ui/SmoothScroll";
import { rangeLabel } from "../../utils/trim";
import { TrimPreview, TrimTimeline, SideBlur, trimWindows, createSignal, createPlayer, MIN_LEN } from "./TrimPanel";
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
  previewClip, // trim "Play": fetches the selected part as a light local clip
  getWaveform, // trim timeline: the video's sound as a waveform
  onEdits,     // reports the card's edits (kept for a moment if it's closed)
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
  // Reopened right after being closed: back as it was (useDownloader.closeCard).
  const restored = mediaData?.restoredEdits || null;
  const [customTitle, setCustomTitle] = useState(restored?.title ?? originalTitle);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(restored?.title ?? originalTitle);

  // The dialog widens for long titles (within design limits) instead of only
  // growing taller: the title is measured and the card gets the width that
  // fits it in 2 lines — between max-w-3xl (768) and 1024 px, never wider
  // than the window allows.
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => { setViewportW(window.innerWidth); setViewportH(window.innerHeight); };
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
      if (!el.offsetHeight) return; // hidden (trim mode): keep the last size
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

  // Video shape (width ÷ height): from the storyboard frames (always the
  // video's real shape); else the site's info; else a Shorts link → 9:16.
  const videoAspect = (mediaData?.storyboard ? mediaData.storyboard.width / mediaData.storyboard.height : null)
    || (mediaData?.aspect > 0 && mediaData.aspect)
    || (/\/shorts\//i.test(mediaData?.originalUrl || '') ? 9 / 16 : null);
  const isVertical = videoAspect > 0 && videoAspect < 0.95;

  const startEditTitle = () => { tooltipHandlers?.leave(); setDraftTitle(customTitle); setEditingTitle(true); };
  const commitTitle = () => { tooltipHandlers?.leave(); setCustomTitle(draftTitle.trim() || originalTitle); setEditingTitle(false); };
  const cancelEditTitle = () => { tooltipHandlers?.leave(); setDraftTitle(customTitle); setEditingTitle(false); };
  const resetTitle = () => { tooltipHandlers?.leave(); setCustomTitle(originalTitle); setDraftTitle(originalTitle); };

  // --- TRIM ---
  // The scissors button (or the shortcut, "T" by default) turns the card into
  // trim mode: the thumbnail grows into a big preview with the timeline under
  // it, and the download options stay below (pushed down), so the folder /
  // quality / format are always in sight. The chosen cut stays when leaving
  // trim mode, and applies to the download either way.
  const duration = Number(mediaData?.duration) || 0;
  const canTrim = duration >= 2;
  const [trimOpen, setTrimOpen] = useState(!!restored?.trimOpen);
  // start / end: the cut being edited; others: more cuts (right-click on the
  // timeline → "Add a cut here").
  const [trim, setTrim] = useState(() => restored?.trim || ({ start: 0, end: duration, others: [] }));
  // The edits, for a quick reopen if the card gets closed by accident.
  useEffect(() => { onEdits?.({ trim, title: customTitle, trimOpen }); }, [trim, customTitle, trimOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const cutCount = 1 + (trim.others?.length || 0);
  const trimActive = canTrim && (cutCount > 1 || trim.start > 0.05 || trim.end < duration - 0.05);
  const resetTrim = () => setTrim((p) => ({ ...p, start: 0, end: duration, others: [] }));
  const [scrub, setScrub] = useState(null);   // time hovered / dragged on the timeline
  const [seek, setSeek] = useState(null);     // { t } → the preview jumps there
  const seekTo = (time) => setSeek({ t: time, n: performance.now() });
  const playhead = useMemo(() => createSignal(), []);
  const player = useMemo(() => createPlayer(), []);
  // The timeline fills in addCutAtPointer() (adds a cut where the mouse is).
  const cutApi = useMemo(() => ({ addCutAtPointer: null }), []);
  const scrollRef = useRef(null);
  // Alt held: the wheel never scrolls the card (Alt + wheel zooms the trim
  // timeline — its strip / ruler handle it themselves, marked data-alt-wheel).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!altHeld(e)) return; // (the real key state: a released Alt doesn't count)
      if (e.target instanceof Element && e.target.closest("[data-alt-wheel]")) return; // the timeline's zoom
      e.preventDefault();
      e.stopImmediatePropagation(); // (also keeps the smooth scroller's own listener out)
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  // Bottom blur (like Settings): shown while there's more of the card below.
  const [atScrollEnd, setAtScrollEnd] = useState(true);
  const [atScrollTop, setAtScrollTop] = useState(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      setAtScrollEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
      setAtScrollTop(el.scrollTop <= 4);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, []);
  const infoInnerRef = useRef(null);
  const [infoLockW, setInfoLockW] = useState(null); // info column width, frozen while it slides away
  const setTrimMode = (open) => {
    tooltipHandlers?.leave();
    if (editingTitle) { setCustomTitle(draftTitle.trim() || originalTitle); setEditingTitle(false); }
    if (open && infoInnerRef.current?.offsetWidth) setInfoLockW(infoInnerRef.current.offsetWidth);
    setScrub(null);
    setTrimOpen(open);
  };
  const setTrimModeRef = useRef(setTrimMode);
  setTrimModeRef.current = setTrimMode;
  const toggleTrim = () => setTrimMode(!trimOpen);
  const toggleTrimRef = useRef(toggleTrim);
  toggleTrimRef.current = canTrim ? toggleTrim : null;
  // Mouse Back closes the trim view (Forward opens it again).
  useBackLayer(trimOpen, () => { setTrimModeRef.current(false); return () => setTrimModeRef.current(true); });

  // What the download gets: one part per cut.
  const trimSections = () => {
    if (!trimActive) return null;
    // Every cut (in time order) → its own file.
    return trimWindows(trim).map(([a, b]) => ({ start: a, end: Math.max(b, a + MIN_LEN) }));
  };

  // --- UNDO / REDO (Ctrl+Z / Ctrl+Shift+Z, configurable) ---
  // Snapshots of what the user edits in this card — the cuts and
  // the title. A change becomes one step once it settles (350 ms without new
  // changes), so a whole drag is a single undo. Up to 100 steps.
  const hist = useRef({ past: [], future: [], committed: null, timer: 0, applying: false });
  const latestSnap = useRef(null);
  const sameSnap = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const commitPending = () => {
    const h = hist.current;
    clearTimeout(h.timer);
    const snap = latestSnap.current;
    if (h.committed && snap && !sameSnap(h.committed, snap)) {
      h.past.push(h.committed);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      h.committed = snap;
    }
  };
  useEffect(() => {
    const h = hist.current;
    const snap = { trim, title: customTitle };
    latestSnap.current = snap;
    if (!h.committed || h.applying) { h.committed = snap; h.applying = false; return; }
    clearTimeout(h.timer);
    h.timer = setTimeout(commitPending, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trim, customTitle]);
  useEffect(() => () => clearTimeout(hist.current.timer), []);
  const restore = (snap) => {
    hist.current.applying = true;
    setTrim(snap.trim);
    setCustomTitle(snap.title);
    setDraftTitle(snap.title);
    setEditingTitle(false);
    tooltipHandlers?.leave();
  };
  const undo = () => {
    commitPending();
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(h.committed);
    h.committed = prev;
    restore(prev);
  };
  const redo = () => {
    commitPending();
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(h.committed);
    h.committed = next;
    restore(next);
  };
  const undoRef = useRef({ undo, redo });
  undoRef.current = { undo, redo };

  // Set once the download was submitted, so double-clicks / a held Enter key
  // can't add the same video to the queue twice.
  const submittedRef = useRef(false);
  const confirmRef = useRef(null);
  const trimOpenRef = useRef(false);
  trimOpenRef.current = trimOpen;

  // Modal shortcuts (configurable in Settings → Shortcuts): download (Enter by
  // default) and close (Escape by default). Ignored while typing in an input,
  // e.g. while editing the title (that input handles its own Enter/Escape).
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (matchesBind(e, kb.closeModal)) {
        e.preventDefault();
        // In the trim view, Escape goes back to the download options first.
        if (trimOpenRef.current) setTrimModeRef.current(false); else close();
        return;
      }
      if (matchesBind(e, kb.undo)) { e.preventDefault(); undoRef.current.undo(); return; }
      if (matchesBind(e, kb.redo) || matchesBind(e, 'Ctrl+Y')) { e.preventDefault(); undoRef.current.redo(); return; }
      // Trim view: play / pause the preview (Space by default) — instead of
      // scrolling the card or pressing the focused button.
      if (trimOpenRef.current && matchesBind(e, kb.playPause)) {
        e.preventDefault();
        if (!e.repeat) player.toggle?.();
        return;
      }
      if (trimOpenRef.current && matchesBind(e, kb.addCut)) {
        e.preventDefault();
        if (!e.repeat) cutApi.addCutAtPointer?.();
        return;
      }
      if (matchesBind(e, kb.trim)) {
        e.preventDefault();
        if (!e.repeat) toggleTrimRef.current?.();
        return;
      }
      if (matchesBind(e, kb.download)) {
        e.preventDefault(); // also stops a focused button from being "clicked" by Enter
        if (!e.repeat) confirmRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, kb.closeModal, kb.download, kb.trim, kb.undo, kb.redo, kb.addCut, kb.playPause]);

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
    const sections = trimSections();
    Promise.resolve(onConfirm(
      {
        res: quality, ext: formatExt.replace('.', ''), audio: audioKbps.replace('kb', ''),
        ...(sections ? { sections, preciseCut: false } : {}), // always the fast cut (whole-second times)
      },
      selectedFormat,
      { ...mediaData, title: finalTitle }
    )).then((ok) => { if (ok === false) submittedRef.current = false; });
  };
  confirmRef.current = handleConfirm;

  // Exact filename the download will get (same sanitizing as the downloader).
  const previewExt = formatExt.replace('.', '');
  const previewTitle = editingTitle ? (draftTitle.trim() || originalTitle) : customTitle;
  // Trimmed: the name of the (first) part, like the downloader names it.
  const firstCut = trimWindows(trim)[0];
  const previewStem = !trimActive ? previewTitle
    : `${previewTitle} [${rangeLabel(firstCut[0], firstCut[1])}]`;
  const extraParts = trimActive ? cutCount - 1 : 0;
  const fileNamePreview = `${sanitizeTitle(previewStem)}.${previewExt}${extraParts > 0 ? `  +${extraParts}` : ''}`;
  const downloadLabel = !trimActive
    ? t('media_modal.start_download', { defaultValue: 'Download' })
    : cutCount > 1
      ? t('trim.download_parts', { count: cutCount, defaultValue: 'Download parts ({{count}})' })
      : t('trim.download_part', { defaultValue: 'Download part' });
  // Title — editable: the (custom) title becomes the downloaded filename.
  // `compact`: one line, over the trim preview.
  const titleBlock = (compact) => (
            <Swap id={editingTitle ? 'editing' : 'view'} as="div" className="block">
            {editingTitle ? (
              <div className={`flex items-center gap-1.5 mb-1 ${compact ? "" : "pr-8"}`}>
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
              <div className={`flex items-start gap-1 mb-0.5 ${compact ? "" : "pr-8"}`}>
                <Swap id={customTitle} as="h3" className={compact ? "text-white text-[17px] font-bold leading-snug line-clamp-1 drop-shadow" : "text-white text-xl font-bold leading-snug line-clamp-2"}>
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
  );

  // --- Sizes (trim mode) ---
  // The card grows a little (+64), the thumbnail becomes a preview as wide as
  // the card's content, in 16:9; the card scrolls inside if it gets taller
  // than the window. Everything animates together (300 ms ease-out,
  // the same curve as the card's width transition).
  const isWide = viewportW >= 768;
  const fitWindow = Math.max(320, viewportW - 48);
  const trimCardW = Math.min(fitWindow, cardWidth + 64);
  const shownCardW = trimOpen ? trimCardW : cardWidth;
  const trimContentW = trimCardW - 48;
  const previewH = Math.round((trimContentW * 9) / 16); // always 16:9 (vertical videos get side bars)
  const thumbBox = trimOpen
    ? { width: trimContentW, height: previewH }
    : isWide
      ? { width: thumbW, height: Math.round((thumbW * 9) / 16) }
      : { width: cardWidth - 48, height: Math.round(((cardWidth - 48) * 9) / 16) };
  const sizeTransition = animateSize ? SIZE_T : { duration: 0 };
  const windows = trimWindows(trim);

  const trimTooltip = (trimOpen ? t('trim.back', { defaultValue: 'Back to download' }) : t('trim.open', { defaultValue: 'Cut video' }))
    + (bindLabel(kb.trim) ? ` (${bindLabel(kb.trim)})` : '');


  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center p-6 overflow-y-auto no-scrollbar">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={close}
        // No dark tint here: the dimming is done inside the app background
        // (App.jsx), so this dialog's liquid glass sees it too.
        className="absolute inset-0 backdrop-blur-sm"
      />

      <motion.div
        variants={CARD_IN} initial="hidden" animate="shown" exit="exit"
        style={{ maxWidth: shownCardW }}
        className={`relative isolate w-full my-auto rounded-[36px] shadow-2xl backdrop-blur-md overflow-visible ${animateSize ? "transition-[max-width] duration-300 ease-out" : ""}`} /* no CSS bg/border: the glass draws them */
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
        {/* Content scrolls inside the card when it's taller than the window
            (e.g. trim mode on a small window): native bar hidden, the app's
            thumb drawn over it, clear of the rounded corners. */}
        {/* clip-path (not just the rounded overflow): GPU-composited children (glass, video, blurs, animated parts) otherwise leak a few pixels past the rounded corners */}
        <SmoothScroll ref={scrollRef} className="no-scrollbar overflow-y-auto overscroll-contain rounded-[36px]" style={{ maxHeight: Math.max(320, viewportH - 48), clipPath: CONTENT_CLIP }}>
        <div className="relative p-6 border-b border-white/5 bg-transparent">
          <div className="flex flex-col md:flex-row">

          {/* Thumbnail → big preview in trim mode */}
          <motion.div
            initial={false}
            animate={thumbBox}
            transition={sizeTransition}
            // Corner radius concentric with the card's: 36 (card) − 24 (padding)
            // = 12 px. clip-path also clips the video and the side blur
            // (backdrop-filter), which a plain rounded overflow can leak.
            style={{ borderRadius: INNER_RADIUS, clipPath: trimOpen || isVertical ? `inset(0 round ${INNER_RADIUS}px)` : undefined /* not otherwise: it would hide the green ring of a saved thumbnail */ }}
            className={`md:self-center overflow-hidden isolate [transform:translateZ(0)] shrink-0 relative group bg-black
            ${trimOpen ? 'cursor-default' : thumbStatus === 'success' ? 'ring-1 ring-emerald-500 cursor-default' : 'cursor-pointer'}
          `}
            onClick={!trimOpen && thumbStatus === 'idle' ? downloadThumbnail : undefined}
            data-ctx="media-thumb" /* right-click menu */
          >
            {isVertical ? (
              // Vertical video: only the thumbnail's sides blurred.
              <div className={`relative w-full h-full transition-all duration-500 ${trimOpen ? "" : "group-hover:blur-[2px] group-hover:scale-105"}`}>
                <img src={mediaData.thumbnail} referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover" />
                <SideBlur aspect={videoAspect} />
              </div>
            ) : (
            <img
              src={mediaData.thumbnail}
              className={`w-full h-full object-cover transition-all duration-500 ${trimOpen ? "" : "group-hover:blur-[2px] group-hover:scale-105"}`}
              referrerPolicy="no-referrer"
            />
            )}

            {!trimOpen && (
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
            )}

            {/* Trim mode: the preview (video / storyboard) over the thumbnail */}
            <AnimatePresence>
              {trimOpen && (
                <motion.div key="preview" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.3, delay: 0.1 } }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
                  <TrimPreview
                    thumbnail={mediaData.thumbnail}
                    aspect={videoAspect}
                    storyboard={mediaData.storyboard}
                    url={mediaData.originalUrl}
                    getClip={previewClip}
                    windows={windows}
                    scrub={scrub}
                    seek={seek}
                    playhead={playhead}
                    player={player}
                    onBack={toggleTrim}
                    backLabel={trimTooltip}
                    overlay={(
                      <div className="min-w-0">
                        {titleBlock(true)}
                        <div className="text-[12px] text-zinc-200 mt-0.5 truncate drop-shadow">
                          {mediaData.uploader ? `${mediaData.uploader} · ` : ''}
                          <span className={`font-mono ${titleChanged || trimActive ? 'text-(--accent)' : ''}`}>{fileNamePreview}</span>
                        </div>
                      </div>
                    )}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <Pop show={thumbStatus === 'success' && !trimOpen} as="div" className="absolute top-2 right-2 bg-emerald-500 text-white p-1 rounded shadow-lg pointer-events-none">
              <Check size={10} strokeWidth={4} />
            </Pop>
          </motion.div>

          {/* Video Info — slides away (and the thumbnail takes its room) in trim
              mode; its width is frozen meanwhile so the text doesn't re-wrap. */}
          <motion.div
            className="flex-1 min-w-0 overflow-hidden md:self-center"
            initial={false}
            animate={trimOpen
              ? { opacity: 0, marginLeft: 0, marginTop: 0, transitionEnd: { display: "none" } }
              : { opacity: 1, marginLeft: isWide ? 20 : 0, marginTop: isWide ? 0 : 20, display: "block" }}
            transition={sizeTransition}
            onAnimationComplete={() => { if (!trimOpen) setInfoLockW(null); }}
          >
          <div ref={(el) => { infoRef.current = el; infoInnerRef.current = el; }} className="flex flex-col justify-center pt-1" style={infoLockW ? { width: infoLockW } : undefined}>
            <span className="text-[13px] font-black text-zinc-300 uppercase tracking-widest mb-1">
              {mediaData.extractor_key || "Web"}
            </span>
            {titleBlock(false)}
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
          </div>
          </motion.div>
          </div>

          {/* Trim mode: the timeline under the preview. Clips only while it
              opens / closes (the time label overflows it). */}
          <AnimatePresence initial={false}>
          {trimOpen && (
          <motion.div
            key="timeline"
            style={{ overflow: "hidden" }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
            transition={SIZE_T}
          >
            <div className="pt-4">
              <TrimTimeline
                duration={duration}
                storyboard={mediaData?.storyboard}
                trim={trim}
                setTrim={setTrim}
                playhead={playhead}
                player={player}
                cutApi={cutApi}
                url={mediaData.originalUrl}
                getWaveform={getWaveform}
                formatType={selectedFormat}
                onScrub={setScrub}
                onSeek={seekTo}
                onReset={() => { resetTrim(); seekTo(0); }} /* the timeline draws the handles gliding back */
                active={trimActive}
              />
            </div>
          </motion.div>
          )}
          </AnimatePresence>

          {/* Close — over the preview's corner in trim mode (mirrors its back button) */}
          <button
            onClick={close}
            aria-label={t('tooltips.close', { defaultValue: 'Close' })}
            className={`absolute z-10 flex items-center justify-center rounded-full transition-all duration-300 cursor-pointer ${trimOpen
              ? "glass-chip top-9 right-9 w-10 h-10 text-white"
              : "top-4 right-4 w-[30px] h-[30px] text-zinc-300 hover:text-white hover:bg-white/5"}`}
          >
            <X size={trimOpen ? 18 : 22} />
          </button>
        </div>

        <div className="p-6">
          {/* Download options — always visible (also in trim mode) */}
          <div className="space-y-6 pb-6">
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
          </div>

          {/* Button row: trim (square, 56 × 56) + download (the rest). */}
          <div className="flex gap-3">
            <motion.button
              type="button"
              whileHover={canTrim ? { scale: 1.03 } : undefined}
              whileTap={canTrim ? { scale: 0.96, transition: TAP } : undefined}
              onClick={canTrim ? toggleTrim : undefined}
              aria-disabled={!canTrim}
              aria-pressed={trimOpen}
              aria-label={canTrim ? trimTooltip : t('trim.unavailable', { defaultValue: "Cutting isn't available for this video" })}
              data-tooltip={canTrim ? trimTooltip : t('trim.unavailable', { defaultValue: "Cutting isn't available for this video" })}
              className={`relative w-14 h-14 shrink-0 flex items-center justify-center rounded-xl border transition-colors ${
                !canTrim ? "bg-zinc-900/50 border-white/5 text-zinc-500 opacity-50 cursor-not-allowed"
                : trimOpen ? "bg-white text-black border-white cursor-pointer"
                : trimActive ? "bg-zinc-900/50 border-(--accent)/60 text-(--accent) cursor-pointer"
                : "bg-zinc-900/50 border-white/5 hover:border-white/10 text-zinc-300 hover:text-white cursor-pointer"}`}
            >
              <Scissors size={22} strokeWidth={2.25} />
              {/* A cut is set (seen from the download options) */}
              <Pop show={trimActive && !trimOpen} className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-(--accent)" />
            </motion.button>
            {/* START DOWNLOAD BUTTON (ui/DownloadButton.jsx) */}
            <DownloadButton onClick={handleConfirm} tooltip={bindLabel(kb.download)} /* only the shortcut: the button already says what it does */ className="flex-1 min-w-0 h-14">
              <Swap id={downloadLabel}>{downloadLabel}</Swap>
            </DownloadButton>
          </div>
        </div>
        </SmoothScroll>
        {/* Bottom blur: hints there's more below; fades out at the end. Clipped
            to the card's rounded bottom; never blocks clicks. */}
        <AnimatePresence>
          {!atScrollEnd && (
            <motion.div
              key="scroll-fade"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="pointer-events-none absolute left-0 right-0 bottom-0 h-16 z-10 backdrop-blur-md bg-gradient-to-t from-zinc-950/85 via-zinc-950/50 to-transparent rounded-b-[36px]"
              style={{
                WebkitMaskImage: "linear-gradient(to top, black 35%, transparent)",
                maskImage: "linear-gradient(to top, black 35%, transparent)",
                // A backdrop blur with a mask ignores the rounded corners
                // (it blurred a sliver past them): clip-path keeps it inside.
                clipPath: CONTENT_CLIP_BOTTOM,
              }}
            />
          )}
        </AnimatePresence>
        {/* Top blur: the same, at the top, once the card is scrolled down. */}
        <AnimatePresence>
          {!atScrollTop && (
            <motion.div
              key="scroll-fade-top"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="pointer-events-none absolute left-0 right-0 top-0 h-16 z-10 backdrop-blur-md bg-gradient-to-b from-zinc-950/85 via-zinc-950/50 to-transparent rounded-t-[36px]"
              style={{
                WebkitMaskImage: "linear-gradient(to bottom, black 35%, transparent)",
                maskImage: "linear-gradient(to bottom, black 35%, transparent)",
                clipPath: CONTENT_CLIP_TOP, // (same as the bottom one)
              }}
            />
          )}
        </AnimatePresence>
        <ScrollThumb scrollRef={scrollRef} className="z-20" insetTop={32} insetBottom={32} right={6} />
      </motion.div>
    </div>
  );
}

// Size changes of the card's parts in trim mode: 300 ms ease-out, the same
// curve as the card's CSS max-width transition, so they stay in step.
// Content clip: the card's exact edges, but rounder corners (38 vs the
// card's 36). The glass draws its visible edge (soft, anti-aliased rim) just
// inside the box, so content clipped with the same 36 px curve peeked out as
// a thin sliver along the corners; a slightly larger radius keeps the curve
// inside the glass, while the straight edges stay flush (no gap there).
const CONTENT_R = 38;
const CONTENT_CLIP = `inset(0 round ${CONTENT_R}px)`;
const CONTENT_CLIP_BOTTOM = `inset(0 round 0 0 ${CONTENT_R}px ${CONTENT_R}px)`;
const CONTENT_CLIP_TOP = `inset(0 round ${CONTENT_R}px ${CONTENT_R}px 0 0)`;

// Card corner radius and padding → radius of the boxes inside it (concentric).
const CARD_RADIUS = 36;
const CARD_PADDING = 24;
const INNER_RADIUS = CARD_RADIUS - CARD_PADDING; // 12

const SIZE_T = { duration: 0.3, ease: [0, 0, 0.58, 1] };

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
