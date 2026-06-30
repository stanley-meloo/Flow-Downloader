import { useState, useEffect, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, FolderOpen, X, ListOrdered, RotateCcw, Trash2, AlertCircle, Ban, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openMediaLocation } from "../../utils/fileSystem";

export default function QueueList({
  queue,
  tooltipHandlers,
  showToast,
  onCancelItem,
  onRetryItem,
  onRemoveItem
}) {
  const { t } = useTranslation();
  const { enter, move, leave } = tooltipHandlers || {};

  return (
    <div className="w-full flex-1 min-h-0 mt-10 mb-2 overflow-hidden flex flex-col relative">
      <AnimatePresence>
        {queue.length > 0 && (
          <motion.h3
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-white text-xs font-bold uppercase tracking-widest mb-4 flex justify-between px-2 items-center"
          >
            <div className="flex items-center gap-2">
              <ListOrdered size={20} className="text-zinc-300 shrink-0" />
              <span>{t('queue.title', 'FILA DE DOWNLOADS')}</span>
            </div>
            <span className="bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full text-[13px]">
              {queue.length}
            </span>
          </motion.h3>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar p-1">
        <motion.div layout className="space-y-4">
          <AnimatePresence mode="popLayout">
            {queue.map((item) => (
              <QueueItem
                key={item.id} 
                item={item}
                t={t}
                handlers={{ enter, move, leave }}
                actions={{ openMediaLocation, showToast, onCancelItem, onRetryItem, onRemoveItem }}
              />
            ))}
          </AnimatePresence>
        </motion.div>
        <div className="h-0 w-full shrink-0 pointer-events-none" />
      </div>
    </div>
  );
}

// Only re-render an item when its own visible fields change. This prevents
// every progress tick (which replaces the whole queue array) from re-rendering
// the entire list.
const areItemsEqual = (prev, next) => {
  const a = prev.item, b = next.item;
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.progress === b.progress &&
    a.speed === b.speed &&
    a.eta === b.eta &&
    a.totalTime === b.totalTime &&
    a.thumbnail === b.thumbnail &&
    a.outputFile === b.outputFile &&
    a.title === b.title
  );
};

const QueueItem = memo(function QueueItem({ item, t, handlers, actions }) {
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

  const handleImageError = () => {
    if (imgSrc && !imgSrc.includes('hqdefault.jpg')) {
      const newSrc = `https://i.ytimg.com/vi/${item.ytId || extractIdFromUrl(item.url)}/hqdefault.jpg`;
      setImgSrc(newSrc);
    }
  };

  const extractIdFromUrl = (url) => {
    try {
      const u = new URL(url);
      return u.searchParams.get("v");
    } catch { return ""; }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      transition={{ 
        layout: { type: "spring", stiffness: 300, damping: 30 },
        opacity: { duration: 0.2 }
      }}
      className="relative group bg-zinc-950/30 backdrop-blur-xl border border-white/5 p-3 rounded-2xl flex items-center gap-4"
    >
      <div className="w-28 h-16 bg-zinc-900 rounded-lg relative shrink-0 shadow-lg group/thumb overflow-hidden">
        <div className="absolute inset-0 rounded-lg border border-white/10 z-20 pointer-events-none" />

        {imgSrc && (
          <img
            src={imgSrc}
            referrerPolicy="no-referrer"
            onError={handleImageError}
            className={`w-full h-full object-cover rounded-lg block transition-opacity duration-500 ${isFinished ? 'opacity-100' : 'opacity-60'} ${(isCanceled || isError) ? 'grayscale opacity-40' : ''}`}
            alt="thumb"
          />
        )}

        <div className={`absolute inset-0 z-10 flex items-center justify-center rounded-lg ${overlayClasses}`}>
          {overlayText}
          {OverlayIcon && <OverlayIcon size={24} className={`${iconColor} drop-shadow-lg`} />}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        <h4 className={`font-medium truncate text-base ${isCanceled ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>{item.title}</h4>
        
        {/* Dynamic progress bar */}
        <div className="w-full h-1.5 bg-zinc-800/50 rounded-full overflow-hidden mt-1 border border-white/5 relative">
          <motion.div
            className={`h-full ${progressColor} shadow-[0_0_10px_currentColor]`}
            initial={{ width: 0 }}
            animate={{ width: isProcessing ? '100%' : `${item.progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <div className="flex items-center gap-4 mt-1 text-[11px] text-white font-medium h-4">
          
          {/* While actively downloading: show speed + ETA */}
          {!isFinished && !isCanceled && !isError && !isProcessing && (
            <>
              <span className="flex items-center gap-1">
                <span className="opacity-70">{t('queue.speed', 'Velocidade:')}</span>
                <span className="text-zinc-300">{item.speed || "0 KB/s"}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="opacity-70">{t('queue.eta', 'Tempo Restante:')}</span>
                <span className="text-zinc-300">{item.eta || "--:--"}</span>
              </span>
            </>
          )}

          {/* Post-processing feedback (replaces the speed/ETA row) */}
          {isProcessing && (
            <span className="text-amber-400 font-medium flex items-center gap-1.5">
            {t('queue.processing', 'Processando e Convertendo...')}
            </span>
          )}
          
          {isFinished && (
            item.totalTime ? (
              <span className="text-emerald-400 font-medium">
                {t('queue.finished_in', { time: item.totalTime }) || `Concluído em ${item.totalTime}`}
              </span>
            ) : (
              <span className="text-emerald-400 font-medium">
                {t('queue.finished', 'Concluído')}
              </span>
            )
          )}

          {isCanceled && <span className="text-zinc-500 flex items-center gap-1"><Ban size={10} /> {t('queue.canceled', 'Cancelado')}</span>}
          {isError && <span className="text-red-400 flex items-center gap-1"><AlertCircle size={10} /> {t('queue.error', 'Erro')}</span>}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {!isFinished && !isCanceled && !isError && (
          <ActionButton
            icon={X}
            tooltip={t('queue.cancel', 'Cancelar')}
            onClick={() => actions.onCancelItem(item.id)}
            handlers={handlers} color="text-zinc-400 hover:text-red-400 hover:bg-red-400/10"
          />
        )}
        {isFinished && (
          <>
            <ActionButton
              icon={FolderOpen} tooltip={t('queue.open_folder', 'Abrir Pasta')}
              onClick={() => actions.openMediaLocation(item.directory, item.outputFile, item.title, item.ext, actions.showToast)}
              handlers={handlers} color="text-stone-300 hover:text-white hover:bg-white/10"
            />
            <ActionButton
              icon={Trash2} tooltip={t('queue.delete', 'Deletar')}
              onClick={() => actions.onRemoveItem(item.id)}
              handlers={handlers} color="text-zinc-400 hover:text-red-400 hover:bg-red-400/10"
            />
          </>
        )}
        {(isCanceled || isError) && (
          <>
            <ActionButton
              icon={RotateCcw} tooltip={t('queue.retry', 'Tentar Novamente')}
              onClick={() => actions.onRetryItem(item.id)}
              handlers={handlers} color="text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10"
            />
            <ActionButton
              icon={Trash2} tooltip={t('queue.delete', 'Deletar')}
              onClick={() => actions.onRemoveItem(item.id)}
              handlers={handlers} color="text-zinc-600 hover:text-red-400 hover:bg-red-400/10"
            />
          </>
        )}
      </div>
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