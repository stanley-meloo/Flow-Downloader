import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, FolderOpen, Settings, FileVideoCamera, Languages, Paintbrush, FileCog,
  Layers, Image as ImageIcon, Trash2, Wand2, ChevronDown, ListVideo, Search, Check, HelpCircle
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";

import imgLines from "../../assets/thumb-lines.jpg";
import imgLiquid from "../../assets/thumb-bend.jpg";
import imgStatic from "../../assets/thumb-satic.jpg";

export default function SettingsModal({ onClose, settings }) {
  const { defaultPath, playlistLimit, defaultQuality, language, visuals, saveSettings, changeDefaultPath } = settings;
  const [activeTab, setActiveTab] = useState("general");

  const { t, i18n } = useTranslation();

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const updateVisual = (key, value) => {
    saveSettings({ visuals: { ...visuals, [key]: value } });
  };

  const handleSelectBgImage = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
      });
      if (selected) {
        updateVisual("bgImage", selected);
      }
    } catch (err) { console.error(err); }
  };

  const handleLanguageChange = (newLang) => {
    saveSettings({ language: newLang });

    if (newLang === "auto") {
      const browserLang = navigator.language.split('-')[0];
      const supported = ["en", "es", "pt", "fr", "de", "zh", "ja", "ru", "hi", "ar"];
      const finalLang = supported.includes(browserLang) ? browserLang : "en";
      i18n.changeLanguage(finalLang);
    } else {
      i18n.changeLanguage(newLang);
    }
  };

  const handleQualityChange = (newQuality) => {
    saveSettings({ defaultQuality: newQuality });
  };

  const qualityOptions = [
    { value: "best", label: t('settings.quality_best', { defaultValue: 'Best (4K)' }) },
    { value: "1080p", label: t('settings.quality_fhd', { defaultValue: 'Full HD' }) },
    { value: "720p", label: t('settings.quality_hd', { defaultValue: 'HD' }) }
  ];

  const languageOptions = [
    { value: "auto", label: t('settings.lang_auto') },
    { value: "en", label: "English" }, { value: "pt", label: "Português" },
    { value: "es", label: "Español" }, { value: "fr", label: "Français" },
    { value: "de", label: "Deutsch" }, { value: "it", label: "Italiano" },
    { value: "ko", label: "한국어 (Korean)" }, { value: "zh", label: "中文 (Chinese)" },
    { value: "ja", label: "日本語 (Japanese)" }, { value: "ru", label: "Русский (Russian)" },
    { value: "hi", label: "हिन्दी (Hindi)" }, { value: "bn", label: "বাংলা (Bengali)" },
    { value: "ar", label: "العربية (Arabic)" }, { value: "tr", label: "Türkçe (Turkish)" },
    { value: "vi", label: "Tiếng Việt (Vietnamese)" }, { value: "pl", label: "Polski (Polish)" }
  ];
  
  const currentQualityLabel = qualityOptions.find(q => q.value === defaultQuality)?.label || "Best";
  const currentLangLabel = languageOptions.find(l => l.value === language)?.label || "System Default";

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15, filter: "blur(10px)" }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.95, y: 15, filter: "blur(10px)", transition: { duration: 0.2, ease: "easeIn" } }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="relative w-full max-w-2xl h-140 bg-zinc-950/1 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-6 flex items-center justify-between border-b border-white/5 bg-transparent shrink-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 8, ease: "linear", repeat: Infinity }}>
                <Settings size={30} className="text-indigo-400" />
              </motion.div>
            </div>
            <div>
              <h2 className="text-white text-lg font-bold leading-snug">
                {t('settings.title', { defaultValue: 'Configurações' })}
              </h2>
              <span className="text-[11px] font-black text-neutral-200 uppercase tracking-widest">
                Flow Downloader Engine
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-neutral-500 hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer">
            <X size={20} />
          </button>
        </div>

        <div className="px-8 pt-6 pb-2 shrink-0 bg-transparent z-10">
          <div className="flex bg-zinc-900/50 p-1 h-[44px] rounded-lg border border-white/5 relative">
            {[
              { id: 'general', icon: FileCog, labelKey: 'settings.tabs.general', defaultLabel: 'General' },
              { id: 'visual', icon: Paintbrush, labelKey: 'settings.tabs.visual', defaultLabel: 'Appearance' }
            ].map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex-1 flex items-center justify-center h-full px-2 rounded-md cursor-pointer outline-none transition-colors z-10 ${isActive ? "text-black font-bold" : "text-neutral-200 hover:text-zinc-300 font-medium"}`}
                >
                  {isActive && <motion.div layoutId="settingsTabBackground" className="absolute inset-0 bg-white rounded-md shadow-sm" transition={{ type: "spring", stiffness: 350, damping: 25 }} />}
                  <span className="relative z-20 flex items-center gap-1.5">
                    <tab.icon size={20} />
                    <span className="text-[12.5px] tracking-wide whitespace-nowrap">
                      {t(tab.labelKey, { defaultValue: tab.defaultLabel })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className={`px-8 pb-8 pt-4 flex flex-col flex-1 min-h-0 relative ${activeTab === 'visual' ? 'overflow-y-auto custom-scrollbar z-0' : 'z-30'}`}>
          <AnimatePresence mode="wait">
            {activeTab === "general" && (
              <motion.div
                key="tab-general"
                initial={{ opacity: 0, x: -15, filter: "blur(4px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: 10, filter: "blur(4px)" }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="space-y-7 w-full"
              >
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-neutral-500 uppercase tracking-widest px-1">
                    {t('settings.general.path', { defaultValue: 'Default Download Path' })}
                  </label>
                  <motion.div
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={changeDefaultPath}
                    className="flex items-center gap-3 p-1.5 pl-3 h-[44px] bg-zinc-900/50 border border-white/5 rounded-lg hover:border-white/10 transition-colors cursor-pointer group"
                  >
                    <FolderOpen size={20} className="text-neutral-200 group-hover:text-zinc-300 shrink-0" />
                    <span className="flex-1 text-[12.5px] font-bold text-zinc-300 truncate font-mono">
                      {defaultPath || t('settings.not_defined', { defaultValue: 'Not Defined' })}
                    </span>
                    <div className="px-2.5 py-1.5 bg-zinc-800 rounded text-[11px] font-bold text-zinc-400 group-hover:text-white shrink-0 uppercase transition-colors">
                      {t('media_modal.change', { defaultValue: 'CHANGE' })}
                    </div>
                  </motion.div>
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 px-1 relative">
                    <label className="text-[11px] font-black text-neutral-500 uppercase tracking-widest flex gap-1.5 items-center">
                      <ListVideo size={18} />
                      {t('settings.general.limit', { defaultValue: 'Playlist Item Limit' })}
                    </label>

                    <div className="group flex items-center justify-center cursor-help">
                      <HelpCircle size={14} className="text-neutral-200 group-hover:text-indigo-400 transition-colors" />
                      <div className="absolute bottom-full left-0 mb-2 w-72 p-3 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl text-[11px] text-zinc-300 font-medium opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 normal-case tracking-normal leading-relaxed">
                        {t('settings.general.limit_info', {
                          defaultValue: 'Podes aumentar o limite para varrer playlists inteiras. Para evitar lentidão na tua máquina e bloqueios no servidor do YouTube (Erro 429), o Flow processará o download de forma inteligente, baixando 3 vídeos por vez.'
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 10, label: '10' }, { value: 20, label: '20' }, { value: 50, label: '50' },
                      { value: 100, label: '100' }, { value: 300, label: '300' }, { value: 9999, label: '∞' }
                    ].map((opt) => {
                      const isActive = playlistLimit === opt.value;
                      return (
                        <motion.button
                          key={opt.value}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => saveSettings({ playlistLimit: opt.value })}
                          className={`relative flex items-center justify-center h-11 rounded-lg border transition-colors duration-300 cursor-pointer outline-none ${isActive
                            ? "bg-indigo-500/10 border-indigo-500/50 shadow-inner text-indigo-400 font-bold"
                            : "bg-zinc-900/40 border-white/5 hover:bg-zinc-900/80 hover:border-white/10 text-neutral-200 hover:text-zinc-300 font-medium"
                            }`}
                        >
                          <span className="text-[12.5px] tracking-wide">{opt.label}</span>
                          {isActive && (
                            <div className="absolute top-1.5 right-1.5 bg-indigo-500 text-white p-0.5 rounded-full shadow-lg">
                              <Check size={8} strokeWidth={4} />
                            </div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <CustomSelect
                    label={t('settings.general.quality', { defaultValue: 'Default Quality' })}
                    icon={(props) => <FileVideoCamera {...props} size={20} />}
                    valueLabel={currentQualityLabel}
                    options={qualityOptions}
                    onSelect={handleQualityChange}
                  />
                  <SearchableSelect
                    label={t('settings.general.language', { defaultValue: 'Language' })}
                    icon={(props) => <Languages {...props} size={20} />}
                    valueLabel={currentLangLabel}
                    options={languageOptions}
                    onSelect={handleLanguageChange}
                    placeholder={t('settings.search_language', { defaultValue: 'Search Language' })}
                  />
                </div>
              </motion.div>
            )}

            {activeTab === "visual" && (
              <motion.div
                key="tab-visual"
                initial={{ opacity: 0, x: 15, filter: "blur(4px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: -10, filter: "blur(4px)" }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="space-y-8 w-full pb-6"
              >
                <div className="space-y-2.5">
                  <label className="text-[11px] font-black text-neutral-500 uppercase tracking-widest px-1 flex gap-1.5 items-center">
                    <Layers size={12} />
                    {t('settings.visual.style', { defaultValue: 'Background Graphic Engine' })}
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'floatingLines', label: t('settings.visual.styles.lines', { defaultValue: 'Linhas' }), img: imgLines },
                      { id: 'colorBends', label: t('settings.visual.styles.liquid', { defaultValue: 'Líquido' }), img: imgLiquid },
                      { id: 'static', label: t('settings.visual.styles.static', { defaultValue: 'Estático' }), img: imgStatic },
                    ].map((bg) => {
                      const isActive = visuals.activeBackground === bg.id;
                      return (
                        <motion.button
                          key={bg.id}
                          whileHover={{ scale: 1.03, y: -2 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => updateVisual("activeBackground", bg.id)}
                          className={`relative flex flex-col items-center justify-center p-4 rounded-xl border transition-colors duration-300 cursor-pointer outline-none group ${isActive
                            ? "bg-indigo-500/10 border-indigo-500/50 shadow-inner"
                            : "bg-zinc-900/40 border-white/5 hover:bg-zinc-900/80 hover:border-white/10"
                            }`}
                        >
                          <div className={`w-14 h-14 rounded-full mb-3 flex items-center justify-center overflow-hidden border transition-colors ${isActive ? "bg-indigo-500/20 border-indigo-500/50" : "bg-zinc-950 border-white/10"
                            }`}>
                            {bg.img ? (
                              <img src={bg.img} alt={bg.label} className={`w-full h-full object-cover transition-opacity duration-300 ${isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`} />
                            ) : (
                              <ImageIcon size={20} className={isActive ? "text-indigo-400" : "text-neutral-500"} />
                            )}
                          </div>
                          <span className={`text-[11px] font-bold uppercase tracking-wider transition-colors ${isActive ? "text-indigo-400" : "text-neutral-200 group-hover:text-zinc-300"
                            }`}>
                            {bg.label}
                          </span>
                          {isActive && (
                            <div className="absolute top-2 right-2 bg-indigo-500 text-white p-0.5 rounded-full shadow-lg">
                              <Check size={10} strokeWidth={4} />
                            </div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {visuals.activeBackground === 'floatingLines' && (
                    <motion.div
                      key="opt-floatingLines"
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}
                      className="space-y-6 pt-2 border-t border-white/5"
                    >
                      <div className="flex flex-col bg-zinc-900/30 rounded-xl border border-white/5 overflow-hidden transition-all duration-300">
                        <div className="flex items-center justify-between p-4 h-[52px]">
                          <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">
                            {t('settings.visual.custom_colors', { defaultValue: 'Cores Customizadas das Linhas' })}
                          </span>
                          <ToggleSwitch
                            active={visuals.showColors}
                            onClick={() => {
                              const isEnabling = !visuals.showColors;
                              saveSettings({
                                visuals: {
                                  ...visuals, showColors: isEnabling,
                                  lineColor1: visuals.lineColor1 || '#4f46e5', lineColor2: visuals.lineColor2 || '#ec4899',
                                  lineColor3: visuals.lineColor3 || '#06b6d4', lineColor4: visuals.lineColor4 || '#14b8a6',
                                }
                              });
                            }}
                          />
                        </div>
                        <AnimatePresence>
                          {visuals.showColors && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="grid grid-cols-2 gap-3 px-4 pb-4 pt-1 border-t border-white/5">
                              {[1, 2, 3, 4].map((num) => (
                                <SmartColorPickerBox key={num} num={num} visuals={visuals} updateVisual={updateVisual} t={t} prefix="lineColor" />
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <SliderControl label={t('settings.visual.quantity', { defaultValue: 'Quantidade de Linhas' })} value={visuals.lineCount} min={1} max={20} step={1} onChange={(v) => updateVisual("lineCount", v)} />
                      <SliderControl label={t('settings.visual.distance', { defaultValue: 'Espaçamento' })} value={visuals.lineDistance} min={1} max={50} step={1} onChange={(v) => updateVisual("lineDistance", v)} />
                      <SliderControl label={t('settings.visual.radius', { defaultValue: 'Interação (Mouse)' })} value={visuals.bendRadius} min={0} max={10} step={0.1} onChange={(v) => updateVisual("bendRadius", v)} />
                    </motion.div>
                  )}

                  {/* ===== COLOR BENDS AGORA TEM APENAS AS CORES ===== */}
                  {visuals.activeBackground === 'colorBends' && (
                    <motion.div
                      key="opt-colorBends"
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}
                      className="space-y-6 pt-2 border-t border-white/5"
                    >
                      <div className="flex flex-col bg-zinc-900/30 rounded-xl border border-white/5 overflow-hidden transition-all duration-300">
                        <div className="flex items-center justify-between p-4 h-[52px]">
                          <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">
                            {t('settings.visual.custom_colors', { defaultValue: 'Cores Customizadas das Ondas' })}
                          </span>
                          <ToggleSwitch
                            active={visuals.cb_showColors}
                            onClick={() => {
                              const isEnabling = !visuals.cb_showColors;
                              saveSettings({
                                visuals: {
                                  ...visuals, cb_showColors: isEnabling,
                                  cb_color1: visuals.cb_color1 || '#4f46e5', cb_color2: visuals.cb_color2 || '#ec4899',
                                  cb_color3: visuals.cb_color3 || '#06b6d4', cb_color4: visuals.cb_color4 || '#14b8a6',
                                }
                              });
                            }}
                          />
                        </div>
                        <AnimatePresence>
                          {visuals.cb_showColors && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="grid grid-cols-2 gap-3 px-4 pb-4 pt-1 border-t border-white/5">
                              {[1, 2, 3, 4].map((num) => (
                                <SmartColorPickerBox key={num} num={num} visuals={visuals} updateVisual={updateVisual} t={t} prefix="cb_color" />
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      {/* OS SLIDERS FORAM PERMANENTEMENTE REMOVIDOS DAQUI */}
                    </motion.div>
                  )}

                  {visuals.activeBackground === 'static' && (
                    <motion.div
                      key="opt-static"
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}
                      className="space-y-8 pt-2 border-t border-white/5"
                    >
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-black text-neutral-500 uppercase tracking-widest px-1">
                            {t('settings.visual.base_color', { defaultValue: 'Cor do Fundo' })}
                          </label>
                          <div className="flex items-center gap-3 bg-zinc-900/50 p-2 h-[44px] rounded-lg border border-white/5 relative">
                            <div className="relative w-7 h-7 rounded border border-white/10 overflow-hidden shadow-inner shrink-0 cursor-pointer ring-1 ring-white/5">
                              <SmartColorPickerRaw colorKey="staticColor" defaultColor="#000000" visuals={visuals} updateVisual={updateVisual} />
                            </div>
                            <div className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">{visuals.staticColor || '#000000'}</div>
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-black text-neutral-500 uppercase tracking-widest px-1">
                            {t('settings.visual.image', { defaultValue: 'Wallpaper Personalizado' })}
                          </label>
                          {visuals.bgImage ? (
                            <div className="flex items-center justify-between px-3 bg-zinc-900/50 h-[44px] rounded-lg border border-indigo-500/30">
                              <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-widest truncate">
                                {t('settings.visual.image_defined', { defaultValue: 'Imagem Ativa' })}
                              </span>
                              <button onClick={() => updateVisual("bgImage", null)} className="p-1.5 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded-md transition-colors"><Trash2 size={14} /></button>
                            </div>
                          ) : (
                            <button onClick={handleSelectBgImage} className="w-full h-[44px] border border-dashed border-white/10 rounded-lg hover:border-white/30 hover:bg-white/5 transition-colors flex items-center justify-center gap-2 text-zinc-400 text-[11px] font-bold uppercase tracking-widest">
                              <ImageIcon size={14} />
                              {t('settings.visual.choose_image', { defaultValue: 'Procurar Imagem' })}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-5 bg-zinc-900/20 p-5 rounded-xl border border-white/5">
                        <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-3">
                          <Wand2 size={14} className="text-indigo-400" />
                          <span className="text-[11px] font-black text-zinc-400 uppercase tracking-widest">
                            {t('settings.visual.effects', { defaultValue: 'Filtros de Pós-Processamento' })}
                          </span>
                        </div>
                        <div className="flex items-center justify-between bg-zinc-950/50 px-3 h-[44px] rounded-lg border border-white/5">
                          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest">
                            {t('settings.visual.gradient', { defaultValue: 'Vignette Superior' })}
                          </span>
                          <div className="flex items-center gap-3">
                            {visuals.staticGradientEnabled && (
                              <div className="relative w-6 h-6 rounded-full border border-white/20 overflow-hidden shadow-inner cursor-pointer">
                                <SmartColorPickerRaw colorKey="staticGradientColor" defaultColor="#000000" visuals={visuals} updateVisual={updateVisual} />
                              </div>
                            )}
                            <ToggleSwitch active={visuals.staticGradientEnabled} onClick={() => updateVisual("staticGradientEnabled", !visuals.staticGradientEnabled)} />
                          </div>
                        </div>
                        <SliderControl label={t('settings.visual.darken', { defaultValue: 'Opacidade Escura' })} value={visuals.imageDarken} min={0} max={0.9} step={0.05} onChange={(v) => updateVisual("imageDarken", v)} />
                        <SliderControl label={t('settings.visual.blur', { defaultValue: 'Nível de Desfoque' })} value={visuals.imageBlur} min={0} max={20} step={1} onChange={(v) => updateVisual("imageBlur", v)} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

function SmartColorPickerBox({ num, visuals, updateVisual, t, prefix = "lineColor" }) {
  const colorKey = `${prefix}${num}`;
  const fallbackColor = num === 1 ? '#4f46e5' : num === 2 ? '#ec4899' : num === 3 ? '#06b6d4' : '#14b8a6';
  const [localColor, setLocalColor] = useState(visuals[colorKey] || fallbackColor);

  useEffect(() => { setLocalColor(visuals[colorKey] || fallbackColor); }, [visuals[colorKey], fallbackColor]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (localColor !== (visuals[colorKey] || fallbackColor)) {
        updateVisual(colorKey, localColor);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [localColor, colorKey, visuals, fallbackColor]);

  return (
    <div className="flex items-center gap-3 bg-zinc-950 p-2 h-[44px] rounded-lg border border-white/5 relative group hover:border-white/10 transition-colors">
      <div className="relative w-6 h-6 rounded overflow-hidden shadow-inner shrink-0 cursor-pointer ring-1 ring-white/10">
        <input type="color" value={localColor} onChange={(e) => setLocalColor(e.target.value)} className="absolute -top-2 -left-2 w-10 h-10 p-0 border-0 cursor-pointer" />
      </div>
      <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-widest group-hover:text-zinc-200 transition-colors">
        {t('settings.visual.color', { defaultValue: 'Cor' })} {num}
      </span>
    </div>
  );
}

function SmartColorPickerRaw({ colorKey, defaultColor, visuals, updateVisual }) {
  const [localColor, setLocalColor] = useState(visuals[colorKey] || defaultColor);
  useEffect(() => { setLocalColor(visuals[colorKey] || defaultColor); }, [visuals[colorKey], defaultColor]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localColor !== (visuals[colorKey] || defaultColor)) updateVisual(colorKey, localColor);
    }, 200);
    return () => clearTimeout(timer);
  }, [localColor]);
  return <input type="color" value={localColor} onChange={(e) => setLocalColor(e.target.value)} className="absolute -top-2 -left-2 w-12 h-12 p-0 border-0 cursor-pointer" />;
}

function SliderControl({ label, value, min, max, step, onChange }) {
  const [localVal, setLocalVal] = useState(value);
  useEffect(() => { setLocalVal(value); }, [value]);
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <label className="text-[11px] font-black text-neutral-200 uppercase tracking-widest">{label}</label>
        <span className="text-[11px] font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">{localVal}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={localVal} onChange={(e) => setLocalVal(parseFloat(e.target.value))} onMouseUp={() => onChange(localVal)} onTouchEnd={() => onChange(localVal)} className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all" />
    </div>
  );
}

function ToggleSwitch({ active, onClick }) {
  return (
    <button onClick={onClick} className={`w-10 h-5 rounded-full relative transition-colors duration-300 ease-in-out border ${active ? "bg-indigo-500 border-indigo-400" : "bg-zinc-800 border-white/10"}`}>
      <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[2px] shadow-sm transition-all duration-300 ${active ? "left-[22px]" : "left-[2px]"}`} />
    </button>
  );
}

function CustomSelect({ label, icon: Icon, valueLabel, options, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <label className="text-[11px] font-black text-neutral-500 uppercase tracking-widest px-1 mb-1.5">{label}</label>
      <div className="relative">
        <button onClick={() => setIsOpen(!isOpen)} className={`w-full flex items-center justify-between p-2.5 px-3 rounded-lg border transition-all duration-500 ease-in-out h-[44px] ${isOpen ? "bg-zinc-800 border-white/20 shadow-inner" : "bg-zinc-900/40 border-white/5 hover:bg-zinc-900 hover:border-white/10 cursor-pointer active:scale-95"}`}>
          <div className="flex items-center gap-2 overflow-hidden">
            <Icon size={14} className="text-neutral-200 shrink-0" />
            <span className="text-[12.5px] font-bold text-zinc-200 truncate">{valueLabel}</span>
          </div>
          <ChevronDown size={12} className={`text-neutral-200 transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
          {isOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={{ duration: 0.15 }} className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl z-40 overflow-hidden flex flex-col max-h-48 py-1 origin-bottom">
                <div className="overflow-y-auto custom-scrollbar flex-1">
                  {options.map((opt, i) => (
                    <button key={i} onClick={() => { onSelect(opt.value); setIsOpen(false); }} className={`w-full text-left px-3 py-2.5 text-[11px] font-bold transition-colors hover:bg-zinc-800 ${valueLabel === opt.label ? 'text-indigo-400 bg-zinc-800/50' : 'text-zinc-400'}`}>{opt.label}</button>
                  ))}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function SearchableSelect({ label, icon: Icon, valueLabel, options, onSelect, placeholder }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const filteredOptions = options.filter(opt => opt.label.toLowerCase().includes(searchTerm.toLowerCase()));
  return (
    <div className="flex flex-col">
      <label className="text-[11px] font-black text-neutral-500 uppercase tracking-widest px-1 mb-1.5">{label}</label>
      <div className="relative">
        <button onClick={() => setIsOpen(!isOpen)} className={`w-full flex items-center justify-between p-2.5 px-3 rounded-lg border transition-all duration-500 ease-in-out h-[44px] ${isOpen ? "bg-zinc-800 border-white/20 shadow-inner" : "bg-zinc-900/40 border-white/5 hover:bg-zinc-900 hover:border-white/10 cursor-pointer active:scale-95"}`}>
          <div className="flex items-center gap-2 overflow-hidden">
            <Icon size={14} className="text-neutral-200 shrink-0" />
            <span className="text-[12.5px] font-bold text-zinc-200 truncate">{valueLabel}</span>
          </div>
          <ChevronDown size={12} className={`text-neutral-200 transition-transform duration-300 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
          {isOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={(e) => { e.stopPropagation(); setIsOpen(false); setSearchTerm(""); }} />
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={{ duration: 0.15 }} className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl z-40 overflow-hidden flex flex-col max-h-60 origin-bottom">
                <div className="p-2 border-b border-zinc-800 shrink-0" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-md px-2.5 py-2 focus-within:border-indigo-500/50 transition-colors">
                    <Search size={12} className="text-neutral-200 shrink-0" />
                    <input type="text" autoFocus placeholder={placeholder} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-transparent text-[11px] font-medium text-white outline-none placeholder:text-neutral-500" />
                  </div>
                </div>
                <div className="overflow-y-auto custom-scrollbar flex-1 py-1">
                  {filteredOptions.length > 0 ? (
                    filteredOptions.map((opt, i) => (
                      <button key={i} onClick={() => { onSelect(opt.value); setIsOpen(false); setSearchTerm(""); }} className={`w-full text-left px-3 py-2.5 text-[11px] font-bold transition-colors hover:bg-zinc-800 ${valueLabel === opt.label ? 'text-indigo-400 bg-zinc-800/50' : 'text-zinc-400'}`}>{opt.label}</button>
                    ))
                  ) : (
                    <div className="px-3 py-5 text-center text-[11px] text-neutral-500 font-bold uppercase tracking-widest">No languages found</div>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}