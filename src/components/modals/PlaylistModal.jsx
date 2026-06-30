import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, FolderOpen, Music, FilePlay, EarOff, Monitor, Camera, FileMusic,
  Download, Image as ImageIcon, ExternalLink, Check, ChevronDown, ListChecks, AlertTriangle,
  Video // fallback icon for playlist entries without a thumbnail
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { downloadDir, join } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";
import { openMediaLocation, fetchBestThumbnail } from "../../utils/fileSystem";
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
  defaultQuality
}) {
  const { t } = useTranslation();

  const firstVideo = mediaData?.entries?.[0];

  const displayThumbnail = firstVideo?.thumbnails?.length > 0
    ? firstVideo.thumbnails[firstVideo.thumbnails.length - 1].url
    : (firstVideo?.id ? `https://i.ytimg.com/vi/${firstVideo.id}/maxresdefault.jpg` : mediaData.thumbnail);

  const displayUploader = firstVideo?.uploader || firstVideo?.channel || mediaData.uploader || t('playlist_modal.unknown_uploader');

  const availableQualities = mediaData?.availableQualities?.length > 0 ? mediaData.availableQualities : [2160, 1440, 1080, 720, 480, 360, 240, 144];

  const getInitialQuality = () => {
    if (!defaultQuality || defaultQuality === "best") return availableQualities[0].toString();
    const targetQuality = parseInt(defaultQuality.replace("p", ""));
    if (availableQualities.includes(targetQuality)) return targetQuality.toString();
    const closestQuality = availableQualities.find(q => q <= targetQuality);
    return closestQuality ? closestQuality.toString() : availableQualities[0].toString();
  };

  const [quality, setQuality] = useState(getInitialQuality());
  const [audioKbps, setAudioKbps] = useState('160kb'); // YouTube tops out at ~160 kbps (Opus)
  const [formatExt, setFormatExt] = useState(".mp4");

  const [thumbStatus, setThumbStatus] = useState("idle");
  const [savedThumbPath, setSavedThumbPath] = useState("");
  const [selectedVideos, setSelectedVideos] = useState([]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [close]);

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

  const formatDuration = (seconds) => {
    if (!seconds) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${m}:${secs.toString().padStart(2, '0')}`;
  };

  const qualityOptions = availableQualities.map(q => ({ value: q.toString(), label: `${q}p` }));
  const audioOptions = [
    { value: '160kb', label: t('media_modal.audio_best', { defaultValue: 'Melhor (~160 kbps)' }) },
    { value: '128kb', label: t('media_modal.audio_medium', { defaultValue: 'Média (128 kbps)' }) },
    { value: '96kb', label: t('media_modal.audio_low', { defaultValue: 'Baixa (96 kbps)' }) }
  ];
  const currentAudioLabel = audioOptions.find(o => o.value === audioKbps)?.label || audioOptions[0].label;

  // Editor-compatibility warning (same rule as the single-video modal):
  // warn strictly above 1080p, where YouTube only serves VP9/AV1.
  const selectedHeight = parseInt(quality, 10);
  const warnCodec = mediaData?.highResCodec || 'AV1';
  const showEditorWarning = selectedFormat !== 'audio' && !isNaN(selectedHeight) && selectedHeight > 1080;

  const formatOptions = selectedFormat === 'audio'
    ? [{ value: '.mp3', label: '.mp3' }, { value: '.wav', label: '.wav' }, { value: '.m4a', label: '.m4a' }, { value: '.aac', label: '.aac' }]
    : [{ value: '.mp4', label: '.mp4' }, { value: '.mkv', label: '.mkv' }, { value: '.webm', label: '.webm' }];

  async function downloadThumbnail() {
    if (!displayThumbnail) return;
    setThumbStatus("downloading");
    try {
      // The playlist cover is the first video's thumbnail — use its id to grab
      // the highest-resolution version (maxres -> sd -> hq -> fallback).
      const videoId = mediaData.entries?.[0]?.id;
      const { bytes, ext } = await fetchBestThumbnail(videoId, displayThumbnail);
      const downloadFolder = await downloadDir();
      const safeTitle = mediaData.title.replace(/[\\/:*?"<>|]/g, "").replace(/ /g, "_");
      const fileName = `${safeTitle}_thumb.${ext}`;
      const fullPath = await join(downloadFolder, fileName);
      await writeFile(fullPath, bytes);
      setSavedThumbPath(fullPath.replace(/\\/g, '/'));
      setThumbStatus("success");
      showToast("success_thumb", "success");
    } catch (err) {
      setThumbStatus("idle");
      showToast("error_thumb", "error");
    }
  }

  const handleConfirm = () => {
    if (selectedVideos.length === 0) {
      showToast(t('playlist_modal.error_no_selection'), 'error');
      return;
    }
    const filteredEntries = mediaData.entries.filter((_, idx) => selectedVideos.includes(idx));
    const finalData = { ...mediaData, entries: filteredEntries };
    onConfirm({ res: quality, ext: formatExt.replace('.', ''), audio: audioKbps.replace('kb', '') }, selectedFormat, finalData);
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={close}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        className="relative w-full max-w-4xl bg-zinc-950/80 border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]"
      >
        <div className="p-6 flex flex-col md:flex-row gap-5 border-b border-white/5 bg-transparent shrink-0">
          {displayThumbnail ? (
            <div
              className={`w-full md:w-48 aspect-video rounded-md overflow-hidden shrink-0 relative group transition-all 
              ${thumbStatus === 'success' ? 'ring-1 ring-emerald-500 cursor-default' : 'cursor-pointer'} 
            `}
              onClick={thumbStatus === 'idle' ? downloadThumbnail : undefined}
            >
              <img src={displayThumbnail} className={`w-full h-full object-cover transition-all duration-500 group-hover:blur-[2px]`} referrerPolicy="no-referrer" />
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-300">
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
              </div>
              {thumbStatus === 'success' && <div className="absolute top-2 right-2 bg-emerald-500 text-white p-1 rounded-sm shadow-lg pointer-events-none"><Check size={10} strokeWidth={4} /></div>}
            </div>
          ) : (
            <div className="w-full md:w-48 aspect-video rounded-md overflow-hidden shrink-0 bg-zinc-900 border border-white/5 flex flex-col items-center justify-center text-zinc-700">
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

          <button onClick={close} className="absolute top-4 right-4 p-1 text-zinc-600 hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-5 flex-1 min-h-0">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-5 shrink-0">
            <div className="md:col-span-3 space-y-2.5">
              <label className="text-[12px] font-black text-zinc-600 uppercase tracking-widest px-1">
                {t('playlist_modal.output_label')}
              </label>
              <div className="flex bg-zinc-900/50 p-1 h-[44px] rounded-lg border border-white/5 relative">
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
                      className={`relative flex-1 flex items-center justify-center h-full px-2 rounded-md cursor-pointer outline-none transition-colors z-10 ${isActive ? "text-black font-bold" : "text-zinc-500 hover:text-zinc-300 font-medium"}`}
                    >
                      {isActive && <motion.div layoutId="activeFormatBackground" className="absolute inset-0 bg-white rounded-md shadow-sm" transition={{ type: "spring", stiffness: 350, damping: 25 }} />}
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
                onClick={() => openDialog({ directory: true, multiple: false, defaultPath: downloadPath }).then(s => s && setDownloadPath(s.replace(/\\/g, "/")))}
                className="flex items-center gap-3 p-1.5 pl-3 h-[44px] bg-zinc-900/50 border border-white/5 rounded-lg hover:border-white/10 transition-all cursor-pointer group"
              >
                <FolderOpen size={14} className="text-zinc-600 group-hover:text-zinc-400 shrink-0" />
                <span className="flex-1 text-[12px] text-zinc-400 truncate font-mono">{downloadPath || t('settings.not_defined')}</span>
                <div className="px-2.5 py-1 bg-zinc-800 rounded text-[9px] font-bold text-zinc-500 group-hover:text-white shrink-0 uppercase">
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

          {showEditorWarning && (
            <div className="flex items-start gap-2.5 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl shrink-0">
              <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-200/90 leading-snug">
                {t('media_modal.editor_warning', {
                  codec: warnCodec,
                  defaultValue: `Resoluções acima de 1080p vêm em {{codec}}, que editores de vídeo (Premiere, DaVinci...) não abrem. Escolha 1080p ou menos para ter H.264, ou converta os arquivos para H.264 com um conversor online.`
                })}
              </p>
            </div>
          )}

          <div className="pt-4 border-t border-white/5 flex flex-col gap-2.5 flex-1 min-h-0">
            <div className="flex items-center justify-between px-1 shrink-0">
              <span className="text-[12px] font-black text-zinc-500 uppercase tracking-widest">
                {t('playlist_modal.select_videos')}
                <span className="text-indigo-400 ml-2">({selectedVideos.length} / {mediaData.entries.length})</span>
              </span>
              <button onClick={handleSelectAll} className="text-[12px] font-bold text-indigo-400 hover:text-indigo-300 uppercase tracking-wider cursor-pointer transition-colors">
                {selectedVideos.length === mediaData.entries.length ? t('playlist_modal.deselect_all') : t('playlist_modal.select_all')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto custom-scrollbar pr-2 pb-2">
              {mediaData.entries.map((entry, idx) => {
                const isSelected = selectedVideos.includes(idx);
                const entryThumb = entry.thumbnails?.length > 0 ? entry.thumbnails[0].url : (entry.id ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` : null);
                return (
                  <div key={idx} onClick={() => handleToggleVideo(idx)} className={`group flex items-center gap-3 p-2.5 rounded-xl border transition-all duration-300 cursor-pointer ${isSelected ? 'bg-indigo-500/10 border-indigo-500/50 shadow-inner' : 'bg-zinc-900/30 border-white/5 hover:border-white/10 hover:bg-zinc-900/60'}`}>
                    <div className="w-24 aspect-video bg-zinc-900 rounded-md overflow-hidden shrink-0 relative shadow-md">
                      {entryThumb ? <img src={entryThumb} className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-zinc-700"><Video size={14} /></div>}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center h-full py-0.5">
                      <p className={`text-[12px] font-bold line-clamp-2 transition-colors ${isSelected ? 'text-zinc-200' : 'text-zinc-400 group-hover:text-zinc-300'}`}>{entry.title || t('playlist_modal.video_placeholder', { num: idx + 1 })}</p>
                      {entry.duration && <span className="text-[9px] text-zinc-500 font-semibold mt-1 inline-block">{formatDuration(entry.duration)}</span>}
                    </div>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors mr-1 ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600 bg-zinc-950'}`}>
                      {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={handleConfirm}
            className="relative mt-2 w-full py-4 rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white font-black text-sm flex items-center justify-center gap-3 cursor-pointer group overflow-hidden border border-indigo-400/30 shadow-[0_0_30px_-5px_rgba(79,70,229,0.5)] hover:shadow-[0_0_40px_0px_rgba(79,70,229,0.7)] transition-all shrink-0"
          >
            <motion.div animate={{ left: ["-100%", "200%"] }} transition={{ duration: 2, ease: "easeInOut", repeat: Infinity, repeatDelay: 2 }} className="absolute top-0 bottom-0 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 z-0" />
            <div className="relative z-10 flex items-center gap-2.5">
              <motion.div animate={{ y: [0, 3, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}><Download size={18} strokeWidth={2.5} /></motion.div>
              <span className="uppercase tracking-widest text-[12px] drop-shadow-md">{t('playlist_modal.download_selected')}</span>
            </div>
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

function DropdownConfigBox({ label, icon: Icon, valueLabel, options, active, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <label className="text-[12px] font-black text-zinc-600 uppercase tracking-widest px-1 mb-1.5">{label}</label>
      <div className="relative">
        <button onClick={() => active && setIsOpen(!isOpen)} className={`w-full flex items-center justify-between p-2.5 px-3 rounded-lg border transition-all duration-500 ease-in-out h-[44px] ${active ? isOpen ? "bg-zinc-800 border-white/20 shadow-inner" : "bg-zinc-900/40 border-white/5 hover:bg-zinc-900 hover:border-white/10 cursor-pointer active:scale-95" : "opacity-10 grayscale cursor-not-allowed"}`}>
          <div className="flex items-center gap-2 overflow-hidden">
            <Icon size={14} className="text-zinc-500 shrink-0" />
            <span className="text-[11.5px] font-bold text-zinc-200 truncate">{valueLabel}</span>
          </div>
          {active && <ChevronDown size={12} className={`text-zinc-500 transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />}
        </button>
        <AnimatePresence>
          {isOpen && active && (
            <>
              <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={{ duration: 0.15 }} className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl z-40 overflow-hidden py-1 max-h-48 overflow-y-auto custom-scrollbar ring-1 ring-black/50 origin-bottom">
                {options.map((opt, i) => (
                  <button key={i} onClick={() => { onSelect(opt.value); setIsOpen(false); }} className={`w-full text-left px-3 py-2.5 text-[12px] font-bold transition-colors hover:bg-zinc-800 ${valueLabel === opt.label ? 'text-white bg-zinc-800/50' : 'text-zinc-400'}`}>
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