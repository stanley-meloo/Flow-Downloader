// Context items for the right-click menu (components/ui/ContextMenu.jsx).
// Returns buildSections(ctx): ctx.kind comes from the closest data-ctx element
// under the pointer ("queue-item" + ctx.id, "queue", "search", "media-thumb",
// or null anywhere else). Each section: { id, title?, items: [...] };
// each item: { id, icon, label, action, hint?, checked?, danger?, title? }.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ClipboardPasteIcon, FolderOpenIcon, SettingsIcon, PinIcon, ExternalLinkIcon,
  LinkIcon, RotateCcwIcon, BanIcon, TrashIcon, DownloadIcon, XIcon, ClockIcon,
  ImageIcon, CopyIcon, CircleCheckIcon,
} from "../components/ui/AnimatedIcons";
import { getSearchHistory, getLastDownloadFolder } from "../utils/recent";
import { openMediaLocation, resolveMediaPath, openPath } from "../utils/fileSystem";

const ACTIVE = ["Downloading", "Processing..."];
const isLink = (s) => /^https?:\/\/\S+$/i.test((s || "").trim());

export default function useContextMenuSections({ downloader, settings, openSettings, showToast, modalOpen }) {
  const { t } = useTranslation();
  const [onTop, setOnTop] = useState(false);
  const L = (key, fallback, opts) => t(`context_menu.${key}`, { defaultValue: fallback, ...opts });

  // --- shared actions ---------------------------------------------------------
  const pasteAndSearch = async () => {
    const text = ((await readText().catch(() => "")) || "").trim();
    if (!text) return showToast("clipboard_empty", "info");
    if (!isLink(text)) return showToast("error_invalid", "error");
    downloader.analyzeLink(text);
  };

  // The folder the user last downloaded into (falls back to the current /
  // default download folder, then the system Downloads folder).
  const openLastFolder = async () => {
    const dir = getLastDownloadFolder() || downloader.downloadPath || settings.defaultPath || (await downloadDir());
    try {
      await openPath(dir);
    } catch (e) {
      console.error("[ContextMenu] open folder", e);
      showToast("open_error", "error");
    }
  };

  const toggleOnTop = async () => {
    const next = !onTop;
    try {
      await getCurrentWindow().setAlwaysOnTop(next);
      setOnTop(next);
    } catch (e) {
      console.error("[ContextMenu] always on top", e);
    }
  };

  const copy = async (text, toastKey) => {
    try {
      await writeText(text);
      showToast(toastKey, "success");
    } catch (e) {
      console.error("[ContextMenu] copy", e);
    }
  };

  // --- sections ---------------------------------------------------------------
  const generalSection = () => ({
    id: "general",
    items: [
      { id: "paste-search", icon: ClipboardPasteIcon, label: L("paste_search", "Paste link and search"), action: pasteAndSearch },
      { id: "open-folder", icon: FolderOpenIcon, label: L("open_last_folder", "Open last download folder"), action: openLastFolder },
      { id: "settings", icon: SettingsIcon, label: L("settings", "Settings"), action: openSettings },
      { id: "on-top", icon: PinIcon, label: L("always_on_top", "Keep window on top"), checked: onTop, action: toggleOnTop },
    ],
  });

  const queueItemSection = (item) => {
    const done = item.status === "Done";
    const active = ACTIVE.includes(item.status);
    const waiting = item.status === "Waiting";
    const failed = item.status === "Error" || item.status === "Canceled";
    const items = [];
    if (done) {
      items.push({
        id: "open-file", icon: ExternalLinkIcon, label: L("open_file", "Open file"),
        action: async () => {
          const path = await resolveMediaPath(item.directory, item.outputFile, item.title, item.ext);
          try {
            if (!path) throw new Error("file not found");
            await openPath(path);
          } catch (e) {
            console.error("[ContextMenu] open file", e);
            showToast("open_error", "error");
          }
        },
      });
      items.push({
        id: "show-folder", icon: FolderOpenIcon, label: L("show_in_folder", "Show in folder"),
        action: () => openMediaLocation(item.directory, item.outputFile, item.title, item.ext, showToast),
      });
    }
    if (item.url) {
      items.push({ id: "copy-link", icon: LinkIcon, label: L("copy_link", "Copy original link"), action: () => copy(item.url, "link_copied") });
    }
    if (failed) items.push({ id: "retry", icon: RotateCcwIcon, label: L("retry", "Try again"), action: () => downloader.retryDownload(item.id) });
    if (item.url && !modalOpen) {
      items.push({ id: "again", icon: DownloadIcon, label: L("download_again", "Download again in another quality"), action: () => downloader.analyzeLink(item.url) });
    }
    if (active || waiting) items.push({ id: "cancel", icon: BanIcon, label: L("cancel", "Cancel"), danger: true, action: () => downloader.cancelDownload(item.id) });
    items.push({ id: "remove", icon: TrashIcon, label: L("remove", "Remove from list"), danger: true, action: () => downloader.removeItem(item.id) });
    return { id: "queue-item", items };
  };

  const queueSection = () => {
    const q = downloader.queue;
    const items = [];
    if (q.some((i) => i.status === "Done")) {
      items.push({ id: "clear-done", icon: CircleCheckIcon, label: L("clear_finished", "Clear completed"), action: downloader.clearFinished });
    }
    if (q.some((i) => i.status === "Waiting" || ACTIVE.includes(i.status))) {
      items.push({ id: "cancel-all", icon: BanIcon, label: L("cancel_all", "Cancel all"), danger: true, action: downloader.cancelAll });
    }
    // "Open last download folder" comes from the general section below it.
    return { id: "queue", items };
  };

  const searchSections = () => {
    const sections = [];
    const items = [
      { id: "paste-search-bar", icon: ClipboardPasteIcon, label: L("paste_search", "Paste link and search"), action: pasteAndSearch },
    ];
    if (downloader.url) items.push({ id: "clear", icon: XIcon, label: L("clear", "Clear"), action: () => downloader.setUrl("") });
    sections.push({ id: "search", items });
    const history = getSearchHistory().slice(0, 5);
    if (history.length) {
      sections.push({
        id: "recent",
        title: L("recent", "Recent"),
        items: history.map((h, i) => ({
          id: `recent-${i}`, icon: ClockIcon, label: h.title, title: h.url,
          action: () => downloader.analyzeLink(h.url),
        })),
      });
    }
    return sections;
  };

  const thumbSection = () => {
    const media = downloader.mediaData;
    if (!media) return null;
    const items = [
      {
        id: "save-thumb", icon: DownloadIcon, label: L("save_thumbnail", "Save thumbnail"),
        // Same as clicking the thumbnail (the dialog shows the progress / result).
        action: () => document.querySelector('[data-ctx="media-thumb"]')?.click(),
      },
    ];
    if (media.thumbnail) {
      items.push({
        id: "copy-image", icon: ImageIcon, label: L("copy_image", "Copy image"),
        action: async () => {
          try {
            await invoke("copy_image_from_url", { url: media.thumbnail });
            showToast("image_copied", "success");
          } catch (e) {
            console.error("[ContextMenu] copy image", e);
            showToast("image_copy_error", "error");
          }
        },
      });
    }
    if (media.title) items.push({ id: "copy-title", icon: CopyIcon, label: L("copy_title", "Copy title"), action: () => copy(media.title, "title_copied") });
    return { id: "thumb", items };
  };

  return (ctx) => {
    const kind = ctx?.kind;
    if (kind === "queue-item") {
      const item = downloader.queue.find((i) => i.id === ctx.id);
      return item ? [queueItemSection(item)] : [];
    }
    if (kind === "media-thumb") return [thumbSection()].filter(Boolean);
    if (modalOpen) return []; // a dialog is open: only the edit + app items
    if (kind === "queue") return [queueSection(), generalSection()];
    if (kind === "search") return searchSections();
    return [generalSection()];
  };
}
