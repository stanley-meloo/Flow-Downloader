import { useState, useRef, useEffect, useMemo } from "react";
import { TAP } from "./components/ui/Motion"; // fast, hard button press
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { LoaderCircleIcon as Loader2, XIcon as X } from "./components/ui/AnimatedIcons"; // animated
import { SettingsIcon as Settings, HeartIcon as Heart, SparklesIcon as Sparkles } from "./components/ui/AnimatedIcons"; // animated (lucide-animated)
import { readFile } from '@tauri-apps/plugin-fs';
import { useTranslation } from 'react-i18next';

import { openUrl as open } from '@tauri-apps/plugin-opener'; // opens external links in the default browser

// Components
import TitleBar from "./components/ui/TitleBar";
import { trackAppStart } from "./utils/analytics";
import Toast from "./components/ui/Toast";
import FloatingLines from "./components/features/FloatingLines";
import { BurstLayer, fireBurst } from "./components/ui/SearchBurst";
import { useBackLayer } from "./utils/mouseNavigation";
import AutoDownloadToggle from "./components/features/AutoDownloadToggle";
import LinkDropZone from "./components/features/LinkDropZone";
import { floatingLinesProps, ghostFibersProps, gradientWavesProps } from "./utils/backgroundProps";
import GradientWaves from "./components/features/GradientWaves";
import { findEngine, engineProps } from "./components/backgrounds/engines";
import GhostFibers from "./components/features/GhostFibers";
import { coverBox } from "./utils/coverBox";
import { findPhoto, framingOf, isVideoPath, mediaBlob } from "./utils/customPhotos";
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
import { isPresetValue, findPreset, useWallpaperPresets } from "./utils/backgrounds";
import { pickTier, ownVideoTiers } from "./utils/videoTiers";
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
  const showToast = (msg, type, params) => toastRef.current?.add(msg, type, params);

  const settings = useSettings();
  const downloader = useDownloader(settings, showToast);
  const closeShown = !!downloader.closePrompt;

  // The window starts hidden (tauri.conf.json "visible": false) and appears
  // only once the saved look is loaded and painted — never a blank frame.
  useEffect(() => {
    if (!settings.loaded) return;
    // A timer, not requestAnimationFrame: a hidden window may not paint frames.
    const timer = setTimeout(() => {
      import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().show()).catch(() => {});
    }, 60);
    return () => clearTimeout(timer);
  }, [settings.loaded]);

  // Anonymous usage statistics: one "app_started" per launch, unless turned
  // off in Settings (utils/analytics.js).
  useEffect(() => {
    if (settings.loaded) trackAppStart(settings.analytics);
  }, [settings.loaded, settings.analytics]);

  // Close confirmation → click a file: close the dialog, glide the queue to
  // that download (centered) and give its card a short glow so it's easy to spot.
  const focusQueueItem = (id) => {
    downloader.cancelClose();
    setTimeout(() => {
      const el = document.querySelector(`[data-ctx="queue-item"][data-ctx-id="${CSS.escape(String(id))}"]`);
      if (!el) return;
      let flashed = false;
      const flash = () => {
        if (flashed) return;
        flashed = true;
        el.classList.remove("queue-spotlight");
        void el.offsetWidth; // restart the animation
        el.classList.add("queue-spotlight");
        setTimeout(() => el.classList.remove("queue-spotlight"), 1800);
      };
      const wrapper = el.closest(".overflow-y-auto");
      if (wrapper?.lenis) {
        wrapper.lenis.scrollTo(el, {
          offset: -(wrapper.clientHeight - el.offsetHeight) / 2, // center it
          duration: 0.8,
          easing: (t) => 1 - Math.pow(1 - t, 4),
          onComplete: flash,
        });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setTimeout(flash, 850); // already in view (no scroll) → still highlight
    }, 220); // after the dialog's exit
  };
  const ytdlpUpdater = useYtdlpUpdater(showToast);
  // App self-update; never installs while something is downloading.
  const downloadingRef = useRef(false);
  downloadingRef.current = downloader.activeDownloads.length > 0 || downloader.waitingCount > 0;
  const appUpdater = useAppUpdater(showToast, () => downloadingRef.current);
  const tooltipApi = useTooltip();
  const { handleTooltipEnter, handleTooltipMove, handleTooltipLeave } = tooltipApi;

  const [showSettings, setShowSettings] = useState(false);

  // Mouse Back / Forward buttons (utils/mouseNavigation.js): Back closes the
  // newest dialog; Forward reopens it.
  useBackLayer(showSettings, () => { setShowSettings(false); return () => setShowSettings(true); });
  useBackLayer(!!downloader.mediaData, () => {
    const data = downloader.mediaData;
    downloader.setMediaData(null);
    return () => downloader.setMediaData(data);
  });
  useBackLayer(closeShown, () => downloader.cancelClose());
  const [selectedFormat, setSelectedFormat] = useState("video");
  // The download card remembers its options between sessions
  // (settings.lastDownloadPreset): the type and folder here, the rest in the card.
  const rememberCard = (partial) => settings.saveSettings({ lastDownloadPreset: partial });
  const chooseFormat = (type) => { setSelectedFormat(type); rememberCard({ formatType: type }); };
  const chooseDownloadPath = (dir) => { downloader.setDownloadPath(dir); rememberCard({ directory: dir }); };
  const restoredFormat = useRef(false);
  useEffect(() => {
    if (!settings.loaded || restoredFormat.current) return;
    restoredFormat.current = true;
    const saved = settings.lastDownloadPreset?.formatType;
    if (["video", "audio", "video_only"].includes(saved)) setSelectedFormat(saved);
  }, [settings.loaded, settings.lastDownloadPreset]);
  const [bgImageBlobUrl, setBgImageBlobUrl] = useState(null);
  // Which setting (bgImage) the image on screen was loaded from. The new file
  // is read asynchronously, so until it's ready the picture still showing is
  // the OLD one — it must keep its own framing (not take the new photo's,
  // which made it jump right before the crossfade).
  const [bgShownPath, setBgShownPath] = useState(null);
  // The user's own photo is framed (position + zoom from Settings) instead of
  // just centered: its natural size and the window size give its box.
  // Natural size of each loaded image (by URL): an image fades in only once its
  // own size is known, so it never appears with another photo's box first.
  const [bgNaturals, setBgNaturals] = useState({});
  const ownPhoto = !!bgShownPath && !isPresetValue(bgShownPath);
  const bgNatural = bgNaturals[bgImageBlobUrl];
  // Video wallpapers (built-in MP4 loops and the user's own videos) play in a
  // <video>; paused while the app is paused (close confirmation), like the
  // interactive backgrounds.
  const bgIsVideo = isPresetValue(bgShownPath) ? !!findPreset(bgShownPath)?.video : isVideoPath(bgShownPath);
  const BgMedia = bgIsVideo ? motion.video : motion.img;
  const bgVideoRef = useRef(null);
  useEffect(() => {
    const v = bgVideoRef.current;
    if (!v) return;
    if (backgroundPaused) v.pause(); else v.play().catch(() => {});
  });
  const [winSize, setWinSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [heartHover, setHeartHover] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false); // dims the background

  const tooltipHandlers = { enter: handleTooltipEnter, move: handleTooltipMove, leave: handleTooltipLeave };

  // The animated backgrounds stop rendering only while the close confirmation
  // covers the window. They stay live (animated and reacting to the mouse)
  // behind the welcome screen, Settings and the video / playlist dialogs,
  // whose liquid glass shows them through.
  const backgroundPaused = closeShown;
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

  // Apply the interface language ("auto" = OS language if supported, else English).
  // The layout is NEVER mirrored (dir stays "ltr"): the app's design (title bar,
  // buttons, toggles, galleries, animations) is built left-to-right and broke
  // when flipped. Arabic text itself still reads right-to-left inside each
  // label (App.css: unicode-bidi: plaintext for right-to-left languages).
  useEffect(() => {
    const lang = resolveLanguage(settings.language);
    i18n.changeLanguage(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = "ltr";
    document.documentElement.toggleAttribute("data-rtl-text", RTL_CODES.includes(lang));
  }, [settings.language, i18n]);

  // --- BACKGROUND IMAGE LOADING ---
  // Which file the wallpaper is shown from: a bundled URL (built-in wallpaper)
  // or a file on disk (wallpaper pack, the user's own photo / video). Videos
  // come in several sizes: the one matching the window's real pixels
  // (utils/videoTiers), re-picked once a resize settles.
  const packVersion = useWallpaperPresets(); // pack loaded → its wallpapers can be shown
  const [tierTick, setTierTick] = useState(0);
  useEffect(() => {
    let timer = 0;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(() => setTierTick((n) => n + 1), 400); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); clearTimeout(timer); };
  }, []);
  const bgPhoto = findPhoto(settings.visuals, settings.visuals?.bgImage);
  const bgZoom = framingOf(bgPhoto).zoom;
  const bgSource = useMemo(() => {
    const img = settings.visuals?.bgImage;
    if (!img) return null;
    if (isPresetValue(img)) {
      const preset = findPreset(img);
      if (!preset) return null;
      const tier = pickTier(preset.tiers);
      return tier ? { url: tier.url, file: tier.file } : { url: preset.url, file: preset.file };
    }
    if (isVideoPath(img)) return { file: pickTier(ownVideoTiers(img, bgPhoto?.tiers), bgZoom).file };
    return { file: img };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.visuals?.bgImage, bgPhoto?.tiers, bgZoom, tierTick, packVersion]);
  const bgSourceKey = bgSource ? bgSource.url || bgSource.file || "" : "";
  // Switching a video to another size keeps its playback position.
  const resumeAt = useRef(null);

  // Resolves bgSource into a usable <img> / <video> src. Bundled files are
  // referenced by URL directly; files on disk are read and exposed as an object URL.
  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;

    const loadBgImage = async () => {
      const img = settings.visuals?.bgImage;
      if (!img || !bgSource) { setBgImageBlobUrl(null); setBgShownPath(null); return; }
      const v = bgVideoRef.current;
      resumeAt.current = v && bgShownPath === img ? { path: img, time: v.currentTime } : null;

      // Built-in wallpaper shipped with the app: its bundled URL.
      if (bgSource.url) {
        setBgImageBlobUrl(bgSource.url);
        setBgShownPath(img);
        return;
      }

      // A file on disk (wallpaper pack, the user's own image or video): read the bytes into a blob URL.
      try {
        const fileBytes = await readFile(bgSource.file);
        if (cancelled) return;
        const blob = mediaBlob(fileBytes, bgSource.file);
        objectUrl = URL.createObjectURL(blob);
        setBgImageBlobUrl(objectUrl);
        setBgShownPath(img);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.visuals?.bgImage, bgSourceKey]);

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

    // Turn Auto Download on / off (the switch in the bottom-left corner).
    if (matchesBind(e, kb.autoDownload)) {
      if (inOtherField || e.repeat) return;
      e.preventDefault();
      const on = !settings.autoDownload;
      settings.saveSettings({ autoDownload: on });
      showToast(on ? "auto_on" : "auto_off", "info");
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

      {/* RESUME BANNER: downloads left unfinished when the app was last closed */}
      <AnimatePresence>
        {downloader.resumable.length > 0 && settings.loaded && !settings.showSetup && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.6 } }}
            exit={{ opacity: 0, y: -12, scale: 0.97, transition: { duration: 0.18 } }}
            className={`fixed ${appUpdater.showBanner ? 'top-[92px]' : 'top-12'} left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 pl-4 pr-1.5 py-1.5 rounded-[14px] bg-zinc-950/80 backdrop-blur-xl border border-white/10 shadow-2xl`}
            role="status"
          >
            <span className="text-[12.5px] font-bold text-zinc-200 whitespace-nowrap">
              {t('resume.message', { n: downloader.resumable.length, defaultValue: 'Unfinished downloads from last time: {{n}}' })}
            </span>
            <button
              onClick={downloader.resumeDownloads}
              className="px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-900 text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer"
            >
              {t('resume.resume', { defaultValue: 'Resume' })}
            </button>
            <button onClick={downloader.dismissResume} className="p-1.5 text-zinc-300 hover:text-white rounded-full hover:bg-white/5 transition-colors cursor-pointer" aria-label={t('update.dismiss', { defaultValue: 'Dismiss' })}>
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* APP UPDATE BANNER (new Flow Downloader version available) */}
      <AnimatePresence>
        {appUpdater.showBanner && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="fixed top-12 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 pl-3 pr-1.5 py-1.5 rounded-[14px] bg-zinc-950/80 backdrop-blur-xl border border-(--accent)/30 shadow-2xl shadow-(--accent-strong)/10"
          >
            <Sparkles size={16} className="text-(--accent) shrink-0" />
            <span className="text-[12.5px] font-bold text-zinc-200 whitespace-nowrap">
              {t('update.available', { version: appUpdater.available?.version, defaultValue: 'Flow Downloader {{version}} is available' })}
            </span>
            <button
              onClick={appUpdater.install}
              disabled={appUpdater.status !== 'idle'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-(--accent-strong) hover:bg-(--accent) disabled:opacity-80 disabled:cursor-wait text-white text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer"
            >
              {appUpdater.status === 'downloading' || appUpdater.status === 'installing'
                ? <><Loader2 size={12} className="animate-spin" />{appUpdater.status === 'downloading' ? `${appUpdater.progress}%` : t('update.installing', { defaultValue: 'Installing…' })}</>
                : t('update.install', { defaultValue: 'Update' })}
            </button>
            {appUpdater.status === 'idle' && (
              <button onClick={appUpdater.dismiss} className="p-1.5 text-zinc-300 hover:text-white rounded-full hover:bg-white/5 transition-colors cursor-pointer" aria-label={t('update.dismiss', { defaultValue: 'Dismiss' })}>
                <X size={14} />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hover tooltips (liquid glass, anchored to the element) */}
      <Tooltip api={tooltipApi} />

      {/* --- BACKGROUND SYSTEM (one engine at a time, crossfaded) --- */}
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

              {/* Engines from the registry (components/backgrounds/engines.js) */}
              {(() => {
                const engine = findEngine(settings.visuals.activeBackground);
                if (!engine) return null;
                const Engine = engine.component;
                return <Engine data-glass-layer="canvas" paused={backgroundPaused} {...engineProps(engine, settings.visuals)} />;
              })()}

              {/* Engine: Gradient Waves (React Bits) */}
              {settings.visuals.activeBackground === 'gradientWaves' && (
                <GradientWaves
                  data-glass-layer="canvas"
                  paused={backgroundPaused}
                  {...gradientWavesProps(settings.visuals)}
                />
              )}

              {/* Engine: Ghost Fibers (React Bits) */}
              {settings.visuals.activeBackground === 'ghostFibers' && (
                <GhostFibers
                  data-glass-layer="canvas"
                  paused={backgroundPaused}
                  {...ghostFibersProps(settings.visuals)}
                />
              )}

              {/* Engine: Floating Lines (interactive WebGL lines) */}
              {settings.visuals.activeBackground === 'floatingLines' && (
                <FloatingLines
                  data-glass-layer="canvas"
                  paused={backgroundPaused}
                  {...floatingLinesProps(settings.visuals)}
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
                      <BgMedia
                        key={bgImageBlobUrl}
                        src={bgImageBlobUrl}
                        data-glass-layer={bgIsVideo ? "video" : "image"}
                        {...(bgIsVideo ? { ref: bgVideoRef, autoPlay: true, muted: true, loop: true, playsInline: true, disablePictureInPicture: true } : {})}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: ownPhoto && !bgNatural ? 0 : 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.6, ease: "easeInOut" }}
                        // Natural size: <img> on load, <video> once its metadata is read.
                        {...{ [bgIsVideo ? "onLoadedMetadata" : "onLoad"]: (e) => {
                          const el = e.currentTarget;
                          const w = el.videoWidth || el.naturalWidth;
                          const h = el.videoHeight || el.naturalHeight;
                          const url = el.currentSrc || el.src;
                          setBgNaturals((m) => (m[url]?.w === w && m[url]?.h === h ? m : { ...m, [url]: { w, h } }));
                          // Same video in another size: continue where it was.
                          if (bgIsVideo && resumeAt.current?.path === bgShownPath && el.duration) {
                            el.currentTime = resumeAt.current.time % el.duration;
                            resumeAt.current = null;
                          }
                        } }}
                        // Built-in wallpapers: centered cover. The user's own photo:
                        // their framing (utils/coverBox — same math as the editor).
                        className={`absolute transition-[filter] duration-300 ${ownPhoto ? "max-w-none" : "inset-0 w-full h-full object-cover"}`}
                        style={{
                          filter: `blur(${settings.visuals.imageBlur}px)`,
                          ...(ownPhoto ? (() => {
                            const f = framingOf(findPhoto(settings.visuals, bgShownPath));
                            const b = coverBox(bgNatural?.w, bgNatural?.h, winSize.w, winSize.h, f.x, f.y, f.zoom);
                            return { left: b.left, top: b.top, width: b.width, height: b.height };
                          })() : {}),
                        }}
                        {...(bgIsVideo ? {} : { alt: "" })}
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
        {/* A CSS transition, not a framer-motion animation: the glass reads this
            layer's opacity every frame, and a CSS transition reports exactly
            the value painted in that frame — framer-motion's value could be one
            frame behind, so the glass briefly looked brighter than the
            background while the dimming faded (a flash of light). */}
        <div
          data-glass-layer="fill"
          data-glass-dim /* the eyedropper reads the background without this dimming */
          className="absolute inset-0 bg-black pointer-events-none"
          style={{
            opacity: settings.showSetup ? 0.55 : (showSettings || downloader.mediaData || closeShown) ? 0.45 : searchFocused ? 0.35 : 0,
            transition: "opacity 0.4s ease-out",
            willChange: "opacity", // always its own layer: no re-layering when the fade starts/ends
          }}
        />
      </div>

      {/* CREDIT (vertical, above the heart): where the background comes from.
          Interactive backgrounds → React Bits; built-in wallpapers → their site
          (preset.source: motionbgs.com for the MP4 loops, wallpaperaccess.com
          for the rest).
          None for the user's own photos or a plain color. The key changes with the source, so
          switching between the two crossfades. */}
      {(() => {
        const v = settings.visuals;
        const by = (name) => t('bg_credit_by', { name, defaultValue: 'Background by {{name}}' });
        const preset = v.activeBackground === 'static' ? findPreset(v.bgImage) : null;
        const SOURCES = {
          wallpaperaccess: { url: 'https://wallpaperaccess.com', name: 'WallpaperAccess' },
          motionbgs: { url: 'https://motionbgs.com', name: 'MotionBGs' },
        };
        const src = preset && SOURCES[preset.source];
        const credit = v.activeBackground !== 'static'
          ? { id: 'reactbits', url: 'https://reactbits.dev', text: by('ReactBits') }
          : src
            ? { id: preset.source, url: src.url, text: by(src.name) }
            : null;
        return (
          <AnimatePresence mode="wait">
            {credit && (
              <motion.div
                key={credit.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.5, delay: performance.now() < 4000 ? INTRO.heart + 0.2 : 0 } }} /* waits for the intro only at startup */
                exit={{ opacity: 0, transition: { duration: 0.25 } }}
                className="fixed right-6 bottom-[137px] w-[35px] z-20 flex justify-center pointer-events-none"
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => { e.currentTarget.blur(); if (credit.url) open(credit.url); }}
                  className={`pointer-events-auto ${credit.url ? "cursor-pointer" : "cursor-default"} select-none whitespace-nowrap uppercase text-[10px] font-medium tracking-[0.12em] text-white/25 hover:text-white/60 transition-colors duration-300`}
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }} /* reads bottom → top */
                >
                  {credit.text}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        );
      })()}

      {/* SUPPORT / DONATION BUTTON */}
      <motion.button
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1, transition: { type: "spring", stiffness: 260, damping: 20, delay: INTRO.heart } }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.97, transition: TAP }}
        transition={smoothTransition}
        // Put your own PayPal.Me, PIX, or Linktree link here
        onMouseDown={(e) => e.preventDefault()} /* no lingering focus after a click */
        onClick={(e) => {
          // A burst of light from the heart (same explosion as a search), then the link.
          const r = e.currentTarget.getBoundingClientRect();
          fireBurst(r.left + r.width / 2, r.top + r.height / 2);
          e.currentTarget.blur();
          open("https://linktr.ee/flow.downloader");
        }}
        onMouseEnter={(e) => tooltipApi.show(e.currentTarget, t('support_flow'), "left")} /* always to the left of the heart */
        onMouseMove={handleTooltipMove}
        onMouseLeave={handleTooltipLeave}
        onHoverStart={() => setHeartHover(true)}
        onHoverEnd={() => setHeartHover(false)}
        className="fixed bottom-[78px] right-6 flex rounded-full z-20 shadow-xl cursor-pointer pointer-events-auto group"
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

      {/* Explosions fired with fireBurst() (support heart / menu item) */}
      <BurstLayer />

      {/* Drag a link onto the window to download it (only on the home screen) */}
      <LinkDropZone
        enabled={!downloader.analyzing && !downloader.mediaData && !showSettings && !settings.showSetup && !closeShown}
        onLink={(url) => downloader.analyzeLink(url)}
      />

      {/* AUTO DOWNLOAD SWITCH (bottom-left corner): skip the card, use the last card's options */}
      <AutoDownloadToggle
        active={settings.autoDownload}
        onToggle={() => settings.saveSettings({ autoDownload: !settings.autoDownload })}
        label={withBind(t('auto_download.label', { defaultValue: 'Auto Download' }), (settings.keybinds || DEFAULT_KEYBINDS).autoDownload)}
        info={t('auto_download.info', { defaultValue: "Skips the download card: new videos go straight to the queue with the same options as your last download (type, quality and format). Playlists still open the card. Turn it off to choose the options again." })}
        tooltip={{ show: tooltipApi.show, leave: handleTooltipLeave }}
        glassPaused={glassPaused}
        delay={INTRO.settings + 0.1}
      />

      {/* SETTINGS BUTTON */}
      <motion.button
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1, transition: { type: "spring", stiffness: 260, damping: 20, delay: INTRO.settings } }}
        whileHover={{ scale: 1.1 }} // the gear itself turns (animated icon)
        transition={smoothTransition}
        onMouseDown={(e) => e.preventDefault()} /* a mouse click must not leave it focused (Enter would reopen Settings) */
        onClick={(e) => { e.currentTarget.blur(); setShowSettings(true); }}
        onMouseEnter={(e) => handleTooltipEnter(e, withBind(t('settings.title'), (settings.keybinds || DEFAULT_KEYBINDS).openSettings), "left", "top")}
        onMouseMove={handleTooltipMove}
        onMouseLeave={handleTooltipLeave}
        data-contrast /* the gear turns dark on a light background (utils/contrastWatch.js) */
        className="settings-gear fixed bottom-[30px] right-6 rounded-full text-zinc-300 hover:text-white transition-colors z-20 shadow-xl cursor-pointer pointer-events-auto group"
      >
        <LiquidGlass
          variant="dark"
          paused={glassPaused}
          settings={ROUND_GLASS}
          className="p-2 rounded-full backdrop-blur-md" /* no CSS ring: the glass draws its own rim */
          fallbackClassName="bg-zinc-900/50 backdrop-blur-xl ring-1 ring-white/10"
        >
          <Settings size={20} active={showSettings} /* stays turned while Settings is open */ />
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
            cardOpen={!!downloader.mediaData}
            renewSignal={downloader.autoAdded}
          />

          <QueueList
            queue={downloader.queue}
            tooltipHandlers={tooltipHandlers}
            showToast={showToast}
            onCancelItem={downloader.cancelDownload}
            onRetryItem={downloader.retryDownload}
            onRemoveItem={downloader.removeItem}
            onResolveConflict={downloader.resolveConflict}
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
              setSelectedFormat={chooseFormat}
              downloadPath={downloader.downloadPath}
              setDownloadPath={chooseDownloadPath}
              showToast={showToast}
              tooltipHandlers={tooltipHandlers}
              defaultQuality={settings.defaultQuality}
              keybinds={settings.keybinds}
              preset={settings.lastDownloadPreset}
              remember={rememberCard}
            />
          ) : (
            <MediaModal
              mediaData={downloader.mediaData}
              close={() => downloader.setMediaData(null)}
              onConfirm={downloader.startDownload}
              selectedFormat={selectedFormat}
              setSelectedFormat={chooseFormat}
              downloadPath={downloader.downloadPath}
              setDownloadPath={chooseDownloadPath}
              showToast={showToast}
              tooltipHandlers={tooltipHandlers}
              defaultQuality={settings.defaultQuality}
              keybinds={settings.keybinds}
              preset={settings.lastDownloadPreset}
              remember={rememberCard}
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
            onSelect={focusQueueItem}
          />
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}

export default App;