// Drag a link (from the browser's address bar, a page, a chat…) onto the
// window to download it: while something with a link is dragged over the
// window, a soft frame + liquid-glass label appear; dropping starts the
// analysis, as if it had been pasted into the search bar.
//
// Needs the window's native file-drop handling off (tauri.conf.json →
// "dragDropEnabled": false), so the webview gets regular HTML5 drag events.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import LiquidGlass from "../ui/liquidGlass/LiquidGlass";
import { LinkIcon } from "../ui/AnimatedIcons";

const hasLink = (dt) => !!dt && Array.from(dt.types || []).some((t) => t === "text/uri-list" || t === "text/plain");

// First http(s) link in the dropped data (uri-list first, then plain text).
function linkFrom(dt) {
  const uris = (dt.getData("text/uri-list") || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const text = (dt.getData("text/plain") || "").trim();
  return [...uris, ...text.split(/\s+/)].find((c) => /^https?:\/\/\S+$/i.test(c) && !isAppUrl(c)) || null;
}

// The app's own files (dev server, tauri://, asset://): never a download link.
const isAppUrl = (u) => {
  try {
    const h = new URL(u).hostname;
    return h === location.hostname || h === "localhost" || h === "127.0.0.1" || h.endsWith(".localhost");
  } catch { return true; }
};

export default function LinkDropZone({ enabled = true, onLink }) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/leave fire for every child element
  const latest = useRef({ enabled, onLink });
  latest.current = { enabled, onLink };

  useEffect(() => {
    const onEnter = (e) => {
      if (!latest.current.enabled || !hasLink(e.dataTransfer)) return;
      depth.current += 1;
      setOver(true);
    };
    // Every drop is handled here: without this the webview would navigate to
    // a dropped link or file and the app would be gone.
    const onOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = latest.current.enabled && hasLink(e.dataTransfer) ? "copy" : "none";
    };
    const onLeave = () => {
      if (depth.current === 0) return;
      depth.current -= 1;
      if (depth.current === 0) setOver(false);
    };
    const onDrop = (e) => {
      const wasOver = depth.current > 0;
      depth.current = 0;
      setOver(false);
      e.preventDefault();
      if (!latest.current.enabled || !wasOver) return;
      const url = linkFrom(e.dataTransfer);
      if (url) latest.current.onLink?.(url);
    };
    // Dragging something of the app itself (a wallpaper <img>, an icon, a
    // link) with the mouse — usually by accident — would start a native drag
    // of its URL ("http://localhost:1420/src/assets/…"), and dropping it on
    // the search bar pasted that URL. Only text inside a field can be dragged.
    const onDragStart = (e) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
    };
    window.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragstart", onDragStart, true);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <AnimatePresence>
      {over && (
        <motion.div
          key="link-drop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.2, ease: "easeOut" } }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          className="fixed inset-0 z-[95] pointer-events-none flex items-center justify-center"
          aria-hidden="true"
        >
          {/* Soft frame around the window */}
          <div className="absolute inset-4 rounded-[28px] border-2 border-dashed border-white/35 bg-white/[0.03]" />
          <motion.div
            initial={{ scale: 0.94, y: 6 }}
            animate={{ scale: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }}
            className="relative"
          >
            <LiquidGlass
              variant="dark"
              className="flex items-center gap-3 h-14 px-6 rounded-full backdrop-blur-md shadow-2xl"
              fallbackClassName="backdrop-blur-2xl border border-white/10 bg-zinc-950/60"
            >
              <LinkIcon size={20} className="text-white" />
              <span className="text-[15px] font-semibold text-white whitespace-nowrap">
                {t("drop.title", { defaultValue: "Drop the link to download" })}
              </span>
            </LiquidGlass>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
