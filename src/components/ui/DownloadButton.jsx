// The cards' big download button (single video / playlist).
//
// Idle: the accent gradient with a slow sheen passing every few seconds and
// the arrow gently bobbing. Hover: the button lifts a touch on a soft spring,
// its glow brightens (App.css .accent-button), a quick sheen sweeps across at
// once, the arrow "drops" into its tray and the label opens up slightly.
// Press: it sinks back with a fast, hard tap.

import { motion } from "framer-motion";
import { DownloadIcon as Download } from "./AnimatedIcons";
import { TAP } from "./Motion";

const LIFT = { type: "spring", stiffness: 420, damping: 24, mass: 0.6 };

const SHEEN = {
  idle: { left: ["-60%", "160%"], transition: { duration: 2, ease: "easeInOut", repeat: Infinity, repeatDelay: 2 } },
  hover: { left: ["-60%", "160%"], transition: { duration: 0.65, ease: [0.4, 0, 0.2, 1] } },
};
const ARROW = {
  idle: { y: [0, 3, 0], transition: { duration: 1.2, ease: "easeInOut", repeat: Infinity } },
  hover: { y: [0, 5, -1.5, 0], transition: { duration: 0.55, ease: "easeOut", repeat: Infinity, repeatDelay: 0.25 } },
};
const LABEL = {
  idle: { letterSpacing: "0.1em" },
  hover: { letterSpacing: "0.14em", transition: LIFT },
};

export default function DownloadButton({ onClick, disabled = false, tooltip, iconSize = 22, textClass = "text-[14px]", className = "", children }) {
  return (
    <motion.button
      type="button"
      initial="idle"
      animate="idle"
      whileHover={disabled ? undefined : "hover"}
      whileTap={disabled ? undefined : "tap"}
      disabled={disabled}
      variants={{
        idle: { y: 0, scale: 1, transition: LIFT },
        hover: { y: -2, scale: 1.015, transition: LIFT },
        tap: { y: 0, scale: 0.98, transition: TAP },
      }}
      onClick={onClick}
      data-tooltip={tooltip || undefined}
      className={`relative rounded-xl accent-button text-white font-black flex items-center justify-center cursor-pointer disabled:cursor-wait overflow-hidden ${className}`}
    >
      {/* Sheen */}
      <motion.div
        variants={SHEEN}
        className="absolute top-0 bottom-0 w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent -skew-x-12 z-0 pointer-events-none"
      />
      <div className="relative z-10 flex items-center gap-2.5">
        <motion.div variants={ARROW}>
          <Download size={iconSize} strokeWidth={2.5} />
        </motion.div>
        <motion.span variants={LABEL} className={`uppercase ${textClass} drop-shadow-md`}>
          {children}
        </motion.span>
      </div>
    </motion.button>
  );
}
