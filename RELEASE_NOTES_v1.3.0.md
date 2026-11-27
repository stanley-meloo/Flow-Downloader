# Flow Downloader 1.3.0

Cut videos before downloading them — pick exactly the part you want, preview it with sound, and download only that. Plus a smarter download engine update, a new update experience and lots of polish.

## ✂️ Trim before downloading

- **Download only part of a video** — press the scissors (or `T`) in the download card: the thumbnail grows into a big 16:9 preview with a timeline under it. Drag the handles, or type the start and end times.
- **Real preview** — play the selected part with sound before downloading (volume control, remembered mute). The preview pauses while you scrub the timeline and resumes on its own.
- **Several cuts at once** — press `N` to add another part; each one becomes its own file, named with its time range (e.g. `Title [1m20s-2m05s]`). Cuts never overlap.
- **Sound waves** — right-click the ruler to see the video's sound instead of the time ruler, filled in your accent color as the video plays. "Audio only" switches to the waves automatically; "Video only" keeps the ruler.
- **Zoom** — `Alt` + mouse wheel zooms the timeline right where the pointer is, smoothly; the magnifier button zooms in and resets.
- **Precise or fast cuts** — cut exactly on the chosen frames, or at the nearest keyframes (faster, no re-encoding).
- **Undo / redo** — `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` for every change to the cuts and the title.
- **Accurate progress** for trimmed downloads.
- New shortcuts (all rebindable in Settings → Shortcuts): `T` trim, `Space` play / pause, `N` add a cut, undo and redo. Mouse gestures on the timeline are listed there too.

## 🔄 Updates

- **New update card** — when a new version of Flow is out, a card shows what's new and updates with one click (with a progress bar). "Ignore" folds it into a small round button next to Settings, so you can update later.
- **A little celebration** after updating — a glow runs across the whole app on the first launch of the new version.
- **Download engine updates only when needed** — Flow now checks the engine's version first and downloads an update only when there's a newer one, with a progress bar in the notification. The download is verified before it replaces the old engine, and the old one comes back if anything goes wrong.

## 🎨 Polish

- **Resume unfinished downloads** — the banner now sits right under the search bar, in liquid glass.
- **Download button** — a livelier hover: it lifts, a sheen sweeps across, the arrow drops and the glow fades in smoothly.
- **Cleaner liquid glass** — no more stray pixels at the corners of the cards.
- Download cards stay centered and grow smoothly, without scrollbar flashes.
- Clearer notifications for the download engine (checking, downloading, updated).

## 🔧 Fixes & improvements

- Anonymous usage statistics from the installed app are now sent reliably (they could be lost when the app was closed quickly).
- Faster, lighter trim view (sound waves sized to the video's length, cached for the session).
- Lots of internal cleanup and optimization.

---

**Install:** Windows → `FlowDownloader-1.3.0.exe` · macOS 12+ → `FlowDownloader-1.3.0-macOS-AppleSilicon.dmg` (Apple chip) or `FlowDownloader-1.3.0-macOS-Intel.dmg` (Intel) · Linux → `.AppImage`, `.deb` or `.rpm`.
Already on 1.2.0? Flow will offer the update by itself.
On macOS, if the app is blocked on first launch, right-click it → **Open** (or run `xattr -cr "/Applications/Flow Downloader.app"` in Terminal).
