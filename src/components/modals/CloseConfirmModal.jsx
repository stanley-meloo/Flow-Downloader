import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Loader2, Power } from "lucide-react";
import { DownloadIcon as Download, ClockIcon as Clock } from "../ui/AnimatedIcons"; // animated (lucide-animated)
import { useTranslation } from "react-i18next";
import { Swap, Collapse } from "../ui/Motion";

// Confirmation shown when the user tries to close the app (close button, Alt+F4,
// Cmd+Q) while downloads are running or queued. Lists every file being
// downloaded (live progress) and how many are still waiting.
//   - "Keep downloading" (focused by default; also Esc / Enter) → app stays open.
//   - "Close anyway" → downloads are cancelled, incomplete files deleted, app closes.
export default function CloseConfirmModal({ items, waitingCount, closing, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const keepRef = useRef(null);
  const latest = useRef({});
  latest.current = { closing, onCancel };

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
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className="relative w-full max-w-lg max-h-[80vh] bg-zinc-950/90 backdrop-blur-2xl border border-white/10 rounded-[36px] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-6 pb-4 flex items-start gap-4 shrink-0">
          <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl shrink-0">
            <AlertTriangle size={22} className="text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-white text-lg font-bold leading-snug">
              {t('close_prompt.title', { defaultValue: 'Close Flow Downloader?' })}
            </h2>
            <Swap id={items.length} as="p" className="text-[12.5px] font-bold text-amber-300/90 mt-0.5">
              {t('close_prompt.count', { n: items.length, defaultValue: 'Files being downloaded: {{n}}' })}
            </Swap>
          </div>
        </div>

        <p className="px-6 text-[12.5px] text-zinc-400 leading-snug shrink-0">
          {t('close_prompt.message', { defaultValue: 'If you close the app now, these downloads will be cancelled and their incomplete files deleted.' })}
        </p>

        {/* Files being downloaded (live) */}
        <div className="mx-6 mt-4 flex-1 min-h-0 overflow-y-auto custom-scrollbar rounded-xl border border-white/5 bg-zinc-900/40">
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
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Swap id={processing} className="flex shrink-0">
                    {processing
                      ? <Loader2 size={15} className="text-amber-400 animate-spin" />
                      : <Download size={15} className="text-indigo-400" />}
                  </Swap>
                  <span className="flex-1 min-w-0 truncate text-[12.5px] font-mono text-zinc-200" data-tooltip={name}>
                    {name}
                  </span>
                  <span className={`text-[11px] font-bold shrink-0 tabular-nums transition-colors duration-300 ${processing ? 'text-amber-400' : 'text-zinc-400'}`}>
                    {processing
                      ? t('queue.processing', { defaultValue: 'Processing & Converting…' })
                      : `${Math.round(item.progress || 0)}%`}
                  </span>
                </div>
              </motion.div>
            );
          })}
          </AnimatePresence>
        </div>

        <Collapse show={waitingCount > 0} className="shrink-0">
          <div className="mx-6 pt-2 flex items-center gap-2 text-[11.5px] text-zinc-500">
            <Clock size={13} />
            {t('close_prompt.waiting', { n: waitingCount, defaultValue: 'Waiting in queue: {{n}}' })}
          </div>
        </Collapse>

        {/* Actions */}
        <div className="p-6 pt-5 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onConfirm}
            disabled={closing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[12.5px] font-bold text-red-300 hover:text-white hover:bg-red-500/80 border border-red-500/30 transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-70"
          >
            <Swap id={closing} className="flex items-center gap-2">
              {closing ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
              {closing
                ? t('close_prompt.closing', { defaultValue: 'Closing…' })
                : t('close_prompt.close', { defaultValue: 'Close anyway' })}
            </Swap>
          </button>
          <button
            ref={keepRef}
            onClick={onCancel}
            disabled={closing}
            className="px-4 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-[12.5px] font-black transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
          >
            {t('close_prompt.keep', { defaultValue: 'Keep downloading' })}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
