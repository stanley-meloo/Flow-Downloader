import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Music, FilePlay, EarOff, Monitor, Camera, FileMusic, Image as ImageIcon, ListChecks, AlertTriangle, Video, X } from "lucide-react"; // Video: fallback for entries without a thumbnail
import { FolderOpenIcon as FolderOpen, DownloadIcon as Download, ExternalLinkIcon as ExternalLink, CheckIcon as Check } from "../ui/AnimatedIcons"; // animated (lucide-animated)
import { openMediaLocation, saveBestThumbnail } from "../../utils/fileSystem";
import { pickFolder } from "../../utils/folderPicker";
import { Swap, Collapse, Pop } from "../ui/Motion";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import { DIALOG_GLASS } from "../ui/liquidGlass/presets";
import { isYouTubeExtractor, youtubeThumb } from "../../utils/media";
import { DEFAULT_KEYBINDS, matchesBind } from "../../utils/keybinds";
import { qualitiesOf, initialQuality, qualityOptionsOf, audioOptionsOf, formatOptionsOf, needsEditorWarning, formatDuration, DropdownConfigBox } from "./downloadOptions";
import ScrollThumb from "../ui/ScrollThumb";
import { useTranslation } from 'react-i18next';

export default function PlaylistModal({
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
  keybinds
}) {
  const { t } = useTranslation();
  const kb = keybinds || DEFAULT_KEYBINDS;

  const firstVideo = mediaData?.entries?.[0];

  // Playlist cover: the first video's best thumbnail. Building it from the video
  // id (i.ytimg.com) only works for YouTube; other sites use yt-dlp's URLs.
  const isYouTube = isYouTubeExtractor(mediaData?.extractor_key);
  const displayThumbnail = firstVideo?.thumbnails?.length > 0
    ? firstVideo.thumbnails[firstVideo.thumbnails.length - 1].url
    : (isYouTube && firstVideo?.id ? youtubeThumb(firstVideo.id, 'maxresdefault') : mediaData.thumbnail);

  const displayUploader = firstVideo?.uploader || firstVideo?.channel || mediaData.uploader || t('playlist_modal.unknown_uploader');

  // Shared helpers: ./downloadOptions
  const availableQualities = qualitiesOf(mediaData);

  const [quality, setQuality] = useState(() => initialQuality(availableQualities, defaultQuality));
  const [audioKbps, setAudioKbps] = useState('160kb'); // YouTube tops out at ~160 kbps (Opus)
  const [formatExt, setFormatExt] = useState(".mp4");

  const [thumbStatus, setThumbStatus] = useState("idle");
  const [savedThumbPath, setSavedThumbPath] = useState("");
  const [selectedVideos, setSelectedVideos] = useState([]);

  // Videos keep their own titles (no per-video renaming in the playlist dialog).
  const titleOf = (entry) => entry.title;

  // Double-submit guard + modal shortcuts (download / close), same as MediaModal.
  const submittedRef = useRef(false);
  const listRef = useRef(null); // video list (custom scroll thumb)
  const confirmRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // typing (e.g. editing a title)
      if (matchesBind(e, kb.closeModal)) { e.preventDefault(); close(); return; }
      if (matchesBind(e, kb.download)) {
        e.preventDefault();
        if (!e.repeat) confirmRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, kb.closeModal, kb.download]);

  useEffect(() => {
    return () => tooltipHandlers?.leave();
  }, []);

  useEffect(() => {
    setFormatExt(selectedFormat === 'audio' ? '.mp3' : '.mp4');
  }, [selectedFormat]);

  const handleToggleVideo = (idx) => {
    setSelectedVideos(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const handleSelectAll = () => {
    if (selectedVideos.length === mediaData.entries.length) {
      setSelectedVideos([]);
    } else {
      setSelectedVideos(mediaData.entries.map((_, idx) => idx));
    }
  };

  const qualityOptions = qualityOptionsOf(availableQualities);
  const audioOptions = audioOptionsOf(t);
  const currentAudioLabel = audioOptions.find(o => o.value === audioKbps)?.label || audioOptions[0].label;
  const warnCodec = mediaData?.highResCodec || 'AV1';
  const showEditorWarning = needsEditorWarning(selectedFormat, quality);
  const formatOptions = formatOptionsOf(selectedFormat);

  async function downloadThumbnail() {
    if (!displayThumbnail) return;
    setThumbStatus("downloading");
    try {
      // The playlist cover is the first video's thumbnail — use its id to grab
      // the highest-resolution version (maxres -> sd -> hq -> fallback).
      const savedPath = await saveBestThumbnail({
        videoId: mediaData.entries?.[0]?.id,
        isYouTube,
        fallbackUrl: displayThumbnail,
        title: String(mediaData.title || '').replace(/^\[Playlist\]\s*/, ''), // file name without the "[Playlist]" label
      });
      setSavedThumbPath(savedPath);
      setThumbStatus("success");
      showToast("success_thumb", "success");
    } catch (err) {
      console.error("Failed to download playlist thumbnail:", err);
      setThumbStatus("idle");
      showToast("error_thumb", "error");
    }
  }

  const handleConfirm = () => {
    if (submittedRef.current) return; // already submitted — ignore repeats
    if (selectedVideos.length === 0) {
      showToast(t('playlist_modal.error_no_selection'), 'error');
      return;
    }
    submittedRef.current = true;
    // Keep only the selected videos.
    const filteredEntries = mediaData.entries.filter((_, idx) => selectedVideos.includes(idx));
    const finalData = { ...mediaData, entries: filteredEntries };
    onConfirm({ res: quality, ext: formatExt.replace('.', ''), audio: audioKbps.replace('kb', '') }, selectedFormat, finalData);
  };
  confirmRef.current = handleConfirm;

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
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        className="relative isolate w-full max-w-4xl rounded-[36px] shadow-2xl overflow-hidden backdrop-blur-md flex flex-col max-h-[95vh]" /* no CSS bg/border: the glass draws them */
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
        <div className="p-6 flex flex-col md:flex-row gap-5 border-b border-white/5 bg-transparent shrink-0">
          {displayThumbnail ? (
            <div
              className={`w-full md:w-48 aspect-video md:self-center rounded-xl overflow-hidden isolate [transform:translateZ(0)] shrink-0 relative group transition-all 
              ${thumbStatus === 'success' ? 'ring-1 ring-emerald-500 cursor-default' : 'cursor-pointer'} 
            `}
              onClick={thumbStatus === 'idle' ? downloadThumbnail : undefined}
              data-ctx="media-thumb" /* right-click menu */
            >
              <img src={displayThumbnail} className="w-full h-full object-cover transition-all duration-500 group-hover:blur-[2px] group-hover:scale-105" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 rounded-[inherit] flex flex-col items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-300">
                {/* idle → downloading → success crossfade into each other */}
                <Swap id={thumbStatus} as="div" className="flex flex-col items-center justify-center">
                {thumbStatus === 'idle' && (
                  <>
                    <ImageIcon size={20} className="text-white mb-1" />
                    <span className="text-[9px] font-bold text-white uppercase tracking-tighter">
                      {t('media_modal.download_png')}
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
                      // in the folder, like the download queue / video modal.
                      openMediaLocation(dir, fullName, '', '', showToast);
                    }}
                    onMouseEnter={(e) => tooltipHandlers?.enter(e, t('media_modal.open_folder'), "left", "top")}
                    onMouseMove={tooltipHandlers?.move}
                    onMouseLeave={tooltipHandlers?.leave}
                    className="bg-emerald-500 text-white p-2 rounded-full hover:scale-110 transition-transform shadow-lg cursor-pointer pointer-events-auto z-20 relative"
                  >
                    <ExternalLink size={16} />
                  </button>
                )}
                </Swap>
              </div>
              <Pop show={thumbStatus === 'success'} as="div" className="absolute top-2 right-2 bg-emerald-500 text-white p-1 rounded shadow-lg pointer-events-none">
                <Check size={10} strokeWidth={4} />
              </Pop>
            </div>
          ) : (
            <div className="w-full md:w-48 aspect-video md:self-center rounded-xl overflow-hidden shrink-0 bg-zinc-900 border border-white/5 flex flex-col items-center justify-center text-zinc-700">
              <ListChecks size={32} />
              <span className="text-[12px] font-bold mt-2 uppercase tracking-widest">{t('playlist_modal.badge')}</span>
            </div>
          )}

          <div className="flex-1 min-w-0 flex flex-col justify-center pt-1">
            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1">
              {t('playlist_modal.badge')}
            </span>
            <h3 className="text-white text-lg font-bold leading-snug line-clamp-2 mb-0.5 pr-6">
              {mediaData.title}
            </h3>
            <p className="text-zinc-400 text-sm font-semibold cursor-default">
              {displayUploader}
            </p>
            <div className="flex items-center gap-1 text-zinc-500 text-[12px] font-semibold mt-1">
              <span>{t('playlist_modal.videos_listed', { count: mediaData.count || mediaData.entries?.length || 0 })}</span>
            </div>
          </div>

          <button onClick={close} data-tooltip={t('tooltips.close', { defaultValue: 'Close' })} className="absolute top-4 right-4 p-1 text-zinc-600 hover:text-white hover:bg-white/5 rounded-full transition-all cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5 flex-1 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-5 shrink-0">
            <div className="md:col-span-3 space-y-2.5">
              <label className="text-[12px] font-black text-zinc-600 uppercase tracking-widest px-1">
                {t('playlist_modal.output_label')}
              </label>
              <div className="flex bg-zinc-900/50 p-1 h-[44px] rounded-xl border border-white/5 relative">
                {[
                  { id: 'video', icon: Camera, labelKey: 'media_modal.format_video_audio' },
                  { id: 'video_only', icon: EarOff, labelKey: 'media_modal.format_video_only' },
                  { id: 'audio', icon: Music, labelKey: 'media_modal.format_audio_only' },
                ].map((type) => {
                  const isActive = selectedFormat === type.id;
                  return (
                    <button
                      key={type.id}
                      onClick={() => setSelectedFormat(type.id)}
                      className={`relative flex-1 flex items-center justify-center h-full px-2 rounded-lg cursor-pointer outline-none transition-colors z-10 ${isActive ? "text-black font-bold" : "text-zinc-500 hover:text-zinc-300 font-medium"}`}
                    >
                      {isActive && <motion.div layoutId="activeFormatBackground" className="absolute inset-0 bg-white rounded-lg shadow-sm" transition={{ type: "spring", stiffness: 350, damping: 25 }} />}
                      <span className="relative z-20 flex items-center gap-1.5">
                        <type.icon size={15} />
                        <span className="text-[11.5px] tracking-wide whitespace-nowrap">
                          {t(type.labelKey)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="md:col-span-2 space-y-2.5">
              <label className="text-[12px] font-black text-zinc-600 uppercase tracking-widest px-1">
                {t('media_modal.destination')}
              </label>
              <div
                onClick={() => pickFolder(downloadPath).then(s => s && setDownloadPath(s))}
                className="flex items-center gap-3 p-1.5 pl-3 h-[44px] bg-zinc-900/50 border border-white/5 rounded-xl hover:border-white/10 transition-all cursor-pointer group"
              >
                <FolderOpen size={14} className="text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-colors" />
                <Swap id={downloadPath} className="flex-1 min-w-0 block text-[12px] text-zinc-400 truncate font-path">{downloadPath || t('settings.not_defined')}</Swap>
                <div className="px-2.5 py-1 bg-zinc-800 rounded-md text-[9px] font-bold text-zinc-500 group-hover:text-white shrink-0 uppercase transition-colors">
                  {t('media_modal.change')}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 shrink-0">
            <DropdownConfigBox label={t('media_modal.quality')} icon={Monitor} valueLabel={`${quality}p`} options={qualityOptions} active={selectedFormat !== 'audio'} onSelect={(val) => setQuality(val)} />
            <DropdownConfigBox label={t('media_modal.format')} icon={FilePlay} valueLabel={formatExt} options={formatOptions} active={true} onSelect={(val) => setFormatExt(val)} />
            <DropdownConfigBox label={t('media_modal.audio')} icon={FileMusic} valueLabel={currentAudioLabel} options={audioOptions} active={selectedFormat !== 'video_only'} onSelect={(val) => setAudioKbps(val)} />
          </div>

          {/* Editor-compatibility warning — slides open/closed (gap = gap-5 = 20px) */}
          <Collapse show={showEditorWarning} gap={20} className="shrink-0">
            <div className="flex items-start gap-2.5 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl">
              <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-200/90 leading-snug">
                {t('media_modal.editor_warning', {
                  codec: warnCodec,
                  defaultValue: `Resolutions above 1080p come in {{codec}}, which video editors (Premiere, DaVinci…) can't open. Choose 1080p or lower to get H.264, or convert this file to H.264 with an online converter.`
                })}
              </p>
            </div>
          </Collapse>

          <div className="pt-4 border-t border-white/5 flex flex-col gap-2.5 flex-1 min-h-0">
            <div className="flex items-center justify-between px-1 shrink-0">
              <span className="text-[12px] font-black text-zinc-500 uppercase tracking-widest">
                {t('playlist_modal.select_videos')}
                <span className="text-indigo-400 ml-2">
                  (<Swap id={selectedVideos.length} className="inline-block tabular-nums" y={3}>{selectedVideos.length}</Swap> / {mediaData.entries.length})
                </span>
              </span>
              <button onClick={handleSelectAll} className="text-[12px] font-bold text-indigo-400 hover:text-indigo-300 uppercase tracking-wider cursor-pointer transition-colors">
                <Swap id={selectedVideos.length === mediaData.entries.length} className="inline-block">
                  {selectedVideos.length === mediaData.entries.length ? t('playlist_modal.deselect_all') : t('playlist_modal.select_all')}
                </Swap>
              </button>
            </div>

            {/* Video list. Geometry (all items the same size):
                  thumbnail 96×54, radius 8 · padding 8 · border 1
                  → item radius 8 + 8 + 1 = 17 (concentric), item height 54 + 16 + 2 = 72;
                  text column = 54 px too (2 title lines of 18 + 4 + duration 14).
                The list reaches into the dialog's 24 px padding (-mr-6 / pr-6): the
                cards line up with the controls above, and the 6 px scroll thumb sits
                centered in that gutter — 9 px from the cards and 9 px from the
                dialog's edge — and 8 px away from the list's top and bottom. */}
            <div className="relative flex-1 min-h-0 -mr-6 flex flex-col">
            <div ref={listRef} className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto no-scrollbar pr-6 pb-2 content-start flex-1 min-h-0">
              {mediaData.entries.map((entry, idx) => {
                const isSelected = selectedVideos.includes(idx);
                const entryThumb = entry.thumbnails?.length > 0 ? entry.thumbnails[0].url : (isYouTube ? youtubeThumb(entry.id) : null);
                return (
                  <motion.div
                    key={idx}
                    onClick={() => handleToggleVideo(idx)}
                    // Entries cascade in when the window opens (delay capped so long lists don't drag).
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut", delay: Math.min(idx, 12) * 0.03 }}
                    className={`group h-[72px] flex items-center gap-3 p-2 rounded-[17px] border transition-colors duration-300 cursor-pointer ${isSelected ? 'bg-indigo-500/10 border-indigo-500/50 shadow-inner' : 'bg-zinc-900/30 border-white/5 hover:border-white/10 hover:bg-zinc-900/60'}`}
                  >
                    <div className="w-24 h-[54px] bg-zinc-900 rounded-lg overflow-hidden isolate shrink-0 relative shadow-md">
                      {entryThumb ? <img src={entryThumb} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-zinc-700"><Video size={14} /></div>}
                    </div>
                    <div className="flex-1 min-w-0 h-[54px] flex flex-col justify-center">
                      <p className={`text-[12px] leading-[18px] font-bold line-clamp-2 transition-colors ${isSelected ? 'text-zinc-200' : 'text-zinc-400 group-hover:text-zinc-300'}`}>
                        {titleOf(entry, idx) || t('playlist_modal.video_placeholder', { num: idx + 1 })}
                      </p>
                      {entry.duration && <span className="block h-3.5 mt-1 text-[10px] leading-[14px] text-zinc-500 font-semibold">{formatDuration(entry.duration)}</span>}
                    </div>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors duration-300 mr-1 ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600 bg-zinc-950'}`}>
                      <Pop show={isSelected} className="flex">
                        <Check size={12} className="text-white" strokeWidth={3} />
                      </Pop>
                    </div>
                  </motion.div>
                )
              })}
            </div>
            <ScrollThumb scrollRef={listRef} inset={8} right={9} />
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={handleConfirm}
            className="relative mt-2 w-full py-4 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white font-black text-sm flex items-center justify-center gap-3 cursor-pointer group overflow-hidden border border-indigo-400/30 shadow-[0_0_30px_-5px_rgba(79,70,229,0.5)] hover:shadow-[0_0_40px_0px_rgba(79,70,229,0.7)] transition-all shrink-0"
          >
            <motion.div animate={{ left: ["-100%", "200%"] }} transition={{ duration: 2, ease: "easeInOut", repeat: Infinity, repeatDelay: 2 }} className="absolute top-0 bottom-0 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 z-0" />
            <div className="relative z-10 flex items-center gap-2.5">
              <Download size={18} strokeWidth={2.5} />
              <span className="uppercase tracking-widest text-[12px] drop-shadow-md">{t('playlist_modal.download_selected')}</span>
            </div>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
