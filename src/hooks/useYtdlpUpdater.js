import { useState, useEffect, useRef } from "react";
import { Command } from "@tauri-apps/plugin-shell";

// Forces UTF-8 output from the bundled yt-dlp (see useDownloader.js).
const SIDE_OPTS = { env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, encoding: 'utf-8' };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'ytdlp_last_update_check';

/**
 * Keeps the bundled yt-dlp up to date.
 * - Runs an automatic, throttled check (max once per day) shortly after startup.
 * - Exposes checkForUpdate() for a manual button in Settings (ignores the throttle).
 *
 * yt-dlp self-updates the running binary in place. In a normal install or in
 * `tauri dev` the binary is writable; if it isn't (e.g. installed under a
 * protected folder), the update simply fails silently on the automatic run.
 */
export default function useYtdlpUpdater(showToast) {
  const [updating, setUpdating] = useState(false);
  const startedRef = useRef(false);

  const runUpdate = async (force) => {
    if (updating) return;
    setUpdating(true);
    if (force) showToast?.("ytdlp_checking", "info");

    try {
      // --update-to stable pins the official stable channel.
      const cmd = Command.sidecar('ytdlp', ['--update-to', 'stable'], SIDE_OPTS);
      const out = await cmd.execute();
      const text = `${out.stdout || ''}\n${out.stderr || ''}`;

      try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch (e) { /* ignore */ }

      const updated = /updated yt-dlp to|updating to|installing yt-dlp/i.test(text);
      const upToDate = /up.?to.?date|is the latest version/i.test(text);
      const errored = /ERROR|unable to (write|rename|download)|permission denied/i.test(text);

      if (updated && !errored) {
        showToast?.("ytdlp_updated", "success");
      } else if (force) {
        if (errored) showToast?.("ytdlp_update_error", "error");
        else if (upToDate) showToast?.("ytdlp_uptodate", "success"); // green toast
        else showToast?.("ytdlp_update_error", "error");
      }
    } catch (err) {
      console.warn("[yt-dlp update] failed:", err);
      if (force) showToast?.("ytdlp_update_error", "error");
    } finally {
      setUpdating(false);
    }
  };

  // Automatic throttled check on startup.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let last = 0;
    try { last = parseInt(localStorage.getItem(LAST_CHECK_KEY) || '0', 10) || 0; } catch (e) { /* ignore */ }

    if (Date.now() - last < ONE_DAY_MS) return;

    // Delay so it never competes with the first render or a quick first analyze.
    const timer = setTimeout(() => runUpdate(false), 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { updating, checkForUpdate: () => runUpdate(true) };
}
