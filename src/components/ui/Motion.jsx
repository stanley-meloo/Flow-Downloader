// Small reusable animation helpers (framer-motion) so state changes across the
// app transition smoothly instead of switching instantly.
//
//   <Swap id={x}>…</Swap>       crossfade when `id` changes (text, icons, button states)
//   <Collapse show={x} gap={n}> height + fade for blocks that appear/disappear
//   <Pop show={x}>…</Pop>        scale + fade for small inline elements (badges, icons)
//
// All three skip the animation on first render (AnimatePresence initial={false}),
// so opening a screen doesn't make every existing element "pop" in.
// Users who enable "reduce motion" in their OS get these toned down automatically
// (App.jsx wraps everything in <MotionConfig reducedMotion="user">).

import { motion, AnimatePresence } from "framer-motion";

// Shared feel for UI micro-interactions.
export const SPRING = { type: "spring", stiffness: 420, damping: 32, mass: 0.7 };
// Press (whileTap) of every button: a near-instant snap (30 ms, no spring, no
// wobble) so the click lands hard and fast. Press depths are shallow
// (scale ~0.95–0.99) so buttons don't "sink".
export const TAP = { type: "tween", duration: 0.03, ease: "easeOut" };
const FAST = { duration: 0.14, ease: "easeOut" };

// Crossfades its children whenever `id` changes. `as` picks the wrapper element
// (span by default) and `className` styles it (e.g. "block truncate" or "flex …").
export function Swap({ id, children, as = "span", className = "", y = 4, title }) {
  const M = motion[as] || motion.span;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <M
        key={String(id)}
        className={className}
        title={title}
        initial={{ opacity: 0, y }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -y }}
        transition={FAST}
      >
        {children}
      </M>
    </AnimatePresence>
  );
}

// Animates a block's height + opacity as it appears/disappears.
// `gap` = the spacing (px) the parent puts between children (space-y-* or gap-*).
// While collapsed, a negative top margin cancels that spacing, so siblings glide
// into place with no jump when the block is finally removed.
export function Collapse({ show, gap = 0, className = "", children }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="collapse"
          className={className}
          style={{ overflow: "hidden" }}
          initial={{ opacity: 0, height: 0, marginTop: -gap }}
          animate={{ opacity: 1, height: "auto", marginTop: 0 }}
          exit={{ opacity: 0, height: 0, marginTop: -gap }}
          transition={{ duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Scale + fade for small elements that appear/disappear (check badges, inline buttons).
export function Pop({ show, children, as = "span", className = "" }) {
  const M = motion[as] || motion.span;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <M
          key="pop"
          className={className}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={SPRING}
        >
          {children}
        </M>
      )}
    </AnimatePresence>
  );
}
