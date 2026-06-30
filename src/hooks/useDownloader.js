import { useState, useRef, useEffect } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import { downloadDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { SIGNATURE_COMMENT } from "../utils/fileSystem";

// Normalizes user input into a usable URL: trims whitespace and adds a
// scheme when missing (yt-dlp accepts scheme-less links, but we add one so
// the value can never be mistaken for an option). Injection is prevented by
// the explicit `--` separator placed before the URL in every yt-dlp call.
const normalizeUrl = (u) => {
  const s = (u || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};

// Sanitizes a title into a safe filename component.
const sanitizeTitle = (raw) => {
  const cleaned = String(raw || 'download')
    .replace(/[\\/:*?"<>|]/g, '') // illegal filename chars
    .replace(/%/g, '')            // avoid yt-dlp output-template injection
    .replace(/\s+/g, '_')         // spaces -> underscore
    .replace(/^[.\-]+/, '')       // no leading dots/dashes
    .slice(0, 150)
    .trim();
  return cleaned || 'download';
};

// Forces the bundled yt-dlp (PyInstaller build) to emit UTF-8 on stdout/stderr.
// Without this, on Windows it uses the system code page (e.g. cp1252) for titles
// with accents/emoji, producing bytes Tauri cannot decode ("invalid utf-8 sequence").
const YTDLP_ENV = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
const SIDE_OPTS = { env: YTDLP_ENV, encoding: 'utf-8' };

// Builds yt-dlp cookie arguments. A cookies.txt file takes priority because it
// bypasses the Windows DPAPI / App-Bound-Encryption problem that blocks reading
// Chrome/Edge cookies directly. Otherwise cookies are read from the chosen browser.
const cookieArgs = (s) =>
  s.cookieFile ? ['--cookies', s.cookieFile]
  : s.cookieBrowser ? ['--cookies-from-browser', s.cookieBrowser]
  : [];

// Points yt-dlp at a JavaScript runtime (bundled Deno) to solve YouTube's
// signature/n challenges. Empty path -> yt-dlp auto-detects a system runtime.
const jsRuntimeArgs = (denoPath) => denoPath ? ['--js-runtimes', `deno:${denoPath}`] : [];

// Resolves the bundled Deno path (via the Rust find_deno command), cached.
let _denoPathCache;
async function resolveDenoPath() {
  if (_denoPathCache !== undefined) return _denoPathCache;
  try { _denoPathCache = await invoke('find_deno'); }
  catch { _denoPathCache = ''; }
  return _denoPathCache;
}

// Maps a yt-dlp failure (stderr + thrown message) to a specific toast key so the
// user gets an actionable message instead of a generic "invalid link".
const classifyYtdlpError = (text) => {
  const t = (text || '').toLowerCase();
  if (/not a bot|sign in to confirm|confirm you.{0,4}re not a bot/.test(t)) return 'youtube_bot_check';
  if (/dpapi|failed to decrypt|could not copy.*cookie|cookie.*database/.test(t)) return 'cookie_error';
  return 'error_invalid';
};

// Maps a yt-dlp vcodec string to a friendly family name.
const codecFamily = (vcodec) => {
  const v = (vcodec || '').toLowerCase();
  if (v.startsWith('avc1') || v.startsWith('h264')) return 'H.264';
  if (v.startsWith('av01') || v.startsWith('av1')) return 'AV1';
  if (v.startsWith('vp9') || v.startsWith('vp09')) return 'VP9';
  if (v.startsWith('vp8') || v.startsWith('vp08')) return 'VP8';
  return v && v !== 'none' ? v.split('.')[0].toUpperCase() : '';
};

// From a yt-dlp formats array, finds the tallest H.264 height (YouTube tops out
// at 1080p for H.264) and the codec of the best overall video stream. Used to
// warn when a chosen resolution will come in an editor-unfriendly codec.
const analyzeCodecs = (formats) => {
  let h264MaxHeight = 0;
  let topCodec = '';
  if (Array.isArray(formats)) {
    let topHeight = 0;
    for (const f of formats) {
      if (!f || !f.height) continue;
      const fam = codecFamily(f.vcodec);
      if (fam === 'H.264') h264MaxHeight = Math.max(h264MaxHeight, f.height);
      if (f.height > topHeight && fam) { topHeight = f.height; topCodec = fam; }
    }
  }
  return { h264MaxHeight, highResCodec: topCodec };
};

const QUALITY_LADDER = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

// Builds the resolution options shown to the user.
// yt-dlp's analyze-time format detection is unreliable on YouTube (throttling /
// signature issues can return only the low-res progressive formats), which used
// to hide 720p/1080p from videos that actually support them. Since the download
// itself re-queries formats and uses `bestvideo[height<=X]+bestaudio/best`, it is
// always safe to OFFER a quality: yt-dlp fetches the best available at or below it.
// We therefore guarantee a ceiling of at least 1080p and extend it upward only
// when detection reliably reports a higher resolution (1440p/4K/8K).
const buildQualities = (detectedMax) => {
  const ceiling = Math.max(Number(detectedMax) || 0, 1080);
  return QUALITY_LADDER.filter((q) => q <= ceiling);
};

export default function useDownloader(settings, showToast) {
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [queue, setQueue] = useState([]);
  const [mediaData, setMediaData] = useState(null);
  const [downloadPath, setDownloadPath] = useState("");

  const activeProcesses = useRef({});
  const manuallyHandled = useRef(new Set());
  const lastUpdate = useRef({});

  // --- AUTO-DETECT A LINK FROM THE CLIPBOARD ---
  // When the window gains focus, if the input is empty and the clipboard holds a
  // new http(s) link, fill it in automatically — so the user copies a link in the
  // browser, switches to Flow, and it's already there. We never overwrite text the
  // user already has, and never re-paste the same link twice.
  const urlRef = useRef("");
  const lastAutoPaste = useRef("");
  const autoPasteRef = useRef(true);
  useEffect(() => { urlRef.current = url; }, [url]);
  useEffect(() => { autoPasteRef.current = settings.autoPaste !== false; }, [settings.autoPaste]);

  useEffect(() => {
    const tryAutoPaste = async () => {
      try {
        if (!autoPasteRef.current) return;          // disabled in settings
        if (urlRef.current) return;                 // don't disturb what the user already has
        const clip = ((await readText()) || "").trim();
        if (!/^https?:\/\/\S+$/i.test(clip)) return;
        if (clip === lastAutoPaste.current) return; // already offered this one
        lastAutoPaste.current = clip;
        setUrl(clip);
        showToast("clipboard_autopaste", "info");
      } catch (e) { /* clipboard not readable — ignore */ }
    };

    tryAutoPaste(); // also run once on startup
    window.addEventListener("focus", tryAutoPaste);
    return () => window.removeEventListener("focus", tryAutoPaste);
  }, []);

  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Removes all per-item bookkeeping for a finished/removed item.
  const cleanupItemRefs = (itemId) => {
    delete activeProcesses.current[itemId];
    delete lastUpdate.current[itemId];
    manuallyHandled.current.delete(itemId);
  };

  // --- 1. FULL LINK ANALYSIS ---
  async function analyzeLink() {
    const cleanUrl = normalizeUrl(url);
    if (!cleanUrl) return;
    setAnalyzing(true);
    let stderrText = '';
    try {
      const playlistLimit = settings.playlistLimit ? String(settings.playlistLimit) : '25';
      const denoPath = await resolveDenoPath();

      const args = [
        '--dump-single-json',
        '--flat-playlist',
        '--yes-playlist',
        '--ignore-errors',
        '--ignore-no-formats-error',
        '--no-warnings',
        '--no-colors',
        '--encoding', 'utf-8',
        ...jsRuntimeArgs(denoPath),
        ...cookieArgs(settings),
        '--playlist-items', `1-${playlistLimit}`,
        '--', cleanUrl
      ];

      const cmd = Command.sidecar('ytdlp', args, SIDE_OPTS);
      const output = await cmd.execute();
      stderrText = output.stderr || '';

      // Surface yt-dlp's real diagnostics. With --ignore-errors the actual
      // failure reason (bot check, sign-in required, nsig, unavailable, ...)
      // goes to stderr while stdout becomes `null`.
      console.log('[yt-dlp] exit code:', output.code);
      if (stderrText.trim()) {
        console.warn('[yt-dlp] stderr:\n' + stderrText.trim());
      }

      if (!output.stdout || !output.stdout.trim()) throw new Error("Empty yt-dlp output");
      const data = JSON.parse(output.stdout);

      // With --ignore-errors yt-dlp prints `null` to stdout when it cannot
      // extract the video (unavailable, region/age-locked, bot check, or an
      // outdated yt-dlp). Guard so we show a clean error instead of crashing.
      if (!data || typeof data !== 'object') {
        throw new Error("yt-dlp returned null. stderr: " + (output.stderr || '(empty)').trim());
      }

      const isPlaylist = data._type === 'playlist' && Array.isArray(data.entries);

      if (isPlaylist) {
        let validEntries = data.entries.filter(entry =>
          entry &&
          entry.id &&
          entry.title &&
          !entry.title.includes('[Private video]') &&
          !entry.title.includes('[Deleted video]')
        );

        const limit = parseInt(playlistLimit, 10);
        if (validEntries.length > limit) {
          validEntries = validEntries.slice(0, limit);
        }

        validEntries = validEntries.map((entry, idx) => ({
          ...entry,
          uniqueId: `${entry.id}-${idx}`
        }));

        let dynamicQualities = buildQualities(0);
        let h264MaxHeight = 0;
        let highResCodec = '';

        if (validEntries.length > 0) {
          try {
            const firstVideoUrl = validEntries[0].url || `https://www.youtube.com/watch?v=${validEntries[0].id}`;
            const firstVideoCmd = Command.sidecar('ytdlp', [
              '--dump-single-json',
              '--no-playlist',
              '--ignore-errors',
              '--ignore-no-formats-error',
              '--no-warnings',
              '--no-colors',
              '--encoding', 'utf-8',
              ...jsRuntimeArgs(denoPath),
              ...cookieArgs(settings),
              '--', firstVideoUrl
            ], SIDE_OPTS);

            const firstOutput = await firstVideoCmd.execute();
            const firstData = JSON.parse(firstOutput.stdout);

            let maxRes = 1080;
            if (firstData && Array.isArray(firstData.formats)) {
              const videoFormats = firstData.formats.filter(f => f.height);
              if (videoFormats.length > 0) {
                maxRes = videoFormats.reduce((m, f) => Math.max(m, f.height), 0);
              }
            }

            dynamicQualities = buildQualities(maxRes);
            const codecInfo = analyzeCodecs(firstData && firstData.formats);
            h264MaxHeight = codecInfo.h264MaxHeight;
            highResCodec = codecInfo.highResCodec;

          } catch (firstErr) {
            console.warn("Could not analyze the first video for quality baseline. Using defaults.", firstErr);
          }
        }

        setMediaData({
          id: data.id,
          title: `[Playlist] ${data.title}`,
          thumbnail: data.thumbnails ? data.thumbnails[0]?.url : (validEntries[0]?.thumbnails?.[0]?.url || null),
          isPlaylist: true,
          entries: validEntries,
          count: validEntries.length,
          originalUrl: cleanUrl,
          uploader: data.uploader || data.channel || data.extractor_key,
          extractor_key: data.extractor_key,
          availableQualities: dynamicQualities,
          h264MaxHeight,
          highResCodec
        });

      } else {
        // If the video has no real downloadable streams (live not started,
        // premiere, members-only, or still processing), tell the user clearly
        // instead of opening the modal with phantom qualities that will fail.
        const hasDownloadable = Array.isArray(data.formats) && data.formats.some(f =>
          f && (f.height || (f.vcodec && f.vcodec !== 'none') || (f.acodec && f.acodec !== 'none'))
        );
        if (!hasDownloadable) {
          showToast("no_formats", "error");
          return;
        }

        let maxRes = 1080;
        if (Array.isArray(data.formats)) {
          const videoFormats = data.formats.filter(f => f.height);
          if (videoFormats.length > 0) {
            maxRes = videoFormats.reduce((m, f) => Math.max(m, f.height), 0);
          }
        }

        const dynamicQualities = buildQualities(maxRes);
        const { h264MaxHeight, highResCodec } = analyzeCodecs(data.formats);

        setMediaData({
          id: data.id,
          title: data.title,
          thumbnail: data.thumbnail,
          isPlaylist: false,
          originalUrl: cleanUrl,
          uploader: data.uploader || data.channel,
          duration: data.duration,
          extractor_key: data.extractor_key,
          availableQualities: dynamicQualities,
          h264MaxHeight,
          highResCodec
        });
      }

      if (!downloadPath) {
        setDownloadPath(settings.defaultPath || await downloadDir());
      }
    } catch (err) {
      console.error(err);
      showToast(classifyYtdlpError(`${stderrText} ${err?.message || ''}`), "error");
    } finally {
      setAnalyzing(false);
    }
  }

  // --- 2. INITIALIZE DOWNLOAD ITEMS ---
  function startDownload(config, formatType, customData) {
    const dataToDownload = customData || mediaData;
    if (!dataToDownload) return;

    const newItems = [];

    const safeRes = config?.res ? config.res.replace('p', '') : 'best';
    const safeAudio = config?.audio ? config.audio.replace('kb', '') : '160';
    const safeExt = config?.ext ? config.ext.replace('.', '') : 'mp4';

    const downloadSettings = {
      targetRes: safeRes,
      targetAudio: safeAudio,
      ext: safeExt,
      formatType: formatType || 'video'
    };

    if (dataToDownload.isPlaylist && dataToDownload.entries) {
      dataToDownload.entries.forEach((entry, idx) => {
        if (!entry || !entry.title) return;

        const thumbUrl = entry.thumbnails?.[0]?.url || (entry.id ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` : null);

        newItems.push({
          id: crypto.randomUUID(),
          title: entry.title,
          thumbnail: thumbUrl,
          status: "Waiting",
          progress: 0,
          speed: "0 KB/s",
          eta: "--:--",
          totalTime: null,
          playlistIndex: idx + 1, // ensures unique filenames within a playlist
          url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
          directory: downloadPath,
          ...downloadSettings
        });
      });
    } else {
      newItems.push({
        id: crypto.randomUUID(),
        title: dataToDownload.title,
        thumbnail: dataToDownload.thumbnail,
        status: "Waiting",
        progress: 0,
        speed: "0 KB/s",
        eta: "--:--",
        totalTime: null,
        playlistIndex: null,
        url: dataToDownload.originalUrl,
        directory: downloadPath,
        ...downloadSettings
      });
    }

    setQueue(prev => [...prev, ...newItems]);
    setMediaData(null);
    setUrl("");

    showToast("success_added", "success");
  }

  // --- 3A. QUEUE PROCESSOR ---
  useEffect(() => {
    const processQueue = () => {
      const MAX_CONCURRENT_DOWNLOADS = settings.maxConcurrent || 3;
      const activeCount = Object.keys(activeProcesses.current).length;

      if (activeCount >= MAX_CONCURRENT_DOWNLOADS) return;

      const waitingItems = queue.filter(item =>
        item.status === "Waiting" && !activeProcesses.current[item.id]
      );

      if (waitingItems.length === 0) return;

      const slotsAvailable = MAX_CONCURRENT_DOWNLOADS - activeCount;
      const itemsToStart = waitingItems.slice(0, slotsAvailable);

      itemsToStart.forEach(async (nextItem) => {
        const itemId = nextItem.id;
        const startTime = Date.now();

        // Reserve the slot synchronously, before any await, to avoid double-starts.
        activeProcesses.current[itemId] = "starting";
        lastUpdate.current[itemId] = 0;
        manuallyHandled.current.delete(itemId);

        try {
          let safeTitle = sanitizeTitle(nextItem.title);
          if (nextItem.playlistIndex) {
            safeTitle = `${String(nextItem.playlistIndex).padStart(2, '0')}_${safeTitle}`;
          }

          const finalExt = nextItem.ext || 'mp4';

          let resFilter = '';
          if (nextItem.targetRes && nextItem.targetRes !== 'best' && nextItem.targetRes !== 'Original') {
            resFilter = `[height<=${nextItem.targetRes}]`;
          }

          let formatString;
          let additionalArgs = [];
          let actualExt = finalExt;

          if (nextItem.formatType === 'audio') {
            formatString = 'bestaudio/best';
            const safeAudioExt = finalExt === 'mp4' ? 'm4a' : finalExt;
            actualExt = safeAudioExt;
            additionalArgs = [
              '--extract-audio',
              '--audio-format', safeAudioExt,
              '--audio-quality', `${nextItem.targetAudio}K`
            ];
          } else {
            // Native download only — NO re-encoding. <=1080p has H.264 (avc1);
            // above that YouTube only serves VP9/AV1. We just remux into the
            // chosen container. The modal warns the user when the resulting
            // codec won't open in video editors.
            const resNum = parseInt(nextItem.targetRes, 10);
            const above1080 = !isNaN(resNum) && resNum > 1080;
            // Prefer the native H.264 (avc1) mp4 stream when it exists (<=1080p).
            const avcPref = (finalExt === 'mp4' && !above1080) ? '[vcodec^=avc1]' : '';

            if (finalExt === 'mp4') {
              formatString = `bestvideo${resFilter}${avcPref}[ext=mp4]+bestaudio[ext=m4a]/bestvideo${resFilter}+bestaudio/best${resFilter}/best`;
            } else if (finalExt === 'webm') {
              formatString = `bestvideo${resFilter}[ext=webm]+bestaudio[ext=webm]/bestvideo${resFilter}+bestaudio/best${resFilter}/best`;
            } else {
              formatString = `bestvideo${resFilter}+bestaudio/best${resFilter}/best`;
            }

            additionalArgs = ['--merge-output-format', finalExt];
          }

          // FFmpeg location resolved by the Rust side (works in dev and prod,
          // Windows and macOS). Empty string -> let yt-dlp auto-detect / use system.
          let ffmpegLocation = "";
          try {
            ffmpegLocation = await invoke('find_ffmpeg');
          } catch (err) {
            console.warn("[FFmpeg] find_ffmpeg command failed; relying on system FFmpeg.", err);
          }

          const denoPath = await resolveDenoPath();

          const finalArgs = [
            '--format', formatString,
            '--output', `${nextItem.directory}/${safeTitle}.%(ext)s`,
            '--no-warnings',
            '--no-colors',
            '--encoding', 'utf-8',
            // With cookies YouTube serves fragmented (SABR/DASH) streams; pulling
            // several fragments in parallel restores fast download speeds.
            '--concurrent-fragments', '5',
            // Digital signature: embeds "Downloaded with Flow Downloader - <repo>"
            // into the file's metadata comment field (visible in file properties / VLC).
            '--embed-metadata',
            '--postprocessor-args', `Metadata:-metadata comment="${SIGNATURE_COMMENT}"`,
            ...jsRuntimeArgs(denoPath),
            ...cookieArgs(settings),
          ];

          if (ffmpegLocation) {
            finalArgs.push('--ffmpeg-location', ffmpegLocation);
          }

          finalArgs.push(...additionalArgs, '--', nextItem.url);

          const predictedFile = `${safeTitle}.${actualExt}`;

          setQueue(prev => prev.map(i =>
            i.id === itemId ? { ...i, status: "Downloading", outputFile: predictedFile } : i
          ));

          const cmd = Command.sidecar('ytdlp', finalArgs, SIDE_OPTS);
          let stderrBuf = '';

          cmd.on('close', (data) => {
            if (manuallyHandled.current.has(itemId)) {
              cleanupItemRefs(itemId);
              return;
            }

            cleanupItemRefs(itemId);

            if (data.code !== 0 && stderrBuf.trim()) {
              console.warn(`[yt-dlp download ${itemId}] exit ${data.code}. stderr:\n` + stderrBuf.trim());
              const key = classifyYtdlpError(stderrBuf);
              if (key !== 'error_invalid') showToast(key, 'error');
            }

            setQueue(prev => {
              const item = prev.find(i => i.id === itemId);
              if (!item) return prev;

              if (data.code === 0) {
                const timeTaken = formatDuration(Date.now() - startTime);
                return prev.map(i => i.id === itemId
                  ? { ...i, status: "Done", progress: 100, totalTime: timeTaken }
                  : i);
              }

              return prev.map(i => i.id === itemId ? { ...i, status: "Error" } : i);
            });
          });

          cmd.on('error', (err) => {
            if (manuallyHandled.current.has(itemId)) return;
            console.warn(`Non-fatal warning on process ${itemId}:`, err);
          });

          // Capture stderr so a failed download can report its real reason.
          cmd.stderr.on('data', (line) => {
            stderrBuf += line.toString();
            if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
          });

          cmd.stdout.on('data', (line) => {
            if (manuallyHandled.current.has(itemId)) return;
            const text = line.toString();

            if (text.includes('[VideoConvertor]') || text.includes('[Merger]') || text.includes('[ExtractAudio]')) {
              updateItemStatus(itemId, "Processing...", 100);
              return;
            }

            if (text.includes('[download]')) {
              const now = Date.now();
              if (now - (lastUpdate.current[itemId] || 0) < 150) return;
              lastUpdate.current[itemId] = now;

              const progressMatch = text.match(/(\d+\.?\d*)%/);
              const speedMatch = text.match(/at\s+([^\s]+)/);
              const etaMatch = text.match(/ETA\s+([^\s]+)/);

              const parsedProgress = progressMatch ? parseFloat(progressMatch[1]) : null;

              setQueue(prev => prev.map(item => {
                if (item.id === itemId) {
                  const newProgress = parsedProgress !== null ? Math.max(item.progress, parsedProgress) : item.progress;
                  return {
                    ...item,
                    progress: newProgress,
                    speed: speedMatch ? speedMatch[1] : item.speed,
                    eta: etaMatch ? etaMatch[1] : item.eta
                  };
                }
                return item;
              }));
            }
          });

          const child = await cmd.spawn();
          activeProcesses.current[itemId] = child;

        } catch (error) {
          console.error(`[CRITICAL] Failed to spawn process ${itemId}:`, error);
          cleanupItemRefs(itemId);
          updateItemStatus(itemId, "Error");
        }
      });
    };

    processQueue();
  }, [queue, settings.maxConcurrent]);

  // --- 3B. KILL CHILD PROCESSES ON WINDOW CLOSE ---
  useEffect(() => {
    let unlisten;
    let cancelled = false;

    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      win.onCloseRequested(async (event) => {
        event.preventDefault();
        await killAllProcesses();
        await win.destroy();
      }).then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
    }).catch((e) => console.warn("[Cleanup] Could not register close handler:", e));

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // --- 3C. KILL CHILD PROCESSES ON HOOK UNMOUNT (hot reload safety) ---
  useEffect(() => {
    return () => { killAllProcesses(); };
  }, []);

  // Kills a yt-dlp child AND its descendants (e.g. the ffmpeg it spawned for
  // re-encoding). child.kill() alone leaves ffmpeg orphaned at high CPU on
  // Windows, so we also ask the Rust side to kill the whole process tree.
  const killChildTree = async (child) => {
    if (!child || child === "starting") return;
    const pid = child.pid;
    try { await child.kill(); } catch (e) { /* already gone */ }
    if (pid != null) {
      try { await invoke('kill_process_tree', { pid }); } catch (e) { /* ignore */ }
    }
  };

  const killAllProcesses = async () => {
    const procs = activeProcesses.current;
    await Promise.all(Object.keys(procs).map((id) => killChildTree(procs[id])));
  };

  const updateItemStatus = (id, status, progress = null) => {
    setQueue(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, status, progress: progress !== null ? progress : item.progress };
      }
      return item;
    }));
  };

  const cancelDownload = async (id) => {
    const child = activeProcesses.current[id];
    // Mark as manually handled and KEEP the flag set, so the eventual
    // 'close' event ignores this item instead of marking it as an error.
    manuallyHandled.current.add(id);
    await killChildTree(child);
    delete activeProcesses.current[id];
    delete lastUpdate.current[id];
    updateItemStatus(id, "Canceled");
  };

  const retryDownload = (id) => {
    setQueue(prev => prev.map(item =>
      item.id === id ? { ...item, status: "Waiting", progress: 0 } : item
    ));
  };

  const removeItem = (id) => {
    if (activeProcesses.current[id]) cancelDownload(id);
    cleanupItemRefs(id);
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  return {
    url, setUrl,
    analyzing, analyzeLink,
    queue,
    mediaData, setMediaData,
    startDownload,
    downloadPath, setDownloadPath,
    cancelDownload,
    retryDownload,
    removeItem
  };
}
