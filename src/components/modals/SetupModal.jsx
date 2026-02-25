import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FolderUp, AlertCircle, Languages, 
  ChevronDown, Check, Search, CheckCircle2 
} from "lucide-react";
import { useTranslation } from "react-i18next";
import logoImg from "../../assets/logo.png";

export default function SetupModal({ settings, onClose }) {
  const { t, i18n } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const languageOptions = [
    { value: "auto", label: "Auto" },
    { value: "en", label: "English" }, { value: "pt", label: "Português" },
    { value: "es", label: "Español" }, { value: "fr", label: "Français" },
    { value: "de", label: "Deutsch" }, { value: "it", label: "Italiano" },
    { value: "ko", label: "한국어 (Korean)" }, { value: "zh", label: "中文 (Chinese)" },
    { value: "ja", label: "日本語 (Japanese)" }, { value: "ru", label: "Русский (Russian)" },
    { value: "hi", label: "हिन्दी (Hindi)" }, { value: "bn", label: "বাংলা (Bengali)" },
    { value: "ar", label: "العربية (Arabic)" }, { value: "tr", label: "Türkçe (Turkish)" },
    { value: "vi", label: "Tiếng Việt (Vietnamese)" }, { value: "pl", label: "Polski (Polish)" }
  ];

  useEffect(() => {
    if (!settings.language || settings.language === "auto") {
      const browserLang = navigator.language.split('-')[0];
      const supported = languageOptions.map(o => o.value).filter(v => v !== "auto");
      const finalLang = supported.includes(browserLang) ? browserLang : "en";
      i18n.changeLanguage(finalLang);
    }
  }, []);

  const currentLangLabel = languageOptions.find(l => l.value === settings.language)?.label || t('settings.lang_auto');
  const filteredLanguages = languageOptions.filter(lang => lang.label.toLowerCase().includes(searchTerm.toLowerCase()));

  const handleLanguageChange = (newLang) => {
    settings.saveSettings({ language: newLang });
    if (newLang === "auto") {
      const browserLang = navigator.language.split('-')[0];
      const supported = languageOptions.map(o => o.value).filter(v => v !== "auto");
      i18n.changeLanguage(supported.includes(browserLang) ? browserLang : "en");
    } else {
      i18n.changeLanguage(newLang);
    }
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
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
      />

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="relative w-full max-w-md bg-zinc-950/50 border border-white/10 rounded-2xl p-8 text-center shadow-2xl backdrop-blur-2xl"
      >
        <motion.div variants={itemVariants} className="w-20 h-20 flex items-center justify-center mx-auto mb-6">
          <img src={logoImg} alt="Logo" className="w-20 h-20" />
        </motion.div>
        
        <motion.h2 variants={itemVariants} className="text-2xl font-bold text-white mb-2">{t('setup_modal.title')}</motion.h2>
        <motion.p variants={itemVariants} className="text-zinc-400 text-sm mb-8 leading-relaxed px-4">{t('setup_modal.subtitle')}</motion.p>

        <div className="space-y-6 text-left">
          <motion.div variants={itemVariants} className="relative">
            <label className="text-[12px] font-black text-zinc-500 uppercase tracking-widest px-1 mb-2 block">{t('settings.general.language')}</label>
            <button onClick={() => setLangOpen(!langOpen)} className="w-full flex items-center justify-between p-3.5 bg-zinc-900/50 border border-white/5 rounded-xl text-white text-sm hover:bg-zinc-900 hover:border-white/10 transition-all cursor-pointer">
              <div className="flex items-center gap-3">
                <Languages size={20} className="text-white" />
                <span className="font-semibold">{currentLangLabel}</span>
              </div>
              <ChevronDown size={20} className={`text-zinc-500 transition-transform ${langOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {langOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setLangOpen(false)} />
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="absolute bottom-full left-0 right-0 mb-2 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-20 overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-white/5 bg-zinc-950/50">
                      <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2">
                        <Search size={14} className="text-neutral-300" />
                        <input autoFocus type="text" placeholder={t('settings.search_language')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-transparent text-xs text-white outline-none" />
                      </div>
                    </div>
                    <div className="max-h-48 overflow-y-auto custom-scrollbar p-1">
                      {filteredLanguages.map((lang) => (
                        <button key={lang.value} onClick={() => handleLanguageChange(lang.value)} className="w-full flex items-center justify-between p-2.5 hover:bg-white/5 rounded-lg text-sm text-zinc-400 hover:text-white transition-colors cursor-pointer">
                          {lang.label}
                          {settings.language === lang.value && <Check size={14} className="text-violet-400" />}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div variants={itemVariants} className="space-y-3">
            <label className="text-[12px] font-black text-zinc-500 uppercase tracking-widest px-1 block">{t('settings.general.path')}</label>
            <button onClick={() => settings.changeDefaultPath()} className={`w-full py-4 rounded-xl transition-all flex items-center justify-center gap-3 cursor-pointer group shadow-lg border ${settings.defaultPath ? "bg-zinc-900/50 border-violet-500/30 text-violet-400" : "bg-white hover:bg-zinc-200 text-black border-transparent"}`}>
              {settings.defaultPath ? <CheckCircle2 size={20} /> : <FolderUp size={20} />}
              <span className="font-bold text-sm truncate px-4">{settings.defaultPath || t('setup_modal.select_folder')}</span>
            </button>
          </motion.div>
        </div>

        <AnimatePresence>
          {settings.defaultPath && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="mt-8">
              <button onClick={onClose} className="w-full py-3 bg-violet-600 hover:bg-violet-500 text-white font-black uppercase tracking-widest text-[11px] rounded-xl transition-all shadow-[0_0_20px_rgba(139,92,246,0.3)] cursor-pointer active:scale-95">
                {t('settings.done')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div variants={itemVariants} className="mt-8 flex items-center justify-center gap-2 text-[10px] text-zinc-600 uppercase tracking-widest">
          <AlertCircle size={10} />
          <span>{t('settings.general.path')} {settings.defaultPath ? t('queue.finished').toLowerCase() : t('settings.not_defined').toLowerCase()}</span>
        </motion.div>
      </motion.div>
    </div>
  );
}