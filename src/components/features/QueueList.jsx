import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, FolderOpen, X, ListOrdered, RotateCcw, Trash2, AlertCircle, Ban } from "lucide-react";
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
              <span>{t('queue.title')}</span>
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

function QueueItem({ item, t, handlers, actions }) {
  const [imgSrc, setImgSrc] = useState(item.thumbnail);

  useEffect(() => {
    setImgSrc(item.thumbnail);
  }, [item.thumbnail]);

  const isFinished = item.status === "Concluído" || item.progress >= 100;
  const isCanceled = !isFinished && item.status === "Cancelado";
  const isError = !isFinished && !isCanceled && item.status === "Erro";

  let progressColor = "bg-blue-500";
  if (isError) progressColor = "bg-red-500";
  if (isCanceled) progressColor = "bg-zinc-600";
  if (isFinished) progressColor = "bg-emerald-500";

  let overlayClasses = "opacity-100 backdrop-blur-[4px] bg-black/40";
  let OverlayIcon = null;
  let iconColor = "text-white";

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
          {!isFinished && !isCanceled && !isError && item.progress > 0 && item.progress < 100 && (
            <span className="text-[11px] font-bold text-white drop-shadow-md">{item.progress.toFixed(0)}%</span>
          )}
          {OverlayIcon && <OverlayIcon size={24} className={`${iconColor} drop-shadow-lg`} />}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        <h4 className={`font-medium truncate text-base ${isCanceled ? 'text-zinc-500 line-through' : 'text-zinc-100'}`}>{item.title}</h4>
        <div className="w-full h-1.5 bg-zinc-800/50 rounded-full overflow-hidden mt-1 border border-white/5">
          <motion.div
            className={`h-full ${progressColor} shadow-[0_0_10px_currentColor]`}
            initial={{ width: 0 }}
            animate={{ width: `${item.progress}%` }}
          />
        </div>
        <div className="flex items-center gap-4 mt-1 text-[11px] text-white font-medium h-4">
          {!isFinished && !isCanceled && !isError && (
            <>
              <span className="flex items-center gap-1">
                <span className="opacity-70">{t('queue.speed')}:</span>
                <span className="text-zinc-300">{item.speed || "0 KB/s"}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="opacity-70">{t('queue.eta')}:</span>
                <span className="text-zinc-300">{item.eta || "--:--"}</span>
              </span>
            </>
          )}
          
          {/* TRANSLATION LOGIC WITH INTERPOLATION APPLIED HERE */}
          {isFinished && (
            item.totalTime ? (
              <span className="text-emerald-400 font-medium">
                {t('queue.finished_in', { time: item.totalTime })}
              </span>
            ) : (
              <span className="text-emerald-400 font-medium">
                {t('queue.finished')}
              </span>
            )
          )}

          {isCanceled && <span className="text-zinc-500 flex items-center gap-1"><Ban size={10} /> {t('queue.canceled')}</span>}
          {isError && <span className="text-red-400 flex items-center gap-1"><AlertCircle size={10} /> {t('queue.error')}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!isFinished && !isCanceled && !isError && (
          <ActionButton
            icon={X}
            tooltip={t('queue.cancel')}
            onClick={() => actions.onCancelItem(item.id)}
            handlers={handlers} color="text-zinc-400 hover:text-red-400 hover:bg-red-400/10"
          />
        )}
        {isFinished && (
          <>
            <ActionButton
              icon={FolderOpen} tooltip={t('queue.open_folder')}
              onClick={() => actions.openMediaLocation(item.directory, item.title, item.ext, actions.showToast, t)}
              handlers={handlers} color="text-stone-300 hover:text-white hover:bg-white/10"
            />
            <ActionButton
              icon={Trash2} tooltip={t('queue.delete')}
              onClick={() => actions.onRemoveItem(item.id)}
              handlers={handlers} color="text-zinc-400 hover:text-red-400 hover:bg-red-400/10"
            />
          </>
        )}
        {(isCanceled || isError) && (
          <>
            <ActionButton
              icon={RotateCcw} tooltip={t('queue.retry')}
              onClick={() => actions.onRetryItem(item.id)}
              handlers={handlers} color="text-zinc-400 hover:text-blue-400 hover:bg-blue-400/10"
            />
            <ActionButton
              icon={Trash2} tooltip={t('queue.delete')}
              onClick={() => actions.onRemoveItem(item.id)}
              handlers={handlers} color="text-zinc-600 hover:text-red-400 hover:bg-red-400/10"
            />
          </>
        )}
      </div>
    </motion.div>
  );
}

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