import { useState, useImperativeHandle, forwardRef, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import LiquidGlass from './liquidGlass/LiquidGlass';
import { XIcon } from './AnimatedIcons';

// Toast notifications. Exposes an imperative `add(messageKey, type, params?)` via ref so
// any component can fire a toast through the app-level `showToast` helper.
// `messageKey` is an i18n key under "toast.*"; `type` picks the color, icon and
// short title (toast.titles.*): success, error, info, download.
//
// Design (liquid glass, same material family as the menus/dialogs):
//   - Geometry: 12 px padding around a square icon tile as tall as the text
//     (40 px for one line, +20 per line); tile radius = 30 % of it, card
//     radius = tile radius + 12 (concentric). One line: 40 / 12 / 24. 12 px gap = the padding, so the
//     spacing rhythm is one value.
//   - Width follows the text (up to 440 px): short messages give a compact
//     card (12 + tile + 12 + text + 12 + close + 12), long ones take 2 lines
//     instead of 3+.
//   - Text on a 4 px grid (title 16 + 4 + lines of 20): title + first line =
//     40 = tile height. Heights: 64 px for one line, +20 per extra line, with
//     the same 12 px above and below.
//   - Icon tile and close button stay pinned to the top row: the tile is
//     always 12 px from the top-left corner (concentric), even when the text
//     wraps; the close button sits centered on the tile.
//   - Position: bottom-6, right-20 — bottom-aligned with the round buttons and
//     16 px to their left, so it never covers them.
//   - One color per type, used for the tile tint, the icon and the title.
//   - On screen for 4.5 s; hovering pauses the timer.
//   - Enters from below and leaves downward (never crosses the round buttons).
//   - Icons draw themselves in when the toast appears (stroke animation).

const DURATION = 4500; // ms on screen
const TILE_MIN = 40;   // px: one line of message (16 + 4 + 20)
const TILE_MAX = 80;   // px: up to three lines
const TOAST_GLASS = { blur: 1, preBlur: 10, darkTint: 0.55, edgeHighlight: 0.12, depth: 16, coreOpacity: 0.6 };

let nextToastId = 0; // unique ids even for toasts fired in the same millisecond

// Type → color (Tailwind 400 shades) + default title.
const TYPES = {
  success:  { color: '#34d399', title: 'Done' },     // emerald-400
  error:    { color: '#f87171', title: 'Error' },    // red-400
  info:     { color: '#60a5fa', title: 'Notice' },   // blue-400
  download: { color: '#a78bfa', title: 'Download' }, // violet-400
};

// --- Self-drawing icons (24×24, Lucide-style strokes) ---------------------------
const draw = (delay = 0, duration = 0.45) => ({
  initial: { pathLength: 0, opacity: 0 },
  animate: { pathLength: 1, opacity: 1 },
  transition: { pathLength: { delay, duration, ease: 'easeOut' }, opacity: { delay, duration: 0.01 } },
});

function ToastIcon({ type, size = 20 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (type === 'success') {
    return (
      <svg {...common}>
        <motion.circle cx="12" cy="12" r="10" {...draw(0, 0.5)} />
        <motion.path d="m8.5 12.5 2.5 2.5 5-5.5" {...draw(0.35, 0.35)} />
      </svg>
    );
  }
  if (type === 'error') {
    return (
      <motion.svg {...common} initial={{ x: 0 }} animate={{ x: [0, -2, 2, -1.5, 1.5, 0] }} transition={{ delay: 0.55, duration: 0.4 }}>
        <motion.circle cx="12" cy="12" r="10" {...draw(0, 0.5)} />
        <motion.path d="M12 7.5v5.5" {...draw(0.35, 0.25)} />
        <motion.path d="M12 16.5h.01" {...draw(0.5, 0.1)} />
      </motion.svg>
    );
  }
  if (type === 'download') {
    return (
      <svg {...common}>
        <motion.path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...draw(0, 0.45)} />
        <motion.g initial={{ y: -5, opacity: 0 }} animate={{ y: [-5, 1.5, 0], opacity: 1 }} transition={{ delay: 0.2, duration: 0.5, ease: 'easeOut' }}>
          <path d="m7 10 5 5 5-5" />
          <path d="M12 15V3" />
        </motion.g>
      </svg>
    );
  }
  // info
  return (
    <svg {...common}>
      <motion.circle cx="12" cy="12" r="10" {...draw(0, 0.5)} />
      <motion.path d="M12 16.5V11" {...draw(0.4, 0.25)} />
      <motion.circle cx="12" cy="7.75" r="0.6" fill="currentColor" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.3, type: 'spring', stiffness: 400, damping: 12 }} />
    </svg>
  );
}

// Folder paths inside a message are marked <path>…</path> in the translations
// and shown in Arial (class "font-path", same as everywhere else in the app).
function renderMessage(text) {
  const parts = String(text).split(/<path>(.*?)<\/path>/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <span key={i} className="font-path">{part}</span> : part
  );
}

// --- One toast (own timer, paused while hovered) --------------------------------
function ToastCard({ toast, onClose, t }) {
  const cfg = TYPES[toast.type] || TYPES.info;
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DURATION);

  // The icon tile grows with the text: it's a square as tall as the text block
  // (40 px for one line, 60 for two…), so it stays centered and in proportion.
  // Everything else follows from it:
  //   icon = tile / 2 · tile radius = 30 % of the tile · card radius = tile
  //   radius + 12 (padding, concentric) · close button centered on the tile.
  const textRef = useRef(null);
  const [tile, setTile] = useState(TILE_MIN);
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.round(el.offsetHeight);
      setTile(Math.min(TILE_MAX, Math.max(TILE_MIN, h)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const tileRadius = Math.round(tile * 0.3);
  const cardRadius = tileRadius + 12;
  const startedAt = useRef(0);

  useEffect(() => {
    if (paused) return;
    startedAt.current = performance.now();
    const timer = setTimeout(onClose, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - startedAt.current;
    };
  }, [paused, onClose]);

  const title = t(`toast.titles.${toast.type}`, { defaultValue: cfg.title });
  const message = t(`toast.${toast.messageKey}`, { defaultValue: toast.messageKey, ...(toast.params || {}) });

  return (
    <motion.div
      layout
      // Rises from below (vertical only, so it never slides across the round
      // buttons on its right) and sinks back down when it leaves.
      initial={{ opacity: 0, y: 32, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.97, transition: { duration: 0.2, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role={toast.type === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto relative isolate w-max max-w-[min(440px,calc(100vw-104px))] p-3 flex items-start gap-3 text-zinc-100 backdrop-blur-md"
      style={{ borderRadius: cardRadius, boxShadow: `0 12px 40px -12px rgba(0,0,0,0.6), 0 0 24px -10px ${cfg.color}55` }}
    >
      <LiquidGlass
        variant="dark"
        settings={TOAST_GLASS}
        radius={cardRadius}
        shared
        maxFps={30}
        className="absolute inset-0 -z-10 pointer-events-none overflow-hidden"
        style={{ borderRadius: cardRadius }}
        fallbackClassName="bg-zinc-950/85 backdrop-blur-2xl border border-white/10"
      />

      {/* Icon tile: square, as tall as the text block (see `tile` above) */}
      <div
        className="shrink-0 flex items-center justify-center transition-[width,height,border-radius] duration-200"
        style={{ width: tile, height: tile, borderRadius: tileRadius, color: cfg.color, background: `${cfg.color}1f`, boxShadow: `inset 0 0 0 1px ${cfg.color}40` }}
      >
        <ToastIcon type={toast.type} size={Math.round(tile / 2)} />
      </div>

      {/* Text on a 4 px grid: title line 16 + gap 4 + message lines of 20.
          Title + first line = 16 + 4 + 20 = 40 = the tile's height, so the tile's
          top/bottom line up exactly with the title's top and the first line's
          bottom; extra lines continue below at the same 20 px rhythm. */}
      <div ref={textRef} className="flex-1 min-w-0">
        <p className="h-4 text-[11px] leading-4 font-black uppercase tracking-widest" style={{ color: cfg.color }}>
          {title}
        </p>
        <p className="mt-1 text-[13px] leading-5 font-semibold text-zinc-100 break-words [text-wrap:pretty]">{renderMessage(message)}</p>
      </div>

      {/* Close: round, centered on the tile's row (40 px tile, 28 px button → 6 px down) */}
      <button
        onClick={onClose}
        aria-label={t('tooltips.close', { defaultValue: 'Close' })}
        style={{ marginTop: (tile - 28) / 2 }}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-zinc-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
      >
        <XIcon size={14} />
      </button>

    </motion.div>
  );
}

const Toast = forwardRef((props, ref) => {
  const [toasts, setToasts] = useState([]);
  const { t } = useTranslation();
  const closers = useRef(new Map()); // stable onClose per toast (keeps the timer effect stable)

  const remove = (id) => {
    closers.current.delete(id);
    setToasts(prev => prev.filter(x => x.id !== id));
  };
  const closerFor = (id) => {
    if (!closers.current.has(id)) closers.current.set(id, () => remove(id));
    return closers.current.get(id);
  };

  useImperativeHandle(ref, () => ({
    add(messageKey, type = 'info', params) {
      const id = ++nextToastId;
      // Same message already on screen: replace it instead of stacking duplicates.
      setToasts(prev => [...prev.filter(x => x.messageKey !== messageKey), { id, messageKey, type, params }].slice(-4));
    }
  }));

  return (
    <div className="fixed bottom-6 right-20 flex flex-col items-end gap-3 z-[10005] pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onClose={closerFor(toast.id)} t={t} />
        ))}
      </AnimatePresence>
    </div>
  );
});

export default Toast;
