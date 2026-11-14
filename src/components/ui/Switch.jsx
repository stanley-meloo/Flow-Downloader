// On/off switch used across the app — the same look as the Auto Download
// switch (AutoDownloadToggle.jsx, styles in App.css "Auto Download switch"):
// a white knob that springs to the other side, a small dash on the free side
// and a soft glow while on. No icons inside the knob.
//
// The Auto Download switch sits on the background, so its track is real
// liquid glass. Here the switch sits inside panels (Settings rows): its track
// is a plain frosted pill (.auto-dl__track--flat) — a liquid glass there would
// refract the app background behind the panel, not the panel itself.

import { motion } from "framer-motion";
import { TAP } from "./Motion";

export default function Switch({ active, onClick, disabled = false, label }) {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={!!active}
      aria-label={label}
      aria-disabled={disabled}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97, transition: TAP }}
      onMouseDown={(e) => e.preventDefault()} /* no lingering focus ring after a click */
      onClick={disabled ? undefined : (e) => { e.currentTarget.blur(); onClick?.(e); }}
      className={`auto-dl relative flex shrink-0 rounded-full transition-opacity duration-300 ${active ? "is-on" : ""} ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span aria-hidden="true" className="auto-dl__glow" />
      <span className="auto-dl__track auto-dl__track--flat relative rounded-full">
        <span aria-hidden="true" className="auto-dl__tint" />
        <span aria-hidden="true" className="auto-dl__line" />
        <span aria-hidden="true" className="auto-dl__circle" />
      </span>
    </motion.button>
  );
}
