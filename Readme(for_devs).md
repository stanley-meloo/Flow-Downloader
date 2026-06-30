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
├─ tailwind.config.js
├─ postcss.config.js
│
├─ src/                        # ─── FRONTEND (React) ───
│  ├─ main.jsx                 # React root; imports global CSS and i18n
│  ├─ App.jsx                  # Top-level component: layout, background engine,
│  │                           #   global keyboard shortcuts, modal orchestration
│  ├─ styles/App.css           # Tailwind import + custom scrollbar
│  │
│  ├─ hooks/
│  │  ├─ useDownloader.js      # CORE: link analysis, queue, yt-dlp invocation,
│  │  │                        #   progress parsing, cancel/kill logic
│  │  ├─ useSettings.js        # Loads/saves settings.json; wallpaper randomizer
│  │  ├─ useYtdlpUpdater.js    # Auto/manual yt-dlp self-update (throttled daily)
│  │  └─ useTooltip.js         # Shared cursor-following tooltip state
│  │
│  ├─ utils/
│  │  ├─ fileSystem.js         # Thumbnail fetch + JPEG signature, clipboard
│  │  │                        #   paste, "reveal file in folder", SIGNATURE_COMMENT
│  │  └─ backgrounds.js        # Auto-loads wallpapers via import.meta.glob
│  │
│  ├─ components/
│  │  ├─ features/
│  │  │  ├─ SearchInput.jsx    # URL bar + paste/fetch buttons
│  │  │  ├─ QueueList.jsx      # Download queue list + per-item state UI
│  │  │  ├─ FloatingLines.jsx  # WebGL background engine #2 (interactive lines)
│  │  │  └─ ColorBends.jsx     # WebGL background engine #1 (color field)
│  │  ├─ modals/
│  │  │  ├─ MediaModal.jsx     # Single video: format/quality/audio + thumbnail
│  │  │  ├─ PlaylistModal.jsx  # Playlist: per-video selection + options
│  │  │  ├─ SettingsModal.jsx  # All settings (general + appearance)
│  │  │  └─ SetupModal.jsx     # First-run setup (language + download folder)
│  │  └─ ui/
│  │     ├─ TitleBar.jsx       # Custom window chrome (mac traffic lights / win)
│  │     └─ Toast.jsx          # Toast notifications (imperative add() via ref)
│  │
│  ├─ locales/
│  │  ├─ i18n.js               # i18next init + resource registration
│  │  └─ {en,pt,es,fr,de,zh,ja,ru,hi,ar,it,ko,bn,tr,vi,pl}.json
│  │
│  └─ assets/
│     ├─ logo.png, thumb-*.jpg # UI images
│     └─ backgrounds/
│        ├─ GIFs/              # animated wallpapers  → ANIMATED_PRESETS
│        ├─ JPGs/              # static wallpapers    → STATIC_PRESETS
│        └─ by Nipp/           # guest-artist artwork → NIPP_PRESETS
│
└─ src-tauri/                  # ─── BACKEND (Rust) ───
   ├─ src/
   │  ├─ main.rs               # Binary entry; calls lib run()
   │  └─ lib.rs                # Tauri commands: find_ffmpeg, find_deno,
   │                           #   kill_process_tree; plugin registration
   ├─ tauri.conf.json          # App config: window, CSP, bundle, externalBin
   ├─ Cargo.toml               # Rust crate + plugin dependencies
   ├─ capabilities/default.json# Permission scopes (fs, shell, dialog, …)
   ├─ icons/                   # App icons
   └─ <sidecar binaries>       # ytdlp-*, ffmpeg-*, deno-* (see §7)
```

---

## 5. Architecture

### 5.1 Frontend ↔ backend

The UI talks to the Rust backend in two ways:

- **`invoke('command')`** — calls a `#[tauri::command]` in `lib.rs`. Three exist:
  - `find_ffmpeg()` → absolute path of the bundled ffmpeg (or `""`).
  - `find_deno()` → absolute path of the bundled deno (or `""`).
  - `kill_process_tree(pid)` → kills a process and all descendants.
- **`Command.sidecar('ytdlp', args, opts)`** (`@tauri-apps/plugin-shell`) — runs
  the bundled `yt-dlp` binary directly and streams its stdout/stderr.

### 5.2 The download pipeline (`useDownloader.js`)

This is the heart of the app. Flow:

1. **`analyzeLink()`** runs `yt-dlp --dump-single-json` to fetch metadata. It
   decides whether the URL is a single video or a playlist, computes the list of
   offer-able qualities (`buildQualities`), and detects the codec situation
   (`analyzeCodecs`) to drive the editor-compatibility warning.
2. The user picks options in `MediaModal` / `PlaylistModal` and confirms.
3. **`startDownload()`** pushes one queue item per video (status `"Waiting"`).
4. A queue-processor effect runs up to `maxConcurrent` (default 3) downloads at
   once. Each spawns a `yt-dlp` child whose stdout is parsed for progress,
   speed, and ETA.
5. On completion the item becomes `"Done"`; on failure `"Error"`; on user
   cancel `"Canceled"`.

**Important details:**

- **Native format, no re-encoding.** Downloads use
  `bestvideo[height<=X]+bestaudio` and only *remux* into the chosen container.
  H.264 (avc1) is preferred at ≤1080p; above that YouTube only serves VP9/AV1,
  which the modal warns about (those won't open in editors like Premiere/DaVinci).
- **UTF-8 output.** `SIDE_OPTS` sets `PYTHONIOENCODING=utf-8` / `PYTHONUTF8=1`
  so titles with accents/emoji decode correctly on Windows.
- **JS runtime.** `--js-runtimes deno:<path>` points yt-dlp at the bundled Deno
  to solve YouTube's signature / `nsig` challenges. Without it, downloads fail
  with "Requested format is not available".
- **Cookies.** A `cookies.txt` file (preferred) or `--cookies-from-browser`
  handles the "confirm you're not a robot" bot check.
- **Concurrent fragments.** `--concurrent-fragments 5` keeps fragmented (SABR/
  DASH) streams fast.
- **Cancel kills the tree.** `kill_process_tree` (Rust) also stops the ffmpeg
  child yt-dlp spawned, preventing an orphaned ffmpeg pinning the CPU on Windows.

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
- `colorBends` → `ColorBends.jsx` (WebGL)
- `static` → a solid color and/or a wallpaper image

Wallpapers are auto-discovered at build time by `utils/backgrounds.js` using
`import.meta.glob` over the three asset subfolders. To add wallpapers, just drop
files into `src/assets/backgrounds/GIFs`, `/JPGs`, or `/by Nipp` — the gallery
and the display name (derived from the filename) are generated automatically.
A selected preset is stored as `bgImage: "@preset:<assetUrl>"`; a user-imported
image is stored as a local file path and read off disk into an object URL.

### 5.5 Settings persistence

`useSettings.js` reads/writes `settings.json` in the OS app-config directory
(`BaseDirectory.AppConfig`), debounced. Notable fields: `downloadPath`,
`playlistLimit`, `maxConcurrent`, `cookieBrowser`, `cookieFile`, `autoPaste`,
`defaultQuality`, `language`, and the `visuals` object (background engine +
wallpaper + per-gallery `randomGif/randomJpg/randomNipp` flags).

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

| Sidecar | Windows | macOS (Intel) | macOS (Apple Silicon) |
|---------|---------|---------------|-----------------------|
| yt-dlp  | `ytdlp-x86_64-pc-windows-msvc.exe` | `ytdlp-x86_64-apple-darwin` | `ytdlp-aarch64-apple-darwin` |
| ffmpeg  | `ffmpeg-x86_64-pc-windows-msvc.exe` | `ffmpeg-x86_64-apple-darwin` | `ffmpeg-aarch64-apple-darwin` |
| deno    | `deno-x86_64-pc-windows-msvc.exe` | `deno-x86_64-apple-darwin` | `deno-aarch64-apple-darwin` |

At runtime, `lib.rs` (`find_ffmpeg` / `find_deno`) locates these next to the app
executable, trying both the plain name and the triple-suffixed name so it works
in dev and in production. `yt-dlp` is launched by name via the shell plugin's
sidecar mechanism. Because the bundled yt-dlp is a PyInstaller build, no Python
install is required.

`yt-dlp` self-updates in place via `--update-to stable` (`useYtdlpUpdater.js`);
keep the binary in a writable location for that to succeed.

---

## 8. Conventions & customization points

- **Toast colors** (`Toast.jsx`): `success` = green, `error` = red,
  `info` = blue, `download` = violet. Fire one with
  `showToast('toast_key', 'success' | 'error' | 'info' | 'download')`.
- **Digital signature**: every downloaded file gets a metadata comment
  `Downloaded with Flow Downloader - <repo>`. The string lives in **one place**,
  `SIGNATURE_COMMENT` in `utils/fileSystem.js` — change the repo URL there.
  Video/audio get it via ffmpeg (`--embed-metadata`); JPEG thumbnails get an EXIF
  APP1 segment injected in `embedJpegComment` (`buildExifApp1`), writing both
  `XPComment` (the field Windows Explorer shows under Properties > Comments) and
  `ImageDescription` (for cross-platform tools).
- **Donation link**: the heart button in `App.jsx` opens a hardcoded Linktree
  URL — change it to your own.
- **Security/permissions**: the CSP is in `tauri.conf.json`; filesystem and
  plugin scopes are in `src-tauri/capabilities/default.json`. Widen scopes there
  if you add features that touch new paths or APIs.

---

## 9. Quick troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| "Requested format is not available" on a normal video | Missing JS runtime — ensure the `deno` sidecar is present. |
| "Confirm you're not a robot" / bot check | Enable cookies in Settings → General (a `cookies.txt` file is the most reliable). |
| "invalid utf-8 sequence" | The UTF-8 env (`SIDE_OPTS`) isn't applied — check the sidecar options. |
| Download stuck "Processing..." then orphaned ffmpeg on cancel | Ensure `kill_process_tree` is registered and invoked by `killChildTree`. |
| Wallpaper gallery empty | The folder under `src/assets/backgrounds/` has no matching files, or the glob extension list needs the new format. |
| Tauri APIs undefined | You ran `npm run dev` (browser) instead of `npm run tauri dev`. |
```
