# Flow Downloader 1.2.0

The biggest update yet: a brand-new **liquid glass** interface, animated icons, a much lighter app, safer internals, clear error messages — and automatic app updates from now on.

## ✨ Highlights

- **Liquid glass interface** — the search bar, every window, the download queue, menus, notifications and tooltips are now made of real, refractive liquid glass. The rim bends and lights up the live background behind it (animated lines, color fields and even animated wallpapers), while the middle stays see-through. Focusing the search bar gently dims the background to put it in focus.
- **Film grain** — a subtle cinematic grain with a light chromatic fringe over the whole app, for a warmer, filmic look. Adjust its intensity with a slider in Settings → Appearance (0 turns it off).
- **Animated icons** — icons across the app come alive when you hover them: the gear turns, the heart beats, folders wiggle, arrows drop, checks redraw and more.
- **Automatic app updates** — Flow tells you when a new version is out and updates itself with one click (signed updates; it never updates while something is downloading).
- **Much lighter** — the built-in wallpapers were re-encoded: **~50 MB → ~7 MB** with the same look, and the wallpaper gallery uses tiny still previews, so Settings opens faster.
- **Wallpaper extension** — a lighter installer with 9 built-in wallpapers, plus a one-click download in Settings → Appearance that adds dozens more (video wallpapers in up to 4K on big screens). Wallpapers show up one by one as they finish downloading; cancel anytime and resume later.
- **Video wallpapers & sharper backgrounds** — use your own videos as a custom background, and wallpapers now follow your window size: full screen on a 4K monitor really plays in 4K.
- **Right-click menu** — a liquid-glass menu that changes with what you click: open a finished file or its folder, copy a video's link, retry, download again in another quality, clear completed, recent searches, keep the window on top, take a screenshot of the app (with flash and shutter sound), copy diagnostics, and more.
- **New notifications and tooltips** — redesigned, color-coded notifications with animated icons, and tooltips on every button.
- **Searching animation** — a colorful light now runs around the search bar while a link is being read.
- **Backgrounds that rest** — animated backgrounds pause while the app is minimized and slow down while Flow is in the background, and glass hidden behind a window stops rendering. Less GPU, less battery.

## 🎨 Personalization & polish

- **Editable titles** — rename a video before downloading, with a live preview of the final file name. Long titles widen the download window instead of squeezing it.
- **Fully customizable shortcuts** — new Shortcuts tab: `Enter` to search and to download, `O` for Settings, `Esc` to close, and more, all rebindable.
- **Simultaneous downloads** — choose 1 to 5 downloads at a time.
- **Live sliders** — background settings update while you drag, not only when you let go.
- **Smoother Settings** — a soft fade at the bottom shows there's more to scroll, and a clean floating scrollbar.
- **Your wallpaper choice survives updates** — built-in wallpapers are saved by name.
- **Language detection for all 16 languages** on first launch.
- **Smooth animations everywhere**, respecting the system "reduce motion" setting.
- **Font bundled with the app** — loads offline, instantly.

## 🗂️ Downloading made nicer

- **Native folder picker that shows your files**, so you can see what's already in a folder before choosing it (Windows and macOS).
- **Cancel really cancels** — the whole download stops immediately and its partial files are deleted.
- **Close confirmation** — closing Flow (including Cmd+Q on macOS) while something is downloading asks first and lists what's still in progress.
- **No accidental duplicates** — double-clicks or a held `Enter` never add the same video twice.

## 🛡️ Safer

- The download engine runs only through a small set of validated commands inside the app core. The interface can no longer pass arbitrary options to it, and personal engine config files are ignored.
- Tighter permissions: the interface has no direct network or file-writing access beyond what it needs.

## 🔒 Privacy

- Flow now collects only anonymous usage statistics: that the app was opened, with the app version, the system and the country it's being used from. No personal data, no device identifiers, nothing about your links or downloads. You can turn it off in Settings → General → **Anonymous usage statistics**.

## 🧠 Clearer errors & help

- Failed downloads now say **why**: unavailable or removed, private / members-only, not available in your country, age-restricted, live not started yet, connection problem, disk/folder problem, processing failure, unsupported link.
- **Copy diagnostics** (right-click menu) copies a short report — versions, tools found and recent errors (site names only, never your links) — to paste when asking for help. Repeated and old errors are tidied up automatically.
- **Automatic retry** — if a site briefly refuses a download, Flow tries again once by itself before showing an error.

## 🔧 Fixes & improvements

- **Download engine updates work everywhere** — Flow keeps an updatable copy of the engine in its own data folder, so updating no longer fails in protected install folders. Settings shows the engine version and the result of the last check.
- **"Video only" really is video only** — no audio track.
- **Thumbnails from any site**, always at the best available resolution, with the Flow signature in their metadata.
- Thumbnails in the queue and playlist lists no longer show broken images on other sites.
- Titles with emoji are never cut in the middle; file names are safe on every system.
- More reliable progress, speed and ETA.
- Round buttons keep their shape; scrollbars without arrow buttons or mismatched backgrounds.
- Toasts fired at the same moment no longer collide.

## Everything Flow already did

- Video + audio, video-only and audio-only downloads; single videos and whole playlists (pick exactly which items, with a configurable limit).
- Native quality, no re-encoding: up to 8K, H.264 preferred up to 1080p, with a warning when a resolution comes in a codec video editors may not open.
- Audio in MP3, M4A, WAV or AAC; video in MP4, MKV or WebM.
- Smart queue with live progress, speed, ETA, retry, remove and "open in folder".
- Live backgrounds — interactive animations, video and image wallpapers, a plain color or your own photos and videos (with framing, blur and darkening), and random-wallpaper-on-launch. More wallpapers can be downloaded from Settings.
- Clipboard auto-paste, cookies support (browser or cookies.txt), and the Flow signature embedded in every file.
- 16 languages. Everything it needs is bundled — nothing extra to install.

---

**Install:** Windows → `FlowDownloader-1.2.0.exe` · macOS 12+ → `aarch64.dmg` (Apple Silicon) or `x64.dmg` (Intel) · Linux → `.AppImage`, `.deb` or `.rpm`.
On macOS, if the app is blocked on first launch, right-click it → **Open** (or run `xattr -cr "/Applications/Flow Downloader.app"` in Terminal).
