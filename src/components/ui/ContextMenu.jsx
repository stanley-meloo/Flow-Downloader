// App-wide right-click menu. Replaces the webview's default context menu
// everywhere (the default one is always suppressed), with a liquid-glass panel:
//   - Copy / Cut / Paste — only when there's selected text or a text field
//   - Context items — from `buildSections(ctx)` (App.jsx), based on the closest
//     element with a data-ctx attribute: "queue-item" (data-ctx-id), "queue",
//     "search", "media-thumb", or nothing (anywhere else in the app)
//   - Reload
//   - Support Flow Downloader (always last; opens the Linktree)
//   - Copy console diagnostics (console errors + the app's diagnostics report)
//   - Screenshot — captures only the app window (Rust: screenshot.rs), saved
//     to Pictures/Flow Downloader and copied to the clipboard.
//
// Geometry: panel padding 6 + item radius 10 → panel radius 16 (concentric).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  RefreshCwIcon as RotateCw, BugIcon as Bug, CameraIcon as Camera,
  CopyIcon as Copy, ScissorsIcon as Scissors, ClipboardPasteIcon as ClipboardPaste,
  CheckIcon as Check, HeartIcon as Heart,
} from "./AnimatedIcons";
import { open as openExternal } from "@tauri-apps/plugin-shell"; // opens links in the default browser // animated on hover (lucide-animated style)
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import LiquidGlass from "./liquidGlass/LiquidGlass";
import { buildDiagnosticsReport } from "../../utils/diagnostics";
import { IS_MAC } from "../../utils/keybinds";
import screenshotSfx from "../../assets/sounds/screenshot.mp3"; // shutter sound for "Screenshot"

const MENU_GLASS = { blur: 1, preBlur: 10, darkTint: 0.55, edgeHighlight: 0.12, depth: 14, coreOpacity: 0.6 };
const EDGE = 8; // px kept between the menu and the window edges
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const SUPPORT_URL = "https://linktr.ee/flow.downloader";

// Shutter sound, loaded once and reused (rewound on every shot).
let shutter = null;
function playShutter() {
  try {
    shutter ??= Object.assign(new Audio(screenshotSfx), { volume: 0.7, preload: "auto" });
    shutter.currentTime = 0;
    shutter.play().catch(() => {}); // autoplay rules / no audio device: stay silent
  } catch {
    /* audio unavailable */
  }
}

// Camera-style flash over the whole app window (CSS animation in App.css,
// the element removes itself when it ends).
function cameraFlash() {
  const el = document.createElement("div");
  el.className = "camera-flash";
  el.setAttribute("aria-hidden", "true");
  el.addEventListener("animationend", () => el.remove(), { once: true });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500); // safety net
}

function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA") return !el.readOnly && !el.disabled;
  if (el.tagName === "INPUT") {
    const type = (el.type || "text").toLowerCase();
    return ["text", "search", "url", "email", "password", "tel", "number"].includes(type) && !el.readOnly && !el.disabled;
  }
  return false;
}

function selectedTextIn(el) {
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
    try {
      return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
    } catch {
      return ""; // inputs like "number" don't expose a selection
    }
  }
  return window.getSelection()?.toString() || "";
}

export default function ContextMenu({ showToast, buildSections }) {
  const { t, i18n } = useTranslation();
  const [menu, setMenu] = useState(null); // { x, y, target, field, selection }
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const panelRef = useRef(null);
  const busyRef = useRef(false);

  // Replace the default menu everywhere.
  useEffect(() => {
    const onContextMenu = (e) => {
      e.preventDefault();
      const target = e.target instanceof Element ? e.target.closest("input, textarea, [contenteditable='true']") || e.target : null;
      const ctxEl = e.target instanceof Element ? e.target.closest("[data-ctx]") : null;
      setMenu({
        ctx: { kind: ctxEl?.dataset.ctx || null, id: ctxEl?.dataset.ctxId || null },
        x: e.clientX,
        y: e.clientY,
        target,
        field: isTextField(target),
        selection: selectedTextIn(target),
        key: Date.now(), // re-animates when opened again somewhere else
      });
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Close on outside click, Escape, scroll, resize or when the window loses focus.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointerDown = (e) => { if (!panelRef.current?.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("wheel", close);
    };
  }, [menu]);

  // Keep the menu inside the window (flip left / up near the edges).
  useLayoutEffect(() => {
    if (!menu || !panelRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = panelRef.current;
    let left = menu.x;
    let top = menu.y;
    if (left + w > window.innerWidth - EDGE) left = Math.max(EDGE, menu.x - w);
    if (top + h > window.innerHeight - EDGE) top = Math.max(EDGE, menu.y - h);
    setPos({ left, top });
  }, [menu]);

  const run = (action) => async () => {
    const current = menu;
    setMenu(null);
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await action(current);
    } finally {
      busyRef.current = false;
    }
  };

  // --- Actions ---------------------------------------------------------------
  const focusField = (m) => { m?.target?.focus?.(); };

  const copy = async (m) => {
    if (m.selection) await writeText(m.selection);
  };
  const cut = async (m) => {
    if (!m.selection) return;
    await writeText(m.selection);
    focusField(m);
    document.execCommand("delete"); // goes through the input's normal onChange
  };
  const paste = async (m) => {
    const text = await readText().catch(() => "");
    if (!text) return;
    focusField(m);
    document.execCommand("insertText", false, text); // same as typing it (React sees the change)
  };
  const reload = async () => {
    window.location.reload();
  };
  const copyDiagnostics = async () => {
    try {
      // Repository link + app diagnostics + console errors (utils/diagnostics.js).
      await writeText(await buildDiagnosticsReport({ language: i18n.language, includeConsole: true }));
      showToast?.("console_copied", "success");
    } catch (e) {
      console.error("[ContextMenu] diagnostics", e);
      showToast?.("diagnostics_error", "error");
    }
  };
  const screenshot = async () => {
    // Let the menu fade out completely first, so it isn't in the picture.
    await new Promise((r) => setTimeout(r, 220));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await invoke("capture_app_window");
      cameraFlash(); // after the capture, so the flash isn't in the picture
      playShutter();
      showToast?.("screenshot_saved", "success");
    } catch (e) {
      console.error("[ContextMenu] screenshot", e);
      showToast?.("screenshot_error", "error");
    }
  };

  // --- Items -----------------------------------------------------------------
  const editItems = [];
  if (menu?.selection) editItems.push({ id: "copy", icon: Copy, label: t("context_menu.copy", { defaultValue: "Copy" }), hint: `${MOD}C`, action: copy });
  if (menu?.field && menu?.selection) editItems.push({ id: "cut", icon: Scissors, label: t("context_menu.cut", { defaultValue: "Cut" }), hint: `${MOD}X`, action: cut });
  if (menu?.field) editItems.push({ id: "paste", icon: ClipboardPaste, label: t("context_menu.paste", { defaultValue: "Paste" }), hint: `${MOD}V`, action: paste });

  // Context items (from App.jsx); evaluated with the app's current state.
  // Safety net: an option already listed (same label) is never shown twice.
  const seenLabels = new Set();
  const contextSections = menu
    ? (buildSections?.(menu.ctx) || [])
        .map((sec) => sec && { ...sec, items: (sec.items || []).filter((it) => !seenLabels.has(it.label) && seenLabels.add(it.label)) })
        .filter((sec) => sec?.items?.length)
    : [];

  const appItems = [
    { id: "reload", icon: RotateCw, label: t("context_menu.reload", { defaultValue: "Reload" }), action: reload },
    { id: "diagnostics", icon: Bug, label: t("context_menu.copy_console", { defaultValue: "Copy console diagnostics" }), action: copyDiagnostics },
    { id: "screenshot", icon: Camera, label: t("context_menu.screenshot", { defaultValue: "Screenshot" }), action: screenshot },
  ];

  const renderItem = (item) => (
    <button
      key={item.id}
      role={item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
      aria-checked={item.checked}
      data-tooltip={item.title}
      onClick={run(item.action)}
      className={`w-full flex items-center gap-2.5 h-9 px-2.5 rounded-[10px] text-[12.5px] font-semibold transition-colors cursor-pointer outline-none hover:bg-white/10 focus-visible:bg-white/10 ${item.danger ? "text-red-300 hover:text-red-200" : item.support ? "text-rose-300 hover:text-rose-200" : "text-zinc-200 hover:text-white"}`}
    >
      <item.icon size={15} className={`shrink-0 ${item.danger ? "text-red-400" : item.support ? "text-rose-400" : "text-zinc-400"}`} />
      <span className="flex-1 min-w-0 text-left truncate">{item.label}</span>
      {item.hint && <span className="text-[10.5px] font-mono text-zinc-500 shrink-0">{item.hint}</span>}
      {item.checked && <Check size={14} strokeWidth={3} className="shrink-0 text-indigo-400" />}
    </button>
  );

  // Groups, in order, separated by a thin line.
  const groups = [
    editItems.length ? { id: "edit", items: editItems } : null,
    ...contextSections,
    { id: "app", items: appItems },
    // Always the very last option: support link (same as the heart button).
    // The label drops the emoji (the coin stays on the heart button's tooltip).
    { id: "support", items: [{ id: "support", icon: Heart, label: t("support_flow", { defaultValue: "Support Flow Downloader 🪙" }).replace(/\s*\p{Extended_Pictographic}\uFE0F?/gu, "").trim(), support: true, action: () => openExternal(SUPPORT_URL) }] },
  ].filter(Boolean);
  const separator = <div className="my-1 mx-2 h-px bg-white/10" />;

  return (
    <AnimatePresence>
      {menu && (
        <motion.div
          key={menu.key}
          ref={panelRef}
          role="menu"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
          transition={{ duration: 0.14, ease: "easeOut" }}
          // keeps the focus (and the selection) in the text field while clicking items
          onMouseDown={(e) => e.preventDefault()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
          style={{ left: pos.left, top: pos.top, transformOrigin: "top left" }}
          className="fixed z-[10020] min-w-[220px] max-w-[320px] p-1.5 rounded-2xl isolate shadow-2xl backdrop-blur-md"
        >
          <LiquidGlass
            variant="dark"
            settings={MENU_GLASS}
            radius={16}
            maxFps={30}
            className="absolute inset-0 -z-10 pointer-events-none rounded-2xl"
            fallbackClassName="bg-zinc-950/85 backdrop-blur-2xl border border-white/10"
          />
          {groups.map((group, i) => (
            <div key={group.id} role="group">
              {i > 0 && separator}
              {group.title && (
                <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-black uppercase tracking-widest text-zinc-500">{group.title}</div>
              )}
              {group.items.map(renderItem)}
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
