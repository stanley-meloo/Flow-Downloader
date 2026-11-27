import { useState, useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

const STARTUP_DELAY_MS = 8000;

/**
 * Flow Downloader self-update (Tauri updater plugin).
 * - Checks GitHub Releases quietly a few seconds after startup; when a newer
 *   version exists, `available` is set and App shows the update card
 *   (AppUpdateCard). "Ignore" folds it into a small round button next to the
 *   Settings gear (`minimized`); clicking it opens the card again. The close
 *   button hides both until the next launch (`dismissed`).
 * - install() downloads, verifies the signature and installs the update, then
 *   restarts the app. It refuses while downloads are running (`isBusy()`).
 */
const LAST_VERSION_KEY = "flow.lastVersion";

export default function useAppUpdater(showToast, isBusy = () => false) {
  const [version, setVersion] = useState("");
  const [available, setAvailable] = useState(null); // Update object from check()
  const [status, setStatus] = useState("idle");     // idle | checking | downloading | installing
  const [progress, setProgress] = useState(0);      // 0-100 while downloading
  const [dismissed, setDismissed] = useState(false);
  const [minimized, setMinimized] = useState(false);
  // Version the app was just updated to (first launch after an update), for
  // the glow across the app + "updated" toast (App.jsx, UpdateGlow.jsx).
  const [justUpdated, setJustUpdated] = useState(null);
  const busyRef = useRef(false);

  useEffect(() => {
    getVersion().then((v) => {
      setVersion(v);
      let prev = null;
      try {
        prev = localStorage.getItem(LAST_VERSION_KEY);
        localStorage.setItem(LAST_VERSION_KEY, v);
      } catch (e) { /* ignore */ }
      // No saved version but the app was used before (key written by 1.2.0's
      // engine check): coming from 1.2.0, which didn't save its version yet.
      let usedBefore = false;
      try { usedBefore = !prev && localStorage.getItem("ytdlp_last_update_check") !== null; } catch (e) { /* ignore */ }
      if ((prev && prev !== v) || usedBefore) setJustUpdated(v);
    }).catch(() => {});
  }, []);

  // Quiet check (no toast): the banner appears only when there's an update.
  const checkForUpdate = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus("checking");
    try {
      const update = await check();
      if (update) {
        setAvailable(update);
        setDismissed(false);
        setMinimized(false);
      }
    } catch (e) {
      // No published update feed yet, offline, ...
      console.warn("[App update] check failed:", e);
    } finally {
      busyRef.current = false;
      setStatus("idle");
    }
  };

  const install = async () => {
    if (!available || busyRef.current) return;
    if (isBusy()) { showToast?.("app_update_wait", "info"); return; }
    busyRef.current = true;
    setStatus("downloading");
    setProgress(0);
    try {
      let total = 0;
      let received = 0;
      await available.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength || 0;
        else if (event.event === "Progress") {
          received += event.data.chunkLength || 0;
          if (total) setProgress(Math.min(100, Math.round((received / total) * 100)));
        } else if (event.event === "Finished") setStatus("installing");
      });
      setStatus("installing");
      await relaunch(); // on Windows the installer already restarts the app
    } catch (e) {
      console.error("[App update] install failed:", e);
      showToast?.("app_update_error", "error");
      setStatus("idle");
    } finally {
      busyRef.current = false;
    }
  };

  // Quiet check shortly after startup.
  useEffect(() => {
    const timer = setTimeout(checkForUpdate, STARTUP_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = status === "downloading" || status === "installing";

  return {
    version,
    available: available ? { version: available.version, notes: available.body } : null,
    showCard: !!available && !dismissed && !minimized,
    showPill: !!available && !dismissed && minimized,
    minimize: () => { if (!busy) setMinimized(true); },
    restore: () => setMinimized(false),
    dismiss: () => {
      if (busy) return;
      setDismissed(true);
      setMinimized(false);
    },
    status, progress,
    install,
    justUpdated,
    clearJustUpdated: () => setJustUpdated(null),
  };
}
