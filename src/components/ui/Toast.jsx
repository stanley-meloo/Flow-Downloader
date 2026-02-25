import { useState, useImperativeHandle, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const Toast = forwardRef((props, ref) => {
  const [toasts, setToasts] = useState([]);
  const { t } = useTranslation();

  useImperativeHandle(ref, () => ({
    add(messageKey, type = 'info') {
      const id = Date.now();
      setToasts(prev => [...prev, { id, messageKey, type }]);
      
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    }
  }));

  const remove = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const typeConfig = {
    success: { 
      icon: <CheckCircle2 className="text-emerald-400" size={18} />,
      accent: "bg-emerald-500",
      glow: "shadow-emerald-500/20"
    },
    error: { 
      icon: <AlertCircle className="text-red-400" size={18} />,
      accent: "bg-red-500",
      glow: "shadow-red-500/20"
    },
    info: { 
      icon: <Info className="text-blue-400" size={18} />,
      accent: "bg-blue-500",
      glow: "shadow-blue-500/20"
    },
    download: { 
      icon: <Zap className="text-violet-400" size={18} />,
      accent: "bg-violet-500",
      glow: "shadow-violet-500/20"
    }
  };

  return (
    <div className="fixed bottom-8 right-8 flex flex-col gap-3 z-[10005] pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const config = typeConfig[toast.type] || typeConfig.info;
          
          return (
            <motion.div 
              key={toast.id}
              layout
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
              className={`
                pointer-events-auto relative overflow-hidden
                min-w-[320px] max-w-sm p-4 rounded-2xl 
                bg-zinc-950/80 backdrop-blur-2xl border border-white/10 
                text-zinc-100 shadow-2xl ${config.glow}
                flex items-center gap-4
              `}
            >
              {/* Barra de cor lateral para feedback imediato */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${config.accent}`} />
              
              <div className="shrink-0 p-2 bg-white/5 rounded-xl border border-white/5">
                {config.icon}
              </div>
              
              <div className="flex-1">
                <p className="text-[13px] font-bold leading-tight tracking-wide">
                  {/* Usa o i18next para traduzir com base na chave enviada */}
                  {t(`toast.${toast.messageKey}`, { defaultValue: toast.messageKey })}
                </p>
              </div>

              <button 
                onClick={() => remove(toast.id)}
                className="p-1 text-zinc-600 hover:text-white hover:bg-white/5 rounded-lg transition-all cursor-pointer"
              >
                <X size={16} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
});

export default Toast;