import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TriangleAlertIcon as AlertTriangle, LoaderCircleIcon as Loader2, PowerIcon as Power, XIcon as X } from "../ui/AnimatedIcons"; // animated
import { useTranslation } from "react-i18next";
import { Swap, Collapse } from "../ui/Motion";
import SmoothScroll from "../ui/SmoothScroll";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import { DIALOG_GLASS } from "../ui/liquidGlass/presets";

// Confirmation shown when the user tries to close the app (close button, Alt+F4,
// Cmd+Q) while downloads are running or queued. Lists every file being
// downloaded (live progress) and how many are still waiting.
//   - "Keep downloading" (focused by default; also Esc / Enter) → app stays open.
//   - "Close anyway" → downloads are cancelled, incomplete files deleted, app closes.
//   - Clicking a file closes this dialog and takes you to that download in the
//     queue (onSelect → App scrolls to it and highlights it).
//   - If everything finishes while it's open, the app closes by itself (that's
//     what the user asked for in the first place).
// Same look as the other dialogs: liquid glass, 24 px padding, 12 px controls
// → 36 px corners (outer radius = inner radius + padding).
export default function CloseConfirmModal({ items, waitingCount, closing, onConfirm, onCancel, onSelect }) {
  const { t } = useTranslation();
  const keepRef = useRef(null);
  const latest = useRef({});
  latest.current = { closing, onCancel };

  // Nothing left running or waiting → finish the close the user asked for.
  const nothingLeft = items.length === 0 && waitingCount === 0;
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm; // latest handler without restarting the timer on every render
  useEffect(() => {
    if (!nothingLeft || closing) return;
    const timer = setTimeout(() => confirmRef.current(), 400); // let the last row slide out first
    return () => clearTimeout(timer);
  }, [nothingLeft, closing]);

  // Own the keyboard while open (capture phase + stop), so the download window
  // or global shortcuts underneath never react — e.g. Enter must not start a
  // download here. Enter still activates the focused button ("Keep downloading").
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (e) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!latest.current.closing) latest.current.onCancel();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={closing ? undefined : onCancel}
        // No dark tint here: the dimming is done inside the app background
        // (App.jsx), so this dialog's liquid glass sees it too.
        className="absolute inset-0 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="relative isolate w-full max-w-xl max-h-[80vh] rounded-[36px] shadow-2xl overflow-hidden backdrop-blur-md flex flex-col" /* no CSS bg/border: the glass draws them */
      >
        <LiquidGlass
          variant="dark"
          settings={DIALOG_GLASS}
          radius={36}
          className="absolute inset-0 -z-10 pointer-events-none rounded-[36px]"
          fallbackClassName="bg-zinc-950/80 backdrop-blur-2xl border border-white/10"
        />
        {/* Close (= keep downloading), same spot and look as the other dialogs */}
        <button
          onClick={onCancel}
          disabled={closing}
          aria-label={t('tooltips.close', { defaultValue: 'Close' })}
          className="absolute top-4 right-4 z-10 p-1 text-zinc-300 hover:text-white hover:bg-white/5 rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          <X size={22} />
        </button>

        {/* Header */}
        <div className="p-6 pb-4 pr-14 flex items-start gap-4 shrink-0">
          <div className="w-12 h-12 flex items-center justify-center bg-red-500/10 border border-red-500/30 rounded-xl shrink-0">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-white text-xl font-bold leading-snug">
              {t('close_prompt.title', { defaultValue: 'Close Flow Downloader?' })}
            </h2>
            <Swap id={items.length} as="p" className="text-[14px] font-bold text-zinc-300 mt-0.5">
              {t('close_prompt.count', { n: items.length, defaultValue: 'Files being downloaded: {{n}}' })}
            </Swap>
          </div>
        </div>

        <p className="px-6 text-[14px] text-zinc-300 leading-snug shrink-0">
          {t('close_prompt.message', { defaultValue: 'If you close the app now, these downloads will be cancelled and their incomplete files deleted.' })}
        </p>

        {/* Files being downloaded (live) */}
        <SmoothScroll className="mx-6 mt-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar rounded-xl border border-white/5 bg-zinc-900/40">
          {/* Rows slide out as their downloads finish while the dialog is open */}
          <AnimatePresence initial={false}>
          {items.map((item, i) => {
            const name = item.outputFile || item.title;
            const processing = item.status === "Processing...";
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: "easeInOut" }}
                className={`overflow-hidden ${i > 0 ? 'border-t border-white/5' : ''}`}
              >
                <button
                  type="button"
                  disabled={closing}
                  onClick={() => onSelect?.(item.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer outline-none transition-colors duration-200 hover:bg-white/[0.06] focus-visible:bg-white/[0.06] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <Loader2 size={17} className="text-zinc-300 animate-spin shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-[14px] font-mono text-zinc-200">
                    {name}
                  </span>
                  <span className={`text-[12.5px] font-bold shrink-0 tabular-nums transition-colors duration-300 ${processing ? 'text-zinc-100' : 'text-zinc-300'}`}>
                    {processing
                      ? t('queue.processing', { defaultValue: 'Processing & Converting…' })
                      : `${Math.round(item.progress || 0)}%`}
                  </span>
                </button>
              </motion.div>
            );
          })}
          </AnimatePresence>
        </SmoothScroll>

        <Collapse show={waitingCount > 0} className="shrink-0">
          <div className="mx-6 pt-2 px-1 text-[13px] text-zinc-300">
            {t('close_prompt.waiting', { n: waitingCount, defaultValue: 'Waiting in queue: {{n}}' })}
          </div>
        </Collapse>

        {/* Actions */}
        <div className="p-6 pt-5 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onConfirm}
            disabled={closing}
            className="flex items-center gap-2 h-11 px-4 rounded-xl text-[14px] font-bold text-red-300 hover:text-white hover:bg-red-500/80 border border-red-500/30 transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-70"
          >
            <Swap id={closing} className="flex items-center gap-2">
              {closing ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
              {closing
                ? t('close_prompt.closing', { defaultValue: 'Closing…' })
                : t('close_prompt.close', { defaultValue: 'Close anyway' })}
            </Swap>
          </button>
          <button
            ref={keepRef}
            onClick={onCancel}
            disabled={closing}
            className="h-11 px-4 rounded-xl bg-white hover:bg-zinc-200 text-black text-[14px] font-black transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50"
          >
            {t('close_prompt.keep', { defaultValue: 'Keep downloading' })}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
