// Animated icons, ported to plain JSX from lucide-animated
// (https://lucide-animated.com, MIT, by pqoqubbw — Lucide shapes + Motion).
//
// They are drop-in replacements for the matching lucide-react icons: same
// `size` / `strokeWidth` / `className` props. Unlike the originals, the
// animation is triggered by hovering the CONTROL the icon sits in (the closest
// button / link / ".group" container), not just the small icon itself.
// The OS "reduce motion" setting is honored through <MotionConfig> in App.jsx.

import { useEffect, useRef } from "react";
import { motion, useAnimation } from "framer-motion";

const HOVER_TARGET = 'button, a, [role="button"], [data-icon-hover], .group';

// Calls onEnter/onLeave when the pointer enters/leaves the icon's control.
function useControlHover(onEnter, onLeave) {
  const ref = useRef(null);
  const enter = useRef(onEnter);
  const leave = useRef(onLeave);
  enter.current = onEnter;
  leave.current = onLeave;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = el.parentElement?.closest(HOVER_TARGET) || el;
    const onIn = () => enter.current();
    const onOut = () => leave.current();
    target.addEventListener("mouseenter", onIn);
    target.addEventListener("mouseleave", onOut);
    return () => {
      target.removeEventListener("mouseenter", onIn);
      target.removeEventListener("mouseleave", onOut);
    };
  }, []);
  return ref;
}

// Wrapper + <svg> with Lucide's default attributes.
function IconFrame({ iconRef, size = 24, strokeWidth = 2, className = "", svgProps, children, Svg = "svg" }) {
  return (
    // Block-level and exactly the icon's size, like lucide-react's <svg> (which
    // Tailwind's preflight makes display:block). An inline wrapper would sit on
    // a text line and make round icon buttons taller than wide.
    <span ref={iconRef} className={`block w-fit leading-none shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <Svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ overflow: "visible", display: "block" }}
        {...svgProps}
      >
        {children}
      </Svg>
    </span>
  );
}

// Leaving an icon: every icon glides back to its resting look with this same
// soft ease (overrides each animation's own timing), from wherever its hover
// animation was — never a hard cut.
const ICON_RETURN = { type: "tween", duration: 0.35, ease: [0.22, 1, 0.36, 1] };

// Most icons: one Motion controller switching between "normal" and "animate".
function useSimpleControls() {
  const controls = useAnimation();
  const ref = useControlHover(() => controls.start("animate"), () => controls.start("normal", ICON_RETURN));
  return [controls, ref];
}

// --- Settings: the gear turns half a revolution ---------------------------
// `active` (e.g. the Settings window is open) keeps the gear turned: it only
// turns back when it's no longer active AND the pointer isn't on its button.
export function SettingsIcon({ active = false, ...props }) {
  const controls = useAnimation();
  const hovered = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const ref = useControlHover(
    () => { hovered.current = true; controls.start("animate"); },
    () => { hovered.current = false; if (!activeRef.current) controls.start("normal", ICON_RETURN); }
  );
  useEffect(() => {
    if (active) controls.start("animate");
    else if (!hovered.current) controls.start("normal", ICON_RETURN);
  }, [active, controls]);
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{
        animate: controls, initial: "normal",
        transition: { type: "spring", stiffness: 50, damping: 10 },
        variants: { normal: { rotate: 0 }, animate: { rotate: 180 } },
      }}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </IconFrame>
  );
}

// --- Heart: beats ---------------------------------------------------------
export function HeartIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{
        animate: controls, initial: "normal",
        transition: { duration: 0.45, repeat: 2 },
        variants: { normal: { scale: 1 }, animate: { scale: [1, 1.08, 1] } },
      }}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </IconFrame>
  );
}

// --- Download: the arrow drops into the tray --------------------------------
const DOWNLOAD_ARROW = {
  normal: { y: 0 },
  animate: { y: 2, transition: { type: "spring", stiffness: 200, damping: 10, mass: 1 } },
};
export function DownloadIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <motion.g animate={controls} initial="normal" variants={DOWNLOAD_ARROW}>
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" x2="12" y1="15" y2="3" />
      </motion.g>
    </IconFrame>
  );
}

// --- Folder open: wiggles -----------------------------------------------
const FOLDER_WIGGLE = {
  normal: { rotate: 0 },
  animate: { rotate: [0, -8, 6, -4, 0], transition: { ease: "easeInOut", rotate: { duration: 0.6 } } },
};
export function FolderOpenIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path
        animate={controls} initial="normal" variants={FOLDER_WIGGLE}
        style={{ transformOrigin: "12px 12px" }}
        d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
      />
    </IconFrame>
  );
}

// --- Refresh (clockwise) / Rotate (counter-clockwise): a quick turn --------
const SPIN = { type: "spring", stiffness: 250, damping: 25 };
export function RefreshCwIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal", transition: SPIN, variants: { normal: { rotate: 0 }, animate: { rotate: 50 } } }}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </IconFrame>
  );
}
export function RotateCcwIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal", transition: SPIN, variants: { normal: { rotate: 0 }, animate: { rotate: -50 } } }}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </IconFrame>
  );
}

// --- Sparkles: the star fills and hops, the small stars blink -------------
const SPARKLE = {
  // fillOpacity, not fill: "currentColor" can't be interpolated (it jumped).
  normal: { y: 0, fillOpacity: 0 },
  animate: { y: [0, -1, 0, 0], fillOpacity: 1, transition: { duration: 1, bounce: 0.3 } },
};
const STAR = {
  normal: { opacity: 1 },
  animate: { opacity: [0, 1, 0, 0, 0, 0, 1], transition: { duration: 2, type: "spring", stiffness: 70, damping: 10, mass: 0.4, delay: 1 } },
};
export function SparklesIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal" variants={SPARKLE} fill="currentColor"
        d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <motion.path animate={controls} initial="normal" variants={STAR} d="M20 3v4" />
      <motion.path animate={controls} initial="normal" variants={STAR} d="M22 5h-4" />
      <motion.path animate={controls} initial="normal" variants={STAR} d="M4 17v2" />
      <motion.path animate={controls} initial="normal" variants={STAR} d="M5 18H3" />
    </IconFrame>
  );
}

// --- Copy: the two sheets slide apart -----------------------------------
const COPY_SPRING = { type: "spring", stiffness: 160, damping: 17, mass: 1 };
export function CopyIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.rect animate={controls} initial="normal" transition={COPY_SPRING}
        variants={{ normal: { x: 0, y: 0 }, animate: { x: -3, y: -3 } }}
        width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <motion.path animate={controls} initial="normal" transition={COPY_SPRING}
        variants={{ normal: { x: 0, y: 0 }, animate: { x: 3, y: 3 } }}
        d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </IconFrame>
  );
}

// --- Languages: the characters are written stroke by stroke ---------------
const WRITE = {
  normal: { opacity: 1, pathLength: 1, pathOffset: 0 },
  animate: (i) => ({
    opacity: [0, 1],
    pathLength: [0, 1],
    pathOffset: [1, 0],
    transition: {
      opacity: { duration: 0.01, delay: i * 0.1 },
      pathLength: { type: "spring", duration: 0.5, bounce: 0, delay: i * 0.1 },
      pathOffset: { type: "spring", duration: 0.5, bounce: 0, delay: i * 0.1 },
    },
  }),
};
export function LanguagesIcon(props) {
  const [controls, ref] = useSimpleControls();
  const p = (d, i) => <motion.path key={d} animate={controls} initial="normal" custom={i} variants={WRITE} d={d} />;
  return (
    <IconFrame {...props} iconRef={ref}>
      {p("m5 8 6 6", 3)}
      {p("m4 14 6-6 3-3", 2)}
      {p("M2 5h12", 1)}
      {p("M7 2h1", 0)}
      {p("m22 22-5-10-5 10", 3)}
      {p("M14 18h6", 3)}
    </IconFrame>
  );
}

// --- Keyboard: the keys flicker as if typed --------------------------------
const KEYS = ["M10 8h.01", "M12 12h.01", "M14 8h.01", "M16 12h.01", "M18 8h.01", "M6 8h.01", "M7 16h10", "M8 12h.01"];
export function KeyboardIcon(props) {
  const controls = useAnimation();
  const ref = useControlHover(
    () => controls.start((i) => ({
      opacity: [1, 0.2, 1],
      transition: { duration: 1.5, times: [0, 0.5, 1], delay: i * 0.2 * Math.random(), repeat: 1, repeatType: "reverse" },
    })),
    () => controls.start({ opacity: 1, transition: ICON_RETURN })
  );
  return (
    <IconFrame {...props} iconRef={ref}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      {KEYS.map((d, i) => <motion.path key={d} animate={controls} initial={{ opacity: 1 }} custom={i} d={d} />)}
    </IconFrame>
  );
}

// --- Chevron down: nudges down ---------------------------------------------
export function ChevronDownIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal" transition={{ times: [0, 0.4, 1], duration: 0.5 }}
        variants={{ normal: { y: 0 }, animate: { y: [0, 2, 0] } }} d="m6 9 6 6 6-6" />
    </IconFrame>
  );
}

// --- Check / Circle check: the tick is redrawn ------------------------------
const TICK = {
  normal: { opacity: 1, pathLength: 1, scale: 1, transition: { duration: 0.3, opacity: { duration: 0.1 } } },
  animate: { opacity: [0, 1], pathLength: [0, 1], scale: [0.5, 1], transition: { duration: 0.4, opacity: { duration: 0.1 } } },
};
export function CheckIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal" variants={TICK} d="M4 12 9 17L20 6" />
    </IconFrame>
  );
}
const CIRCLE_TICK = {
  normal: { opacity: 1, pathLength: 1, transition: { duration: 0.3, opacity: { duration: 0.1 } } },
  animate: { opacity: [0, 1], pathLength: [0, 1], transition: { duration: 0.4, opacity: { duration: 0.1 } } },
};
export function CircleCheckIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <circle cx="12" cy="12" r="10" />
      <motion.path animate={controls} initial="normal" variants={CIRCLE_TICK} d="m9 12 2 2 4-4" />
    </IconFrame>
  );
}

// --- Search: the magnifier looks around ------------------------------------
export function SearchIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{
        animate: controls, initial: "normal",
        transition: { duration: 1, bounce: 0.3 },
        variants: { normal: { x: 0, y: 0 }, animate: { x: [0, 0, -3, 0], y: [0, -4, 0, 0] } },
      }}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </IconFrame>
  );
}

// --- External link: the arrow pops out -------------------------------------
const OUT_ARROW = {
  normal: { scale: 1, x: 0, y: 0 },
  animate: { scale: [1, 0.92, 1], x: [0, 2, 0], y: [0, -2, 0], originX: 1, originY: 0, transition: { duration: 0.5, ease: "easeInOut" } },
};
export function ExternalLinkIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <motion.g animate={controls} initial="normal" variants={OUT_ARROW}>
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
      </motion.g>
    </IconFrame>
  );
}

// --- Link: the chain links wobble ---------------------------------------------
const CHAIN = {
  normal: { pathLength: 1, pathOffset: 0, rotate: 0 },
  animate: {
    pathLength: [1, 0.97, 1, 0.97, 1],
    pathOffset: [0, 0.05, 0, 0.05, 0],
    rotate: [0, -5, 0],
    transition: { rotate: { duration: 0.5 }, duration: 1, times: [0, 0.2, 0.4, 0.6, 1], ease: "easeInOut" },
  },
};
export function LinkIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal" variants={CHAIN} d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <motion.path animate={controls} initial="normal" variants={CHAIN} d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </IconFrame>
  );
}

// --- Layers: the sheets lift and settle -------------------------------------
const LAYER_SPRING = { type: "spring", stiffness: 100, damping: 14, mass: 1 };
export function LayersIcon(props) {
  const controls = useAnimation();
  const ref = useControlHover(
    async () => { await controls.start("firstState"); await controls.start("secondState"); },
    () => controls.start("normal", ICON_RETURN)
  );
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <motion.path animate={controls} initial="normal" transition={LAYER_SPRING}
        variants={{ normal: { y: 0 }, firstState: { y: -9 }, secondState: { y: 0 } }}
        d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <motion.path animate={controls} initial="normal" transition={LAYER_SPRING}
        variants={{ normal: { y: 0 }, firstState: { y: -5 }, secondState: { y: 0 } }}
        d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </IconFrame>
  );
}

// --- Circle help: the question mark shakes its head ----------------------------
export function CircleHelpIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <circle cx="12" cy="12" r="10" />
      <motion.g animate={controls} initial="normal" transition={{ duration: 0.5, ease: "easeInOut" }}
        variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -10, 10, -10, 0] } }}>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </motion.g>
    </IconFrame>
  );
}

// --- Folder up: the arrow hops ------------------------------------------------
export function FolderUpIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <motion.g animate={controls} initial="normal" transition={{ times: [0, 0.4, 1], duration: 0.5 }}
        variants={{ normal: { y: 0 }, animate: { y: [0, -2, 0] } }}>
        <path d="M12 10v6" />
        <path d="m9 13 3-3 3 3" />
      </motion.g>
    </IconFrame>
  );
}

// --- File cog: the cog turns -------------------------------------------------
export function FileCogIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M4.677 21.5a2 2 0 0 0 1.313.5H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v2.5" />
      <motion.g animate={controls} initial="normal" transition={{ type: "spring", stiffness: 50, damping: 10 }}
        variants={{ normal: { rotate: 0 }, animate: { rotate: 180 } }}>
        <path d="m3.2 12.9-.9-.4" />
        <path d="m3.2 15.1-.9.4" />
        <path d="m4.9 11.2-.4-.9" />
        <path d="m4.9 16.8-.4.9" />
        <path d="m7.5 10.3-.4.9" />
        <path d="m7.5 17.7-.4-.9" />
        <path d="m9.7 12.5-.9.4" />
        <path d="m9.7 15.5-.9-.4" />
        <circle cx="6" cy="14" r="3" />
      </motion.g>
    </IconFrame>
  );
}

// --- Clock: the hands spin ------------------------------------------------------
const HOUR = { normal: { rotate: 0, originX: "0%", originY: "100%" }, animate: { rotate: 360, originX: "0%", originY: "100%" } };
const MINUTE = { normal: { rotate: 0, originX: "0%", originY: "100%" }, animate: { rotate: 45, originX: "0%", originY: "100%" } };
export function ClockIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <circle cx="12" cy="12" r="10" />
      <motion.line animate={controls} initial="normal" transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }} variants={HOUR} x1="12" x2="12" y1="12" y2="6" />
      <motion.line animate={controls} initial="normal" transition={{ duration: 0.5, ease: "easeInOut" }} variants={MINUTE} x1="12" x2="16" y1="12" y2="12" />
    </IconFrame>
  );
}

// --- Ban: the circle and then the slash are drawn ---------------------------
const BAN_STROKE = {
  normal: { opacity: 1, pathLength: 1, transition: { duration: 0.3, opacity: { duration: 0.1 } } },
  animate: { opacity: [0, 1], pathLength: [0, 1], transition: { duration: 0.4, opacity: { duration: 0.1 } } },
};
const BAN_SLASH = {
  normal: BAN_STROKE.normal,
  slash: { opacity: [0, 1], pathLength: [0, 1], transition: { duration: 0.4, opacity: { duration: 0.1 } } },
};
export function BanIcon(props) {
  const controls = useAnimation();
  const ref = useControlHover(
    () => { controls.start("animate"); controls.start("slash", { delay: 0.5 }); },
    () => controls.start("normal", ICON_RETURN)
  );
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.circle animate={controls} initial="normal" variants={BAN_STROKE} cx="12" cy="12" r="10" />
      <motion.path animate={controls} initial="normal" variants={BAN_SLASH} d="m4.9 4.9 14.2 14.2" />
    </IconFrame>
  );
}

// --- Looping icons (always animated while shown, no hover needed) ----------
// Used in the download queue next to the live speed / time left.

// Hourglass: flips over every ~2 s (it looks the same upside down, so the
// loop restarts seamlessly).
export function HourglassIcon(props) {
  return (
    <IconFrame {...props}>
      <motion.g
        style={{ transformOrigin: "12px 12px" }}
        initial={{ rotate: 0 }}
        animate={{ rotate: [0, 180] }}
        transition={{ duration: 0.8, ease: [0.65, 0, 0.35, 1], repeat: Infinity, repeatDelay: 1.2 }}
      >
        <path d="M5 22h14" />
        <path d="M5 2h14" />
        <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
        <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
      </motion.g>
    </IconFrame>
  );
}

// --- Camera (screenshot): the lens "clicks" like a shutter ------------------
const SHUTTER = {
  normal: { scale: 1 },
  animate: { scale: [1, 0.55, 1.12, 1], transition: { duration: 0.5, ease: "easeInOut" } },
};
const CAMERA_BODY = {
  normal: { y: 0 },
  animate: { y: [0, 0.8, 0], transition: { duration: 0.3, ease: "easeOut" } },
};
export function CameraIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.g animate={controls} initial="normal" variants={CAMERA_BODY}>
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <motion.circle animate={controls} initial="normal" variants={SHUTTER}
          style={{ transformOrigin: "12px 13px" }} cx="12" cy="13" r="3" />
      </motion.g>
    </IconFrame>
  );
}

// --- Bug (diagnostics): the bug wiggles --------------------------------------
const BUG_WIGGLE = {
  normal: { rotate: 0, y: 0 },
  animate: { rotate: [0, -10, 10, -6, 6, 0], y: [0, -1, 0, -1, 0, 0], transition: { duration: 0.6, ease: "easeInOut" } },
};
export function BugIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal", variants: BUG_WIGGLE }}>
      <path d="M12 20v-9" />
      <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
      <path d="M14.12 3.88 16 2" />
      <path d="M21 21a4 4 0 0 0-3.81-4" />
      <path d="M21 5a4 4 0 0 1-3.55 3.97" />
      <path d="M22 13h-4" />
      <path d="M3 21a4 4 0 0 1 3.81-4" />
      <path d="M3 5a4 4 0 0 0 3.55 3.97" />
      <path d="M6 13H2" />
      <path d="m8 2 1.88 1.88" />
      <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
    </IconFrame>
  );
}

// --- Scissors (cut): the blades snip twice -----------------------------------
const SNIP = (dir) => ({
  normal: { rotate: 0 },
  animate: { rotate: [0, 14 * dir, 0, 14 * dir, 0], transition: { duration: 0.6, ease: "easeInOut" } },
});
const BLADE_A = SNIP(-1);
const BLADE_B = SNIP(1);
export function ScissorsIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.g animate={controls} initial="normal" variants={BLADE_A} style={{ transformOrigin: "12px 12px" }}>
        <circle cx="6" cy="6" r="3" />
        <path d="M8.12 8.12 12 12" />
        <path d="M14.8 14.8 20 20" />
      </motion.g>
      <motion.g animate={controls} initial="normal" variants={BLADE_B} style={{ transformOrigin: "12px 12px" }}>
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.12 15.88" />
      </motion.g>
    </IconFrame>
  );
}

// --- Clipboard paste: the arrow slides in and out ----------------------------
const PASTE_ARROW = {
  normal: { x: 0 },
  animate: { x: [0, -3, 0], transition: { duration: 0.5, ease: "easeInOut" } },
};
export function ClipboardPasteIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="M16 4h2a2 2 0 0 1 2 2v1.344" />
      <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <motion.g animate={controls} initial="normal" variants={PASTE_ARROW}>
        <path d="M11 14h10" />
        <path d="m17 18 4-4-4-4" />
      </motion.g>
    </IconFrame>
  );
}

// --- Pin (keep on top): the pin tilts and pushes in ---------------------------
const PIN = {
  normal: { rotate: 0, y: 0 },
  animate: { rotate: [0, -18, 0], y: [0, -1.5, 1, 0], transition: { duration: 0.55, ease: "easeInOut" } },
};
export function PinIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal", variants: PIN, style: { overflow: "visible", display: "block", transformOrigin: "12px 22px" } }}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </IconFrame>
  );
}

// --- Delete (trash): the lid lifts, the can and its lines sink a little ------
// From lucide-animated "delete".
const DELETE_SPRING = { type: "spring", stiffness: 500, damping: 30 };
const DELETE_LINE = { normal: { y1: 11, y2: 17 }, animate: { y1: 11.5, y2: 17.5 } };
export function TrashIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.g animate={controls} initial="normal" transition={DELETE_SPRING} variants={{ normal: { y: 0 }, animate: { y: -1.1 } }}>
        <path d="M3 6h18" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      </motion.g>
      <motion.path
        animate={controls} initial="normal" transition={DELETE_SPRING}
        variants={{
          normal: { d: "M19 8v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V8" },
          animate: { d: "M19 9v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V9" },
        }}
        d="M19 8v12c0 1-1 2-2 2H7c-1 0-2-1-2-2V8"
      />
      <motion.line animate={controls} initial="normal" transition={DELETE_SPRING} variants={DELETE_LINE} x1="10" x2="10" y1="11" y2="17" />
      <motion.line animate={controls} initial="normal" transition={DELETE_SPRING} variants={DELETE_LINE} x1="14" x2="14" y1="11" y2="17" />
    </IconFrame>
  );
}

// --- Image: the sun rises over the mountains ----------------------------------
const SUN = {
  normal: { y: 0 },
  animate: { y: [0, -2, 0], transition: { duration: 0.6, ease: "easeInOut" } },
};
export function ImageIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <motion.circle animate={controls} initial="normal" variants={SUN} cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </IconFrame>
  );
}

// --- X (clear): turns a quarter -------------------------------------------------
export function XIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal", transition: SPIN, variants: { normal: { rotate: 0 }, animate: { rotate: 90 } } }}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </IconFrame>
  );
}

// --- Chart (download speed): the bars redraw one after another, in a loop ------
// From lucide-animated "chart-no-axes-column-increasing" (bars vanish and grow
// back from the base, 0.1 s apart), looping like the other queue status icons.
export function ChartColumnIncreasingIcon(props) {
  const bar = (i) => ({
    initial: { pathLength: 1, opacity: 1 },
    animate: { pathLength: [1, 0, 0, 1], opacity: [1, 0, 0, 1] },
    transition: { duration: 1.2, times: [0, 0.25, 0.35, 0.6], ease: "easeInOut", repeat: Infinity, repeatDelay: 0.8, delay: i * 0.1 },
  });
  return (
    <IconFrame {...props}>
      <motion.path {...bar(0)} d="M6 20v-4" />
      <motion.path {...bar(1)} d="M12 20v-10" />
      <motion.path {...bar(2)} d="M18 20v-16" />
    </IconFrame>
  );
}

// ============================================================================
// Icons below complete the set so EVERY icon in the app is animated.
// Maximize2 and the alert shake are ported from lucide-animated
// ("maximize-2", "badge-alert"); the others are new, in the same style
// (Lucide shapes + Motion, triggered by hovering their control).
// ============================================================================

// Shared "alert" shake (lucide-animated badge-alert).
const ALERT_SHAKE = {
  normal: { scale: 1, rotate: 0 },
  animate: {
    scale: [1, 1.1, 1.1, 1.1, 1],
    rotate: [0, -3, 3, -2, 2, 0],
    transition: { duration: 0.5, times: [0, 0.2, 0.4, 0.6, 1], ease: "easeInOut" },
  },
};
const shakeSvg = (controls) => ({ animate: controls, initial: "normal", variants: ALERT_SHAKE });

// --- Circle alert: shakes -----------------------------------------------------
export function CircleAlertIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg} svgProps={shakeSvg(controls)}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </IconFrame>
  );
}

// --- Triangle alert: shakes ---------------------------------------------------
export function TriangleAlertIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg} svgProps={shakeSvg(controls)}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </IconFrame>
  );
}

// --- Maximize 2: the two arrows push outwards (lucide-animated) ---------------
const MAX_SPRING = { type: "spring", stiffness: 250, damping: 25 };
export function Maximize2Icon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal" transition={MAX_SPRING}
        variants={{ normal: { x: 0, y: 0 }, animate: { x: -2, y: 2 } }}
        d="M3 16.2V21m0 0h4.8M3 21l6-6" />
      <motion.path animate={controls} initial="normal" transition={MAX_SPRING}
        variants={{ normal: { x: 0, y: 0 }, animate: { x: 2, y: -2 } }}
        d="M21 7.8V3m0 0h-4.8M21 3l-6 6" />
    </IconFrame>
  );
}

// --- Square (window maximize): grows a little ----------------------------------
export function SquareIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.rect animate={controls} initial="normal" transition={MAX_SPRING}
        variants={{ normal: { scale: 1 }, animate: { scale: 1.12 } }}
        style={{ transformOrigin: "12px 12px" }}
        width="18" height="18" x="3" y="3" rx="2" />
    </IconFrame>
  );
}

// --- Minus (window minimize): the line drops ------------------------------------
export function MinusIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal" transition={MAX_SPRING}
        variants={{ normal: { y: 0 }, animate: { y: 3 } }}
        d="M5 12h14" />
    </IconFrame>
  );
}

// --- Power: the stem pulls down and springs back, the arc pulses ---------------
export function PowerIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal"
        variants={{ normal: { y: 0 }, animate: { y: [0, 2, 0], transition: { duration: 0.45, ease: "easeInOut" } } }}
        d="M12 2v10" />
      <motion.path animate={controls} initial="normal"
        variants={{ normal: { scale: 1 }, animate: { scale: [1, 0.92, 1], transition: { duration: 0.45, ease: "easeInOut" } } }}
        style={{ transformOrigin: "12px 13px" }}
        d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </IconFrame>
  );
}

// --- Music: the notes hop --------------------------------------------------------
const HOP = { normal: { y: 0 }, animate: { y: [0, -2.5, 0, -1, 0], transition: { duration: 0.6, ease: "easeOut" } } };
export function MusicIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg} svgProps={{ animate: controls, initial: "normal", variants: HOP }}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </IconFrame>
  );
}

// --- Video (camera): the lens part nudges, like recording ------------------------
export function VideoIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal"
        variants={{ normal: { x: 0 }, animate: { x: [0, 1.5, 0, 1, 0], transition: { duration: 0.6 } } }}
        d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </IconFrame>
  );
}

// --- Ear off ("video only"): the slash redraws ------------------------------------
export function EarOffIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="M6 18.5a3.5 3.5 0 1 0 7 0c0-1.57.92-2.52 2.04-3.46" />
      <path d="M6 8.5c0-.75.13-1.47.36-2.14" />
      <path d="M8.8 3.15A6.5 6.5 0 0 1 19 8.5c0 1.63-.44 2.81-1.09 3.76" />
      <path d="M12.5 6A2.5 2.5 0 0 1 15 8.5M10 13a2 2 0 0 0 1.82-1.18" />
      <motion.line animate={controls} initial="normal"
        variants={{ normal: { pathLength: 1 }, animate: { pathLength: [0, 1], transition: { duration: 0.4, ease: "easeOut" } } }}
        x1="2" x2="22" y1="2" y2="22" />
    </IconFrame>
  );
}

// --- Paintbrush: the brush sweeps --------------------------------------------------
export function PaintbrushIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal", style: { overflow: "visible", display: "block", transformOrigin: "20px 4px" },
        variants: { normal: { rotate: 0 }, animate: { rotate: [0, -12, 8, -4, 0], transition: { duration: 0.6, ease: "easeInOut" } } } }}>
      <path d="m14.622 17.897-10.68-2.913" />
      <path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z" />
      <path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15" />
    </IconFrame>
  );
}

// --- Wand: waves, the sparkles blink ------------------------------------------------
export function WandSparklesIcon(props) {
  const [controls, ref] = useSimpleControls();
  const blink = (d) => ({ normal: { opacity: 1 }, animate: { opacity: [1, 0, 1], transition: { duration: 0.5, delay: d } } });
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal" style={{ transformOrigin: "3px 21px" }}
        variants={{ normal: { rotate: 0 }, animate: { rotate: [0, -8, 6, 0], transition: { duration: 0.5 } } }}
        d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72M14 7l3 3" />
      <motion.path animate={controls} initial="normal" variants={blink(0)} d="M5 6v4M7 8H3" />
      <motion.path animate={controls} initial="normal" variants={blink(0.12)} d="M19 14v4M21 16h-4" />
      <motion.path animate={controls} initial="normal" variants={blink(0.24)} d="M10 2v2M11 3H9" />
    </IconFrame>
  );
}

// --- List checks: the ticks redraw one after the other --------------------------------
export function ListChecksIcon(props) {
  const [controls, ref] = useSimpleControls();
  const tick = (d) => ({ normal: { pathLength: 1 }, animate: { pathLength: [0, 1], transition: { duration: 0.3, delay: d } } });
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.path animate={controls} initial="normal" variants={tick(0)} d="m3 7 2 2 4-4" />
      <motion.path animate={controls} initial="normal" variants={tick(0.15)} d="m3 17 2 2 4-4" />
      <path d="M13 6h8M13 12h8M13 18h8" />
    </IconFrame>
  );
}

// --- List video: the play triangle pulses ----------------------------------------------
export function ListVideoIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="M12 12H3M16 6H3M12 18H3" />
      <motion.path animate={controls} initial="normal" style={{ transformOrigin: "18px 15px" }}
        variants={{ normal: { scale: 1, x: 0 }, animate: { scale: [1, 1.2, 1], x: [0, 1, 0], transition: { duration: 0.45 } } }}
        d="m16 12 5 3-5 3v-6Z" />
    </IconFrame>
  );
}

// --- Pencil (edit title): writes a little stroke ------------------------------------------
export function PencilIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal", style: { overflow: "visible", display: "block", transformOrigin: "3px 21px" },
        variants: { normal: { rotate: 0, x: 0 }, animate: { rotate: [0, -10, 4, -6, 0], x: [0, 1, -1, 1, 0], transition: { duration: 0.6 } } } }}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </IconFrame>
  );
}

// --- Loader (spinner): always spinning (status, not a hover icon) ------------------------------
export function LoaderCircleIcon({ className = "", ...props }) {
  return (
    <IconFrame {...props} className={`animate-spin ${className}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </IconFrame>
  );
}

// --- Cookie (browser cookies setting): rolls a little, the chips twinkle -------------
export function CookieIcon(props) {
  const [controls, ref] = useSimpleControls();
  const chip = (d) => ({ normal: { scale: 1 }, animate: { scale: [1, 1.6, 1], transition: { duration: 0.35, delay: d } } });
  const chips = [[8.5, 9], [15, 8.5], [12, 13], [8.5, 15], [15.5, 14.5]];
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal",
        variants: { normal: { rotate: 0 }, animate: { rotate: [0, -20, 10, 0], transition: { duration: 0.6, ease: "easeInOut" } } } }}>
      <circle cx="12" cy="12" r="9.5" />
      {chips.map(([cx, cy], i) => (
        <motion.circle key={i} animate={controls} initial="normal" variants={chip(i * 0.06)}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
          cx={cx} cy={cy} r="1" fill="currentColor" stroke="none" />
      ))}
    </IconFrame>
  );
}

// --- Palette (colors): the paint dots pop one after another ---------------------
export function PaletteIcon(props) {
  const [controls, ref] = useSimpleControls();
  const dots = [[13.5, 6.5], [17.5, 10.5], [8.5, 7.5], [6.5, 12.5]];
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal",
        variants: { normal: { rotate: 0 }, animate: { rotate: [0, -8, 6, 0], transition: { duration: 0.6 } } } }}>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
      {dots.map(([cx, cy], i) => (
        <motion.circle key={i} cx={cx} cy={cy} r="1" fill="currentColor" stroke="none"
          style={{ transformOrigin: `${cx}px ${cy}px` }}
          animate={controls} initial="normal"
          variants={{ normal: { scale: 1 }, animate: { scale: [1, 1.9, 1], transition: { duration: 0.35, delay: i * 0.07 } } }} />
      ))}
    </IconFrame>
  );
}

// --- Sun dim (darken): the rays turn and dim --------------------------------------
export function SunDimIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <circle cx="12" cy="12" r="4" />
      <motion.g style={{ transformOrigin: "12px 12px" }} animate={controls} initial="normal"
        variants={{ normal: { rotate: 0, opacity: 1 }, animate: { rotate: 45, opacity: [1, 0.35, 1], transition: { duration: 0.6 } } }}>
        <path d="M12 4h.01" /><path d="M20 12h.01" /><path d="M12 20h.01" /><path d="M4 12h.01" />
        <path d="M17.657 6.343h.01" /><path d="M17.657 17.657h.01" /><path d="M6.343 17.657h.01" /><path d="M6.343 6.343h.01" />
      </motion.g>
    </IconFrame>
  );
}

// --- Droplet (blur): wobbles like a falling drop ----------------------------------
export function DropletIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal",
        variants: { normal: { y: 0, scaleY: 1, scaleX: 1 }, animate: { y: [0, -2, 1.5, 0], scaleY: [1, 1.08, 0.9, 1], scaleX: [1, 0.94, 1.08, 1], transition: { duration: 0.6 } } } }}>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />
    </IconFrame>
  );
}

// --- Mouse pointer (interaction): taps ---------------------------------------------
export function MousePointerIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal",
        variants: { normal: { x: 0, y: 0, scale: 1 }, animate: { x: [0, 2, 0], y: [0, 2, 0], scale: [1, 0.88, 1], transition: { duration: 0.45 } } } }}>
      <path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />
    </IconFrame>
  );
}

// --- Sliders (spacing / amount): the knobs slide ------------------------------------
export function SlidersHorizontalIcon(props) {
  const [controls, ref] = useSimpleControls();
  const knob = (dx, d) => ({ normal: { x: 0 }, animate: { x: [0, dx, 0], transition: { duration: 0.6, delay: d } } });
  return (
    <IconFrame {...props} iconRef={ref}>
      <line x1="21" x2="3" y1="4" y2="4" />
      <line x1="21" x2="3" y1="12" y2="12" />
      <line x1="21" x2="3" y1="20" y2="20" />
      <motion.line x1="14" x2="14" y1="2" y2="6" animate={controls} initial="normal" variants={knob(-5, 0)} />
      <motion.line x1="8" x2="8" y1="10" y2="14" animate={controls} initial="normal" variants={knob(6, 0.08)} />
      <motion.line x1="16" x2="16" y1="18" y2="22" animate={controls} initial="normal" variants={knob(-4, 0.16)} />
    </IconFrame>
  );
}

// --- Engine (download engine / yt-dlp): the engine block idles and vibrates ---------
// Fast small x/y jitter of the whole engine (like a motor running), while the
// top cap and the side mount kick a little out of phase.
const ENGINE_BODY = {
  normal: { x: 0, y: 0, rotate: 0 },
  animate: {
    x: [0, -0.6, 0.6, -0.5, 0.5, -0.4, 0.4, -0.2, 0],
    y: [0, 0.4, -0.4, 0.5, -0.3, 0.3, -0.2, 0.1, 0],
    rotate: [0, -1.5, 1.5, -1.2, 1.2, -0.8, 0.8, -0.3, 0],
    transition: { duration: 0.7, ease: "linear" },
  },
};
const ENGINE_PART = (dy) => ({
  normal: { y: 0 },
  animate: { y: [0, -dy, 0, -dy, 0, -dy * 0.6, 0], transition: { duration: 0.7, ease: "easeInOut" } },
});
export function EngineIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal", variants: ENGINE_BODY }}>
      <motion.g animate={controls} initial="normal" variants={ENGINE_PART(1)}>
        <path d="M10 3h6" />
        <path d="M13 3v4" />
      </motion.g>
      <motion.g animate={controls} initial="normal" variants={ENGINE_PART(0.6)}>
        <path d="M2 10v6" />
        <path d="M2 13h4" />
      </motion.g>
      <path d="M6 16a2 2 0 002 2h1a2 2 0 011.6.8l.3.4a2 2 0 001.6.8h2.264a2 2 0 001.789-1.106l1.67-3.341a1 1 0 01.895-.553H21a1 1 0 001-1v-4a1 1 0 00-1-1h-3.5a1 1 0 01-.8-.4l-.9-1.2A1 1 0 0015 7h-4a1 1 0 00-.8.4l-.9 1.2a1 1 0 01-.8.4H7a1 1 0 00-1 1z" />
    </IconFrame>
  );
}

// --- Clap (video + audio), from lucide-animated "clap": the clapper snaps shut ------
const CLAP_BOARD = {
  normal: { rotate: 0 },
  animate: { rotate: [-10, -10, 0], transition: { duration: 0.8, times: [0, 0.5, 1], ease: "easeInOut" } },
};
const CLAP_STICK = {
  normal: { rotate: 0 },
  animate: { rotate: [0, -10, 16, 0], transition: { duration: 0.4, times: [0, 0.3, 0.6, 1], ease: "easeInOut" } },
};
export function ClapIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <motion.g animate={controls} initial="normal" variants={CLAP_BOARD} style={{ transformOrigin: "4px 20px" }}>
        <motion.g animate={controls} initial="normal" variants={CLAP_STICK} style={{ transformOrigin: "3px 11px" }}>
          <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
          <path d="m6.2 5.3 3.1 3.9" />
          <path d="m12.4 3.4 3.1 4" />
        </motion.g>
        <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      </motion.g>
    </IconFrame>
  );
}

// --- Folder input (format), from lucide-animated "folder-input": the arrow goes in ----
export function FolderInputIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1" />
      <motion.g animate={controls} initial="normal" transition={{ times: [0, 0.4, 1], duration: 0.5 }}
        variants={{ normal: { x: 0 }, animate: { x: [0, 2, 0] } }}>
        <path d="M2 13h10" />
        <path d="m9 16 3-3-3-3" />
      </motion.g>
    </IconFrame>
  );
}

// --- Monitor cog (quality), from lucide-animated "monitor-cog": the cog turns --------
export function MonitorCogIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref}>
      <path d="M12 17v4" />
      <path d="M22 13v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
      <path d="M8 21h8" />
      <motion.g animate={controls} initial="normal" style={{ transformOrigin: "18px 6px" }}
        transition={{ type: "spring", stiffness: 50, damping: 10 }}
        variants={{ normal: { rotate: 0 }, animate: { rotate: 180 } }}>
        <path d="m14.305 7.53.923-.382" />
        <path d="m15.228 4.852-.923-.383" />
        <path d="m16.852 3.228-.383-.924" />
        <path d="m16.852 8.772-.383.923" />
        <path d="m19.148 3.228.383-.924" />
        <path d="m19.53 9.696-.382-.924" />
        <path d="m20.772 4.852.924-.383" />
        <path d="m20.772 7.148.924.383" />
        <circle cx="18" cy="6" r="3" />
      </motion.g>
    </IconFrame>
  );
}

// --- Run: a running stick figure (filled head). Idle it holds a running pose;
// while its control is hovered it actually runs: a 6-frame run cycle (contact →
// down → push → toe-off → heel kick → knee drive) where the knees bend and the
// back foot kicks up, elbows stay bent while the arms pump opposite to the
// legs, and the body dips on each landing. The figure is narrow, so it's
// scaled 1.3× around its own center (12.35, 11.6) to the middle of the grid:
// it fills the icon box like other icons and sits centered next to its label.
// Every limb is one path whose points morph between frames. Drawn for this app
// in Lucide's style (24 grid, 2 px).
const runPath = (a, b, c) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]}`;
const RUN_HIP = [11.4, 13];
const RUN_SHOULDER = [13.3, 8.5];
// [knee, foot] per frame
const RUN_LEG = [
  [[14.3, 15.7], [15.9, 19.8]], // contact (front leg reaching)
  [[13.4, 16.5], [12.9, 20.4]], // down (weight on it)
  [[11.2, 16.9], [8.8, 19.9]],  // push
  [[10.2, 16.6], [7.4, 18.6]],  // toe-off
  [[9.9, 15.8], [7.7, 15.6]],   // heel kicks up behind
  [[14.6, 14.4], [14.0, 17.8]], // knee drives forward
];
// [elbow, hand] per frame (bent arm pumping)
const RUN_ARM = [
  [[15.3, 10.6], [17.3, 9.1]],  // forward, hand up
  [[14.7, 11.3], [16.6, 11.6]],
  [[14.2, 11.6], [16.2, 12.2]],
  [[11.1, 11.0], [9.6, 12.4]],  // back
  [[10.9, 10.1], [9.0, 9.4]],   // back, high
  [[12.0, 11.4], [11.6, 13.4]],
];
const RUN_STRIDE = 0.6; // s per full cycle (two steps)
const runCycle = (frames, root, offset) => {
  const seq = frames.map((_, k) => frames[(k + offset) % frames.length]).map(([j, e]) => runPath(root, j, e));
  return {
    normal: { d: seq[0], transition: { duration: 0.25, ease: "easeOut" } },
    animate: { d: [...seq, seq[0]], transition: { duration: RUN_STRIDE, ease: "linear", repeat: Infinity } },
  };
};
const RUN_LEG_A = runCycle(RUN_LEG, RUN_HIP, 0);
const RUN_LEG_B = runCycle(RUN_LEG, RUN_HIP, 3);
const RUN_ARM_A = runCycle(RUN_ARM, RUN_SHOULDER, 3); // opposite to leg A
const RUN_ARM_B = runCycle(RUN_ARM, RUN_SHOULDER, 0);
const RUN_BODY = {
  normal: { y: 0, transition: { duration: 0.25 } },
  animate: { y: [0.2, 0.8, 0, 0.2, 0.8, 0, 0.2], transition: { duration: RUN_STRIDE, ease: "easeInOut", repeat: Infinity } },
};
export function RunIcon(props) {
  const [controls, ref] = useSimpleControls();
  const p = (variants) => ({ animate: controls, initial: "normal", variants });
  return (
    <IconFrame {...props} iconRef={ref}>
      <g transform="translate(12 12) scale(1.3) translate(-12.35 -11.6)" strokeWidth={2 / 1.3}>
      <motion.g {...p(RUN_BODY)}>
        <circle cx="14.9" cy="4.5" r="2.1" fill="currentColor" stroke="none" />
        <path d={`M${RUN_SHOULDER[0]} ${RUN_SHOULDER[1]} L${RUN_HIP[0]} ${RUN_HIP[1]}`} />
        <motion.path {...p(RUN_ARM_A)} d={RUN_ARM_A.normal.d} />
        <motion.path {...p(RUN_ARM_B)} d={RUN_ARM_B.normal.d} />
        <motion.path {...p(RUN_LEG_A)} d={RUN_LEG_A.normal.d} />
        <motion.path {...p(RUN_LEG_B)} d={RUN_LEG_B.normal.d} />
      </motion.g>
      </g>
    </IconFrame>
  );
}

// --- Plus (add a wallpaper): turns a quarter on hover -----------------------
export function PlusIcon(props) {
  const [controls, ref] = useSimpleControls();
  return (
    <IconFrame {...props} iconRef={ref} Svg={motion.svg}
      svgProps={{ animate: controls, initial: "normal", transition: { type: "spring", stiffness: 300, damping: 18 }, variants: { normal: { rotate: 0, scale: 1 }, animate: { rotate: 90, scale: 1.1 } } }}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </IconFrame>
  );
}
