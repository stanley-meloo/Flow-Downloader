import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Loader2, Link as LinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

// Mola suave para entrada inicial
const liquidSpring = { 
  type: "spring", 
  stiffness: 150, 
  damping: 25, 
  mass: 0.8 
};

// Mola "crocante" para o movimento físico (Scale/Rotate)
const physicsSpring = {
  type: "spring",
  stiffness: 400,
  damping: 25,
  mass: 0.5
};

export default function SearchInput({ 
  url, 
  setUrl, 
  analyzing, 
  onAnalyze, 
  onPaste, 
  tooltipHandlers 
}) {
  const { t } = useTranslation();
  const { enter, move, leave } = tooltipHandlers || {};
  const [isFocused, setIsFocused] = useState(false);
  
  const inputRef = useRef(null);

  const handlePasteAndFocus = () => {
    onPaste(); 
    
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...liquidSpring, delay: 0.1 }}
      className="w-full max-w-2xl shrink-0 relative z-20 group"
    >
      {/* --- GLOW --- */}
      <AnimatePresence>
        {analyzing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            className="absolute -inset-[5px] rounded-full z-0 overflow-hidden blur-2xl"
          >
            <motion.div
              className="flex w-[200%] h-full"
              animate={{ x: ["-50%", "0%"] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            >
              <div className="w-1/2 h-full flex-shrink-0" style={{ background: "linear-gradient(90deg, #06b6d4, #a855f7, #3b82f6, #06b6d4)" }} />
              <div className="w-1/2 h-full flex-shrink-0" style={{ background: "linear-gradient(90deg, #06b6d4, #a855f7, #3b82f6, #06b6d4)" }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- INPUTBAR --- */}
      <motion.div 
        animate={{
          backgroundColor: isFocused ? "rgba(9, 9, 11, 0.6)" : "rgba(9, 9, 11, 0.3)",
          borderColor: isFocused ? "rgba(255, 255, 255, 0.25)" : "rgba(255, 255, 255, 0.1)",
          boxShadow: isFocused 
            ? "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 1px rgba(255,255,255,0.15)" 
            : "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.1)"
        }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative z-10 flex items-center gap-2 backdrop-blur-2xl border p-2 rounded-full"
      >
        
        {/* --- PASTE BUTTON --- */}
        <motion.button
          whileHover="hover"
          whileTap="tap"
          variants={{
            hover: { scale: 1.1, rotate: -5 },
            tap: { scale: 0.9, rotate: 0 }
          }}
          transition={physicsSpring}
          
          onClick={handlePasteAndFocus} 
          onMouseEnter={(e) => enter && enter(e, t('search.paste_tooltip'))}
          onMouseMove={move}
          onMouseLeave={leave}
          disabled={analyzing}
          className="relative p-3 rounded-full text-zinc-400 hover:text-white transition-colors disabled:opacity-30 ml-1 cursor-pointer overflow-hidden isolate"
        >
          {/* 2. Separate background (Animate Opacity = Super Light) */}
          <motion.div 
            variants={{
              hover: { opacity: 1 },
              tap: { opacity: 1 }
            }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }} 
            className="absolute inset-0 bg-white/10 z-[-1]"
          />
          
          <LinkIcon size={20} className="relative z-10" />
        </motion.button>


        {/* Text field */}
        <input
          ref={inputRef} 
          className="flex-1 bg-transparent border-none text-white px-2 py-3 outline-none placeholder-zinc-500/70 text-lg font-medium cursor-text tracking-wide"
          placeholder={analyzing ? t('search.analyzing_placeholder') : t('search.placeholder')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAnalyze()}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={analyzing}
        />

        {/* --- FETCH BUTTON --- */}
        <motion.button
          whileHover={{ 
            scale: 1.1, 
            rotate: 5,
            backgroundColor: "rgba(255,255,255,1)", 
            boxShadow: "0 0 20px rgba(255,255,255,0.4)" 
          }}
          whileTap={{ scale: 0.85 }}
          transition={physicsSpring}
          onClick={onAnalyze}
          onMouseEnter={(e) => enter && enter(e, analyzing ? t('search.analyzing_tooltip') : t('search.analyze_tooltip'))}
          onMouseMove={move}
          onMouseLeave={leave}
          disabled={analyzing}
          className="bg-white/90 text-black w-12 h-12 flex items-center justify-center rounded-full transition-colors disabled:opacity-100 disabled:scale-100 cursor-pointer z-10 backdrop-blur-sm"
        >
          {analyzing ? (
            <Loader2 className="animate-spin text-black" size={20} />
          ) : (
            <Search size={20} strokeWidth={2.5} />
          )}
        </motion.button>

      </motion.div>
    </motion.div>
  );
}