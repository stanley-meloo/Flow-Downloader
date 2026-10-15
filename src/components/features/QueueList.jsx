import { useState, useEffect, useRef, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Loader2, X } from "lucide-react";
import { FolderOpenIcon as FolderOpen, RotateCcwIcon as RotateCcw, CircleCheckIcon as CheckCircle, BanIcon as Ban, TrashIcon as Trash2, ChartColumnIncreasingIcon, HourglassIcon } from "../ui/AnimatedIcons"; // animated (lucide-animated)
import { useTranslation } from "react-i18next";
import { openMediaLocation } from "../../utils/fileSystem";
import { isYouTubeUrl, youtubeThumb } from "../../utils/media";
import { Swap } from "../ui/Motion";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";

// Liquid-glass material for the queue cards: like the search bar (partly
// see-through middle), a bit darker so titles/progress stay readable.
// Stronger refraction and a deeper rim than the dark preset, so the
// background visibly bends along the card edges.
// Blur matches the search bar: shader blur 0.65 + CSS backdrop-blur-md on the card.
const QUEUE_GLASS = { blur: 0.65, refraction: 1.15, depth: 34, chromaticAberration: 0.06, darkTint: 0.38, edgeHighlight: 0.14, coreOpacity: 0.55 };

export default function QueueList({
  queue,
  tooltipHandlers,
  showToast,
  onCancelItem,
  onRetryItem,
  onRemoveItem,
  glassPaused = false, // a dialog covers the queue: its items stop rendering their glass
  dimmed = false       // the search bar is focused: the queue darkens with the background
}) {
  const { t } = useTranslation();
  const { enter, move, leave } = tooltipHandlers || {};

  return (
    <motion.div
      initial={false}
      animate={{ opacity: dimmed ? 0.45 : 1 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      data-ctx="queue" /* right-click menu */
      className="w-full flex-1 min-h-0 mt-10 mb-2 overflow-hidden flex flex-col relative"
    >
      <AnimatePresence>
        {queue.length > 0 && (
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-white text-xs font-bold uppercase tracking-widest mb-4 flex justify-between px-2 items-center"
          >
            <span>{t('queue.title', 'Download Queue')}</span>
            {/* "1 item" / "3 items" — plural forms per language (i18next count) */}
            <Swap id={queue.length} className="inline-block normal-case tracking-normal font-medium text-[12px] text-zinc-400" y={3}>
              {t('queue.items', { count: queue.length, defaultValue: '{{count}} items' })}
            </Swap>
          </motion.h3>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar p-1">
        <motion.div layout className="space-y-4">
          <AnimatePresence mode="popLayout">
            {queue.map((item) => (
              <QueueItem
                key={item.id} 
                item={item}
                t={t}
                handlers={{ enter, move, leave }}
                actions={{ openMediaLocation, showToast, onCancelItem, onRetryItem, onRemoveItem }}
                glassPaused={glassPaused}
              />
            ))}
          </AnimatePresence>
        </motion.div>
        <div className="h-0 w-full shrink-0 pointer-events-none" />
      </div>
    </motion.div>
  );
}

// Only re-render an item when its own visible fields change. This prevents
// every progress tick (which replaces the whole queue array) from re-rendering
// the entire list.
const areItemsEqual = (prev, next) => {
  const a = prev.item, b = next.item;
  return (
    prev.glassPaused === next.glassPaused &&
    a.id === b.id &&
    a.status === b.status &&
    a.progress === b.progress &&
    a.speed === b.speed &&
    a.eta === b.eta &&
    a.totalTime === b.totalTime &&
    a.thumbnail === b.thumbnail &&
    a.outputFile === b.outputFile &&
    a.errorKey === b.errorKey &&
    a.title === b.title
  );
};

const QueueItem = memo(function QueueItem({ item, t, handlers, actions, glassPaused }) {
  const [imgSrc, setImgSrc] = useState(item.thumbnail);

  useEffect(() => {
    setImgSrc(item.thumbnail);
  }, [item.thumbnail]);

  // Derive the visual state from the item's status string (set by useDownloader).
  // Order matters: a finished/processing item must win over later checks.
  const isFinished = item.status === "Done";
  const isProcessing = item.status === "Processing...";
  const isCanceled = !isFinished && !isProcessing && item.status === "Canceled";
  const isError = !isFinished && !isProcessing && !isCanceled && item.status === "Error";
  const isDownloading = item.status === "Downloading";

  // Shine once when this item turns "Done" while on screen (not for items that
  // were already finished when the list appeared).
  const [shine, setShine] = useState(false);
  const prevStatus = useRef(item.status);
  useEffect(() => {
    if (item.status === "Done" && prevStatus.current !== "Done") setShine(true);
    prevStatus.current = item.status;
  }, [item.status]);
  // One key per visual phase: changing phase crossfades the overlay icon, the
  // status row and the action buttons (progress ticks within a phase don't).
  const phase = isFinished ? 'done' : isProcessing ? 'processing' : isCanceled ? 'canceled' : isError ? 'error' : 'active';
  const actionsKey = isFinished ? 'done' : (isCanceled || isError) ? 'retry' : 'cancel';

  let progressColor = "bg-blue-500";
  if (isProcessing) progressColor = "bg-amber-500 animate-pulse"; // pulsing amber while post-processing
  if (isError) progressColor = "bg-red-500";
  if (isCanceled) progressColor = "bg-zinc-600";
  if (isFinished) progressColor = "bg-emerald-500";

  let overlayClasses = "opacity-100 backdrop-blur-[4px] bg-black/40";
  let OverlayIcon = null;
  let iconColor = "text-white";
  let overlayText = null;

  if (isFinished) {
    overlayClasses = "opacity-0 group-hover:opacity-100 bg-black/60 transition-opacity duration-300";
    OverlayIcon = CheckCircle;
    iconColor = "text-emerald-400";
  } else if (isCanceled) {
    overlayClasses = "opacity-100 backdrop-blur-sm bg-black/60";
    OverlayIcon = Ban;
    iconColor = "text-zinc-400";
  } else if (isError) {
    overlayClasses = "opacity-100 backdrop-blur-sm bg-red-500/20";
    OverlayIcon = AlertCircle;
    iconColor = "text-red-400";
  } else if (isProcessing) {
    overlayClasses = "opacity-100 backdrop-blur-[4px] bg-black/50";
    OverlayIcon = Loader2;
    iconColor = "text-amber-400 animate-spin"; // spinning loader
  } else if (item.progress > 0 && item.progress <= 100) {
    overlayText = <span className="text-[11px] font-bold text-white drop-shadow-md">{item.progress.toFixed(0)}%</span>;
  }

  // Thumbnail failed to load: YouTube videos fall back to the always-available
  // hqdefault image; for other sites we just show the empty placeholder.
  const handleImageError = () => {
    const fallback = isYouTubeUrl(item.url) ? youtubeThumb(item.videoId) : null;
    setImgSrc(fallback && imgSrc !== fallback ? fallback : null);
  };

  return (
    <motion.div
      // layout="position": cards glide to their new place when the list changes,
      // but are never animated by SIZE. A size animation is done with a scale
      // transform that also squashes the children (the thumbnail ended up
      // shifted inside its frame after the status row changed on completion).
      layout="position"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      transition={{ 
        layout: { type: "spring", stiffness: 300, damping: 30 },
        opacity: { duration: 0.2 }
      }}
      data-ctx="queue-item" data-ctx-id={item.id} /* right-click menu */
      className="relative isolate group p-3 rounded-[20px] flex items-center gap-4 backdrop-blur-md" /* no CSS bg/border: the glass draws them; backdrop-blur-md = same blur as the search bar */
    >
      {/* Liquid glass card. All queue items share ONE WebGL context ("shared"),
          so a long playlist never runs into the browser's context limit. */}
      <LiquidGlass
        variant="dark"
        settings={QUEUE_GLASS}
        radius={20}
        shared
        maxFps={30}          // many cards at once: 30 fps is plenty for the glass
        paused={glassPaused}
        // overflow-hidden: the glass canvas is a bit larger than the card; it must
        // not stick out, or the queue list gets a horizontal scrollbar.
        className="absolute inset-0 -z-10 pointer-events-none rounded-[20px] overflow-hidden"
        fallbackClassName="bg-zinc-950/30 backdrop-blur-xl border border-white/5"
      />
      {/* One-time premium shine across the card (and thumbnail) when it finishes */}
      {shine && (
        <span className="queue-finish-shine" aria-hidden="true" onAnimationEnd={() => setShine(false)} />
      )}
      <div className="w-28 h-16 bg-zinc-900 rounded-lg relative shrink-0 shadow-lg group/thumb overflow-hidden">
        <div className="absolute inset-0 rounded-lg border border-white/10 z-20 pointer-events-none" />

        {imgSrc && (
          <img
            src={imgSrc}
            referrerPolicy="no-referrer"
            onError={handleImageError}
            className={`w-full h-full object-cover rounded-lg block transition-all duration-500 ${isFinished ? 'opacity-100' : 'opacity-60'} ${(isCanceled || isError) ? 'grayscale opacity-40' : ''}`}
            alt=""
          />
        )}

        <div className={`absolute inset-0 z-10 flex items-center justify-center rounded-lg transition-all duration-500 ${overlayClasses}`}>
          <Swap id={phase} className="flex items-center justify-center">
            {overlayText}
            {OverlayIcon && <OverlayIcon size={24} className={`${iconColor} drop-shadow-lg`} />}
          </Swap>
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        <h4 className={`font-medium truncate text-base transition-colors duration-300 ${isCanceled ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>{item.title}</h4>
        
        {/* Dynamic progress bar */}
        {/* overflow-visible so the glowing tip isn't cut; the fill is rounded itself */}
        <div className="w-full h-1.5 bg-zinc-800/50 rounded-full mt-1 border border-white/5 relative">
          <motion.div
            className={`relative h-full rounded-full ${progressColor} shadow-[0_0_10px_currentColor] transition-colors duration-500`}
            initial={{ width: 0 }}
            animate={{ width: isProcessing ? '100%' : `${item.progress}%` }}
            transition={{ duration: 0.3 }}
          >
            {/* Small point of light riding the tip of the bar while downloading */}
            {isDownloading && item.progress > 0 && (
              <span className="queue-bar-spark" aria-hidden="true" />
            )}
          </motion.div>
        </div>

        <div className="flex items-center gap-4 mt-1 text-[11px] text-white font-medium h-4">
          {/* The whole status row crossfades when the phase changes */}
          <Swap id={phase} as="div" className="flex items-center gap-2">

          {/* While actively downloading: show speed + ETA */}
          {!isFinished && !isCanceled && !isError && !isProcessing && (
            <>
              {/* Speed (bar-chart icon) and time left (hourglass icon), both looping */}
              {/* Fixed-width slots: the hourglass and the time never shift
                  sideways when the speed text gets longer or shorter. */}
              <span className="flex items-center gap-1.5 w-[88px] shrink-0" data-tooltip={t('queue.speed', 'Speed').replace(/:$/, '')}>
                <ChartColumnIncreasingIcon size={16} className="text-zinc-400" />
                <span className="text-zinc-300 tabular-nums whitespace-nowrap">{item.speed || "0 KB/s"}</span>
              </span>
              <span className="flex items-center gap-1.5 w-[110px] shrink-0" data-tooltip={t('queue.eta', 'Remaining time').replace(/:$/, '')}>
                <HourglassIcon size={16} className="text-zinc-400" />
                <span className="text-zinc-300 tabular-nums whitespace-nowrap">{item.eta || "--:--"}</span>
              </span>
            </>
          )}

          {/* Post-processing feedback (replaces the speed/ETA row) */}
          {isProcessing && (
            <span className="text-amber-400 font-medium flex items-center gap-1.5">
            {t('queue.processing', 'Processing & Converting…')}
            </span>
          )}
          
          {isFinished && (
            item.totalTime ? (
              <span className="text-emerald-400 font-medium">
                {t('queue.finished_in', { time: item.totalTime })}
              </span>
            ) : (
              <span className="text-emerald-400 font-medium">
                {t('queue.finished', 'Completed')}
              </span>
            )
          )}

          {isCanceled && <span className="text-zinc-500 flex items-center gap-1"><Ban size={10} /> {t('queue.canceled', 'Canceled')}</span>}
          {/* Error: the specific reason when known (e.g. "unavailable in your country") */}
          {isError && (() => {
            const reason = item.errorKey ? t(`toast.${item.errorKey}`, { defaultValue: 'Canceled' }) : '';
            return (
              <span className="text-red-400 flex items-center gap-1 min-w-0" data-tooltip={reason || undefined}>
                <AlertCircle size={10} className="shrink-0" />
                <span className="truncate">{reason || t('queue.error', 'Download Error')}</span>
              </span>
            );
          })()}
          </Swap>
        </div>
      </div>

      {/* Action buttons — crossfade between cancel / open+delete / retry+delete */}
      <Swap id={actionsKey} as="div" className="flex items-center gap-2">
        {!isFinished && !isCanceled && !isError && (
          <ActionButton
            icon={X}
            tooltip={t('queue.cancel', 'Cancel download')}
            onClick={() => actions.onCancelItem(item.id)}
            handlers={handlers} color="text-zinc-400 hover:text-red-400 hover:bg-red-400/10"
          />
        )}
        {isFinished && (
          <>
            <ActionButton
              icon={FolderOpen} tooltip={t('queue.open_folder', 'Go to file')}
              onClick={() => actions.openMediaLocation(item.directory, item.outputFile, item.title, item.ext, actions.showToast)}
              handlers={handlers} color="text-stone-300 hover:text-white hover:bg-white/10"
            />
            <ActionButton
              icon={Trash2} tooltip={t('queue.delete', 'Remove from list')}
              onClick={() => actions.onRemoveItem(item.id)}
              handlers={handlers} color="text-zinc-400 hover:text-red-400 hover:bg-red-400/10"
            />
          </>
        )}
        {(isCanceled || isError) && (
          <>
            <ActionButton
              icon={RotateCcw} tooltip={t('queue.retry', 'Try again')}
              onClick={() => actions.onRetryItem(item.id)}
              handlers={handlers} color="text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10"
            />
            <ActionButton
              icon={Trash2} tooltip={t('queue.delete', 'Remove from list')}
              onClick={() => actions.onRemoveItem(item.id)}
              handlers={handlers} color="text-zinc-600 hover:text-red-400 hover:bg-red-400/10"
            />
          </>
        )}
      </Swap>
    </motion.div>
  );
}, areItemsEqual);

function ActionButton({ icon: Icon, tooltip, onClick, handlers, color }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => handlers.enter && handlers.enter(e, tooltip)}
      onMouseMove={handlers.move}
      onMouseLeave={handlers.leave}
      className={`p-2.5 rounded-full transition-all ${color} cursor-pointer active:scale-95`}
    >
      <Icon size={18} />
    </button>
  );
}