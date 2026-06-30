import { useState, useEffect, useRef } from "react";
import { exists, readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { downloadDir } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import i18n from "../locales/i18n";
import { ANIMATED_PRESETS, STATIC_PRESETS, NIPP_PRESETS } from "../utils/backgrounds";

const CONFIG_FILE = "settings.json";
const SAVE_DEBOUNCE_MS = 400;

const DEFAULT_VISUALS = {
  activeBackground: 'floatingLines', // 'floatingLines', 'colorBends', 'static'

  // Floating Lines
  lineCount: 6,
  lineDistance: 1,
  bendRadius: 2.5,
  bendStrength: -0.5,
  showColors: false,
  customColors: ["#2c2cf2", "#8b5cf6", "#3b82f6"],

  // Color Bends
  cb_colors: ["#ff5c7a", "#8a5cff", "#00ffd1"],
  cb_speed: 0.2,
  cb_scale: 1,
  cb_warpStrength: 1,
  cb_noise: 0.1,

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
  randomNipp: false
};

// Picks a random wallpaper from the enabled galleries. This only affects the
// current session (the saved bgImage on disk is left untouched).
function pickRandomWallpaper(v) {
  const pool = [];
  if (v.randomGif) pool.push(...ANIMATED_PRESETS);
  if (v.randomJpg) pool.push(...STATIC_PRESETS);
  if (v.randomNipp) pool.push(...NIPP_PRESETS);
  if (pool.length === 0) return v;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { ...v, bgImage: `@preset:${pick.url}`, activeBackground: 'static' };
}

export default function useSettings() {
  const [defaultPath, setDefaultPath] = useState("");
  const [playlistLimit, setPlaylistLimit] = useState(25);
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [cookieBrowser, setCookieBrowser] = useState(""); // "" = disabled; else chrome/firefox/edge/...
  const [cookieFile, setCookieFile] = useState("");       // path to a cookies.txt file (takes priority)
  const [autoPaste, setAutoPaste] = useState(true);       // auto-fill the bar from the clipboard
  const [defaultQuality, setDefaultQuality] = useState("best");
  const [language, setLanguage] = useState("auto");
  const [showSetup, setShowSetup] = useState(false);

  const [visuals, setVisuals] = useState(DEFAULT_VISUALS);

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
        const fileExists = await exists(CONFIG_FILE, { baseDir: BaseDirectory.AppConfig });
        if (fileExists) {
          const content = await readTextFile(CONFIG_FILE, { baseDir: BaseDirectory.AppConfig });
          const config = JSON.parse(content);
          configRef.current = config;

          if (config.downloadPath) setDefaultPath(config.downloadPath);
          if (config.playlistLimit !== undefined) setPlaylistLimit(config.playlistLimit);
          if (config.maxConcurrent !== undefined) setMaxConcurrent(config.maxConcurrent);
          if (config.cookieBrowser !== undefined) setCookieBrowser(config.cookieBrowser);
          if (config.cookieFile !== undefined) setCookieFile(config.cookieFile);
          if (config.autoPaste !== undefined) setAutoPaste(config.autoPaste);
          if (config.defaultQuality) setDefaultQuality(config.defaultQuality);
          if (config.language) setLanguage(config.language);

          if (config.visuals) {
            // Apply the random pick (if enabled) for this session only;
            // it does not overwrite the saved configuration on disk.
            setVisuals(pickRandomWallpaper({ ...DEFAULT_VISUALS, ...config.visuals }));
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
    loadConfig();

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

  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flushConfig();
    }, SAVE_DEBOUNCE_MS);
  }

  // Updates state immediately (responsive UI) and persists to disk debounced.
  function saveSettings(updates) {
    const current = configRef.current || {};
    const newConfig = { ...current, ...updates };

    if (updates.visuals) {
      newConfig.visuals = { ...current.visuals, ...updates.visuals };
    }
    configRef.current = newConfig;

    if (updates.downloadPath) setDefaultPath(updates.downloadPath);
    if (updates.playlistLimit !== undefined) setPlaylistLimit(updates.playlistLimit);
    if (updates.maxConcurrent !== undefined) setMaxConcurrent(updates.maxConcurrent);
    if (updates.cookieBrowser !== undefined) setCookieBrowser(updates.cookieBrowser);
    if (updates.cookieFile !== undefined) setCookieFile(updates.cookieFile);
    if (updates.autoPaste !== undefined) setAutoPaste(updates.autoPaste);
    if (updates.language) setLanguage(updates.language);
    if (updates.defaultQuality) setDefaultQuality(updates.defaultQuality);
    if (updates.visuals) setVisuals(prev => ({ ...prev, ...updates.visuals }));

    scheduleSave();
  }

  async function changeDefaultPath() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) {
      const newPath = selected.replace(/\\/g, "/");
      saveSettings({ downloadPath: newPath });
      return newPath;
    }
    return null;
  }

  return {
    defaultPath, playlistLimit, maxConcurrent, cookieBrowser, cookieFile, autoPaste, defaultQuality, language, showSetup, visuals,
    setShowSetup, saveSettings, changeDefaultPath
  };
}
