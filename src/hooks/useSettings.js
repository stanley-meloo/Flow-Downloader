import { useState, useEffect, useRef } from "react";
import { exists, readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { downloadDir } from "@tauri-apps/api/path";
import i18n from "../locales/i18n";
import { ANIMATED_PRESETS, STATIC_PRESETS, presetValue, normalizePresetValue, wallpaperPackReady } from "../utils/backgrounds";
import { DEFAULT_KEYBINDS, keybindOverrides, resolveKeybinds } from "../utils/keybinds";
import { pickFolder } from "../utils/folderPicker";
import { ENGINE_IDS } from "../components/backgrounds/engines";

const CONFIG_FILE = "settings.json";
const SAVE_DEBOUNCE_MS = 400;

// Every background engine App.jsx can render (saved values outside this list
// are reset on load).
const KNOWN_BACKGROUNDS = ['floatingLines', 'ghostFibers', 'gradientWaves', ...ENGINE_IDS, 'static'];

const DEFAULT_VISUALS = {
  activeBackground: 'floatingLines', // 'floatingLines', 'ghostFibers', 'gradientWaves', an engine from components/backgrounds/engines.js (interactive) or 'static' (GIF / color / gradient / photo)

  // Floating Lines
  lineCount: 6,
  lineDistance: 1,
  bendRadius: 2.5,
  showColors: false,

  // Static / Image
  staticColor: "#09090b",
  bgImage: null,
  staticGradientEnabled: true,
  staticGradientColor: "#000000",
  imageDarken: 0.0,
  imageBlur: 0,

  // Randomize the wallpaper on each app launch (disabled by default).
  // One flag per gallery so the user can opt in per category.
  randomGif: false,
  randomJpg: false,
  randomCustom: false,

  // The user's own wallpapers ({ id, path, x, y, zoom, thumb }) — utils/customPhotos.js
  customPhotos: [],

  // Film grain + light chromatic aberration over the whole app: intensity
  // 0–100 (0 = off). Older versions saved true/false (see grainIntensity()).
  filmGrain: 15
};

// Settings of features that were removed (old background engines etc.). They
// are dropped on load, so the next save writes a clean settings.json.
const OBSOLETE_VISUAL_KEYS = /^(cb_|ga_|pw_|sh_)|^(randomNipp|customColors|bendStrength|shaderSpeed|gw_grain|bgPosX|bgPosY|bgZoom)$/;
const withoutObsolete = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !OBSOLETE_VISUAL_KEYS.test(k)));

// Picks a random wallpaper from the enabled galleries. This only affects the
// current session (the saved bgImage on disk is left untouched).
// Random wallpaper on startup — a "shuffle bag", like a music player's
// shuffle: every wallpaper of the gallery is shown once, in a random order,
// before any of them comes back; a new round never starts with the one just
// shown. (A plain random pick each launch repeated the same few wallpapers,
// sometimes several launches in a row.) The bag is kept in localStorage per
// gallery; wallpapers added or removed since are taken into account.
//
// Only the gallery of the wallpaper in use counts (its switch can only be
// turned on while one of its wallpapers is the background — SettingsModal);
// a flag left on for another gallery is ignored.
const BAG_KEY = "fd-wallpaper-bag";

// Unbiased random integer in [0, n) (crypto when available).
function randomInt(n) {
  if (globalThis.crypto?.getRandomValues) {
    const max = Math.floor(0x100000000 / n) * n; // rejection sampling: no modulo bias
    const buf = new Uint32Array(1);
    do { globalThis.crypto.getRandomValues(buf); } while (buf[0] >= max);
    return buf[0] % n;
  }
  return Math.floor(Math.random() * n);
}

// Fisher–Yates shuffle (new array).
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Next wallpaper of `pool` (array of saved values) from the gallery's bag.
function nextFromBag(gallery, pool, current) {
  let bags = {};
  try { bags = JSON.parse(localStorage.getItem(BAG_KEY) || "{}") || {}; } catch { bags = {}; }
  const bag = bags[gallery] || {};
  const inPool = new Set(pool);
  // Still to show this round (wallpapers removed since are dropped).
  let queue = (Array.isArray(bag.queue) ? bag.queue : []).filter((x) => inPool.has(x));
  // Wallpapers added since the round started join it at a random place.
  const known = new Set(Array.isArray(bag.seen) ? bag.seen : []);
  for (const x of pool) {
    if (!known.has(x) && !queue.includes(x)) queue.splice(randomInt(queue.length + 1), 0, x);
  }
  const last = bag.last ?? current;
  if (queue.length === 0) {
    // New round: everything, shuffled — never starting with the last one shown.
    queue = shuffled(pool);
    if (queue.length > 1 && queue[0] === last) {
      const j = 1 + randomInt(queue.length - 1);
      [queue[0], queue[j]] = [queue[j], queue[0]];
    }
  }
  // Never the one shown last time again right away.
  if (queue.length > 1 && queue[0] === last) queue.push(queue.shift());
  const pick = queue.shift();
  bags[gallery] = { queue, seen: pool, last: pick };
  try { localStorage.setItem(BAG_KEY, JSON.stringify(bags)); } catch { /* storage unavailable */ }
  return pick;
}

let sessionPick = null; // this launch's random pick (see below)

function pickRandomWallpaper(v) {
  if (v.activeBackground !== 'static' || !v.bgImage) return v;
  const values = (list) => list.map((p) => presetValue(p));
  const photos = (v.customPhotos || []).map((p) => p.path);
  const galleries = [
    { id: 'animated', on: v.randomGif, pool: values(ANIMATED_PRESETS) },
    { id: 'static', on: v.randomJpg, pool: values(STATIC_PRESETS) },
    { id: 'custom', on: v.randomCustom, pool: photos },
  ];
  const g = galleries.find((x) => x.on && x.pool.includes(v.bgImage));
  if (!g || g.pool.length < 2) return v;
  // One pick per launch: the settings can be loaded twice at startup (React
  // StrictMode runs effects twice in development), and a second pick moved
  // the bag on again — with two wallpapers it always landed back on the
  // saved one, so the random wallpaper never seemed to change.
  const key = `${g.id}|${v.bgImage}`;
  if (sessionPick?.key === key && g.pool.includes(sessionPick.pick)) return { ...v, bgImage: sessionPick.pick, activeBackground: 'static' };
  const pick = nextFromBag(g.id, g.pool, v.bgImage);
  sessionPick = { key, pick };
  return pick ? { ...v, bgImage: pick, activeBackground: 'static' } : v;
}

// Writes a pending (debounced) save right away. Called before the window is
// destroyed (useDownloader), so a change made just before closing isn't lost.
let flushPending = async () => {};
export const flushPendingSettings = () => flushPending();

// Dev aid: true = show the first-run setup on every launch (for styling it).
const FORCE_SETUP = false;

export default function useSettings() {
  const [defaultPath, setDefaultPath] = useState("");
  const [loaded, setLoaded] = useState(false); // saved settings applied
  const [playlistLimit, setPlaylistLimit] = useState(10);
  const [maxConcurrent, setMaxConcurrent] = useState(5);
  const [cookieBrowser, setCookieBrowser] = useState(""); // "" = disabled; else chrome/firefox/edge/...
  const [cookieFile, setCookieFile] = useState("");       // path to a cookies.txt file (takes priority)
  const [autoPaste, setAutoPaste] = useState(true);
  const [analytics, setAnalytics] = useState(true);
  const [notifications, setNotifications] = useState(true); // false = only important notifications (App.jsx)     // anonymous usage statistics (utils/analytics.js)       // auto-fill the bar from the clipboard
  const [defaultQuality, setDefaultQuality] = useState("1080p"); // Full HD
  const [language, setLanguage] = useState("auto");
  const [showSetup, setShowSetup] = useState(false);
  // Auto Download (toggle on the home screen): skip the download card and use
  // the remembered card options. lastDownloadPreset = what the download card
  // remembers between sessions: { formatType, res, audio, ext, exts: { audio,
  // video }, directory } — updated as the user changes them in the card.
  const [autoDownload, setAutoDownload] = useState(false);
  const [lastDownloadPreset, setLastDownloadPreset] = useState(null);

  const [visuals, setVisuals] = useState(DEFAULT_VISUALS);
  const [keybinds, setKeybinds] = useState(DEFAULT_KEYBINDS); // user-configurable shortcuts

  // Authoritative in-memory copy of the whole config file.
  const configRef = useRef({});
  const saveTimer = useRef(null);

  // Synchronize the language with i18next
  useEffect(() => {
    if (language && language !== 'auto') {
      const langMap = { 'pt-BR': 'pt', 'en-US': 'en', 'es-ES': 'es' };
      i18n.changeLanguage(langMap[language] || language);
    }
  }, [language]);

  useEffect(() => {
    async function loadConfig() {
      try {
        // The downloaded wallpaper pack first: a saved wallpaper from it must
        // be known when the saved background is checked below.
        await wallpaperPackReady;
        const fileExists = await exists(CONFIG_FILE, { baseDir: BaseDirectory.AppConfig });
        if (fileExists) {
          const content = await readTextFile(CONFIG_FILE, { baseDir: BaseDirectory.AppConfig });
          const config = JSON.parse(content);
          if (config.visuals) config.visuals = withoutObsolete(config.visuals);
          configRef.current = config;

          if (config.downloadPath) setDefaultPath(config.downloadPath);
          if (config.playlistLimit !== undefined) setPlaylistLimit(config.playlistLimit);
          if (config.maxConcurrent !== undefined) setMaxConcurrent(config.maxConcurrent);
          if (config.cookieBrowser !== undefined) setCookieBrowser(config.cookieBrowser);
          if (config.cookieFile !== undefined) setCookieFile(config.cookieFile);
          if (config.autoPaste !== undefined) setAutoPaste(config.autoPaste);
          if (config.analytics !== undefined) setAnalytics(config.analytics !== false);
          if (config.notifications !== undefined) setNotifications(config.notifications !== false);
          if (config.defaultQuality) setDefaultQuality(config.defaultQuality);
          if (config.language) setLanguage(config.language);
          if (config.autoDownload !== undefined) setAutoDownload(!!config.autoDownload);
          if (config.lastDownloadPreset) setLastDownloadPreset(config.lastDownloadPreset);
          // Only customized shortcuts are saved; merge them over the current
          // defaults (old default values count as "not customized").
          if (config.keybinds) setKeybinds(resolveKeybinds(config.keybinds));

          if (config.visuals) {
            // Apply the random pick (if enabled) for this session only;
            // it does not overwrite the saved configuration on disk.
            // Older versions saved built-in wallpapers by asset URL, which changes
            // between builds; convert them to the stable preset id.
            const saved = { ...DEFAULT_VISUALS, ...config.visuals };
            saved.bgImage = normalizePresetValue(saved.bgImage);
            // Gradients were removed from Custom: a saved one becomes the plain color.
            if (typeof saved.bgImage === "string" && saved.bgImage.startsWith("@gradient:")) saved.bgImage = null;
            // A background engine that no longer exists → the default one.
            if (!KNOWN_BACKGROUNDS.includes(saved.activeBackground)) saved.activeBackground = DEFAULT_VISUALS.activeBackground;
            setVisuals(pickRandomWallpaper(saved));
          }

          if (!config.downloadPath) setShowSetup(true);
        } else {
          setShowSetup(true);
        }
      } catch (e) {
        try {
          const sysPath = await downloadDir();
          setDefaultPath(sysPath.replace(/\\/g, "/"));
        } catch (err) { /* ignore */ }
        setShowSetup(true);
      }
    }
    // `loaded` lets the app wait for the saved look (background, colors…)
    // before showing anything, so nothing switches abruptly after startup.
    loadConfig().finally(() => {
      if (FORCE_SETUP) setShowSetup(true);
      setLoaded(true);
    });

    // Flush any pending write if the component unmounts.
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        flushConfig();
      }
    };
  }, []);

  async function flushConfig() {
    try {
      await mkdir("", { baseDir: BaseDirectory.AppConfig, recursive: true });
      await writeTextFile(
        CONFIG_FILE,
        JSON.stringify(configRef.current, null, 2),
        { baseDir: BaseDirectory.AppConfig }
      );
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  }

  flushPending = async () => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    await flushConfig();
  };

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flushConfig();
    }, SAVE_DEBOUNCE_MS);
  }

  // Updates state immediately (responsive UI) and persists to disk debounced.
  function saveSettings(updates) {
    const { keepBgHistory, ...rest } = updates; // option, not a setting
    updates = rest;
    const current = configRef.current || {};
    const newConfig = { ...current, ...updates };

    if (updates.visuals) {
      const before = current.visuals || {};
      newConfig.visuals = { ...before, ...updates.visuals };
      // Background history (newest first, up to 10): what was in use before
      // each change, so removing a wallpaper can go back to the previous one.
      const after = newConfig.visuals;
      // (A caller that sets the history itself — removing a wallpaper — passes keepBgHistory.)
      if (!keepBgHistory && before.activeBackground && (after.activeBackground !== before.activeBackground || after.bgImage !== before.bgImage)) {
        const prev = { activeBackground: before.activeBackground, bgImage: before.bgImage ?? null };
        const rest = (before.bgHistory || []).filter((h) => h.activeBackground !== prev.activeBackground || h.bgImage !== prev.bgImage);
        newConfig.visuals.bgHistory = [prev, ...rest].slice(0, 10);
      }
    }
    // Card options: merged (callers send only what changed). Changing the
    // default quality / folder in Settings also becomes the card's choice.
    if (updates.lastDownloadPreset || updates.defaultQuality || updates.downloadPath) {
      const preset = { ...(current.lastDownloadPreset || {}), ...(updates.lastDownloadPreset || {}) };
      if (updates.defaultQuality) preset.res = String(updates.defaultQuality).replace("p", "");
      if (updates.downloadPath) preset.directory = updates.downloadPath;
      newConfig.lastDownloadPreset = preset;
      setLastDownloadPreset(preset);
    }
    if (updates.keybinds) {
      // Persist only the overrides, so future default changes still reach the user.
      newConfig.keybinds = keybindOverrides({ ...resolveKeybinds(current.keybinds), ...updates.keybinds });
    }
    configRef.current = newConfig;

    if (updates.downloadPath) setDefaultPath(updates.downloadPath);
    if (updates.playlistLimit !== undefined) setPlaylistLimit(updates.playlistLimit);
    if (updates.maxConcurrent !== undefined) setMaxConcurrent(updates.maxConcurrent);
    if (updates.cookieBrowser !== undefined) setCookieBrowser(updates.cookieBrowser);
    if (updates.cookieFile !== undefined) setCookieFile(updates.cookieFile);
    if (updates.autoPaste !== undefined) setAutoPaste(updates.autoPaste);
    if (updates.analytics !== undefined) setAnalytics(updates.analytics !== false);
    if (updates.notifications !== undefined) setNotifications(updates.notifications !== false);
    if (updates.language) setLanguage(updates.language);
    if (updates.defaultQuality) setDefaultQuality(updates.defaultQuality);
    if (updates.autoDownload !== undefined) setAutoDownload(!!updates.autoDownload);
    if (updates.visuals) setVisuals(prev => ({ ...prev, ...updates.visuals, bgHistory: newConfig.visuals.bgHistory }));
    if (updates.keybinds) setKeybinds(prev => ({ ...prev, ...updates.keybinds }));

    scheduleSave();
  }

  // Opens the in-app folder browser (shows media files) to pick the default folder.
  async function changeDefaultPath() {
    const selected = await pickFolder(defaultPath);
    if (selected) {
      const newPath = selected.replace(/\\/g, "/");
      saveSettings({ downloadPath: newPath });
      return newPath;
    }
    return null;
  }

  return {
    loaded, defaultPath, playlistLimit, maxConcurrent, cookieBrowser, cookieFile, autoPaste, analytics, notifications, defaultQuality, language, showSetup, visuals,
    autoDownload, lastDownloadPreset,
    keybinds, setShowSetup, saveSettings, changeDefaultPath
  };
}
