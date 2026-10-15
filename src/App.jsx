import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { SettingsIcon as Settings, HeartIcon as Heart, SparklesIcon as Sparkles } from "./components/ui/AnimatedIcons"; // animated (lucide-animated)
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
import CloseConfirmModal from "./components/modals/CloseConfirmModal";

// Hooks & Utils
import useSettings from "./hooks/useSettings";
import useDownloader from "./hooks/useDownloader";
import useYtdlpUpdater from "./hooks/useYtdlpUpdater";
import useAppUpdater from "./hooks/useAppUpdater";
import useTooltip from "./hooks/useTooltip";
import useContextMenuSections from "./hooks/useContextMenuSections";
import { handlePaste } from "./utils/fileSystem";
import { isPresetValue, findPreset } from "./utils/backgrounds";
import LiquidGlass from "./components/ui/liquidGlass/LiquidGlass";
import FilmGrain from "./components/ui/FilmGrain";
import ContextMenu from "./components/ui/ContextMenu";
import Tooltip from "./components/ui/Tooltip";
import HeroTitle from "./components/features/HeroTitle";

// App entrance timeline (seconds after launch): the window fades in first, then
// each element appears in turn. The search bar uses INTRO.search (SearchInput).
// They start after a short pause so the startup work is done and they play smoothly.
// The title is written letter by letter (~1 s, HeroTitle.jsx), then its tagline
// appears; the search bar and the round buttons follow.
const INTRO = { titleBar: 0.35, title: 0.45, search: 1.45, heart: 1.65, settings: 1.75 };
const INTRO_EASE = [0.22, 1, 0.36, 1]; // soft "ease-out-quint"

// Liquid-glass materials for the round buttons (bottom-right).
// The heart glass is tinted rose: the refracted background is lifted a little
// (brightness) and multiplied by a red tint, stronger on hover.
// coreOpacity: how much of the flat middle is glass (the rest shows the live background).
const ROUND_GLASS = { blur: 0.65, darkTint: 0.3, edgeHighlight: 0.14, coreOpacity: 0.35 };
const HEART_GLASS = { blur: 0.65, darkTint: 0.12, edgeHighlight: 0.16, brightness: 0.06, tintColor: [1.0, 0.36, 0.46], tintStrength: 0.65, coreOpacity: 0.55 };
const HEART_GLASS_HOVER = { ...HEART_GLASS, darkTint: 0.02, brightness: 0.2, tintStrength: 0.9 };
import { DEFAULT_KEYBINDS, matchesBind, eventToCombo, isTypingCombo, withBind } from "./utils/keybinds";
import { resolveLanguage, RTL_CODES } from "./locales/languages";

const smoothTransition = { type: "spring", stiffness: 200, damping: 25 };

function App() {
  const { t, i18n } = useTranslation();
  const toastRef = useRef(null);
  const showToast = (msg, type) => toastRef.current?.add(msg, type);

  const settings = useSettings();
  const downloader = useDownloader(settings, showToast);
  const ytdlpUpdater = useYtdlpUpdater(showToast);
  // App self-update; never installs while something is downloading.
  const downloadingRef = useRef(false);
  downloadingRef.current = downloader.activeDownloads.length > 0 || downloader.waitingCount > 0;
  const appUpdater = useAppUpdater(showToast, () => downloadingRef.current);
  const tooltipApi = useTooltip();
  const { handleTooltipEnter, handleTooltipMove, handleTooltipLeave } = tooltipApi;

  const [showSettings, setShowSettings] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState("video");
  const [bgImageBlobUrl, setBgImageBlobUrl] = useState(null);
  const [heartHover, setHeartHover] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false); // dims the background

  const tooltipHandlers = { enter: handleTooltipEnter, move: handleTooltipMove, leave: handleTooltipLeave };

  // The animated backgrounds stop rendering only while the close confirmation
  // covers the window. They stay live (animated and reacting to the mouse)
  // behind the welcome screen, Settings and the video / playlist dialogs,
  // whose liquid glass shows them through.
  const backgroundPaused = !!downloader.closePrompt;
  // The main-screen glasses (search bar, round buttons) stop rendering while
  // any dialog covers them — including Settings, whose own glass needs the GPU.
  const glassPaused = backgroundPaused || showSettings || !!downloader.mediaData || !!settings.showSetup;
  // Right-click menu items for the element under the pointer (queue item, search bar…).
  const buildMenuSections = useContextMenuSections({
    downloader,
    settings,
    openSettings: () => setShowSettings(true),
    showToast,
    modalOpen: !!(downloader.mediaData || settings.showSetup || showSettings || downloader.closePrompt),
  });

  // Apply the interface language ("auto" = OS language if supported, else English)
  // and mirror the layout for right-to-left languages (Arabic).
  useEffect(() => {
    const lang = resolveLanguage(settings.language);
    i18n.changeLanguage(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL_CODES.includes(lang) ? "rtl" : "ltr";
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

      // Built-in preset wallpaper ("@preset:<id>"): use its bundled URL.
      if (isPresetValue(img)) {
        setBgImageBlobUrl(findPreset(img)?.url || null);
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

  // --- GLOBAL KEYBOARD SHORTCUTS (main window) ---
  // Bindings come from Settings → Shortcuts (defaults: Enter = search,
  // Ctrl/Cmd+V = paste, Ctrl/Cmd+A = select bar, O = settings).
  // They work even when the search bar isn't focused. The handler lives in a ref
  // reassigned on every render, so it always reads the latest state/bindings
  // without re-binding the window listener. Modals handle their own shortcuts.
  const keyHandlerRef = useRef(() => {});
  keyHandlerRef.current = (e) => {
    const kb = settings.keybinds || DEFAULT_KEYBINDS;
    const tag = e.target?.tagName;
    const inSearchBar = e.target?.id === 'flow-search-input';
    const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
    const inOtherField = inEditable && !inSearchBar;
    const modalOpen = downloader.mediaData || settings.showSetup || showSettings || downloader.closePrompt;
    if (modalOpen) return;

    // Single-key shortcuts (like "O") don't fire while typing in a text field:
    // there the key just types its character (e.g. the "o" in "youtube.com").
    const combo = eventToCombo(e);
    if (inEditable && isTypingCombo(combo)) return;

    // Search: analyze the link (also from inside the search bar itself).
    if (matchesBind(e, kb.search)) {
      if (inOtherField || tag === 'BUTTON' || downloader.analyzing || e.repeat) return;
      e.preventDefault();
      downloader.analyzeLink();
      return;
    }

    // Paste the clipboard link into the search bar. If the binding is the native
    // Ctrl+V and focus is in a field, let the browser paste normally.
    if (matchesBind(e, kb.paste)) {
      if (inOtherField || (inEditable && kb.paste === 'Ctrl+V')) return;
      e.preventDefault();
      handlePaste(downloader.setUrl, showToast);
      return;
    }

    // Select only the search bar contents (instead of the whole page).
    if (matchesBind(e, kb.selectBar)) {
      if (inOtherField || (inEditable && kb.selectBar === 'Ctrl+A')) return; // native select-all
      const input = document.getElementById('flow-search-input');
      if (input) {
        e.preventDefault();
        input.focus();
        input.select();
      }
      return;
    }

    // Open the settings window.
    if (matchesBind(e, kb.openSettings)) {
      if (inOtherField || e.repeat) return;
      e.preventDefault();
      setShowSettings(true);
    }
  };
  useEffect(() => {
    const onKeyDown = (e) => keyHandlerRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Wait for the saved settings before showing the app. Otherwise it would
  // start with the default look and, a moment later, switch to the saved one
  // (other background / colors / wallpaper) — a sudden brightness jump right
  // after the smooth entrance. Reading the settings file takes a few ms.
  if (!settings.loaded) {
    return <div className="w-full h-full bg-[#09090b]" />;
  }

  return (
    // reducedMotion="user": if the OS "reduce motion" setting is on, framer-motion
    // drops transform/layout animations (keeping simple fades) across the whole app.
    <MotionConfig reducedMotion="user">
    {/* App entrance: the whole window fades in and settles from a slight zoom
        ("app-enter" in App.css), then the elements appear one after another
        (see INTRO). The window animation is pure CSS on purpose: it runs on the
        GPU compositor, so it stays smooth even while the app is still busy
        starting up (WebGL shaders, wallpapers...) — a JS animation would freeze
        during that work and then jump to its final size. */}
    <div className="app-enter isolate w-full h-full bg-zinc-950 overflow-hidden flex flex-col relative">

      {/* TITLE BAR (custom window chrome: drag region + min/max/close) */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: INTRO_EASE, delay: INTRO.titleBar }}
        className="pointer-events-auto z-50"
      >
        <TitleBar />
      </motion.div>
      <Toast ref={toastRef} language={settings.language} />
      {/* Custom right-click menu (replaces the webview default) */}
      <ContextMenu showToast={showToast} buildSections={buildMenuSections} />

      {/* Film grain + light chromatic aberration over everything (Settings → Appearance) */}
      <FilmGrain intensity={settings.visuals?.filmGrain} />

      {/* APP UPDATE BANNER (new Flow Downloader version available) */}
      <AnimatePresence>
        {appUpdater.showBanner && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="fixed top-12 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 pl-3 pr-1.5 py-1.5 rounded-[14px] bg-zinc-950/80 backdrop-blur-xl border border-indigo-400/30 shadow-2xl shadow-indigo-500/10"
          >
            <Sparkles size={16} className="text-indigo-400 shrink-0" />
            <span className="text-[12.5px] font-bold text-zinc-200 whitespace-nowrap">
              {t('update.available', { version: appUpdater.available?.version, defaultValue: 'Flow Downloader {{version}} is available' })}
            </span>
            <button
              onClick={appUpdater.install}
              disabled={appUpdater.status !== 'idle'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-80 disabled:cursor-wait text-white text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer"
            >
              {appUpdater.status === 'downloading' || appUpdater.status === 'installing'
                ? <><Loader2 size={12} className="animate-spin" />{appUpdater.status === 'downloading' ? `${appUpdater.progress}%` : t('update.installing', { defaultValue: 'Installing…' })}</>
                : t('update.install', { defaultValue: 'Update' })}
            </button>
            {appUpdater.status === 'idle' && (
              <button onClick={appUpdater.dismiss} className="p-1.5 text-zinc-500 hover:text-white rounded-full hover:bg-white/5 transition-colors cursor-pointer" aria-label={t('update.dismiss', { defaultValue: 'Dismiss' })}>
                <X size={14} />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hover tooltips (liquid glass, anchored to the element) */}
      <Tooltip api={tooltipApi} />

      {/* --- BACKGROUND SYSTEM (one of three engines, crossfaded) --- */}
      {/* data-glass-*: lets the liquid-glass search bar re-draw (refract) exactly
          what is behind it — see components/ui/liquidGlass/backdrop.js */}
      <div className="fixed inset-0 z-0 bg-[#09090b]" data-glass-backdrop data-glass-layer="fill" data-glass-static={backgroundPaused ? "true" : "false"}>
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
                  data-glass-layer="canvas"
                  paused={backgroundPaused}
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
                  data-glass-layer="canvas"
                  paused={backgroundPaused}
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
                  data-glass-layer="fill"
                  className="w-full h-full relative overflow-hidden transition-colors duration-500"
                  style={{ backgroundColor: settings.visuals.staticColor }}
                >
                  {/* Wallpaper image (with optional blur) — smooth crossfade on change */}
                  <AnimatePresence>
                    {bgImageBlobUrl && (
                      <motion.img
                        key={bgImageBlobUrl}
                        src={bgImageBlobUrl}
                        data-glass-layer="image"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.6, ease: "easeInOut" }}
                        className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-300"
                        style={{ filter: `blur(${settings.visuals.imageBlur}px)` }}
                        alt=""
                      />
                    )}
                  </AnimatePresence>

                  {/* Darkening overlay (controls wallpaper brightness) */}
                  <div
                    data-glass-layer="fill"
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
                        data-glass-layer="gradient"
                        data-glass-color={settings.visuals.staticGradientColor}
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

        {/* Dim layer: darkens the background while the search bar is focused
            (focus) or the Settings dialog is open. It's part of the backdrop, so
            every liquid glass refracts the darkened background too — this keeps
            the Settings glass consistent with what's around it. */}
        <motion.div
          data-glass-layer="fill"
          className="absolute inset-0 bg-black pointer-events-none"
          initial={false}
          animate={{ opacity: settings.showSetup ? 0.55 : (showSettings || downloader.mediaData) ? 0.45 : searchFocused ? 0.35 : 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>

      {/* SUPPORT / DONATION BUTTON */}
      <motion.button
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1, transition: { type: "spring", stiffness: 260, damping: 20, delay: INTRO.heart } }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        transition={smoothTransition}
        // Put your own PayPal.Me, PIX, or Linktree link here
        onClick={() => open("https://linktr.ee/flow.downloader")}
        onMouseEnter={(e) => handleTooltipEnter(e, t('support_flow'), "left", "top")}
        onMouseMove={handleTooltipMove}
        onMouseLeave={handleTooltipLeave}
        onHoverStart={() => setHeartHover(true)}
        onHoverEnd={() => setHeartHover(false)}
        className="fixed bottom-20 right-6 rounded-full z-20 shadow-xl cursor-pointer pointer-events-auto group"
      >
        {/* Rose-tinted liquid glass (brighter and redder on hover) */}
        <LiquidGlass
          variant="dark"
          paused={glassPaused}
          settings={heartHover ? HEART_GLASS_HOVER : HEART_GLASS}
          className={`p-2 rounded-full backdrop-blur-md transition-colors duration-300 ${heartHover ? 'text-white' : 'text-rose-400'}`} /* no CSS ring: the glass draws its own rim */
          fallbackClassName="bg-rose-500/10 backdrop-blur-xl ring-1 ring-rose-500/30"
        >
          <Heart size={19} />
        </LiquidGlass>
      </motion.button>

      {/* SETTINGS BUTTON */}
      <motion.button
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1, transition: { type: "spring", stiffness: 260, damping: 20, delay: INTRO.settings } }}
        whileHover={{ scale: 1.1 }} // the gear itself turns (animated icon)
        transition={smoothTransition}
        onClick={() => setShowSettings(true)}
        onMouseEnter={(e) => handleTooltipEnter(e, withBind(t('settings.title'), (settings.keybinds || DEFAULT_KEYBINDS).openSettings), "left", "top")}
        onMouseMove={handleTooltipMove}
        onMouseLeave={handleTooltipLeave}
        className="fixed bottom-6 right-6 rounded-full text-zinc-400 hover:text-white transition-colors z-20 shadow-xl cursor-pointer pointer-events-auto group"
      >
        <LiquidGlass
          variant="dark"
          paused={glassPaused}
          settings={ROUND_GLASS}
          className="p-2 rounded-full backdrop-blur-md" /* no CSS ring: the glass draws its own rim */
          fallbackClassName="bg-zinc-900/50 backdrop-blur-xl ring-1 ring-white/10"
        >
          <Settings size={20} />
        </LiquidGlass>
      </motion.button>

      {/* --- MAIN CONTENT --- */}
      <main className="flex-1 flex flex-col items-center pt-24 px-6 w-full  max-w-4xl mx-auto z-10 h-full pointer-events-none">
        {/* LOGO */}
        {/* Written letter by letter, then the tagline appears (HeroTitle.jsx) */}
        <HeroTitle subtitle={t('hero.subtitle')} delay={INTRO.title} />

        {/* INTERACTIVE AREA: search bar + download queue */}
        <div className="w-full max-w-2xl pointer-events-auto flex flex-col items-center gap-0 flex-1 min-h-0">
          <SearchInput
            url={downloader.url}
            setUrl={downloader.setUrl}
            analyzing={downloader.analyzing}
            onAnalyze={downloader.analyzeLink}
            onPaste={() => handlePaste(downloader.setUrl, showToast)}
            tooltipHandlers={tooltipHandlers}
            keybinds={settings.keybinds}
            onFocusChange={setSearchFocused}
            glassPaused={glassPaused}
          />

          <QueueList
            queue={downloader.queue}
            tooltipHandlers={tooltipHandlers}
            showToast={showToast}
            onCancelItem={downloader.cancelDownload}
            onRetryItem={downloader.retryDownload}
            onRemoveItem={downloader.removeItem}
            glassPaused={glassPaused}
            dimmed={searchFocused}
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
              keybinds={settings.keybinds}
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
              keybinds={settings.keybinds}
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
          <SettingsModal onClose={() => setShowSettings(false)} settings={settings} ytdlpUpdater={ytdlpUpdater} appUpdater={appUpdater} showToast={showToast} />
        )}
      </AnimatePresence>

      {/* Close confirmation (shown when closing the app while downloads run) */}
      <AnimatePresence>
        {downloader.closePrompt && (
          <CloseConfirmModal
            items={downloader.activeDownloads}
            waitingCount={downloader.waitingCount}
            closing={downloader.closing}
            onConfirm={downloader.confirmClose}
            onCancel={downloader.cancelClose}
          />
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}

export default App;