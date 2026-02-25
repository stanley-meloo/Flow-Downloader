import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, FolderOpen, Music, Camera, EarOff, Monitor, FilePlay,
  FileMusic, Activity, Download, Image as ImageIcon, ExternalLink, Check, ChevronDown
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { downloadDir, join } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";
import { openMediaLocation } from "../../utils/fileSystem";

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
  defaultQuality // <-- A mágica vem por essa Prop agora!
}) {
  const { t } = useTranslation();

  // --- DADOS DINÂMICOS DO YT-DLP ---
  const availableQualities = mediaData?.availableQualities?.length > 0 ? mediaData.availableQualities : [2160, 1440, 1080, 720, 480, 360, 240, 144];
  const availableAudio = mediaData?.availableAudio?.length > 0 ? mediaData.availableAudio : [320, 256, 192, 128];
  const cinematicFpsList = mediaData?.availableFps?.length > 0 ? ["Original", ...mediaData.availableFps] : ["Original", "60", "59.94", "50", "30", "29.97", "25", "24", "23.976"];

  // --- CÁLCULO DE QUALIDADE AUTOMÁTICA ---
  const getInitialQuality = () => {
    if (!defaultQuality || defaultQuality === "best") return availableQualities[0].toString();

    // Converte '1080p' para número 1080 para fazer a checagem
    const targetQuality = parseInt(defaultQuality.replace("p", ""));

    if (availableQualities.includes(targetQuality)) {
      return targetQuality.toString();
    }

    // Se o vídeo não tiver a qualidade exata (ex: você pediu 1080p mas o vídeo só tem até 720p)
    // Ele acha a qualidade imediatamente abaixo ou a maior possível
    const closestQuality = availableQualities.find(q => q <= targetQuality);
    return closestQuality ? closestQuality.toString() : availableQualities[0].toString();
  };

  // --- ESTADOS ---
  const [quality, setQuality] = useState(getInitialQuality()); // Inicializa com a inteligência do Settings
  const [audioKbps, setAudioKbps] = useState(`${availableAudio[0]}kb`);
  const [fps, setFps] = useState("Original");
  const [formatExt, setFormatExt] = useState(".mp4");

  const [thumbStatus, setThumbStatus] = useState("idle");
  const [savedThumbPath, setSavedThumbPath] = useState("");

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

  // --- OPÇÕES DOS DROPDOWNS ---
  const qualityOptions = availableQualities.map(q => ({ value: q.toString(), label: `${q}p` }));
  const audioOptions = availableAudio.map(a => ({ value: `${a}kb`, label: `${a}kbps` }));
  const fpsOptions = cinematicFpsList.map(f => ({
    value: f.toString(),
    label: f.toString() === "Original" ? t('media_modal.native_fps', { defaultValue: 'Nativo' }) : `${f} FPS`
  }));

  const formatOptions = selectedFormat === 'audio'
    ? [{ value: '.mp3', label: '.mp3' }, { value: '.wav', label: '.wav' }, { value: '.m4a', label: '.m4a' }, { value: '.aac', label: '.aac' }]
    : [{ value: '.mp4', label: '.mp4' }, { value: '.mkv', label: '.mkv' }, { value: '.webm', label: '.webm' }];

  async function downloadThumbnail() {
    setThumbStatus("downloading");
    try {
      const response = await fetch(mediaData.thumbnail, { method: 'GET', connectTimeout: 30000 });
      const buffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);

      const downloadFolder = await downloadDir();
      const safeTitle = mediaData.title.replace(/[\\/:*?"<>|]/g, "").replace(/ /g, "_");

      let ext = "jpg";
      const urlLower = mediaData.thumbnail.toLowerCase();
      if (urlLower.includes(".webp")) ext = "webp";
      else if (urlLower.includes(".png")) ext = "png";

      const fileName = `${safeTitle}_thumb.${ext}`;
      const fullPath = await join(downloadFolder, fileName);

      await writeFile(fullPath, uint8Array);

      const normalizedPath = fullPath.replace(/\\/g, '/');
      setSavedThumbPath(normalizedPath);
      setThumbStatus("success");
      showToast(success_thumb, "success");
    } catch (err) {
      console.error("Erro ao baixar thumb:", err);
      setThumbStatus("idle");
      showToast("error_thumb", "error");
    }
  }

  const formatTime = (seconds) => {
    const s = Number(seconds);
    if (isNaN(s) || s <= 0) return "00:00";
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleConfirm = () => {
    onConfirm({ res: quality, ext: formatExt.replace('.', ''), audio: audioKbps.replace('kb', ''), fps: fps }, selectedFormat);
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
        className="relative w-full max-w-3xl bg-zinc-950/80 border border-white/10 rounded-xl shadow-2xl overflow-visible"
      >
        <div className="p-6 flex flex-col md:flex-row gap-5 border-b border-white/5 bg-transparent">

          {/* Thumbnail */}
          <div
            className={`w-full md:w-48 aspect-video rounded-md overflow-hidden shrink-0 relative group transition-all 
            ${thumbStatus === 'success' ? 'ring-1 ring-emerald-500 cursor-default' : 'cursor-pointer'} 
          `}
            onClick={thumbStatus === 'idle' ? downloadThumbnail : undefined}
          >
            <img
              src={mediaData.thumbnail}
              className={`w-full h-full object-cover transition-all duration-500 ${thumbStatus === 'success' ? '' : ''} group-hover:blur-[2px]`}
              referrerPolicy="no-referrer"
            />

            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-300">
              {thumbStatus === 'idle' && (
                <>
                  <ImageIcon size={20} className="text-white mb-1" />
                  <span className="text-[12px] font-bold text-white uppercase tracking-tighter">
                    {t('media_modal.download_png', { defaultValue: 'Baixar Imagem' })}
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
                    const name = fullName.substring(0, fullName.lastIndexOf('.'));
                    const ext = fullName.substring(fullName.lastIndexOf('.') + 1);
                    openMediaLocation(dir, name, ext, showToast, (k) => k);
                  }}
                  onMouseEnter={(e) => tooltipHandlers?.enter(e, t('media_modal.open_folder', { defaultValue: 'Abrir local do arquivo' }), "left", "top")}
                  onMouseMove={tooltipHandlers?.move}
                  onMouseLeave={tooltipHandlers?.leave}
                  className="bg-emerald-500 text-white p-2 rounded-full hover:scale-110 transition-transform shadow-lg cursor-pointer pointer-events-auto z-20 relative"
                >
                  <ExternalLink size={16} />
                </button>
              )}
            </div>

            {thumbStatus === 'success' && (
              <div className="absolute top-2 right-2 bg-emerald-500 text-white p-1 rounded-sm shadow-lg pointer-events-none">
                <Check size={10} strokeWidth={4} />
              </div>
            )}
          </div>

          {/* Informações do Vídeo */}
          <div className="flex-1 min-w-0 flex flex-col justify-center pt-1">
            <span className="text-[12px] font-black text-zinc-600 uppercase tracking-widest mb-1">
              {mediaData.extractor_key || "Web"}
            </span>
            <h3 className="text-white text-lg font-bold leading-snug line-clamp-2 mb-0.5 pr-6">
              {mediaData.title}
            </h3>
            <p className="text-zinc-400 text-sm font-semibold hover:text-zinc-200 transition-colors cursor-default">
              {mediaData.uploader || "Canal desconhecido"}
            </p>
            <div className="flex items-center gap-1 text-zinc-500 text-[12px] font-semibold mt-1">
              <span>{formatTime(mediaData.duration)}</span>
            </div>
          </div>

          <button onClick={close} className="absolute top-4 right-4 p-1 text-zinc-600 hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-5">

            {/* Seletor Tipo */}
            <div className="md:col-span-3 space-y-2.5">
              <label className="text-[12px] font-black text-zinc-600 uppercase tracking-widest px-1">
                {t('media_modal.output_format', { defaultValue: 'Formato de Saída' })}
              </label>
              <div className="flex bg-zinc-900/50 p-1 h-[44px] rounded-lg border border-white/5 relative">
                {[
                  { id: 'video', icon: Camera, labelKey: 'media_modal.format_video_audio', defaultLabel: 'Video + Audio' },
                  { id: 'video_only', icon: EarOff, labelKey: 'media_modal.format_video_only', defaultLabel: 'Apenas Video' },
                  { id: 'audio', icon: Music, labelKey: 'media_modal.format_audio_only', defaultLabel: 'Apenas Audio' },
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
                        <span className="text-[10.5px] tracking-wide whitespace-nowrap">
                          {t(type.labelKey, { defaultValue: type.defaultLabel })}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Destino */}
            <div className="md:col-span-2 space-y-2.5">
              <label className="text-[12px] font-black text-zinc-600 uppercase tracking-widest px-1">
                {t('media_modal.destination', { defaultValue: 'Destino' })}
              </label>
              <div
                onClick={() => openDialog({ directory: true, multiple: false, defaultPath: downloadPath }).then(s => s && setDownloadPath(s.replace(/\\/g, "/")))}
                className="flex items-center gap-3 p-1.5 pl-3 h-[44px] bg-zinc-900/50 border border-white/5 rounded-lg hover:border-white/10 transition-all cursor-pointer group"
              >
                <FolderOpen size={14} className="text-zinc-600 group-hover:text-zinc-400 shrink-0" />
                <span className="flex-1 text-[12px] text-zinc-400 truncate font-mono">{downloadPath || "Downloads"}</span>
                <div className="px-2.5 py-1 bg-zinc-800 rounded text-[12px] font-bold text-zinc-500 group-hover:text-white shrink-0 uppercase">
                  {t('media_modal.change', { defaultValue: 'ALTERAR' })}
                </div>
              </div>
            </div>
          </div>

          {/* CAIXAS DE CONFIGURAÇÃO INTERATIVAS */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DropdownConfigBox
              label={t('media_modal.quality', { defaultValue: 'Qualidade' })}
              icon={Monitor}
              valueLabel={`${quality}p`}
              options={qualityOptions}
              active={selectedFormat !== 'audio'}
              onSelect={(val) => setQuality(val)}
            />
            <DropdownConfigBox
              label={t('media_modal.format', { defaultValue: 'Formato' })}
              icon={FilePlay}
              valueLabel={formatExt}
              options={formatOptions}
              active={true}
              onSelect={(val) => setFormatExt(val)}
            />
            <DropdownConfigBox
              label={t('media_modal.audio', { defaultValue: 'Áudio' })}
              icon={FileMusic}
              valueLabel={`${audioKbps.replace('kb', '')}kbps`}
              options={audioOptions}
              active={selectedFormat !== 'video_only'}
              onSelect={(val) => setAudioKbps(val)}
            />
            <DropdownConfigBox
              label={t('media_modal.fps', { defaultValue: 'FPS' })}
              icon={Activity}
              valueLabel={fps === "Original" ? t('media_modal.native_fps', { defaultValue: 'Nativo' }) : `${fps} FPS`}
              options={fpsOptions}
              active={selectedFormat !== 'audio'}
              onSelect={(val) => setFps(val)}
            />
          </div>

          {/* BOTÃO INICIAR DOWNLOAD */}
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleConfirm}
            className="relative w-full py-4 rounded-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white font-black text-sm flex items-center justify-center gap-3 cursor-pointer group overflow-hidden border border-indigo-400/30 shadow-[0_0_30px_-5px_rgba(79,70,229,0.5)] hover:shadow-[0_0_40px_0px_rgba(79,70,229,0.7)] transition-all"
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
                <Download size={18} strokeWidth={2.5} />
              </motion.div>

              <span className="uppercase tracking-widest text-[13px] drop-shadow-md">
                {t('media_modal.start_download', { defaultValue: 'Iniciar Download' })}
              </span>
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
    <div className="flex flex-col"> {/* <-- O relative foi removido daqui */}
      <label className="text-[11px] font-black text-zinc-600 uppercase tracking-widest px-1 mb-1.5">
        {label}
      </label>

      {/* NOVO: Container relativo isolando apenas o botão e a lista */}
      <div className="relative">
        <button
          onClick={() => active && setIsOpen(!isOpen)}
          // Adicionado w-full
          className={`w-full flex items-center justify-between p-2.5 px-3 rounded-lg border transition-all duration-500 ease-in-out h-[44px] ${active
              ? isOpen
                ? "bg-zinc-800 border-white/20 shadow-inner"
                : "bg-zinc-900/40 border-white/5 hover:bg-zinc-900 hover:border-white/10 cursor-pointer active:scale-95"
              : "opacity-10 grayscale cursor-not-allowed"
            }`}
        >
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
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                // mb-1 aqui adiciona apenas 4px de gap suave.
                className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl z-40 overflow-hidden py-1 max-h-48 overflow-y-auto custom-scrollbar ring-1 ring-black/50 origin-bottom"
              >
                {options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => { onSelect(opt.value); setIsOpen(false); }}
                    className={`w-full text-left px-3 py-2.5 text-[12px] font-bold transition-colors hover:bg-zinc-800 ${valueLabel === opt.label ? 'text-white bg-zinc-800/50' : 'text-zinc-400'
                      }`}
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