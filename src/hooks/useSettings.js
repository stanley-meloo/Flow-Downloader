import { useState, useEffect } from "react";
import { exists, readTextFile, writeTextFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { downloadDir } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import i18n from "../locales/i18n"; // <--- Importe a configuração do i18n que você criou

const CONFIG_FILE = "settings.json";

// VALORES PADRÃO (Com todas as configurações visuais que criamos)
const DEFAULT_VISUALS = {
  activeBackground: 'floatingLines', // 'floatingLines', 'colorBends', 'static'

  // Configs Floating Lines
  lineCount: 9,
  lineDistance: 21,
  bendRadius: 2.5,
  bendStrength: -0.5,
  showColors: false,
  customColors: ["#2c2cf2", "#8b5cf6", "#3b82f6"],

  // Configs Color Bends
  cb_colors: ["#ff5c7a", "#8a5cff", "#00ffd1"], 
  cb_speed: 0.2,
  cb_scale: 1,
  cb_warpStrength: 1,
  cb_noise: 0.1,

  // Configs Estático / Imagem
  staticColor: "#09090b",
  bgImage: null,
  staticGradientEnabled: true,
  staticGradientColor: "#000000",
  imageDarken: 0.0,
  imageBlur: 0
};

export default function useSettings() {
  const [defaultPath, setDefaultPath] = useState("");
  const [playlistLimit, setPlaylistLimit] = useState(10);
  const [defaultQuality, setDefaultQuality] = useState("1080p");
  const [language, setLanguage] = useState("auto");
  const [showSetup, setShowSetup] = useState(false);
  
  const [visuals, setVisuals] = useState(DEFAULT_VISUALS);

  // Efeito para sincronizar o idioma com o i18next
  useEffect(() => {
    if (language && language !== 'auto') {
      // Mapeia 'pt-BR' para 'pt', 'en-US' para 'en', etc.
      // Certifique-se que as chaves batem com seu arquivo i18n.js
      const langMap = {
        'pt-BR': 'pt',
        'en-US': 'en',
        'es-ES': 'es'
      };
      i18n.changeLanguage(langMap[language] || 'en');
    } else {
       // Se for auto, deixa o i18next decidir (ele usa o detector do navegador/sistema)
       // Ou você pode forçar a detecção novamente se necessário
    }
  }, [language]);

  useEffect(() => {
    async function loadConfig() {
      try {
        const fileExists = await exists(CONFIG_FILE, { baseDir: BaseDirectory.AppConfig });
        if (fileExists) {
          const content = await readTextFile(CONFIG_FILE, { baseDir: BaseDirectory.AppConfig });
          const config = JSON.parse(content);
          
          if (config.downloadPath) setDefaultPath(config.downloadPath);
          if (config.playlistLimit !== undefined) setPlaylistLimit(config.playlistLimit);
          if (config.defaultQuality) setDefaultQuality(config.defaultQuality);
          if (config.language) setLanguage(config.language);
          
          if (config.visuals) {
            setVisuals(prev => ({ ...DEFAULT_VISUALS, ...config.visuals }));
          }

          if (!config.downloadPath) setShowSetup(true);
        } else { setShowSetup(true); }
      } catch (e) {
        try {
          const sysPath = await downloadDir();
          setDefaultPath(sysPath.replace(/\\/g, "/"));
        } catch (err) { }
        setShowSetup(true);
      }
    }
    loadConfig();
  }, []);

  async function saveSettings(updates) {
    try {
      const fileExists = await exists(CONFIG_FILE, { baseDir: BaseDirectory.AppConfig });
      let currentConfig = {};
      
      if (fileExists) {
        const content = await readTextFile(CONFIG_FILE, { baseDir: BaseDirectory.AppConfig });
        currentConfig = JSON.parse(content);
      }

      const newConfig = { ...currentConfig, ...updates };
      
      if (updates.visuals) {
        newConfig.visuals = { ...currentConfig.visuals, ...updates.visuals };
      }

      await mkdir("", { baseDir: BaseDirectory.AppConfig, recursive: true });
      await writeTextFile(CONFIG_FILE, JSON.stringify(newConfig), { baseDir: BaseDirectory.AppConfig });
      
      if (updates.downloadPath) setDefaultPath(updates.downloadPath);
      if (updates.playlistLimit !== undefined) setPlaylistLimit(updates.playlistLimit);
      if (updates.language) setLanguage(updates.language);
      if (updates.defaultQuality) setDefaultQuality(updates.defaultQuality);
      if (updates.visuals) setVisuals(prev => ({ ...prev, ...updates.visuals }));

    } catch (e) { console.error(e); }
  }

  async function changeDefaultPath() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) {
      const newPath = selected.replace(/\\/g, "/");
      await saveSettings({ downloadPath: newPath });
      return newPath;
    }
    return null;
  }

  return {
    defaultPath, playlistLimit, defaultQuality, language, showSetup, visuals,
    setShowSetup, saveSettings, changeDefaultPath
  };
}