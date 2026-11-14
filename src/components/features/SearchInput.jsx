import { useState, useRef, useEffect } from "react";
import { TAP } from "../ui/Motion"; // fast, hard button press
import { SearchIcon as Search, LinkIcon } from "../ui/AnimatedIcons"; // animated (lucide-animated)
import { motion, AnimatePresence } from "framer-motion";
import { LoaderCircleIcon as Loader2 } from "../ui/AnimatedIcons"; // animated
import { useTranslation } from "react-i18next";
import { DEFAULT_KEYBINDS, withBind } from "../../utils/keybinds";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import StarBorder from "../ui/StarBorder";
import SearchBurst from "../ui/SearchBurst";

// Soft spring for the initial mount animation.
const liquidSpring = {
  type: "spring",
  stiffness: 150,
  damping: 25,
  mass: 0.8
};

// Liquid-glass material for the bar: the "dark" preset of LiquidGlass OSS.
// coreOpacity < 1 makes the middle truly see-through (the live background
// shows through it) while the rim refracts; the 30% left keeps text readable.
const GLASS_SETTINGS = { blur: 0.65, darkTint: 0.34, edgeHighlight: 0.14, coreOpacity: 0.3 };

// Snappier spring for physical motion (scale/rotate on hover/tap).
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
  tooltipHandlers,
  keybinds,
  onFocusChange, // tells App to dim the background while the bar is focused
  glassPaused = false, // a dialog covers the bar: stop rendering its glass
  cardOpen = false, // the download card is open (its closing "renews" the bar)
  renewSignal = 0   // changes when Auto Download adds a video (renews the bar too)
}) {
  const { t } = useTranslation();
  const kb = keybinds || DEFAULT_KEYBINDS;
  const { enter, move, leave } = tooltipHandlers || {};
  const [isFocused, setIsFocused] = useState(false);
  
  const inputRef = useRef(null);

  // "Renewed" animation when the download card closes: a soft pop plus a
  // sheen of light across the bar (App.css). `renew` counts the closings so
  // each one remounts the overlay and replays it.
  const [renew, setRenew] = useState(0);
  const [renewing, setRenewing] = useState(false);
  const wasOpen = useRef(cardOpen);
  useEffect(() => {
    if (wasOpen.current && !cardOpen) {
      setRenew((n) => n + 1);
      setRenewing(true);
      const id = setTimeout(() => setRenewing(false), 1400);
      wasOpen.current = cardOpen;
      return () => clearTimeout(id);
    }
    wasOpen.current = cardOpen;
  }, [cardOpen]);
  // A search starts: the premium sheen sweeps the bar too (after the burst
  // from the button), at its normal pace.
  const wasAnalyzing = useRef(analyzing);
  useEffect(() => {
    const started = analyzing && !wasAnalyzing.current;
    wasAnalyzing.current = analyzing;
    if (!started) return undefined;
    setRenew((n) => n + 1);
    setRenewing(true);
    const id = setTimeout(() => setRenewing(false), 1400);
    return () => clearTimeout(id);
  }, [analyzing]);

  // Auto Download sent a video to the queue (no card to close): same animation.
  useEffect(() => {
    if (!renewSignal) return undefined;
    setRenew((n) => n + 1);
    setRenewing(true);
    const id = setTimeout(() => setRenewing(false), 1400);
    return () => clearTimeout(id);
  }, [renewSignal]);

  const handlePasteAndFocus = () => {
    onPaste(); 
    
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  };

  return (
    <motion.div
      // Only movement here: the fade is on the glass itself (.glass-fade-in,
      // App.css) — a fading parent would switch off the glass's backdrop blur
      // until the end of the fade, which then popped in.
      initial={{ y: 20, scale: 0.9 }}
      animate={{ y: 0, scale: 1 }}
      transition={{ ...liquidSpring, delay: 1.45 }} // after the title is written (App.jsx INTRO.search)
      data-ctx="search" /* right-click menu */
      className={`w-full max-w-2xl shrink-0 relative z-20 group ${analyzing ? 'search-working' : ''} ${renewing ? 'search-renewed' : ''}`} /* subtle "working hard" shake (App.css) */
    >
      {/* --- SEARCHING: stars of light run around the bar, accelerating over time (StarBorder.jsx) --- */}
      <AnimatePresence>
        {analyzing && (
          <motion.div
            key="search-ring"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{ duration: 0.1 }} /* near-instant: the trails grow out of the button */
            className="absolute inset-0 z-20 pointer-events-none rounded-full"
            aria-hidden="true"
          >
            <StarBorder
              color="var(--glow-1)" /* follows the background's main color (utils/accentColor.js) */
              trailColor="var(--glow-2)" /* the background's second color */
              duration={1.5}
              direction="clockwise"
              stars={2}
              trailLength={0.3}
              thickness={1.5}
              glow={1.6}
              sparkle
              vary /* random shades of these colors, rarely the same twice */
              theme="dark"
            />
            {/* Burst of light + sparks from the search button (SearchBurst.jsx) */}
            <SearchBurst />
            {/* Shockwave from the search button when the search starts (App.css) */}
            <span className="search-wave">
              <span className="search-wave__flash" />
              <span className="search-wave__glow">
                <span className="search-wave__ring" />
              </span>
              <span className="search-wave__ring" />
              <span className="search-wave__ring search-wave__ring--echo" />
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- RENEWED: sheen + rim light after the download card closes (App.css) --- */}
      {renew > 0 && (
        <span key={renew} className="search-renew" aria-hidden="true">
          <span className="search-renew__rim" />
          <span className="search-renew__clip"><span className="search-renew__sheen" /></span>
        </span>
      )}

      {/* --- INPUTBAR (liquid glass: refracts the live background behind it) --- */}
      <LiquidGlass
        variant="dark"
        settings={GLASS_SETTINGS}
        focused={isFocused}
        paused={glassPaused}
        className="glass-fade-in z-10 flex items-center gap-2 p-2 rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-md" /* real blur of the live background seen through the clear core */
        style={{ "--fade-delay": "1.45s", "--fade-duration": "0.45s" }}
        fallbackClassName="backdrop-blur-2xl border border-white/10 bg-zinc-950/40"
      >
        
        {/* Geometry (concentric circles in a pill):
            bar height H = 8 (p-2) + 48 + 8 = 64 → end caps of radius 32.
            Both round buttons are d = 48 → inset (H − d) / 2 = 8 on every side,
            so each icon's center sits exactly on its end cap's center
            (32 px from the edge, both sides — symmetric).
            The input is h-12 too, so nothing makes the bar taller than 64. */}

        {/* --- PASTE BUTTON --- */}
        <motion.button
          whileHover="hover"
          whileTap="tap"
          variants={{
            hover: { scale: 1.1, rotate: -5 },
            tap: { scale: 0.95, rotate: 0, transition: TAP }
          }}
          transition={physicsSpring}
          
          onClick={handlePasteAndFocus} 
          onMouseEnter={(e) => enter && enter(e, withBind(t('search.paste_tooltip'), kb.paste))}
          onMouseMove={move}
          onMouseLeave={leave}
          disabled={analyzing}
          className="relative w-12 h-12 shrink-0 flex items-center justify-center rounded-full text-zinc-300 hover:text-white transition-colors disabled:opacity-30 cursor-pointer overflow-hidden isolate"
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
          id="flow-search-input"
          data-contrast /* placeholder turns dark on a light background (utils/contrastWatch.js) */
          className="flex-1 min-w-0 h-12 bg-transparent border-none text-white px-2 outline-none placeholder-zinc-500/70 text-lg font-medium cursor-text tracking-wide"
          placeholder={analyzing ? t('search.analyzing_placeholder') : t('search.placeholder')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          /* The search shortcut (Enter by default) is handled globally in App.jsx,
             including while this input is focused — so it follows the user's binding. */
          onFocus={() => { setIsFocused(true); onFocusChange?.(true); }}
          onBlur={() => { setIsFocused(false); onFocusChange?.(false); }}
          disabled={analyzing}
        />

        {/* --- FETCH BUTTON --- */}
        <motion.button
          whileHover={{ scale: 1.1, rotate: 5, boxShadow: "0 0 20px rgba(255,255,255,0.4)" }}
          whileTap={{ scale: 0.94, transition: TAP }}
          transition={physicsSpring}
          onClick={onAnalyze}
          onMouseEnter={(e) => enter && enter(e, analyzing ? t('search.analyzing_tooltip') : withBind(t('search.analyze_tooltip'), kb.search))}
          onMouseMove={move}
          onMouseLeave={leave}
          disabled={analyzing}
          className="text-black w-12 h-12 shrink-0 flex items-center justify-center rounded-full disabled:opacity-100 disabled:scale-100 cursor-pointer z-10 bg-white"
        >
          {/* Magnifier ↔ spinner swap with a quick scale/fade */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={analyzing ? 'loading' : 'idle'}
              className="flex"
              initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.5, rotate: 45 }}
              transition={{ duration: 0.15 }}
            >
              {analyzing ? (
                <Loader2 className="animate-spin" size={20} strokeWidth={2.5} />
              ) : (
                <Search size={20} strokeWidth={2.5} />
              )}
            </motion.span>
          </AnimatePresence>
        </motion.button>

      </LiquidGlass>
    </motion.div>
  );
}