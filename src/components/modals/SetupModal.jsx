import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LanguagesIcon as Languages, FolderUpIcon as FolderUp, ChevronDownIcon as ChevronDown, CheckIcon as Check, SearchIcon as Search, CircleCheckIcon as CheckCircle2 } from "../ui/AnimatedIcons"; // animated (lucide-animated)
import { useTranslation } from "react-i18next";
import { Swap, Collapse, Pop } from "../ui/Motion";
import { LANGUAGES, resolveLanguage } from "../../locales/languages";
import { changeLanguageScrambled } from "../../utils/scrambleLanguage";
import logoImg from "../../assets/logo.png";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import { DIALOG_GLASS } from "../ui/liquidGlass/presets";
import SmoothScroll from "../ui/SmoothScroll";

export default function SetupModal({ settings, onClose }) {
  const { t, i18n } = useTranslation();
  const [langOpen, setLangOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Close the language menu on any click outside it (a full-screen catcher
  // div doesn't work here: inside the animated card, "fixed" only covers the card).
  const langRef = useRef(null);
  useEffect(() => {
    if (!langOpen) return;
    const onDown = (e) => { if (!langRef.current?.contains(e.target)) { setLangOpen(false); setSearchTerm(""); } };
    const onKey = (e) => { if (e.key === "Escape") { setLangOpen(false); setSearchTerm(""); } };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [langOpen]);

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
    changeLanguageScrambled(resolveLanguage(newLang)); // text "decodes" into the new language
    setLangOpen(false);
    setSearchTerm("");
  };

  // Entrance, Apple-like: no bounce, small distances, long soft ease-out.
  // The glass card fades in while settling from 97% scale; then its contents
  // arrive top to bottom (logo → title → subtitle → language → folder → Done), each rising 8 px out of a light blur. Exit: a quick, quiet fade.
  const EASE = [0.16, 1, 0.3, 1]; // "expo out": fast start, very gentle landing
  const STAGGER = 0.07;
  const FIRST = 0.15;

  const containerVariants = {
    hidden: { opacity: 0, scale: 0.97 },
    visible: {
      opacity: 1, scale: 1,
      transition: { duration: 0.6, ease: EASE, staggerChildren: STAGGER, delayChildren: FIRST }
    },
    exit: {
      opacity: 0, scale: 0.98,
      transition: { duration: 0.18, ease: [0.4, 0, 1, 1] }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } }
  };

  // The "Done" button lives in a Collapse (it opens when a folder is chosen),
  // outside the staggered list. On the entrance it takes its turn after the
  // folder button; picked later, it appears right away.
  const openedAt = useRef(performance.now());
  const doneDelay = () => Math.max(0, FIRST + 4.5 * STAGGER - (performance.now() - openedAt.current) / 1000);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.4, ease: "easeOut" } }} exit={{ opacity: 0, transition: { duration: 0.2 } }}
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
        <motion.p variants={itemVariants} className="text-zinc-300 text-sm mb-8 leading-relaxed px-2 break-words [text-wrap:balance]">{t('setup_modal.subtitle')}</motion.p>

        <div className="space-y-6 text-left">
          <motion.div ref={langRef} variants={itemVariants} className="relative z-30" /* above the folder / Done blocks, so its menu covers them */>
            <label className="text-[12px] font-black text-zinc-300 uppercase tracking-widest leading-snug break-words px-1 mb-2 block">{t('settings.general.language')}</label>
            <button onClick={() => setLangOpen(!langOpen)} className="w-full flex items-center justify-between p-3.5 bg-zinc-900/50 border border-white/5 rounded-xl text-white text-sm hover:bg-zinc-900 hover:border-white/10 transition-all cursor-pointer">
              <div className="flex items-center gap-3 min-w-0">
                <Languages size={20} className="text-white shrink-0" />
                <Swap id={currentLangLabel} className="font-semibold truncate min-w-0">{currentLangLabel}</Swap>
              </div>
              <ChevronDown size={20} className={`text-zinc-300 shrink-0 transition-transform ${langOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {langOpen && (
                <>
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} /* opens right below the language field */ className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-20 overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-white/5 bg-zinc-950/50">
                      <div className="flex items-center gap-2 bg-zinc-900 border border-white/10 rounded-lg px-3 py-2">
                        <Search size={14} className="text-neutral-300" />
                        <input autoFocus type="text" placeholder={t('settings.search_language')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-transparent text-xs text-white outline-none" />
                      </div>
                    </div>
                    <SmoothScroll className="max-h-48 overflow-y-auto custom-scrollbar" contentClassName="p-1">
                      {filteredLanguages.map((lang) => (
                        <button key={lang.value} onClick={() => handleLanguageChange(lang.value)} className="w-full flex items-center justify-between p-2.5 hover:bg-white/5 rounded-xl text-sm text-zinc-300 hover:text-white transition-colors cursor-pointer">
                          {lang.label}
                          <Pop show={settings.language === lang.value} className="flex">
                            <Check size={14} className="text-(--accent)" />
                          </Pop>
                        </button>
                      ))}
                    </SmoothScroll>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div variants={itemVariants} className="space-y-3">
            <label className="text-[12px] font-black text-zinc-300 uppercase tracking-widest leading-snug break-words px-1 block">{t('settings.general.path')}</label>
            <button onClick={() => settings.changeDefaultPath()} className={`w-full py-4 rounded-xl transition-all duration-300 flex items-center justify-center cursor-pointer group shadow-lg border ${settings.defaultPath ? "bg-zinc-900/50 border-(--accent-strong)/30 text-(--accent)" : "bg-white hover:bg-zinc-200 text-black border-transparent"}`}>
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
          <motion.div
            className="pt-4" /* 16 px above the Done button */
            initial={itemVariants.hidden}
            animate={{ ...itemVariants.visible, transition: { ...itemVariants.visible.transition, delay: doneDelay() } }}
          >
            <button onClick={onClose} className="w-full py-3.5 bg-(--accent-strong) hover:bg-(--accent-strong) text-white font-black uppercase tracking-widest text-[13px] rounded-xl transition-all shadow-[0_0_20px_color-mix(in_srgb,var(--accent-strong)_30%,transparent)] cursor-pointer active:scale-95">
              {t('settings.done')}
            </button>
          </motion.div>
        </Collapse>
      </motion.div>
    </div>
  );
}
