# Flow Downloader — Developer Guide

A cross-platform desktop app (Windows / macOS) for downloading YouTube videos,
audio, and playlists. Built with **Tauri v2** — a **React + Vite** frontend and a
small **Rust** backend — it bundles `yt-dlp`, `ffmpeg`, and `deno` as sidecar
binaries so the end user does not need to install anything.

This document is for developers working on the codebase. For the user-facing
description, see `README.md`.

---

## 1. Tech stack

| Layer | Technology |
|-------|-----------|
| Shell / window | Tauri v2 (Rust) |
| UI | React 19, Vite 7 |
| Styling | Tailwind CSS v4 |
| Animation | Framer Motion |
| Icons | lucide-react |
| i18n | i18next + react-i18next (16 languages) |
| WebGL backgrounds | three.js |
| Download engine | yt-dlp (sidecar) |
| Media muxing/encoding | ffmpeg (sidecar) |
| JS runtime for yt-dlp | deno (sidecar) |

---

## 2. Prerequisites

- **Node.js** 18+ and npm
- **Rust** (stable) + the Tauri prerequisites for your OS
  (see https://tauri.app/start/prerequisites/)
- The sidecar binaries must be present in `src-tauri/` (see §7). They are large
  and are typically **git-ignored**, so a fresh clone needs them added manually.

---

## 3. Getting started

```bash
# install JS dependencies
npm install

# run the app in development (Vite + Tauri, hot reload on the frontend)
npm run tauri dev

# production build (installers in src-tauri/target/release/bundle/)
npm run tauri build
```

`npm run dev` alone runs only the Vite frontend in a browser, where Tauri APIs
(shell, fs, invoke, …) are unavailable — always use `npm run tauri dev` to test
real functionality.

---

## 4. Project structure

```
Flow Downloader/
├─ index.html                  # Vite entry HTML
├─ package.json                # scripts + JS dependencies
├─ vite.config.js              # Vite config (fixed port 1420 for Tauri)
├─ postcss.config.js
│
├─ src/                        # ─── FRONTEND (React) ───
│  ├─ main.jsx                 # React root; imports global CSS and i18n
│  ├─ App.jsx                  # Top-level component: layout, background engine,
│  │                           #   global keyboard shortcuts, modal orchestration
│  ├─ styles/App.css           # Tailwind import, radius scale, CSS-only effects
│  │                           #   (grain, shine, flash, queue spark…)
│  │
│  ├─ hooks/
│  │  ├─ useDownloader.js      # CORE: link analysis, queue, yt-dlp invocation,
│  │  │                        #   progress parsing, cancel/kill logic
│  │  ├─ useSettings.js        # Loads/saves settings.json; wallpaper randomizer
│  │  ├─ useYtdlpUpdater.js    # Auto/manual yt-dlp self-update (throttled daily)
│  │  ├─ useAppUpdater.js      # Flow self-update (Tauri updater) + banner state
│  │  ├─ useContextMenuSections.js # Right-click menu items per clicked element
│  │  ├─ useScrollEdges.js     # Which list edges can still scroll (soft fades)
│  │  └─ useTooltip.js         # Shared tooltip state (anchored to the element)
│  │
│  ├─ utils/
│  │  ├─ fileSystem.js         # Thumbnail fetch + JPEG signature, clipboard
│  │  │                        #   paste, "reveal file in folder", SIGNATURE_COMMENT
│  │  ├─ backgrounds.js        # Auto-loads wallpapers via import.meta.glob
│  │  ├─ keybinds.js           # Default shortcuts + combo matching, IS_MAC
│  │  ├─ folderPicker.js       # pickFolder(): native folder dialog (shows files)
│  │  ├─ media.js              # sanitizeTitle, YouTube id/thumbnail helpers
│  │  ├─ recent.js             # Search history + last download folder (localStorage)
│  │  ├─ consoleCapture.js     # Keeps recent console errors for diagnostics
│  │  ├─ autoMarquee.js        # Truncated text ("…") scrolls back and forth
│  │  ├─ scrambleLanguage.js   # "Decoding" text effect on language change
│  │  ├─ mouseNavigation.js    # Mouse Back/Forward buttons (dialogs, pages)
│  │  ├─ a11y.js               # `pressable`: keyboard access for clickable divs
│  │  ├─ coverBox.js           # Custom photo framing math (cover + position + zoom)
│  │  ├─ accentColor.js        # Accent colors taken from the background
│  │  └─ diagnostics.js        # Diagnostics report text + REPO_URL
│  │
│  ├─ components/
│  │  ├─ features/
│  │  │  ├─ SearchInput.jsx    # URL bar + paste/fetch buttons (liquid glass)
│  │  │  ├─ AutoDownloadToggle.jsx # Auto Download switch (skip the card)
│  │  │  ├─ LinkDropZone.jsx   # Drag a link onto the window to download it
│  │  │  ├─ PhotoPositioner.jsx # Frame the custom background photo (drag / zoom)
│  │  │  ├─ HeroTitle.jsx      # Title written letter by letter + tagline
│  │  │  ├─ QueueList.jsx      # Download queue list + per-item state UI
│  │  │  ├─ FloatingLines.jsx  # WebGL background engine (interactive lines)
│  │  │  └─ GhostFibers.jsx    # WebGL background engine (fiber ribbons, React Bits)
│  │  ├─ modals/
│  │  │  ├─ MediaModal.jsx     # Single video: format/quality/audio + thumbnail
│  │  │  ├─ PlaylistModal.jsx  # Playlist: per-video selection + options
│  │  │  ├─ downloadOptions.jsx# Shared quality/audio/format options + dropdown
│  │  │  ├─ CloseConfirmModal.jsx # "Close while downloading?" dialog
│  │  │  ├─ SettingsModal.jsx  # All settings (general, appearance, shortcuts)
│  │  │  └─ SetupModal.jsx     # First-run setup (language + download folder)
│  │  └─ ui/
│  │     ├─ TitleBar.jsx       # Custom window chrome (mac traffic lights / win)
│  │     ├─ Toast.jsx          # Toast notifications (imperative add() via ref)
│  │     ├─ Tooltip.jsx        # Liquid-glass tooltips (data-tooltip="…")
│  │     ├─ ContextMenu.jsx    # Right-click menu (replaces the webview's)
│  │     ├─ StarBorder.jsx     # Stars of light running around the search bar
│  │     ├─ SearchBurst.jsx    # Burst of light + sparks (search start, support heart)
│  │     ├─ SmoothScroll.jsx   # Lenis smooth scrolling for every scroll area
│  │     ├─ AnimatedIcons.jsx  # lucide-animated icons (plain JSX + Motion)
│  │     ├─ FilmGrain.jsx, BrandShine.jsx, ScrollThumb.jsx, Motion.jsx
│  │     └─ liquidGlass/       # WebGL liquid glass (LiquidGlass OSS, MIT)
│  │
│  ├─ locales/
│  │  ├─ i18n.js               # i18next init + resource registration
│  │  └─ {en,pt,es,fr,de,zh,ja,ru,hi,ar,it,ko,bn,tr,vi,pl}.json
│  │
│  └─ assets/
│     ├─ logo.png, thumb-*.jpg # UI images
│     ├─ sounds/screenshot.mp3 # Shutter sound (right-click → Screenshot)
│     └─ backgrounds/          # OPTIMIZED wallpapers (generated, see §5.4)
│        ├─ GIFs/              # animated (animated WebP) → ANIMATED_PRESETS
│        ├─ JPGs/              # static (WebP)            → STATIC_PRESETS
│        └─ _thumbs/           # 320×180 still previews for the gallery
│
├─ assets-src/backgrounds/     # ORIGINAL wallpapers (not bundled)
├─ scripts/optimize-wallpapers.mjs  # originals → optimized WebP + thumbs (sharp)
├─ scripts/installer-art.py         # Windows installer (NSIS) artwork → src-tauri/installer/
├─ .github/workflows/release.yml    # Windows + macOS builds on tag push (§10)
│
└─ src-tauri/                  # ─── BACKEND (Rust) ───
   ├─ src/
   │  ├─ main.rs               # Binary entry; calls lib run()
   │  ├─ lib.rs                # App setup, plugins, partial-file helpers,
   │  │                        #   pick_folder_native (Windows dialog)
   │  ├─ ytdlp.rs              # yt-dlp runner: analyze / download / cancel /
   │  │                        #   update / thumbnails / diagnostics / log
   │  ├─ screenshot.rs         # Screenshot of the app window (xcap)
   │  ├─ window_corners.rs     # Rounded window corners (Windows 11 / macOS)
   │  └─ actions.rs            # Open file/folder, copy image, drag file out, free space
   ├─ tauri.conf.json          # App config: window, CSP, bundle, updater
   ├─ tauri.updater.conf.json  # Merged in CI only when the signing key exists
   ├─ Cargo.toml               # Rust crate + plugin dependencies
   ├─ capabilities/default.json# Permission scopes (fs, shell, dialog, …)
   ├─ installer/               # NSIS installer art: sidebar.bmp (164×314), header.bmp (150×57)
   ├─ icons/                   # App icons
   └─ <sidecar binaries>       # ytdlp-*, ffmpeg-*, deno-* (see §7)
```

---

## 5. Architecture

### 5.1 Frontend ↔ backend

**The webview never runs yt-dlp itself.** It has no shell `execute`/`spawn`
permission: every call goes through typed Rust commands in `src-tauri/src/ytdlp.rs`,
which validate the input (http(s) URL, existing absolute folder, safe file name,
whitelisted formats / browsers) and build a **fixed** argument list (always with
`--ignore-config` and the URL after `--`). This closes options like `--exec`.

| Command | What it does |
|---------|--------------|
| `ytdlp_analyze(url, single, playlistLimit, cookies)` | `--dump-single-json`; returns `{ code, stdout, stderr }` |
| `ytdlp_download(runId, opts)` | Runs one download; resolves when yt-dlp exits with `{ code, stderr, cancelled, outputFile }`. Progress arrives as `ytdlp://progress` events `{ runId, phase, percent, speed, eta }` |
| `ytdlp_cancel(runId)` / `ytdlp_cancel_all()` | Kills the process tree; the download then deletes its partial files |
| `ytdlp_update()` | `--update-to stable` on the writable copy (see §7); returns `{ code, output, writable, version }` |
| `ytdlp_version()` | Installed yt-dlp version (shown in Settings) |
| `save_thumbnail(urls, directory, stem)` | Downloads the first working thumbnail (any site), adds the EXIF signature, saves it |
| `get_diagnostics()` | Plain-text report (versions, tools found, cleaned recent log) for "Copy diagnostics" |
| `capture_app_window()` | `screenshot.rs`: screenshot of the app window only → `Pictures/Flow Downloader` + clipboard |
| `find_media_file(directory, names)` | `actions.rs`: first existing file among candidate names (works in any folder) |
| `open_media_path(path)` | `actions.rs`: opens an existing folder or media/image file (anything else is refused) |
| `copy_image_from_url(url)` | `actions.rs`: downloads an https image and puts it on the clipboard |
| `pick_folder_native(...)` | **Windows only**: native folder dialog that also shows files (§5.2b) |

`opts` for a download: `{ url, directory, stem, formatType: "video"|"audio"|"video_only", ext, height, audioKbps, cookies: { cookieFile, cookieBrowser } }`.

### 5.2 The download pipeline (`useDownloader.js`)

This is the heart of the app. Flow:

1. **`analyzeLink()`** runs `yt-dlp --dump-single-json` to fetch metadata. It
   decides whether the URL is a single video or a playlist, computes the list of
   offer-able qualities (`buildQualities`), and detects the codec situation
   (`analyzeCodecs`) to drive the editor-compatibility warning.
2. The user picks options in `MediaModal` / `PlaylistModal` and confirms.
3. **`startDownload()`** pushes one queue item per video (status `"Waiting"`).
4. A queue-processor effect runs up to `maxConcurrent` (default 3, set in
   Settings) downloads at once. Each attempt gets its own `runId` and calls
   `ytdlp_download`; progress comes back as events.
5. On completion the item becomes `"Done"`; on failure `"Error"` with an
   `errorKey` (see `classifyYtdlpError`: unavailable, private, geo-blocked, age,
   live not started, network, disk, ffmpeg, …) shown in the queue row and as a
   toast; on user cancel `"Canceled"`.

**Important details:**

- **Native format, no re-encoding.** Downloads use
  `bestvideo[height<=X]+bestaudio` and only *remux* into the chosen container
  (format strings are built in `format_selection`, `ytdlp.rs`). H.264 (avc1) is
  preferred at ≤1080p; above that YouTube only serves VP9/AV1, which the modal
  warns about. **Video only** downloads just the video stream (`--remux-video`).
- **UTF-8 output.** `PYTHONIOENCODING=utf-8` / `PYTHONUTF8=1` are set on every
  yt-dlp process so titles with accents/emoji decode correctly on Windows.
- **JS runtime.** `--js-runtimes deno:<path>` points yt-dlp at the bundled Deno
  to solve YouTube's signature / `nsig` challenges.
- **Cookies.** A `cookies.txt` file (preferred) or `--cookies-from-browser`
  (whitelisted browser names) handles the bot check / private content.
- **Progress.** `--newline --progress-template` prints raw byte counts that Rust
  turns into percent / speed / ETA, throttled to ~150 ms per download.
- **Cancel kills the tree.** The bundled yt-dlp is a PyInstaller "onefile"
  build (bootloader → Python → ffmpeg), so `kill_tree` kills the whole process
  tree (`taskkill /T` / `pgrep -P`). A cancel that arrives before the process
  exists is remembered and the download stops right before spawning.
- **Cancel removes partial files.** Before spawning, the download snapshots the
  files that already exist for that name. After a cancel it deletes only files
  *this* download created that match yt-dlp's naming (`.part`, `.part-FragN`,
  `.ytdl`, `fNNN` streams, `.temp`, unfinished output) — never the snapshot,
  never other titles — retrying for ~3 s (Windows file locks).
- **Close confirmation.** Every close path calls `requestClose()` in
  `useDownloader`: the window's close button / Alt+F4 (`onCloseRequested`) and
  app-level quit such as Cmd+Q on macOS (Rust `RunEvent::ExitRequested` →
  `prevent_exit()` + `exit-requested` event, only while a window is still open).
  With downloads running or queued, `CloseConfirmModal` lists them (live
  progress); "Close anyway" calls `ytdlp_cancel_all`, waits (max ~8 s) for every
  download to exit and clean up, then destroys the window. `RunEvent::Exit`
  also kills anything still running as a last safety net. With nothing pending, the app closes immediately.
- **Custom titles.** The single-video dialog lets the user rename the video
  (playlists keep each video's own title). The custom title is passed in `customData` to `startDownload`
  and goes through `sanitizeTitle` (`utils/media.js`: spaces → `_`, cut by code
  point so emoji never break, Windows-safe). Rust re-validates the result.
- **Duplicate-submit guard.** The modals ignore repeated confirms, and
  `startDownload` drops an identical request made within 2 s.

### 5.2b Shortcuts and the folder dialog

- **Shortcuts** live in `settings.keybinds` (defaults in `utils/keybinds.js`) and
  are edited in Settings → Shortcuts. Combos are strings like `Ctrl+Shift+K`
  (`Ctrl` also matches Cmd). Actions belong to a group (`main` / `modal`);
  duplicates are only rejected inside a group. `App.jsx` handles the main-window
  actions; the download modals handle `download` / `closeModal`. To add an action,
  add it to `DEFAULT_KEYBINDS` + `KEYBIND_ACTIONS`, handle it, and add
  `settings.shortcuts.actions.<id>` to all locales.
- **Folder dialog.** Always call `await pickFolder(defaultPath)`
  (`utils/folderPicker.js`); it returns `"C:/path"` or `null`. The goal is a
  *native* dialog that also shows the files inside each folder:
  - **Windows:** the standard folder picker hides all files, so the Rust command
    `pick_folder_native` (module `win_folder_dialog` in `lib.rs`, `windows` crate
    0.61) opens the Explorer "Open" dialog (`IFileOpenDialog`) instead: a filter
    lists video/audio/image files, the OK button is relabeled "Select folder",
    and the file-name box is pre-filled with a placeholder ("This folder") with
    `FOS_FILEMUSTEXIST` removed — so confirming returns `<folder>\<placeholder>`
    and we keep the folder. Selecting a file uses its folder. The dialog is owned
    by the app window (modal). All texts come translated from the frontend.
  - **macOS:** the standard folder panel (dialog plugin) already shows files
    (greyed out), so it's used directly. On non-Windows the Rust command is a stub.
  - If the Windows command ever fails, `pickFolder` falls back to the standard dialog.

### 5.3 Internal status state machine

Queue items move through these **English** status strings, set in
`useDownloader.js` and read in `QueueList.jsx`:

`"Waiting"` → `"Downloading"` → `"Processing..."` → `"Done"`
(or `"Error"` / `"Canceled"`).

These are internal identifiers, **not** display text — the visible label comes
from i18n keys under `queue.*`.

### 5.4 Backgrounds

Three engines, selected by `visuals.activeBackground` and crossfaded in `App.jsx`:

- `floatingLines` → `FloatingLines.jsx` (WebGL)
- `ghostFibers` → `GhostFibers.jsx` (WebGL 2, React Bits)
- `static` → a solid color and/or a wallpaper image

Wallpapers are auto-discovered at build time by `utils/backgrounds.js`
(`import.meta.glob`). The bundled files are **optimized copies**:

1. Put originals (GIF/JPG/PNG…) in `assets-src/backgrounds/GIFs` or `/JPGs`.
2. Run `npm run optimize-wallpapers` (uses `sharp`). Stills → WebP ≤2560×1440,
   GIFs → animated WebP ≤1280 px wide (kept as GIF if that is smaller), plus a
   320×180 still thumbnail in `_thumbs/`. Only changed files are processed;
   outputs whose original was removed are deleted.

A chosen preset is stored as `bgImage: "@preset:<folder>/<name>"` (e.g.
`@preset:GIFs/adventure`) — stable across builds. Old values that stored the
asset URL are converted on load (`normalizePresetValue`). A user-imported image
is stored as a local file path and read off disk into an object URL.

The WebGL engines use `utils/renderLoop.js`: rendering stops while the window
is hidden/minimized or the close-confirmation dialog covers it (`paused` prop),
drops to ~30 fps while unfocused, and resumes where it stopped.

### 5.5 Settings persistence

`useSettings.js` reads/writes `settings.json` in the OS app-config directory
(`BaseDirectory.AppConfig`), debounced. Notable fields: `downloadPath`,
`playlistLimit`, `maxConcurrent`, `cookieBrowser`, `cookieFile`, `autoPaste`,
`defaultQuality`, `language`, and the `visuals` object (background engine +
wallpaper + per-gallery `randomGif/randomJpg` flags).

---

## 6. Internationalization

- 16 locale files live in `src/locales/`, registered in `i18n.js`.
- `fallbackLng` is `en`; `load: 'languageOnly'` maps e.g. `pt-BR` → `pt`.
- Components call `t('namespace.key', { defaultValue: '…' })`. The `defaultValue`
  is only a last-resort fallback if a key is missing.

**Adding a translation key:** add it to **all 16** JSON files under the same
path. Keep the files valid JSON (UTF-8). A quick validation:

```bash
for f in src/locales/*.json; do python3 -c "import json;json.load(open('$f',encoding='utf-8'))" || echo "INVALID: $f"; done
```

**Adding a language:** create `src/locales/<code>.json`, import it in `i18n.js`,
add it to the `resources` map, and add an entry to the language dropdowns in
`SettingsModal.jsx` and `SetupModal.jsx`.

---

## 7. Sidecars & bundling

Tauri ships extra executables listed under `bundle.externalBin` in
`tauri.conf.json`: `ytdlp`, `ffmpeg`, `deno`. Tauri resolves each to a
**target-triple-suffixed** file at build time, so every platform you build for
needs its own copy in `src-tauri/`:

| Sidecar | Windows | macOS (Intel) | macOS (Apple Silicon) | Linux (x64) |
|---------|---------|---------------|-----------------------|-------------|
| yt-dlp  | `ytdlp-x86_64-pc-windows-msvc.exe` | `ytdlp-x86_64-apple-darwin` | `ytdlp-aarch64-apple-darwin` | `flowdl-ytdlp-x86_64-unknown-linux-gnu` |
| ffmpeg  | `ffmpeg-x86_64-pc-windows-msvc.exe` | `ffmpeg-x86_64-apple-darwin` | `ffmpeg-aarch64-apple-darwin` | `flowdl-ffmpeg-x86_64-unknown-linux-gnu` |
| deno    | `deno-x86_64-pc-windows-msvc.exe` | `deno-x86_64-apple-darwin` | `deno-aarch64-apple-darwin` | `flowdl-deno-x86_64-unknown-linux-gnu` |

**Linux.** The Linux sidecars carry a `flowdl-` prefix (`tauri.linux.conf.json`):
the .deb/.rpm install them into `/usr/bin`, where a plain `ffmpeg`/`deno` would
clash with the system packages. They are not committed (large); get them with
`bash scripts/fetch-linux-sidecars.sh` (the release workflow does the same).
Building on Linux needs Tauri's system packages plus the screen-capture libs:

```sh
sudo apt-get install build-essential file libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf \
  pkg-config libclang-dev libxcb1-dev libxrandr-dev libdbus-1-dev \
  libpipewire-0.3-dev libwayland-dev libegl-dev libgbm-dev
```

Linux bundles: `.AppImage` (any distro, libraries included), `.deb` and `.rpm`
(their runtime dependencies are listed under `bundle.linux` in `tauri.conf.json`).
Windows installs WebView2 automatically if missing (`webviewInstallMode:
embedBootstrapper`).

At runtime `bundled_binary()` (`ytdlp.rs`) locates them next to the app
executable (plain or triple-suffixed name, so dev and production both work).
Because the bundled yt-dlp is a PyInstaller build, no Python install is required.

**Updatable yt-dlp copy.** On first use, the bundled yt-dlp is copied to
`<app local data>/bin/yt-dlp(.exe)` (chmod + quarantine flag removed on macOS)
and run from there, so `--update-to stable` works even when the app is installed
in a read-only folder. A marker file stores which bundled binary the copy came
from; a new app version with a different yt-dlp refreshes the copy. If copying
fails, the bundled binary is used directly.

---

## 8. Conventions & customization points

- **Animations** (`components/ui/Motion.jsx`): every state change should transition.
  Use `<Swap id={x}>` to crossfade content when `x` changes (labels, icons, button
  states), `<Collapse show gap={px}>` for blocks that appear/disappear (pass the
  parent's `space-y`/`gap` in px so siblings glide without a jump), and
  `<Pop show>` for small inline elements (badges, inline buttons). They skip the
  animation on first render. `App.jsx` wraps everything in
  `<MotionConfig reducedMotion="user">`, so the OS "reduce motion" setting is honored.

- **Animated icons** (`components/ui/AnimatedIcons.jsx`): JSX ports of
  [lucide-animated](https://lucide-animated.com) (MIT) — Settings, Heart, Download,
  FolderOpen, FolderUp, RefreshCw, RotateCcw, Sparkles, Copy, Languages, Keyboard,
  ChevronDown, Check, CircleCheck, Search, ExternalLink, Zap, Link, Layers,
  CircleHelp, FileCog, Clock, Ban. (Icons with no animated version stay on
  lucide-react.) The wrapper is block-level and exactly `size`×`size`, like
  lucide's `<svg>`, so round icon buttons keep their shape. They
  are drop-in replacements for the lucide-react icons (imported with an alias,
  e.g. `SettingsIcon as Settings`) and animate when the surrounding button / `.group` is hovered.
  To add one, port its `/r/<name>.json` source into that file the same way.
- **Liquid glass** (`components/ui/liquidGlass/`): the search bar is a
  `<LiquidGlass>` — WebGL refraction adapted from
  [LiquidGlass OSS](https://gitlab.com/ogtirth/liquidglass-oss) (MIT; see the folder's `LICENSE.md`; the shader only adds `u_coreOpacity`,
  which makes the flat middle see-through so the live background shows there). The original refracts one fixed image;
  here `backdrop.js` re-composes the real background (WebGL canvas, wallpaper with
  blur/darken/gradient, or color) into a half-resolution snapshot (every frame while it
  animates, ~2 fps when static). Background layers are tagged in `App.jsx` with
  `data-glass-backdrop` / `data-glass-layer`; the WebGL engines use
  `preserveDrawingBuffer` so they can be read. Without WebGL it falls back to the
  `fallbackClassName` CSS blur. Tune the look with `variant`
  (`clear|frosted|dark|prism|dome`) and `settings` (`GLASS_SETTINGS` in `SearchInput.jsx`).
- **Toast colors** (`Toast.jsx`): `success` = green, `error` = red,
  `info` = blue, `download` = violet. Fire one with
  `showToast('toast_key', 'success' | 'error' | 'info' | 'download')`.
- **Digital signature**: every downloaded file gets a metadata comment
  `Downloaded with Flow Downloader - <repo>`. The string lives in **one place**,
  `SIGNATURE_COMMENT` in `src-tauri/src/ytdlp.rs` — change the repo URL there.
  Video/audio get it via ffmpeg (`--embed-metadata`); JPEG thumbnails get an EXIF
  APP1 segment (`exif_app1`) with both `XPComment` (Windows Explorer → Comments)
  and `ImageDescription` (cross-platform tools).
- **Logs & diagnostics**: failures (analyze, download, yt-dlp update) are
  appended to `flow-downloader.log` in the OS app-log folder (site name only,
  never full links; entries older than 14 days, failures caused by non-video
  links and consecutive repeats are cleaned up; reset past 512 KB). The
  right-click menu → "Copy console diagnostics" copies the repository link,
  versions, the log tail and recent console errors (`src/utils/diagnostics.js`).
- **Donation link**: the heart button in `App.jsx` opens a hardcoded Linktree
  URL — change it to your own.
- **Security/permissions**: the CSP is in `tauri.conf.json` (`connect-src` is
  IPC only — network requests happen in Rust); filesystem and plugin scopes are
  in `src-tauri/capabilities/default.json`. Never give the webview shell
  execute/spawn rights for the sidecars: add a validated Rust command instead.

---

## 9. Quick troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| "Requested format is not available" on a normal video | Missing JS runtime — ensure the `deno` sidecar is present. |
| "Confirm you're not a robot" / bot check | Enable cookies in Settings → General (a `cookies.txt` file is the most reliable). |
| "invalid utf-8 sequence" | The UTF-8 env in `base_command` (`ytdlp.rs`) isn't applied. |
| Orphaned yt-dlp/ffmpeg after cancel | `kill_tree` failed — check the log / diagnostics. |
| Wallpaper missing from the gallery | Run `npm run optimize-wallpapers` after adding the original to `assets-src/backgrounds/`. |
| yt-dlp update fails | Diagnostics shows "bundled (read-only)": the writable copy couldn't be created in the app-data folder. |
| Tauri APIs undefined | You ran `npm run dev` (browser) instead of `npm run tauri dev`. |

---

## 10. Releases & app auto-update

Pushing a tag `v<version>` runs `.github/workflows/release.yml`: one draft
release, then Windows (x64) and macOS (Apple Silicon + Intel) builds upload to it
(one at a time, so their `latest.json` entries don't overwrite each other).

The in-app updater (`useAppUpdater.js`, `tauri-plugin-updater`) reads
`releases/latest/download/latest.json`. One-time setup:

1. Generate a key pair on your machine (never commit the private key):
   `npm run tauri signer generate -- -w ~/.tauri/flow-downloader.key`
2. Put the **public** key in `tauri.conf.json` → `plugins.updater.pubkey`.
3. Add repo secrets `TAURI_SIGNING_PRIVATE_KEY` (the private key's contents) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

With the secret present, CI merges `tauri.updater.conf.json`
(`createUpdaterArtifacts`) and publishes signed updates; without it, the builds
still work, just without auto-update. Publish the draft to make it "latest".
