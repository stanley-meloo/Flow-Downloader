import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X, Minus, Square} from "lucide-react";
import { motion } from "framer-motion";
import appLogo from "../../assets/logo.png";

export default function TitleBar() {
  const [appWindow, setAppWindow] = useState(null);

  useEffect(() => {
    const win = getCurrentWindow();
    setAppWindow(win);
  }, []);

  const buttonLightVariants = {
    initial: { 
      opacity: 0.6, 
      scale: 1, 
      background: "radial-gradient(closest-side at center, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 100%)",
      color: "rgb(161 161 170)"
    },
    hover: { 
      opacity: 1, 
      scale: 1.1, 
      background: "radial-gradient(closest-side at center, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 100%)",
      color: "rgb(255 255 255)", 
      transition: { type: "spring", stiffness: 300, damping: 25 } 
    },
    tap: { 
      scale: 0.95,
      background: "radial-gradient(closest-side at center, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 100%)",
    }
  };

  const closeLightVariants = {
    initial: { 
      opacity: 0.6, 
      scale: 1, 
      background: "radial-gradient(closest-side at center, rgba(220, 38, 38, 0) 0%, rgba(220, 38, 38, 0) 100%)",
      color: "rgb(161 161 170)"
    },
    hover: { 
      opacity: 1, 
      scale: 1.1, 
      background: "radial-gradient(closest-side at center, rgba(220, 38, 38, 0.25) 0%, rgba(220, 38, 38, 0) 100%)",
      color: "rgb(255 255 255)",
      transition: { type: "spring", stiffness: 300, damping: 25 } 
    },
    tap: { 
      scale: 0.95,
       background: "radial-gradient(closest-side at center, rgba(220, 38, 38, 0.35) 0%, rgba(220, 38, 38, 0) 100%)",
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 h-10 flex select-none z-[10000]">
      <div data-tauri-drag-region className="flex-1 flex items-center pl-4 gap-3 cursor-default">
        <motion.div 
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 0.7, x: 0 }}
          className="pointer-events-none flex items-center gap-2"
        >
           <img src={appLogo} alt="Flow Logo" className="w-5 h-5" />
           {/* MUDANÇA: Nome FLOW DOWNLOADER */}
           <span className="text-[10px] font-bold text-zinc-300 tracking-[0.2em] uppercase">
             FLOW DOWNLOADER
           </span>
        </motion.div>
      </div>

      <div className="flex items-center px-2 gap-2">
        <motion.div variants={buttonLightVariants} initial="initial" whileHover="hover" whileTap="tap" onClick={() => appWindow?.minimize()} className="h-8 w-10 flex items-center justify-center rounded-lg cursor-pointer relative"><Minus size={16} /></motion.div>
        <motion.div variants={buttonLightVariants} initial="initial" whileHover="hover" whileTap="tap" onClick={() => appWindow?.toggleMaximize()} className="h-8 w-10 flex items-center justify-center rounded-lg cursor-pointer relative"><Square size={14} /></motion.div>
        <motion.div variants={closeLightVariants} initial="initial" whileHover="hover" whileTap="tap" onClick={() => appWindow?.close()} className="h-8 w-10 flex items-center justify-center rounded-lg cursor-pointer relative"><X size={16} /></motion.div>
      </div>
    </div>
  );
}