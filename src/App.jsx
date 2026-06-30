import { useState, useRef, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Heart } from "lucide-react";
import { readFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';

import { open } from '@tauri-apps/plugin-shell'; // safely opens external links in the default browser

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
import useYtdlpUpdater from "./hooks/useYtdlpUpdater";
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
  const ytdlpUpdater = useYtdlpUpdater(showToast);
  const { tooltip, handleTooltipEnter, handleTooltipMove, handleTooltipLeave } = useTooltip();

  const [showSettings, setShowSettings] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState("video");
  const [bgImageBlobUrl, setBgImageBlobUrl] = useState(null);

  const tooltipHandlers = { enter: handleTooltipEnter, move: handleTooltipMove, leave: handleTooltipLeave };

  // --- MEMOIZED VISUAL PROPS (avoid re-creating arrays every render) ---
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

  // --- BACKGROUND IMAGE LOADING ---
  // Resolves settings.visuals.bgImage into a usable <img> src. Bundled presets
  // are referenced by URL directly; user-imported images are local file paths
  // that must be read off disk and exposed as an object URL.
  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;

    const loadBgImage = async () => {
      const img = settings.visuals?.bgImage;
      if (!img) { setBgImageBlobUrl(null); return; }

      // Built-in preset wallpaper: the value is "@preset:<url>" — use the URL directly.
      if (img.startsWith("@preset:")) {
        setBgImageBlobUrl(img.slice("@preset:".length));
        return;
      }

      // User-imported image: a local file path; read the bytes into a blob URL.
      try {
        const fileBytes = await readFile(img);
        if (cancelled) return;
        const blob = new Blob([fileBytes]);
        objectUrl = URL.createObjectURL(blob);
        setBgImageBlobUrl(objectUrl);
      } catch (err) {
        console.error("Failed to read background image:", err);
        showToast("error_thumb", "error");
      }
    };
    loadBgImage();

    // Revokes the URL created by THIS effect run (no stale closure leak).
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [settings.visuals?.bgImage]);

  // --- GLOBAL KEYBOARD SHORTCUTS (Enter = search, Ctrl/Cmd+V = paste, Ctrl/Cmd+A = select bar) ---
  // These work even when the input/button is not focused. The handler is stored
  // in a ref that is reassigned on every render, so it always reads the latest
  // state/URL without re-binding the window listener.
  const keyHandlerRef = useRef(() => {});
  keyHandlerRef.current = (e) => {
    const tag = e.target?.tagName;
    const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
    const modalOpen = downloader.mediaData || settings.showSetup || showSettings;

    // Enter: trigger the link analysis when focus is not on a field/button.
    if (e.key === 'Enter') {
      if (inEditable || tag === 'BUTTON' || modalOpen || downloader.analyzing) return;
      downloader.analyzeLink();
      return;
    }

    // Ctrl/Cmd + V: paste the clipboard link into the search bar. Inside editable
    // fields the native paste already handles it, so we only act outside them.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      if (inEditable || modalOpen) return;
      handlePaste(downloader.setUrl, showToast);
      return;
    }

    // Ctrl/Cmd + A: select only the search bar contents (instead of the whole page).
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      if (inEditable || modalOpen) return; // inside fields, the native "select all" is fine
      const input = document.getElementById('flow-search-input');
      if (input) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    }
  };
  useEffect(() => {
    const onKeyDown = (e) => keyHandlerRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="w-screen h-screen bg-zinc-950 rounded-xl border border-white overflow-hidden flex flex-col relative">

      {/* TITLE BAR (custom window chrome: drag region + min/max/close) */}
      <div className="pointer-events-auto z-50"><TitleBar /></div>
      <Toast ref={toastRef} language={settings.language} />

      {/* FLOATING CURSOR-FOLLOWING TOOLTIP */}
      <AnimatePresence>
        {tooltip.visible && (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1, x: tooltip.align === "left" ? tooltip.x - 15 : tooltip.x + 15, y: tooltip.vAlign === "top" ? tooltip.y - 15 : tooltip.y + 15 }} exit={{ opacity: 0, scale: 0.8 }} transition={tooltipPhysics} style={{ position: 'fixed', top: 0, left: 0, pointerEvents: 'none', zIndex: 9999, translateX: tooltip.align === "left" ? "-100%" : "0%", translateY: tooltip.vAlign === "top" ? "-100%" : "0%" }} className="bg-zinc-950/90 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-lg shadow-2xl">
            <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest whitespace-nowrap">{tooltip.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- BACKGROUND SYSTEM (one of three engines, crossfaded) --- */}
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

              {/* Engine 1: Color Bends (animated color field) */}
              {settings.visuals.activeBackground === 'colorBends' && (
                <ColorBends
                  colors={settings.visuals.cb_showColors ? [
                    settings.visuals.cb_color1 || '#4f46e5',
                    settings.visuals.cb_color2 || '#ec4899',
                    settings.visuals.cb_color3 || '#06b6d4',
                    settings.visuals.cb_color4 || '#14b8a6'
                  ] : [
                    '#6E0E3B', // default color 1
                    '#2A611F', // default color 2
                    '#0900AB', // default color 3
                    '#9C3A00'  // default color 4
                  ]}
                />
              )}

              {/* Engine 2: Floating Lines (interactive WebGL lines) */}
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

              {/* Engine 3: Static color / custom wallpaper image */}
              {settings.visuals.activeBackground === 'static' && (
                <div
                  className="w-full h-full relative overflow-hidden transition-colors duration-500"
                  style={{ backgroundColor: settings.visuals.staticColor }}
                >
                  {/* Wallpaper image (with optional blur) — smooth crossfade on change */}
                  <AnimatePresence>
                    {bgImageBlobUrl && (
                      <motion.img
                        key={bgImageBlobUrl}
                        src={bgImageBlobUrl}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.6, ease: "easeInOut" }}
                        className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-300"
                        style={{ filter: `blur(${settings.visuals.imageBlur}px)` }}
                        alt="Background"
                      />
                    )}
                  </AnimatePresence>

                  {/* Darkening overlay (controls wallpaper brightness) */}
                  <div
                    className="absolute inset-0 pointer-events-none transition-opacity duration-300"
                    style={{ backgroundColor: 'black', opacity: settings.visuals.imageDarken }}
                  />

                  {/* Top vignette gradient */}
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

      {/* SUPPORT / DONATION BUTTON */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        transition={smoothTransition}
        // Put your own PayPal.Me, PIX, or Linktree link here
        onClick={() => open("https://linktr.ee/flow.downloader")}
        onMouseEnter={(e) => handleTooltipEnter(e, t('support_flow'), "left", "top")}
        onMouseMove={handleTooltipMove}
        onMouseLeave={handleTooltipLeave}
        className="fixed bottom-20 right-6 p-2 bg-rose-500/10 border border-rose-500/30 rounded-full text-rose-400 hover:bg-rose-500 hover:text-white z-20 shadow-xl cursor-pointer pointer-events-auto transition-colors"
      >
        <Heart size={19} />
      </motion.button>

      {/* SETTINGS BUTTON */}
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

      {/* --- MAIN CONTENT --- */}
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

        {/* INTERACTIVE AREA: search bar + download queue */}
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
            onCancelItem={downloader.cancelDownload}
            onRetryItem={downloader.retryDownload}
            onRemoveItem={downloader.removeItem}
          />
        </div>
      </main>

      {/* MODALS: media options, first-run setup, settings */}
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
          <SettingsModal onClose={() => setShowSettings(false)} settings={settings} ytdlpUpdater={ytdlpUpdater} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;