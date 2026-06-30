# Technical Analysis — Flow Downloader

Full code review (React frontend + Tauri/Rust backend + configuration).
Items ordered by severity. Each one indicates the **file**, **location** and **suggested fix**.

---

## 🔴 CRITICAL — break functionality or re-encode everything

### 1. FPS overrides the GPU codec (the worst quality/stability bug)
**`src/hooks/useDownloader.js` lines 312–325**

You build the codec args like this:
```js
additionalArgs = ['-S','res','--merge-output-format','mkv','--recode-video','mp4',
  '--postprocessor-args', gpuCodecArgs];   // VideoConvertor:-c:v h264_nvenc ...
...
if (nextItem.targetFps !== 'Original' ...) {
  additionalArgs.push('--postprocessor-args', `VideoConvertor:-r ${nextItem.targetFps}`);
}
```
In yt-dlp, **two `--postprocessor-args` for the same postprocessor (`VideoConvertor:`) do not add up — the second one replaces the first.** That means: whenever the user picks an FPS other than "Original", all the codec args (h264_nvenc/amf/qsv, preset, crf) are **discarded** and the conversion falls back to the ffmpeg default. Result: slow, no GPU, unpredictable behavior.

**Fix:** concatenate everything into a single `VideoConvertor:...` string:
```js
let vcArgs = '-c:v h264_nvenc -preset p1 -cq 23 -pix_fmt yuv420p -c:a aac';
if (fps !== 'Original') vcArgs += ` -r ${fps}`;
additionalArgs.push('--postprocessor-args', `VideoConvertor:${vcArgs}`);
```

### 2. Every MP4 is re-encoded from scratch (wastes CPU/time and loses quality)
**`src/hooks/useDownloader.js` lines 295–317**

For `.mp4` video you force `--recode-video mp4` with `libx264`/nvenc on **every** download. The vast majority of YouTube videos are already H.264/VP9 and only need a *remux* (stream copy), not a re-encode. Re-encoding:
- Multiplies the download time by 3–10×;
- **Degrades quality** (lossy transcoding);
- Is the most likely cause of the app feeling "slow/unstable".

**Fix:** by default, only remux (`--merge-output-format mp4` and let yt-dlp choose compatible streams, or `--remux-video mp4`). Only re-encode when truly necessary (e.g.: the user forced an FPS, or the codecs are not MP4-compatible). `recode` should be the exception, not the rule.

### 3. WebGL-based GPU detection is fragile and has no execution fallback
**`src/hooks/useDownloader.js` lines 6–26 and 299**

`WEBGL_debug_renderer_info`/`UNMASKED_RENDERER_WEBGL` is **deprecated and blocked** in many contexts (returns empty → falls back to `cpu`, or wrong vendor). Worse: if it detects `nvidia` but the bundled ffmpeg doesn't have `nvenc`, or the driver doesn't support it, **ffmpeg fails and the whole download errors out** — with no fallback to CPU.

**Fix:** don't trust the GPU name. Try the hardware encoder and, if ffmpeg fails, automatically retry with `libx264`. Ideally probe once at startup (`ffmpeg -encoders`) and cache the result, instead of creating a `<canvas>` for each item.

### 4. Pause/Resume is dead code (passes nonexistent functions)
**`src/App.jsx` lines 251–252** + **`src/hooks/useDownloader.js`**

```jsx
onPauseItem={downloader.pauseDownload}    // undefined
onResumeItem={downloader.resumeDownload}  // undefined
```
`useDownloader` never defines or returns `pauseDownload`/`resumeDownload`, and `QueueList` doesn't even destructure them. They are `undefined` props. Either implement real pause, or remove these props to avoid confusion.

### 5. Filename collision (silently overwrites downloads)
**`src/hooks/useDownloader.js` line 275** (`--output` on 343)

`safeTitle` comes only from the title. Two videos with the same title (common in playlists, "Episode 1", livestreams, etc.) produce the **same file** and one overwrites the other. The `uniqueId` exists in the analysis but isn't used in the final name.

**Fix:** include the playlist index and/or the id in the template: `%(playlist_index)s-%(title).80s [%(id)s].%(ext)s`, letting yt-dlp sanitize (`--restrict-filenames`), instead of building the name by hand.

---

## 🟠 SECURITY

### 6. Sidecar with `args: true` — arbitrary execution via yt-dlp
**`src-tauri/capabilities/default.json`** (`shell:allow-execute` and `shell:allow-spawn` blocks)

`"args": true` allows the frontend to pass **any** argument to yt-dlp. yt-dlp accepts dangerous flags (`--exec`, `--external-downloader`, `--load-info-json`, etc.) that are equivalent to **arbitrary command execution**. If any untrusted input (URL, remote title, config value) makes it into the args list, it becomes an RCE vector.

**Fix:** restrict to an args pattern with a `validator` (regex) instead of `args: true`, or at minimum ensure that no value derived from remote content can turn into a flag (see items 7 and 8).

### 7. Unvalidated URL → option injection
**`src/hooks/useDownloader.js`** (`analyzeLink` 48, args 54–62 and `finalArgs` 354)

The URL is pasted by the user and goes in as a positional argument. A "URL" starting with `-` (e.g.: `--config-location ...`) is interpreted by yt-dlp as a **flag**, not as a URL.

**Fix:** validate the scheme (`^https?://`) before analyzing and insert `--` immediately before the URL in the args, to force yt-dlp to treat it as positional:
```js
finalArgs.push('--', nextItem.url);
```

### 8. Injection into the output template via the title
**`src/hooks/useDownloader.js` line 275**

`safeTitle` removes `\ / : * ? " < > |` and spaces, but **does not remove `%`**. A video whose title contains `%(...)s` corrupts the `--output` template. Dots (`.`) are also not handled (partly mitigated because `/` and `\` are removed).

**Fix:** prefer letting yt-dlp sanitize (`--restrict-filenames`). If you keep the manual sanitization, escape `%` (`%`→`%%`) and remove leading `.`.

### 9. Broad CSP
**`src-tauri/tauri.conf.json`** → `security.csp`

`connect-src 'self' https:` and `img-src ... https:` allow **any** HTTPS host into the webview. Acceptable for a downloader, but it's worth restricting `connect-src` to the minimum (ideally just `ipc:`), since the actual download is done by the sidecar, not the webview.

---

## 🟡 STABILITY / LIFECYCLE

### 10. Orphaned processes when closing the app
**`src-tauri/src/lib.rs` lines 25–29**

`std::process::exit(0)` on `CloseRequested` terminates the process immediately, **skipping the React cleanup** (effect 3B in `useDownloader`). The child `ytdlp`/`ffmpeg` processes can be left **orphaned** running in the background (especially on Windows).

**Fix:** before exiting, kill the active children (keep a registry on the Rust side, or emit an event for the frontend to kill everything and only then `app.exit(0)`). Avoid calling `process::exit` directly.

### 11. Background image blob leak
**`src/App.jsx` lines 68–89**

The effect cleanup uses `bgImageBlobUrl` captured by closure, but the dependency is `[settings.visuals?.bgImage]`. The `URL.revokeObjectURL` runs with a **stale** value (often `null`), so old URLs are not revoked → memory leak when switching images several times.

**Fix:** create the URL and return the cleanup that revokes **that same** local URL:
```js
useEffect(() => {
  let url;
  (async () => { ...; url = URL.createObjectURL(blob); setBgImageBlobUrl(url); })();
  return () => { if (url) URL.revokeObjectURL(url); };
}, [settings.visuals?.bgImage]);
```

### 12. False "Completed"
**`src/hooks/useDownloader.js` line 371**

`if (data.code === 0 || item.progress >= 99)` marks it as **Completed**. Since you use `--ignore-errors`, yt-dlp can exit with code 0 even with partial failures; and an item that reached 99% and failed at the merge is marked as a success. Check the real exit code (without `--ignore-errors` on individual downloads) and/or confirm the final file exists.

### 13. `processQueue` fires on every progress tick
**`src/hooks/useDownloader.js` line 247/435** (`useEffect([queue])`)

Since every progress update calls `setQueue`, the `[queue]` effect re-runs **dozens of times per second** during downloads, re-filtering the entire queue. It works because of the `activeCount` guard, but it's wasteful and opens room for race conditions.

**Fix:** separate the queue "trigger" from the progress state (e.g.: keep progress in a separate `ref`/state, or fire `processQueue` only when the *number* of waiting items changes).

### 14. Refs never cleaned up for removed items
**`src/hooks/useDownloader.js`** (`activeProcesses`, `lastUpdate`, `manuallyHandled`)

Entries in `lastUpdate.current` and `manuallyHandled.current` are not deleted when an item leaves the queue → slow memory growth in long sessions with many downloads.

---

## 🟢 OPTIMIZATION / CODE QUALITY

### 15. Extra yt-dlp call per playlist
**`src/hooks/useDownloader.js` lines 96–118** — to discover the qualities you make a second `--dump-single-json` of the first video. This doubles the analysis latency and can fail. You could infer it from the entries or defer it to download time.

### 16. `Math.max(...array)` can blow the stack
**lines 111 and 148** — spreading large format arrays. Use `array.reduce((m,f)=>Math.max(m,f.height),0)`.

### 17. `setQueue` re-renders the whole list every 150ms × 3 downloads
**lines 406–419** — each tick maps the entire array. For large queues, consider per-item state or `React.memo` on `QueueItem` with comparison by id/progress.

### 18. `playlistLimit` with inconsistent default
`useSettings` starts at **10** (`useSettings.js:38`), but `analyzeLink` uses a fallback of **'25'** (`useDownloader.js:52`). Align the two.

### 19. `MAX_CONCURRENT_DOWNLOADS = 3` hardcoded
**line 249** — not configurable. Move it to the settings.

### 20. Settings written on every adjustment, with no debounce or indentation
**`src/hooks/useSettings.js:109`** — dragging a color slider writes the file on every change. Add a debounce and `JSON.stringify(obj, null, 2)`.

### 21. `get_exec_dir` is dead code
**`src-tauri/src/lib.rs:3–12`** — command registered but never invoked by the frontend. Remove it.

### 22. `openMediaLocation` rebuilds the name and gets the extension wrong
**`src/utils/fileSystem.js:32–63`** — after recode/merge the real extension may differ from the requested one (mkv→mp4, m4a audio, etc.), so `exists(fullPath)` almost always fails and it just opens the folder. Better to capture the real path with `--print after_move:filepath` in yt-dlp and store it on the item.

### 23. FS scope vs. custom download folder
**`src-tauri/capabilities/default.json`** — `fs:allow-exists`/`allow-read-file` only allow `$DOWNLOAD/$VIDEO/$AUDIO/$DESKTOP/$DOCUMENT`. The user can pick **any** folder in the dialog (`useSettings.js:120`). The download itself works (it's the sidecar), but the `exists()` check and the "open folder" action **fail** if the folder is outside that scope. Align the scope with the folder actually chosen.

---

## 🧹 REPOSITORY / BUILD HYGIENE

### 24. Junk file `src-tauri/2` committed
Contains `npm` output (`"up to date, audited 105 packages..."`) — generated by an accidental redirect (`... 2> 2` or similar) and committed. **Delete it.**

### 25. Huge binaries committed to git
`src-tauri/ffmpeg.exe` (99 MB), `ffmpeg-*-apple-darwin` (51–80 MB), `ytdlp-*` (18–36 MB) are in the **root** of `src-tauri/`. The `.gitignore` only ignores `src-tauri/binaries/*`, so these files **are in the git history**, inflating the repository by hundreds of MB. Move them to `binaries/` (already ignored) and download them via script/CI, or use git-lfs.

### 26. `bundle.resources` only includes `ffmpeg.exe` → macOS with no bundled ffmpeg
**`src-tauri/tauri.conf.json`** — only `ffmpeg.exe` is in `resources`. On macOS, `resolveResource('ffmpeg')` (`useDownloader.js:334`) **fails** and the app silently falls back to the system ffmpeg (which may not exist). The `ffmpeg-*-apple-darwin` binaries exist in the folder but are not referenced. Configure per-platform resources (or use `externalBin` for ffmpeg too, with a target-triple suffix, as is already done for `ytdlp`).

---

## Summary of what to prioritize
1. **Stop re-encoding every MP4** (#2) and **fix the FPS override** (#1) — biggest gain in speed/stability/quality.
2. **Close the sidecar security hole** (#6/#7/#8).
3. **Kill child processes on exit** (#10) and **fix the name collision** (#5).
4. ffmpeg packaging on macOS (#26) and repo cleanup (#24/#25).
