import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'ytdlp_last_update_check';

/**
 * Keeps yt-dlp (the download engine) up to date.
 * - Runs an automatic, throttled check (max once per day) shortly after startup.
 * - Exposes checkForUpdate() for the button in Settings (ignores the throttle).
 * - Exposes the installed `version` and the last check's `status`
 *   ('idle' | 'uptodate' | 'updated' | 'error'), so Settings can show the result
 *   right on the button, not only in a toast.
 *
 * The update runs in Rust (`ytdlp_update`) on a writable copy of yt-dlp kept in
 * the app's local data folder, so it also works when the app itself is
 * installed in a protected folder (Program Files, /Applications).
 */
export default function useYtdlpUpdater(showToast) {
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

    try {
      const { output = '', code, version: newVersion } = await invoke('ytdlp_update');
      if (newVersion) setVersion(newVersion);

      try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch (e) { /* ignore */ }

      const updated = /updated yt-dlp to|updating to|installing yt-dlp/i.test(output);
      const upToDate = /up.?to.?date|is the latest version/i.test(output);
      const errored = code !== 0 || /ERROR|unable to (write|rename|download)|permission denied/i.test(output);

      if (updated && !errored) {
        setStatus('updated');
        showToast?.("ytdlp_updated", "success");
      } else if (upToDate && !errored) {
        setStatus('uptodate');
        if (force) showToast?.("ytdlp_uptodate", "success");
      } else {
        console.warn("[yt-dlp update] output:\n" + output.trim());
        setStatus('error');
        if (force) showToast?.("ytdlp_update_error", "error");
      }
    } catch (err) {
      console.warn("[yt-dlp update] failed:", err);
      setStatus('error');
      if (force) showToast?.("ytdlp_update_error", "error");
    } finally {
      updatingRef.current = false;
      setUpdating(false);
    }
  };

  // Installed version right away + automatic throttled check on startup.
  // (No "run once" ref: in React StrictMode the effect runs, is cleaned up and
  // runs again — a ref guard would cancel the timer and skip the check.)
  useEffect(() => {
    refreshVersion();

    let last = 0;
    try { last = parseInt(localStorage.getItem(LAST_CHECK_KEY) || '0', 10) || 0; } catch (e) { /* ignore */ }

    if (Date.now() - last < ONE_DAY_MS) return;

    // Delay so it never competes with the first render or a quick first analyze.
    const timer = setTimeout(() => runUpdate(false), 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { updating, version, status, checkForUpdate: () => runUpdate(true) };
}
