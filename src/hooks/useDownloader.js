import { useState, useRef, useEffect } from "react";
import { downloadDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { addSearchHistory, setLastDownloadFolder } from "../utils/recent";
import { flushPendingSettings } from "./useSettings";
import { initialQuality, qualitiesOf } from "../components/modals/downloadOptions"; // Auto Download: same quality rule as the card
import {
  sanitizeTitle, isYouTubeExtractor, isYouTubeUrl, youtubeThumb, youtubeWatchUrl
} from "../utils/media";


// All yt-dlp work happens in Rust (src-tauri/src/ytdlp.rs). The webview only
// sends typed requests (URL, folder, file name, format, quality, cookies);
// Rust validates them and builds the command line itself.

// Normalizes user input into a usable URL: trims whitespace and adds a scheme
// when missing. Rust validates it again and always passes it after `--`.
const normalizeUrl = (u) => {
  const s = (u || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};

// Cookie settings sent to Rust: a cookies.txt file takes priority (it avoids
// the Windows problem of reading Chrome/Edge's encrypted cookies directly);
// otherwise cookies are read from the chosen browser.
const cookiesOf = (s) => ({
  cookieFile: s.cookieFile || null,
  cookieBrowser: s.cookieFile ? null : (s.cookieBrowser || null),
});

// Maps a yt-dlp failure (stderr + thrown message) to a specific toast key so the
// user gets an actionable message instead of a generic one. `fallback` is used
// when nothing specific matches. Order matters: the most specific checks first.
const ERROR_RULES = [
  ['youtube_bot_check', /not a bot|sign in to confirm you.{0,4}re not|confirm you.{0,4}re not a bot/],
  ['cookie_error', /dpapi|failed to decrypt|could not copy.*cookie|cookie.*database|cookies file not found|invalid cookie browser/],
  ['err_age', /confirm your age|age.restricted|inappropriate for some users/],
  ['err_private', /private video|members.only|join this channel|requires? (a )?(login|sign.?in|subscription)|premium/],
  ['err_geo', /not available in your country|geo.?restrict|blocked in your country|from your location/],
  ['err_live', /live event will begin|premieres? in|is not live|this live event|will begin in/],
  ['err_unavailable', /video unavailable|has been removed|no longer available|does not exist|http error 404|not found \(404\)|account.*terminated/],
  ['err_disk', /no space left|disk full|errno 28|permission denied|errno 13|access is denied|download folder not found|read-only file system/],
  ['err_ffmpeg', /ffmpeg|ffprobe|postprocessing|conversion failed/],
  ['err_network', /unable to download webpage|timed? ?out|getaddrinfo|name or service not known|connection (reset|refused|aborted)|network is unreachable|ssl|http error 5\d\d|http error 429|too many requests/],
  ['err_unsupported', /unsupported url|no video formats found|invalid url|\[generic\]|anti-bot challenge/],
];
const classifyYtdlpError = (text, fallback = 'error_invalid') => {
  const t = (text || '').toLowerCase();
  const hit = ERROR_RULES.find(([, re]) => re.test(t));
  return hit ? hit[0] : fallback;
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

// Tallest video height in a formats array (null when none is reported).
const maxHeightOf = (formats) => {
  if (!Array.isArray(formats)) return null;
  const max = formats.reduce((m, f) => Math.max(m, f?.height || 0), 0); // no spread: safe for huge lists
  return max || null;
};

// --- Size estimate (for the free-space check) ---
// From yt-dlp's format list: the largest video stream at each height and the
// largest audio stream, in bytes (filesize, or filesize_approx when exact
// isn't known), plus the duration. Missing numbers → that part counts as 0.
function sizeInfoOf(formats, duration) {
  const video = {};
  let audio = 0;
  for (const f of Array.isArray(formats) ? formats : []) {
    const bytes = Number(f?.filesize || f?.filesize_approx) || 0;
    if (!bytes) continue;
    const hasVideo = f.vcodec && f.vcodec !== "none";
    const hasAudio = f.acodec && f.acodec !== "none";
    if (hasVideo && f.height) video[f.height] = Math.max(video[f.height] || 0, bytes);
    else if (hasAudio && !hasVideo) audio = Math.max(audio, bytes);
  }
  return { video, audio, duration: Number(duration) || 0 };
}

// Approximate bytes one video will take with the chosen options (0 = unknown).
function estimateBytes(info, config, formatType) {
  if (!info) return 0;
  const kbps = parseInt(String(config?.audio || "160").replace("kb", ""), 10) || 160;
  const audio = info.audio || (info.duration ? info.duration * kbps * 125 : 0);
  if (formatType === "audio") return info.duration ? info.duration * kbps * 125 : info.audio;
  const target = parseInt(String(config?.res || ""), 10) || Infinity;
  const heights = Object.keys(info.video).map(Number).filter((h) => h <= target).sort((a, b) => b - a);
  const video = heights.length ? info.video[heights[0]] : 0;
  if (!video) return 0;
  return video + (formatType === "video_only" ? 0 : audio);
}

const LOW_SPACE_MARGIN = 1024 ** 3; // warn when less than 1 GB would be left
const formatGB = (bytes) => `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB`;

const QUALITY_LADDER = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];

// Queue statuses that mean "a download is running right now".
const ACTIVE_STATUSES = ["Downloading", "Processing..."];

// Builds the resolution options shown to the user.
// yt-dlp's analyze-time format detection is unreliable on YouTube (throttling /
// signature issues can return only the low-res progressive formats), which used
// to hide 720p/1080p from videos that actually support them. Since the download
// itself re-queries formats and asks for the best stream at or below the chosen
// height, it is always safe to OFFER a quality. We therefore guarantee a ceiling
// of at least 1080p and extend it upward only when detection reports more.
const buildQualities = (detectedMax) => {
  const ceiling = Math.max(Number(detectedMax) || 0, 1080);
  return QUALITY_LADDER.filter((q) => q <= ceiling);
};

// Runs yt-dlp's metadata dump in Rust and parses the JSON. Throws with stderr
// attached (err.stderr) so the caller can classify the failure.
async function analyzeRemote(url, settings, single) {
  const out = await invoke('ytdlp_analyze', {
    url,
    single,
    playlistLimit: Number(settings.playlistLimit) || 10,
    cookies: cookiesOf(settings),
  });
  const stderr = out.stderr || '';
  if (stderr.trim()) console.warn('[yt-dlp] stderr:\n' + stderr.trim());
  let data = null;
  try { data = out.stdout && out.stdout.trim() ? JSON.parse(out.stdout) : null; } catch { data = null; }
  // With --ignore-errors yt-dlp prints `null` when it cannot extract the video
  // (unavailable, region/age-locked, bot check, outdated yt-dlp).
  if (!data || typeof data !== 'object') {
    const err = new Error('yt-dlp returned no data');
    err.stderr = stderr;
    throw err;
  }
  return data;
}

// Load (and decode) an image before the card opens, so the thumbnail is
// already there when the card appears instead of popping in afterwards.
// Never blocks for long: resolves on error, and after `timeout` ms at most.
// localStorage key of the downloads left unfinished (resume after closing).
const PENDING_KEY = "fd-pending-downloads";

function preloadImage(src, timeout = 8000) {
  if (!src) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer"; // same as the <img> in the cards
    const timer = setTimeout(resolve, timeout);
    const done = () => { clearTimeout(timer); resolve(); };
    img.onload = () => (img.decode ? img.decode().catch(() => {}).then(done) : done());
    img.onerror = done;
    img.src = src;
  });
}

export default function useDownloader(settings, showToast) {
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [queue, setQueue] = useState([]);
  const [mediaData, setMediaData] = useState(null);
  const [downloadPath, setDownloadPath] = useState("");
  // Counts videos sent straight to the queue by Auto Download (no card): the
  // search bar plays its "renewed" animation on each one, as when a card closes.
  const [autoAdded, setAutoAdded] = useState(0);

  // itemId -> runId of the download running for it (one run per attempt, so a
  // retried item never inherits an old cancellation).
  const activeRuns = useRef({});
  // runId -> itemId, to route progress events.
  const runToItem = useRef({});
  // runId -> promise that settles when that yt-dlp process has exited.
  const runPromises = useRef({});
  const lastStartRef = useRef({ signature: '', at: 0 }); // duplicate-submit guard
  // Output files in use this session (folder + name, lower-case): runId → key
  // for running downloads, plus the ones already finished. Two downloads must
  // never write the same file — on Windows names that differ only in
  // upper/lower case ARE the same file, and two yt-dlp runs on it both fail
  // ("file is being used by another process").
  const runningOutputs = useRef({});
  const finishedOutputs = useRef(new Set());

  // Settings → default folder changed during the session: the card follows it.
  const prevDefaultPath = useRef(settings.defaultPath);
  useEffect(() => {
    if (prevDefaultPath.current && settings.defaultPath && settings.defaultPath !== prevDefaultPath.current) {
      setDownloadPath(settings.defaultPath);
    }
    prevDefaultPath.current = settings.defaultPath;
  }, [settings.defaultPath]);
  // Bumped whenever a run ends, so the queue processor re-checks free slots
  // even if that run's end didn't change the queue (e.g. a cancelled run).
  const [runTick, setRunTick] = useState(0);

  // --- CLOSE CONFIRMATION STATE (see section 3B) ---
  const [closePrompt, setClosePrompt] = useState(false); // confirmation dialog visible
  const [closing, setClosing] = useState(false);         // "Close anyway" in progress
  const closingRef = useRef(false);
  // Latest queue for the window/app close handlers, which are registered once.
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // --- AUTO-DETECT A LINK FROM THE CLIPBOARD ---
  // When the window gains focus, if the input is empty and the clipboard holds a
  // new http(s) link, fill it in automatically — so the user copies a link in the
  // browser, switches to Flow, and it's already there. We never overwrite text the
  // user already has, and never re-paste the same link twice.
  const urlRef = useRef("");
  const lastAutoPaste = useRef("");
  // Follows the saved setting. Nothing is pasted before the settings are
  // loaded: the startup check used to run with the default (on) before the
  // saved "off" was read, so a link was pasted even with the option disabled.
  const autoPasteRef = useRef(false);
  useEffect(() => { urlRef.current = url; }, [url]);
  useEffect(() => { autoPasteRef.current = !!settings.loaded && settings.autoPaste !== false; }, [settings.loaded, settings.autoPaste]);

  const tryAutoPasteRef = useRef(() => {});
  tryAutoPasteRef.current = async () => {
    try {
      if (!autoPasteRef.current) return;          // disabled in settings (or not loaded yet)
      if (urlRef.current) return;                 // don't disturb what the user already has
      const clip = ((await readText()) || "").trim();
      if (!autoPasteRef.current) return;          // turned off while reading the clipboard
      if (!/^https?:\/\/\S+$/i.test(clip)) return;
      if (clip === lastAutoPaste.current) return; // already offered this one
      lastAutoPaste.current = clip;
      setUrl(clip);
      showToast("clipboard_autopaste", "info");
    } catch (e) { /* clipboard not readable — ignore */ }
  };

  // Once at startup (after the settings are loaded), then on every window focus.
  const startupPasteDone = useRef(false);
  useEffect(() => {
    if (!settings.loaded || startupPasteDone.current) return;
    startupPasteDone.current = true;
    tryAutoPasteRef.current();
  }, [settings.loaded]);
  useEffect(() => {
    const onFocus = () => tryAutoPasteRef.current();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // --- PROGRESS EVENTS FROM RUST ---
  // One listener for every download; events carry the runId. Rust already
  // throttles them (~150 ms per download).
  useEffect(() => {
    let unlisten = null;
    let cancelled = false;
    listen('ytdlp://progress', ({ payload }) => {
      const itemId = runToItem.current[payload.runId];
      if (!itemId) return;
      setQueue((prev) => prev.map((item) => {
        if (item.id !== itemId || !ACTIVE_STATUSES.includes(item.status)) return item;
        if (payload.phase === 'processing') {
          return { ...item, status: "Processing...", progress: 100 };
        }
        return {
          ...item,
          progress: payload.percent != null ? Math.max(item.progress, payload.percent) : item.progress,
          speed: payload.speed || item.speed,
          eta: payload.eta || item.eta,
        };
      }));
    }).then((u) => { if (cancelled) u(); else unlisten = u; });
    return () => { cancelled = true; if (unlisten) unlisten(); };
  }, []);

  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // --- 1. FULL LINK ANALYSIS ---
  // overrideUrl: analyze this link instead of the search bar's text (right-click
  // menu: history, "download again", "paste and search"). Button clicks pass an
  // event object, which is ignored.
  async function analyzeLink(overrideUrl) {
    const override = typeof overrideUrl === 'string' ? overrideUrl : null;
    if (override) setUrl(override);
    const cleanUrl = normalizeUrl(override ?? url);
    if (!cleanUrl) return;
    setAnalyzing(true);
    try {
      // Folder for this download (the card can still change it).
      // (this session's choice → the card's remembered folder → Settings default)
      const dir = downloadPath || settings.lastDownloadPreset?.directory || settings.defaultPath || await downloadDir();
      if (!downloadPath) setDownloadPath(dir);

      // Show the result: the download card, or — with Auto Download on and a
      // saved preset, single videos only — straight to the queue with the last
      // card's options.
      const present = async (thumb, media, folder) => {
        // Playlists always open their card (to pick the videos).
        const saved = settings.lastDownloadPreset;
        const preset = settings.autoDownload && !media.isPlaylist && saved?.formatType ? saved : null;
        if (preset) {
          const config = {
            res: initialQuality(qualitiesOf(media), preset.res), // same height, or the closest lower
            ext: preset.exts?.[preset.formatType === 'audio' ? 'audio' : 'video'] || preset.ext || (preset.formatType === 'audio' ? 'mp3' : 'mp4'),
            audio: preset.audio,
          };
          startDownload(config, preset.formatType, media, { directory: folder, auto: true });
          return;
        }
        await preloadImage(thumb); // the card opens with its thumbnail ready
        setMediaData(media);
      };

      const data = await analyzeRemote(cleanUrl, settings, false);
      const playlistLimit = Number(settings.playlistLimit) || 10;
      const isPlaylist = data._type === 'playlist' && Array.isArray(data.entries);
      const isYouTube = isYouTubeExtractor(data.extractor_key) || isYouTubeUrl(cleanUrl);

      if (isPlaylist) {
        let validEntries = data.entries.filter(entry =>
          entry &&
          entry.id &&
          entry.title &&
          (entry.url || isYouTube) &&
          !entry.title.includes('[Private video]') &&
          !entry.title.includes('[Deleted video]')
        );

        if (validEntries.length > playlistLimit) {
          validEntries = validEntries.slice(0, playlistLimit);
        }

        validEntries = validEntries.map((entry, idx) => ({
          ...entry,
          uniqueId: `${entry.id}-${idx}`
        }));

        let dynamicQualities = buildQualities(0);
        let sizeInfo = null; // first video's sizes, used as the per-video estimate
        let h264MaxHeight = 0;
        let highResCodec = '';

        // Probe the first video for its real resolutions/codecs (flat playlist
        // entries carry no format list).
        const firstUrl = validEntries[0] && (validEntries[0].url || (isYouTube ? youtubeWatchUrl(validEntries[0].id) : null));
        if (firstUrl) {
          try {
            const firstData = await analyzeRemote(firstUrl, settings, true);
            sizeInfo = sizeInfoOf(firstData.formats, firstData.duration);
            dynamicQualities = buildQualities(maxHeightOf(firstData.formats) || 1080);
            ({ h264MaxHeight, highResCodec } = analyzeCodecs(firstData.formats));
          } catch (firstErr) {
            console.warn("Could not analyze the first video for quality baseline. Using defaults.", firstErr);
          }
        }

        // The cover the card shows (same choice as PlaylistModal).
        const first = validEntries[0];
        const cover = first?.thumbnails?.length > 0
          ? first.thumbnails[first.thumbnails.length - 1].url
          : (isYouTube && first?.id ? youtubeThumb(first.id, 'maxresdefault') : (data.thumbnails ? data.thumbnails[0]?.url : null));

        await present(cover, {
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
          sizeInfo,
          h264MaxHeight,
          highResCodec
        }, dir);
        addSearchHistory(cleanUrl, `[Playlist] ${data.title}`);

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

        const { h264MaxHeight, highResCodec } = analyzeCodecs(data.formats);
        await present(data.thumbnail, {
          id: data.id,
          title: data.title,
          thumbnail: data.thumbnail,
          isPlaylist: false,
          originalUrl: data.webpage_url || cleanUrl,
          uploader: data.uploader || data.channel,
          duration: data.duration,
          extractor_key: data.extractor_key,
          availableQualities: buildQualities(maxHeightOf(data.formats) || 1080),
          sizeInfo: sizeInfoOf(data.formats, data.duration),
          h264MaxHeight,
          highResCodec
        }, dir);
        addSearchHistory(cleanUrl, data.title);
      }
    } catch (err) {
      console.error(err);
      showToast(classifyYtdlpError(`${err?.stderr || ''} ${err?.message || err || ''}`), "error");
    } finally {
      setAnalyzing(false);
    }
  }

  // --- 2. INITIALIZE DOWNLOAD ITEMS ---
  // opts.directory: folder (default: the current one); opts.auto: started by
  // Auto Download (no card) — otherwise the card's options become the preset.
  // Free-space check first: refuses when the download clearly won't fit on the
  // drive, warns when less than ~1 GB would be left. Unknown sizes / errors
  // never block a download.
  async function startDownload(config, formatType, customData, opts = {}) {
    const data = customData || mediaData;
    if (!data) return false;
    const directory = opts.directory || downloadPath;
    const count = data.isPlaylist ? (data.entries?.length || 0) : 1;
    const needed = estimateBytes(data.sizeInfo, config, formatType || "video") * count;
    try {
      const free = await invoke("disk_free", { directory });
      if (needed > 0 && needed > free) {
        showToast("disk_no_space", "error", { needed: formatGB(needed), free: formatGB(free) });
        return false; // the card stays open
      }
      if (free - needed < LOW_SPACE_MARGIN) showToast("disk_low", "info", { free: formatGB(Math.max(0, free - needed)) });
    } catch { /* folder missing or check unavailable: yt-dlp reports real errors */ }
    addDownload(config, formatType, customData, opts);
    return true;
  }

  function addDownload(config, formatType, customData, opts = {}) {
    const dataToDownload = customData || mediaData;
    if (!dataToDownload) return;
    const directory = opts.directory || downloadPath;

    // Guard against accidental double submits (double-click, held Enter, ...):
    // an identical request within a short window is ignored, so the same video
    // can't land in the queue twice.
    const signature = JSON.stringify([
      dataToDownload.originalUrl, dataToDownload.title, formatType, config,
      (dataToDownload.entries || []).map((e) => e?.id + ':' + e?.title)
    ]);
    const now = Date.now();
    if (lastStartRef.current.signature === signature && now - lastStartRef.current.at < 2000) return;
    lastStartRef.current = { signature, at: now };

    const isYouTube = isYouTubeExtractor(dataToDownload.extractor_key) || isYouTubeUrl(dataToDownload.originalUrl);
    const newItems = [];

    const downloadSettings = {
      targetRes: config?.res ? String(config.res).replace('p', '') : 'best',
      targetAudio: config?.audio ? String(config.audio).replace('kb', '') : '160',
      ext: config?.ext ? String(config.ext).replace('.', '') : 'mp4',
      formatType: formatType || 'video'
    };

    const baseItem = () => ({
      id: crypto.randomUUID(),
      status: "Waiting",
      progress: 0,
      speed: "0 KB/s",
      eta: "--:--",
      totalTime: null,
      directory,
      ...downloadSettings
    });

    if (dataToDownload.isPlaylist && dataToDownload.entries) {
      dataToDownload.entries.forEach((entry, idx) => {
        if (!entry || !entry.title) return;
        const entryUrl = entry.url || (isYouTube ? youtubeWatchUrl(entry.id) : null);
        if (!entryUrl) return;
        newItems.push({
          ...baseItem(),
          title: entry.title,
          thumbnail: entry.thumbnails?.[0]?.url || (isYouTube ? youtubeThumb(entry.id) : null),
          videoId: isYouTube ? entry.id : null,
          playlistIndex: idx + 1, // ensures unique filenames within a playlist
          url: entryUrl,
        });
      });
    } else {
      newItems.push({
        ...baseItem(),
        title: dataToDownload.title,
        thumbnail: dataToDownload.thumbnail,
        videoId: isYouTube ? dataToDownload.id : null,
        playlistIndex: null,
        url: dataToDownload.originalUrl,
      });
    }

    setQueue(prev => [...prev, ...newItems]);
    setLastDownloadFolder(directory); // right-click menu: "open last download folder"
    // Remember the card's choices for Auto Download.
    if (!opts.auto) {
      settings.saveSettings?.({
        lastDownloadPreset: {
          formatType: downloadSettings.formatType, res: config?.res ?? 'best', ext: downloadSettings.ext, audio: downloadSettings.targetAudio,
          exts: { ...(settings.lastDownloadPreset?.exts || {}), [downloadSettings.formatType === 'audio' ? 'audio' : 'video']: downloadSettings.ext },
          directory,
        },
      });
    }
    setMediaData(null);
    setUrl("");

    if (opts.auto) setAutoAdded((n) => n + 1);
    showToast(opts.auto ? "auto_added" : "success_added", "success");
  }

  // --- Resume after closing ---
  // Downloads still waiting / running are remembered (localStorage), so if the
  // app is closed — or crashes — with work left, the next launch offers to
  // start them again (from scratch: partial files are deleted on close).
  const [resumable, setResumable] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
      return Array.isArray(saved) ? saved.filter((p) => p && typeof p.url === "string" && /^https?:\/\//i.test(p.url)) : [];
    } catch { return []; }
  });
  const freezePending = useRef(false); // while closing: keep the list as it was
  useEffect(() => {
    if (freezePending.current) return;
    const timer = setTimeout(() => {
      savePending(queue);
    }, 400);
    return () => clearTimeout(timer);
  }, [queue, resumable]);
  function savePending(list) {
    const pending = list
      .filter((i) => ["Waiting", "Downloading", "Processing...", "Conflict"].includes(i.status))
      .map(({ title, url, thumbnail, videoId, playlistIndex, directory, targetRes, targetAudio, ext, formatType }) =>
        ({ title, url, thumbnail, videoId, playlistIndex, directory, targetRes, targetAudio, ext, formatType }));
    // Until the user answers, what's offered is kept too.
    const keep = [...resumable, ...pending];
    try {
      if (keep.length) localStorage.setItem(PENDING_KEY, JSON.stringify(keep.slice(0, 500)));
      else localStorage.removeItem(PENDING_KEY);
    } catch { /* storage unavailable */ }
  }
  const resumeDownloads = () => {
    const items = resumable.map((p) => ({
      ...p, id: crypto.randomUUID(), status: "Waiting", progress: 0, speed: "0 KB/s", eta: "--:--", totalTime: null,
    }));
    setResumable([]);
    if (items.length) setQueue((prev) => [...prev, ...items]);
  };
  const dismissResume = () => setResumable([]);

  // --- Taskbar (Windows) / Dock (macOS) progress ---
  // Overall progress of what's running or waiting, on the app's icon, so it
  // can be followed with the window minimized. Only sent when it changes.
  const taskbarRef = useRef("");
  useEffect(() => {
    const pending = queue.filter((i) => i.status === "Downloading" || i.status === "Processing..." || i.status === "Waiting");
    const progress = pending.length
      ? Math.round(pending.reduce((sum, i) => sum + (i.status === "Processing..." ? 100 : Number(i.progress) || 0), 0) / pending.length)
      : 0;
    const key = pending.length ? `on:${progress}` : "off";
    if (key === taskbarRef.current) return;
    taskbarRef.current = key;
    import("@tauri-apps/api/window").then(({ getCurrentWindow, ProgressBarStatus }) =>
      getCurrentWindow().setProgressBar(pending.length
        ? { status: ProgressBarStatus.Normal, progress: Math.max(1, progress) } // ≥1 so it shows right away
        : { status: ProgressBarStatus.None })
    ).catch(() => {});
  }, [queue]);

  // --- 3A. QUEUE PROCESSOR ---
  useEffect(() => {
    if (closingRef.current) return; // app is closing: don't start anything new
    const maxConcurrent = settings.maxConcurrent || 5;
    const activeCount = Object.keys(activeRuns.current).length;
    if (activeCount >= maxConcurrent) return;

    const toStart = queue
      .filter((item) => item.status === "Waiting" && !activeRuns.current[item.id])
      .slice(0, maxConcurrent - activeCount);

    toStart.forEach((item) => runDownload(item));
  }, [queue, settings.maxConcurrent, runTick]);

  async function runDownload(item) {
    const itemId = item.id;
    const runId = crypto.randomUUID();
    const startTime = Date.now();

    // Reserve the slot synchronously, before anything async, to avoid double-starts.
    activeRuns.current[itemId] = runId;
    runToItem.current[runId] = itemId;

    let stem = sanitizeTitle(item.title);
    if (item.playlistIndex) stem = `${String(item.playlistIndex).padStart(2, '0')}_${stem}`;
    // Same output as another download (running or done this session)? Use
    // "name_(2)", "name_(3)"… instead.
    const outputKey = (s) => `${String(item.directory || '').replace(/\\/g, '/').replace(/\/+$/, '')}/${s}`.toLowerCase();
    const taken = new Set([...Object.values(runningOutputs.current), ...finishedOutputs.current]);
    const baseStem = stem;
    for (let n = 2; taken.has(outputKey(stem)); n++) stem = `${baseStem}_(${n})`;
    runningOutputs.current[runId] = outputKey(stem);
    const height = parseInt(item.targetRes, 10);

    // A file with this name already in the folder (e.g. downloaded on another
    // day)? Don't overwrite it silently: the card asks — Replace / Keep both /
    // Skip (resolveConflict). "Keep both" picks the next free "name_(n)".
    const ext = item.ext || 'mp4';
    const existsOnDisk = async (s) => {
      try {
        const found = await invoke('find_media_file', { directory: item.directory, names: [`${s}.${ext}`] });
        return !!found?.file;
      } catch { return false; }
    };
    if (item.conflictChoice === 'keep') {
      for (let n = 2; taken.has(outputKey(stem)) || await existsOnDisk(stem); n++) stem = `${baseStem}_(${n})`;
      runningOutputs.current[runId] = outputKey(stem);
    } else if (item.conflictChoice !== 'replace' && await existsOnDisk(stem)) {
      delete activeRuns.current[itemId];
      delete runToItem.current[runId];
      delete runningOutputs.current[runId];
      setQueue(prev => prev.map(i => i.id === itemId && i.status === "Waiting" ? { ...i, status: "Conflict", conflictName: `${stem}.${ext}` } : i));
      setRunTick((t) => t + 1);
      return;
    }

    setQueue(prev => prev.map(i =>
      i.id === itemId && i.status === "Waiting" ? { ...i, status: "Downloading" } : i
    ));

    const promise = invoke('ytdlp_download', {
      runId,
      opts: {
        url: item.url,
        directory: item.directory,
        stem,
        formatType: item.formatType,
        ext: item.ext || 'mp4',
        height: Number.isNaN(height) ? null : height,
        audioKbps: parseInt(item.targetAudio, 10) || 160,
        overwrite: item.conflictChoice === 'replace',
        cookies: cookiesOf(settings),
      },
    });
    runPromises.current[runId] = promise;

    let result = null;
    let failure = null;
    try {
      result = await promise;
    } catch (e) {
      failure = String(e?.message || e || '');
      console.error(`[yt-dlp download ${itemId}] could not run:`, e);
    } finally {
      delete runPromises.current[runId];
      delete runToItem.current[runId];
      if (result && result.code === 0 && !result.cancelled) finishedOutputs.current.add(runningOutputs.current[runId]);
      delete runningOutputs.current[runId];
      if (activeRuns.current[itemId] === runId) delete activeRuns.current[itemId];
      setRunTick((t) => t + 1);
    }

    // Cancelled (by the user or by closing the app): the UI already shows it,
    // and Rust has already deleted the partial files.
    if (result?.cancelled) return;

    const ok = result && result.code === 0;
    let errorKey = null;

    // "HTTP Error 403: Forbidden" while downloading is usually a temporary
    // refusal from the site (expired stream link): try once more by itself
    // before showing an error. The new attempt gets fresh links.
    if (!ok && !item.autoRetried && /http error 403|403: forbidden/i.test(`${result?.stderr || ''} ${failure || ''}`)) {
      setQueue(prev => prev.map(i =>
        i.id === itemId && ACTIVE_STATUSES.includes(i.status)
          ? { ...i, status: "Waiting", progress: 0, autoRetried: true }
          : i
      ));
      return;
    }

    if (!ok) {
      const text = `${result?.stderr || ''} ${failure || ''}`;
      if (text.trim()) console.warn(`[yt-dlp download ${itemId}] failed:\n${text.trim()}`);
      errorKey = classifyYtdlpError(text, 'err_download');
      if (errorKey !== 'err_download') showToast(errorKey, 'error');
    }

    setQueue(prev => prev.map(i => {
      if (i.id !== itemId || !ACTIVE_STATUSES.includes(i.status)) return i;
      return ok
        ? { ...i, status: "Done", progress: 100, totalTime: formatDuration(Date.now() - startTime), outputFile: result.outputFile }
        : { ...i, status: "Error", errorKey };
    }));
  }

  // --- 3B. CLOSING THE APP ---
  // Every way of closing goes through requestClose():
  //   - the window's close button / Alt+F4 (window "close requested" event),
  //   - app-level quit such as Cmd+Q on macOS (Rust emits "exit-requested").
  // If downloads are running or queued, a confirmation dialog is shown instead
  // (rendered by App.jsx from `closePrompt`). Otherwise the app closes at once.
  const destroyWindow = async () => {
    try { await flushPendingSettings(); } catch { /* never block closing */ }
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().destroy();
  };

  // Cancels every download and waits (up to a few seconds) until each yt-dlp
  // process has exited and its partial files are deleted.
  const cancelAllAndWait = async (timeoutMs = 8000) => {
    try { await invoke('ytdlp_cancel_all'); } catch (e) { /* ignore */ }
    const pending = Object.values(runPromises.current).map((p) => p.catch(() => {}));
    await Promise.race([
      Promise.all(pending),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  };

  const requestClose = async () => {
    if (closingRef.current) return;
    const pending = queueRef.current.filter(
      (i) => ACTIVE_STATUSES.includes(i.status) || i.status === "Waiting"
    );
    if (pending.length > 0) {
      setClosePrompt(true);
      return;
    }
    closingRef.current = true;
    await cancelAllAndWait(2000);
    await destroyWindow();
  };

  // "Close anyway": cancel everything, delete the incomplete files, then close.
  const confirmClose = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    savePending(queueRef.current); // the downloads cancelled now are offered again next time
    freezePending.current = true;
    setClosing(true);
    setQueue(prev => prev.map(i =>
      ACTIVE_STATUSES.includes(i.status) || i.status === "Waiting" ? { ...i, status: "Canceled" } : i
    ));
    try {
      await cancelAllAndWait();
    } finally {
      await destroyWindow();
    }
  };

  const cancelClose = () => setClosePrompt(false);

  // The handlers are registered once, so they call the latest requestClose via a ref.
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const unlisteners = [];
    let cancelled = false;
    const keep = (u) => { if (cancelled) u(); else unlisteners.push(u); };

    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        requestCloseRef.current();
      }).then(keep);
    }).catch((e) => console.warn("[Close] Could not register close handler:", e));

    listen('exit-requested', () => requestCloseRef.current()).then(keep)
      .catch((e) => console.warn("[Close] Could not listen for app exit:", e));

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, []);

  // --- 3C. STOP DOWNLOADS ON HOOK UNMOUNT (hot reload safety) ---
  useEffect(() => {
    return () => { invoke('ytdlp_cancel_all').catch(() => {}); };
  }, []);

  const updateItemStatus = (id, status, progress = null) => {
    setQueue(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, status, progress: progress !== null ? progress : item.progress };
      }
      return item;
    }));
  };

  // Cancels an item. A running download is killed by Rust (process tree), which
  // then deletes its partial files; a waiting item simply never starts.
  const cancelDownload = async (id) => {
    updateItemStatus(id, "Canceled");
    const runId = activeRuns.current[id];
    if (runId) {
      try { await invoke('ytdlp_cancel', { runId }); } catch (e) { /* already finished */ }
    }
  };

  const retryDownload = (id) => {
    setQueue(prev => prev.map(item =>
      item.id === id ? { ...item, status: "Waiting", progress: 0, errorKey: null, autoRetried: false } : item
    ));
  };

  // A file with the same name was already in the folder: the user's choice.
  //   replace → download again over it · keep → save as "name_(2)" · skip → leave it.
  const resolveConflict = (id, choice) => {
    setQueue(prev => prev.map(item => {
      if (item.id !== id || item.status !== "Conflict") return item;
      if (choice === 'skip') return { ...item, status: "Canceled", errorKey: 'skipped_exists' };
      return { ...item, status: "Waiting", progress: 0, conflictChoice: choice };
    }));
  };

  const removeItem = (id) => {
    if (activeRuns.current[id]) cancelDownload(id);
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  // Right-click menu on the queue.
  const clearFinished = () => {
    setQueue(prev => prev.filter(item => item.status !== "Done"));
  };
  const cancelAll = () => {
    queueRef.current
      .filter((item) => item.status === "Waiting" || ACTIVE_STATUSES.includes(item.status))
      .forEach((item) => cancelDownload(item.id));
  };

  // Items shown in the close-confirmation dialog.
  const activeDownloads = queue.filter((i) => ACTIVE_STATUSES.includes(i.status));
  const waitingCount = queue.filter((i) => i.status === "Waiting").length;

  return {
    url, setUrl,
    analyzing, analyzeLink,
    queue,
    activeDownloads, waitingCount,
    closePrompt, closing, confirmClose, cancelClose,
    mediaData, setMediaData,
    startDownload,
    downloadPath, setDownloadPath,
    cancelDownload,
    retryDownload,
    resolveConflict,
    resumable, resumeDownloads, dismissResume,
    autoAdded,
    removeItem,
    clearFinished,
    cancelAll
  };
}
