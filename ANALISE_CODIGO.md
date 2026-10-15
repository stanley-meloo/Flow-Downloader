# Technical Analysis — Flow Downloader 1.2.0

Code review of version **1.2.0** (React 19 + Vite 7 frontend, Tauri v2 / Rust
backend, sidecars yt-dlp + ffmpeg + deno). Updated October 2026.

Part 1 revisits every item of the previous analysis (pre-1.2.0). Part 2 lists
what is still open or new, ordered by severity. Part 3 summarizes the current
architecture for whoever reads the code next.

Legend: ✅ fixed · 🟡 partially fixed / accepted · 🔴 still open

---

## Part 1 — Status of the previous analysis

| # | Previous issue | Status in 1.2.0 |
|---|----------------|-----------------|
| 1 | FPS argument overrode the GPU codec arguments | ✅ Gone: the whole re-encode path (GPU detection, `VideoConvertor` args, FPS option) was removed. |
| 2 | Every MP4 was re-encoded | ✅ Downloads use native streams: `--merge-output-format` (or `--remux-video` for "video only"), stream copy, no transcoding. H.264 is preferred up to 1080p; above that a warning explains that VP9/AV1 may not open in video editors. |
| 3 | Fragile WebGL GPU detection, no fallback | ✅ Removed together with re-encoding. |
| 4 | Pause/resume props pointing to undefined functions | ✅ Removed. |
| 5 | Same title → files overwrite each other | ✅ Playlist items get an index prefix (`01_Title`), and Rust picks a free name (`Title_(2)`, `Title_(3)`…) when the file already exists or another running download is writing it. |
| 6 | Sidecar `args: true` → arbitrary yt-dlp flags | ✅ The webview has **no** shell execute/spawn permission. yt-dlp runs only through typed Rust commands with a fixed argument list (`src-tauri/src/ytdlp.rs`). |
| 7 | URL could be read as an option | ✅ Rust validates `http(s)://`, length and characters, and always puts the URL after `--`. |
| 8 | `%` in titles broke the output template | ✅ `sanitizeTitle` removes `%`, illegal and control characters and leading dots/dashes; Rust re-validates the stem and escapes `%` in the folder. |
| 9 | Broad CSP | ✅ `connect-src` is IPC only — every network request happens in Rust. `img-src https:` stays (remote thumbnails). |
| 10 | Orphaned yt-dlp/ffmpeg on exit | ✅ Process registry in Rust, `kill_tree` (taskkill /T on Windows, `pgrep -P` tree on macOS), close confirmation while downloading, `RunEvent::Exit` safety net, partial files deleted. |
| 11 | Background image blob URL leak | ✅ Each effect run revokes its own URL. |
| 12 | False "Completed" (99 % or `--ignore-errors`) | ✅ Success = exit code 0 only; downloads don't use `--ignore-errors`; the real output path comes back from Rust. |
| 13 | Queue processor re-runs on every progress tick | 🟡 Still a `useEffect([queue])`, but cheap: progress events are throttled in Rust (text once per second, bar every 250 ms) and the slot reservation is synchronous, so no double starts. |
| 14 | Refs never cleaned for removed items | ✅ `activeRuns` / `runToItem` / `runPromises` are cleared in `finally`. |
| 15 | Extra yt-dlp call per playlist (quality probe) | 🟡 Kept on purpose: the flat playlist listing has no formats, and the probe gives real qualities. It only runs once per playlist. |
| 16 | `Math.max(...array)` on large lists | ✅ Replaced by `reduce`. |
| 17 | Whole list re-rendered on each tick | ✅ `QueueItem` is memoized with a field-by-field comparison. |
| 18 | Inconsistent `playlistLimit` default | ✅ 25 everywhere. |
| 19 | Hard-coded 3 concurrent downloads | ✅ Setting (1–5). |
| 20 | Settings written on every slider move | ✅ State updates instantly, disk write is debounced and indented. |
| 21 | Dead `get_exec_dir` command | ✅ Removed; every registered command is used by the frontend. |
| 22 | "Open folder" guessed the wrong extension | ✅ Rust reports the real output file; it is stored on the queue item. |
| 23 | FS scope narrower than the chosen folder | ✅ Finding and opening downloaded files happens in Rust (`find_media_file`, `open_media_path`), so any folder works (other drives, network shares). The webview's `exists` permission was reduced to the app's own folders. |
| 24 | Junk file `src-tauri/2` | ✅ Deleted. |
| 25 | Large binaries committed to git | 🔴 Still tracked in `src-tauri/` (ytdlp/ffmpeg/deno for 3 targets) — see 2.1. |
| 26 | No ffmpeg on macOS | ✅ ffmpeg, yt-dlp and deno are all `externalBin` sidecars per target triple; CI marks them executable on macOS. |

---

## Part 2 — Open items

### 🟠 2.1 Sidecar binaries live in git (repository size)
`src-tauri/{ytdlp,ffmpeg,deno}-<triple>` (9 files, hundreds of MB) are tracked.
Every update of a binary adds its full size to the history.
**Suggestion:** download them in CI (and with a small `npm run fetch-sidecars`
script locally) instead of committing them, or move them to Git LFS.

### 🟡 2.2 Updater signing
The updater public key is set in `tauri.conf.json`. Auto-update works once the
GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` exist (CI then signs the builds and
publishes `latest.json`). The private key must never be committed or shared.

### 🟡 2.3 Rust code is not compiled in this review
All Rust changes of this cycle (screenshot, actions, log cleaning, ytdlp_version,
macOS sidecar selection, unique file names, find_media_file) were reviewed by hand. Run `cargo test` (tests exist for
stems, hosts/dates, URL redaction, log cleaning and date math) and
`npm run tauri build` on both platforms before publishing.

### 🟡 2.4 Third-party crates with platform-specific behavior
- **xcap** (screenshot): on macOS the first capture asks for the *Screen
  Recording* permission; if denied, the screenshot fails with an error toast.
- Windows 11 rounded window corners are cut to transparent in the PNG; other
  Windows versions keep square corners (correct).

### 🟢 2.5 Small things worth knowing
- `localStorage` holds the search history (8 links) and the last download folder;
  settings live in `settings.json` (app config folder).
- The log is pruned automatically (14 days, repeats merged, non-video links
  dropped, URLs reduced to site names, 512 KB cap).
- `screenshot3.png` in `src/assets` is not used by the app or the README (not
  bundled either); remove it or reference it.

---

## Part 3 — Architecture overview (1.2.0)

**Security model**
- The webview never runs processes and never makes network requests. Rust
  commands: `ytdlp_analyze`, `ytdlp_download`, `ytdlp_cancel(_all)`,
  `ytdlp_update`, `ytdlp_version`, `save_thumbnail`, `get_diagnostics`,
  `capture_app_window`, `find_media_file`, `open_media_path`, `copy_image_from_url`,
  `pick_folder_native` (Windows).
- Inputs are validated in Rust (URL, folder, file stem, formats, browsers);
  yt-dlp always gets `--ignore-config` and the URL after `--`.
- yt-dlp runs from a writable copy in the app data folder, so it can update
  itself even when the app is installed in a protected folder.

**Download pipeline** (`src/hooks/useDownloader.js` + `ytdlp.rs`)
analyze → dialog (shared options in `components/modals/downloadOptions.jsx`) →
queue item → Rust download with throttled progress events → real output path →
finish. A 403 during download is retried once automatically.

**UI layer**
- Liquid glass (`components/ui/liquidGlass`, WebGL, from LiquidGlass OSS — MIT)
  on the search bar, dialogs, queue cards, menus, toasts and tooltips; one shared
  WebGL context for surfaces that can be many; hidden glass stops rendering.
- Background engines (Floating Lines, Color Bends, static/wallpaper) pause when
  minimized and slow down when unfocused.
- Corner radii follow one rule: outer radius = inner radius + padding
  (documented at the top of `styles/App.css`).
- Right-click menu (`ContextMenu.jsx` + `useContextMenuSections.js`) replaces
  the webview menu; tooltips use `data-tooltip="…"`.
- 16 languages, all keys present in every locale; English fallbacks in code.

**Cross-platform**
- Windows x64 and macOS (Apple Silicon + Intel), built by
  `.github/workflows/release.yml`; macOS minimum version 11.0.
- macOS: custom traffic-light title bar, ⌘ shortcuts, Cmd+Q goes through the
  close confirmation, sidecars chosen by CPU architecture.
