import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const LAST_CHECK_KEY = 'ytdlp_last_update_check'; // time of the last check (also read by useAppUpdater)
const PROGRESS_EVENT = 'ytdlp://update-progress'; // ytdlp.rs UPDATE_PROGRESS_EVENT

/**
 * Keeps yt-dlp (the download engine) up to date.
 * - Automatic check every time the app opens (a few seconds after startup):
 *   sites change often and an old engine breaks them. The Settings button
 *   runs it on demand too (checkForUpdate).
 * - The check only compares versions (`ytdlp_check_update`, nothing is
 *   downloaded). Only when a newer release exists is it downloaded
 *   (`ytdlp_update`), with a progress toast, then "updated". An automatic
 *   check that finds nothing new shows nothing.
 * - Exposes the installed `version` and the last check's `status`
 *   ('idle' | 'uptodate' | 'updated' | 'error') for Settings.
 *
 * The binary is replaced in the app's local data folder (writable copy), so
 * it also works when the app is installed in a protected folder.
 */
export default function useYtdlpUpdater(showToast, progressToast, hideToast) {
  const [updating, setUpdating] = useState(false);
  const [version, setVersion] = useState(null);
  const [status, setStatus] = useState('idle');
  const updatingRef = useRef(false);

  const refreshVersion = async () => {
    try {
      setVersion(await invoke('ytdlp_version'));
    } catch (e) {
      console.warn("[yt-dlp] version:", e);
    }
  };

  const runUpdate = async (force) => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    setUpdating(true);
    if (force) showToast?.("ytdlp_checking", "info");

    let unlisten = null;
    let downloading = false;
    try {
      const check = await invoke('ytdlp_check_update');
      try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch (e) { /* ignore */ }
      if (check.current) setVersion(check.current);
      hideToast?.("ytdlp_checking");

      if (!check.outdated) {
        setStatus('uptodate');
        if (force) showToast?.("ytdlp_uptodate", "success");
        return;
      }
      if (!check.writable) throw new Error("yt-dlp is not in a writable folder");

      // A newer version exists: download it, with the progress in a toast.
      downloading = true;
      const show = (progress) => progressToast?.("ytdlp_downloading", "download", { progress, version: check.latest });
      show(null);
      unlisten = await listen(PROGRESS_EVENT, ({ payload }) => {
        const { received = 0, total } = payload || {};
        show(total ? received / total : null);
      });
      const newVersion = await invoke('ytdlp_update');
      setVersion(newVersion || check.latest);
      setStatus('updated');
      hideToast?.("ytdlp_downloading");
      showToast?.("ytdlp_updated", "success", { version: newVersion || check.latest });
    } catch (err) {
      console.warn("[yt-dlp update] failed:", err);
      setStatus('error');
      hideToast?.("ytdlp_checking");
      hideToast?.("ytdlp_downloading");
      // Silent for a failed automatic check (offline…); shown when the user
      // asked, or when the download toast was already on screen.
      if (force || downloading) showToast?.("ytdlp_update_error", "error");
    } finally {
      unlisten?.();
      updatingRef.current = false;
      setUpdating(false);
    }
  };

  // Installed version right away + automatic check on every launch.
  // (No "run once" ref: in React StrictMode the effect runs, is cleaned up and
  // runs again — a ref guard would cancel the timer and skip the check.)
  useEffect(() => {
    refreshVersion();

    // Delay so it never competes with the first render or a quick first analyze.
    const timer = setTimeout(() => runUpdate(false), 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { updating, version, status, checkForUpdate: () => runUpdate(true) };
}
