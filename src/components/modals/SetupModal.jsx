import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle } from "lucide-react";
import { LanguagesIcon as Languages, FolderUpIcon as FolderUp, ChevronDownIcon as ChevronDown, CheckIcon as Check, SearchIcon as Search, CircleCheckIcon as CheckCircle2 } from "../ui/AnimatedIcons"; // animated (lucide-animated)
import { useTranslation } from "react-i18next";
import { Swap, Collapse, Pop } from "../ui/Motion";
import { LANGUAGES, resolveLanguage } from "../../locales/languages";
import logoImg from "../../assets/logo.png";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import { DIALOG_GLASS } from "../ui/liquidGlass/presets";

export default function SetupModal({ settings, onClose }) {
  const { t, i18n } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const languageOptions = [{ value: "auto", label: t('settings.lang_auto') }, ...LANGUAGES];

  useEffect(() => {
    if (!settings.language || settings.language === "auto") {
      i18n.changeLanguage(resolveLanguage("auto"));
    }
  }, []);

  const currentLangLabel = languageOptions.find(l => l.value === settings.language)?.label || t('settings.lang_auto');
  const filteredLanguages = languageOptions.filter(lang => lang.label.toLowerCase().includes(searchTerm.toLowerCase()));

  const handleLanguageChange = (newLang) => {
    settings.saveSettings({ language: newLang });
    i18n.changeLanguage(resolveLanguage(newLang));
    setLangOpen(false);
    setSearchTerm("");
  };

  // Animation variants for the modal container and items
  const containerVariants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: { 
      opacity: 1, scale: 1, y: 0,
      transition: { 
        type: "spring", stiffness: 300, damping: 25,
        staggerChildren: 0.1, delayChildren: 0.1 
      }
    },
    exit: { 
      opacity: 0, scale: 0.95, y: 20, 
      transition: { duration: 0.2, ease: "easeIn" } 
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 25 } }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        // No dark tint here: the dimming is done inside the app background
        // (App.jsx), so this dialog's liquid glass sees it too.
        className="absolute inset-0 backdrop-blur-md"
      />

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        // max-w-lg + wrapping text below: some languages (French, Spanish,
        // Italian, Vietnamese...) have much longer sentences than English.
        className="relative isolate w-full max-w-lg rounded-[36px] p-6 text-center shadow-2xl backdrop-blur-md" /* no CSS bg/border: the glass draws them */
      >
        {/* Liquid glass background — same material as the other dialogs */}
        <LiquidGlass
          variant="dark"
          settings={DIALOG_GLASS}
          radius={36}
          className="absolute inset-0 -z-10 pointer-events-none rounded-[36px]"
          fallbackClassName="bg-zinc-950/80 backdrop-blur-2xl border border-white/10"
        />
        <motion.div variants={itemVariants} className="w-20 h-20 flex items-center justify-center mx-auto mb-6">
          <img src={logoImg} alt="Flow Downloader" className="w-20 h-20" />
        </motion.div>
        
        <motion.h2 variants={itemVariants} className="text-2xl font-bold text-white mb-2 break-words [text-wrap:balance]">{t('setup_modal.title')}</motion.h2>
        <motion.p variants={itemVariants} className="text-zinc-400 text-sm mb-8 leading-relaxed px-2 break-words [text-wrap:balance]">{t('setup_modal.subtitle')}</motion.p>

        <div className="space-y-6 text-left">
          <motion.div variants={itemVariants} className="relative">
            <label className="text-[12px] font-black text-zinc-500 uppercase tracking-widest leading-snug break-words px-1 mb-2 block">{t('settings.general.language')}</label>
            <button onClick={() => setLangOpen(!langOpen)} className="w-full flex items-center justify-between p-3.5 bg-zinc-900/50 border border-white/5 rounded-xl text-white text-sm hover:bg-zinc-900 hover:border-white/10 transition-all cursor-pointer">
              <div className="flex items-center gap-3 min-w-0">
                <Languages size={20} className="text-white shrink-0" />
                <Swap id={currentLangLabel} className="font-semibold truncate min-w-0">{currentLangLabel}</Swap>
              </div>
              <ChevronDown size={20} className={`text-zinc-500 shrink-0 transition-transform ${langOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {langOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setLangOpen(false)} />
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute bottom-full left-0 right-0 mb-2 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-20 overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-white/5 bg-zinc-950/50">
                      <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2">
                        <Search size={14} className="text-neutral-300" />
                        <input autoFocus type="text" placeholder={t('settings.search_language')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-transparent text-xs text-white outline-none" />
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                      {filteredLanguages.map((lang) => (
                        <button key={lang.value} onClick={() => handleLanguageChange(lang.value)} className="w-full flex items-center justify-between p-2.5 hover:bg-white/5 rounded-xl text-sm text-zinc-400 hover:text-white transition-colors cursor-pointer">
                          {lang.label}
                          <Pop show={settings.language === lang.value} className="flex">
                            <Check size={14} className="text-violet-400" />
                          </Pop>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div variants={itemVariants} className="space-y-3">
            <label className="text-[12px] font-black text-zinc-500 uppercase tracking-widest leading-snug break-words px-1 block">{t('settings.general.path')}</label>
            <button onClick={() => settings.changeDefaultPath()} className={`w-full py-4 rounded-xl transition-all duration-300 flex items-center justify-center cursor-pointer group shadow-lg border ${settings.defaultPath ? "bg-zinc-900/50 border-violet-500/30 text-violet-400" : "bg-white hover:bg-zinc-200 text-black border-transparent"}`}>
              {/* Icon + label crossfade when a folder is picked */}
              {/* The chosen path is truncated (one line); the "select folder" text
                  wraps instead, so long translations never leave the button. */}
              <Swap id={settings.defaultPath || 'none'} as="div" className="flex items-center justify-center gap-3 w-full min-w-0 px-4">
                {settings.defaultPath ? <CheckCircle2 size={20} className="shrink-0" /> : <FolderUp size={20} className="shrink-0" />}
                <span className={`font-bold text-sm min-w-0 ${settings.defaultPath ? 'truncate font-path' : 'break-words leading-snug'}`}>{settings.defaultPath || t('setup_modal.select_folder')}</span>
              </Swap>
            </button>
          </motion.div>
        </div>

        {/* "Done" button slides open once a folder is chosen (no layout jump) */}
        <Collapse show={!!settings.defaultPath}>
          <div className="pt-8">
            <button onClick={onClose} className="w-full py-3 bg-violet-600 hover:bg-violet-500 text-white font-black uppercase tracking-widest text-[11px] rounded-xl transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)] cursor-pointer active:scale-95">
              {t('settings.done')}
            </button>
          </div>
        </Collapse>

        <motion.div variants={itemVariants} className="mt-8 flex items-center justify-center gap-2 text-[10px] text-zinc-600 uppercase tracking-widest leading-relaxed px-2">
          <AlertCircle size={10} className="shrink-0" />
          <Swap id={!!settings.defaultPath} className="min-w-0 break-words">{t('settings.general.path')} {settings.defaultPath ? t('queue.finished').toLowerCase() : t('settings.not_defined').toLowerCase()}</Swap>
        </motion.div>
      </motion.div>
    </div>
  );
}