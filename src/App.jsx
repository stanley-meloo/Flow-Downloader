import { useState, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Heart } from "lucide-react";
import { readFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';

import { open } from '@tauri-apps/plugin-shell'; // Importação para abrir links externos com segurança

// Components
import TitleBar from "./components/ui/TitleBar";
import Toast from "./components/ui/Toast";
import FloatingLines from "./components/features/FloatingLines";
import ColorBends from "./components/features/ColorBends";
import SearchInput from "./components/features/SearchInput";
import QueueList from "./components/features/QueueList";
import MediaModal from "./components/modals/MediaModal";
import SetupModal from "./components/modals/SetupModal";
import SettingsModal from "./components/modals/SettingsModal";
import PlaylistModal from "./components/modals/PlaylistModal";

// Hooks & Utils
import useSettings from "./hooks/useSettings";
import useDownloader from "./hooks/useDownloader";
import useTooltip from "./hooks/useTooltip";
import { handlePaste } from "./utils/fileSystem";

const smoothTransition = { type: "spring", stiffness: 200, damping: 25 };
const tooltipPhysics = { type: "spring", stiffness: 300, damping: 20, mass: 0.8 };

function App() {
  const { t, i18n } = useTranslation();
  const toastRef = useRef(null);
  const showToast = (msg, type) => toastRef.current?.add(msg, type);

  const settings = useSettings();
  const downloader = useDownloader(settings, showToast);
  const { tooltip, handleTooltipEnter, handleTooltipMove, handleTooltipLeave } = useTooltip();

  const [showSettings, setShowSettings] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState("video");
  const [bgImageBlobUrl, setBgImageBlobUrl] = useState(null);

  const tooltipHandlers = { enter: handleTooltipEnter, move: handleTooltipMove, leave: handleTooltipLeave };

  // --- MEMOIZAÇÃO DE VISUAIS ---
  const activeGradient = useMemo(() => {
    return settings.visuals?.showColors ? settings.visuals.customColors : undefined;
  }, [settings.visuals?.showColors, settings.visuals?.customColors]);

  const activeColors = useMemo(() => {
    return settings.visuals?.cb_colors || ["#ff5c7a", "#8a5cff", "#00ffd1"];
  }, [settings.visuals?.cb_colors]);

  useEffect(() => {
    if (settings.language) {
      if (settings.language === "auto") {
        const browserLang = navigator.language.split('-')[0];
        const supported = ["en", "es", "pt", "fr", "de", "zh", "ja", "ru", "hi", "ar"];
        const finalLang = supported.includes(browserLang) ? browserLang : "en";
        i18n.changeLanguage(finalLang);
      } else {
        i18n.changeLanguage(settings.language);
      }
    }
  }, [settings.language, i18n]);

  // --- CARREGAMENTO DE IMAGEM DE FUNDO ---
  useEffect(() => {
    const loadBgImage = async () => {
      if (settings.visuals?.bgImage) {
        try {
          const fileBytes = await readFile(settings.visuals.bgImage);
          const blob = new Blob([fileBytes]);
          const url = URL.createObjectURL(blob);
          setBgImageBlobUrl(url);
        } catch (err) {
          console.error("Falha ao ler imagem:", err);
          showToast("error_thumb", "error");
        }
      } else {
        setBgImageBlobUrl(null);
      }
    };
    loadBgImage();

    return () => {
      if (bgImageBlobUrl) URL.revokeObjectURL(bgImageBlobUrl);
    };
  }, [settings.visuals?.bgImage]);

  return (
    <div className="w-screen h-screen bg-zinc-950 rounded-xl border border-white overflow-hidden flex flex-col relative">

      {/* BARRA DE TÍTULO */}
      <div className="pointer-events-auto z-50"><TitleBar /></div>
      <Toast ref={toastRef} language={settings.language} />

      {/* TOOLTIP FLUTUANTE */}
      <AnimatePresence>
        {tooltip.visible && (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1, x: tooltip.align === "left" ? tooltip.x - 15 : tooltip.x + 15, y: tooltip.vAlign === "top" ? tooltip.y - 15 : tooltip.y + 15 }} exit={{ opacity: 0, scale: 0.8 }} transition={tooltipPhysics} style={{ position: 'fixed', top: 0, left: 0, pointerEvents: 'none', zIndex: 9999, translateX: tooltip.align === "left" ? "-100%" : "0%", translateY: tooltip.vAlign === "top" ? "-100%" : "0%" }} className="bg-zinc-950/90 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg shadow-2xl">
            <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest whitespace-nowrap">{tooltip.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- SISTEMA DE BACKGROUND --- */}
      <div className="fixed inset-0 z-0 bg-[#09090b]">
        <AnimatePresence mode="popLayout">
          {settings.visuals && (
            <motion.div
              key={settings.visuals.activeBackground}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0 w-full h-full"
            >

              {/* Opção 1: Color Bends LIMPO (Apenas Cores) */}
              {settings.visuals.activeBackground === 'colorBends' && (
                <ColorBends
                  colors={settings.visuals.cb_showColors ? [
                    settings.visuals.cb_color1 || '#4f46e5',
                    settings.visuals.cb_color2 || '#ec4899',
                    settings.visuals.cb_color3 || '#06b6d4',
                    settings.visuals.cb_color4 || '#14b8a6'
                  ] : [
                    '#6E0E3B', // Cor Padrão 1
                    '#2A611F', // Cor Padrão 2
                    '#0900AB', // Cor Padrão 3
                    '#9C3A00'  // Cor Padrão 4
                  ]}
                />
              )}

              {/* Opção 2: Linhas Flutuantes */}
              {settings.visuals.activeBackground === 'floatingLines' && (
                <FloatingLines
                  linesGradient={settings.visuals.showColors ? [
                    settings.visuals.lineColor1 || '#4f46e5',
                    settings.visuals.lineColor2 || '#ec4899',
                    settings.visuals.lineColor3 || '#06b6d4',
                    settings.visuals.lineColor4 || '#14b8a6'
                  ] : null}
                  lineCount={settings.visuals.lineCount ? [settings.visuals.lineCount, settings.visuals.lineCount, settings.visuals.lineCount] : [6]}
                  lineDistance={settings.visuals.lineDistance ? [settings.visuals.lineDistance, settings.visuals.lineDistance, settings.visuals.lineDistance] : [5]}
                  bendRadius={settings.visuals.bendRadius || 5.0}
                />
              )}

              {/* Opção 3: Estático / Imagem */}
              {settings.visuals.activeBackground === 'static' && (
                <div
                  className="w-full h-full relative overflow-hidden transition-colors duration-500"
                  style={{ backgroundColor: settings.visuals.staticColor }}
                >
                  {/* Imagem com Blur */}
                  {bgImageBlobUrl && (
                    <img
                      src={bgImageBlobUrl}
                      className="absolute inset-0 w-full h-full object-cover transition-all duration-300"
                      style={{ filter: `blur(${settings.visuals.imageBlur}px)` }}
                      alt="Background"
                    />
                  )}

                  {/* Overlay Escuro */}
                  <div
                    className="absolute inset-0 pointer-events-none transition-opacity duration-300"
                    style={{ backgroundColor: 'black', opacity: settings.visuals.imageDarken }}
                  />

                  {/* Gradiente Superior */}
                  <AnimatePresence>
                    {settings.visuals.staticGradientEnabled && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.8 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.5, ease: "easeInOut" }}
                        className="absolute inset-0 pointer-events-none"
                        style={{
                          background: `linear-gradient(to bottom, ${settings.visuals.staticGradientColor} 0%, transparent 60%)`
                        }}
                      />
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* BOTÃO DE APOIO / DOAÇÃO */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        transition={smoothTransition}
        // Coloque o seu link do PayPal.Me, link de PIX ou Linktree aqui
        onClick={() => open("https://linktr.ee/flow.downloader")}
        onMouseEnter={(e) => handleTooltipEnter(e, t('support_flow'), "left", "top")}
        onMouseMove={handleTooltipMove}
        onMouseLeave={handleTooltipLeave}
        className="fixed bottom-20 right-6 p-2 bg-rose-500/10 border border-rose-500/30 rounded-full text-rose-400 hover:bg-rose-500 hover:text-white z-20 shadow-xl cursor-pointer pointer-events-auto transition-colors"
      >
        <Heart size={19} />
      </motion.button>

      {/* BOTÃO DE CONFIGURAÇÕES */}
      <motion.button
        whileHover={{ rotate: 90, scale: 1.1 }}
        transition={smoothTransition}
        onClick={() => setShowSettings(true)}
        onMouseEnter={(e) => handleTooltipEnter(e, t('settings.title'), "left", "top")}
        onMouseMove={handleTooltipMove}
        onMouseLeave={handleTooltipLeave}
        className="fixed bottom-6 right-6 p-2 bg-zinc-900/50 border border-zinc-800 rounded-full text-zinc-400 hover:text-white z-20 shadow-xl cursor-pointer pointer-events-auto"
      >
        <Settings size={20} />
      </motion.button>

      {/* --- CONTEÚDO PRINCIPAL --- */}
      <main className="flex-1 flex flex-col items-center pt-24 px-6 w-full  max-w-4xl mx-auto z-10 h-full pointer-events-none">
        {/* LOGO */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12 shrink-0">
          <h1 className="text-5xl font-light tracking-tight mb-2 text-white">
            Flow <span className="font-bold">Downloader</span>
          </h1>
          <p className="text-zinc-500 text-sm tracking-widest uppercase">
            {t('hero.subtitle')}
          </p>
        </motion.div>

        {/* ÁREA INTERATIVA */}
        <div className="w-full max-w-2xl pointer-events-auto flex flex-col items-center gap-0 flex-1 min-h-0">
          <SearchInput
            url={downloader.url}
            setUrl={downloader.setUrl}
            analyzing={downloader.analyzing}
            onAnalyze={downloader.analyzeLink}
            onPaste={() => handlePaste(downloader.setUrl, showToast)}
            tooltipHandlers={tooltipHandlers}
          />

          <QueueList
            queue={downloader.queue}
            tooltipHandlers={tooltipHandlers}
            showToast={showToast}
            onPauseItem={downloader.pauseDownload}
            onResumeItem={downloader.resumeDownload}
            onCancelItem={downloader.cancelDownload}
            onRetryItem={downloader.retryDownload}
            onRemoveItem={downloader.removeItem}
          />
        </div>
      </main>

      {/* MODAIS */}
      <AnimatePresence>
        {downloader.mediaData && (
          downloader.mediaData.isPlaylist ? (
            <PlaylistModal
              mediaData={downloader.mediaData}
              close={() => downloader.setMediaData(null)}
              onConfirm={downloader.startDownload}
              selectedFormat={selectedFormat}
              setSelectedFormat={setSelectedFormat}
              downloadPath={downloader.downloadPath}
              setDownloadPath={downloader.setDownloadPath}
              showToast={showToast}
              tooltipHandlers={tooltipHandlers}
              defaultQuality={settings.defaultQuality}
            />
          ) : (
            <MediaModal
              mediaData={downloader.mediaData}
              close={() => downloader.setMediaData(null)}
              onConfirm={downloader.startDownload}
              selectedFormat={selectedFormat}
              setSelectedFormat={setSelectedFormat}
              downloadPath={downloader.downloadPath}
              setDownloadPath={downloader.setDownloadPath}
              showToast={showToast}
              tooltipHandlers={tooltipHandlers}
              defaultQuality={settings.defaultQuality}
            />
          )
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settings.showSetup && (
          <SetupModal
            settings={settings}
            onClose={() => settings.setShowSetup(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} settings={settings} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;