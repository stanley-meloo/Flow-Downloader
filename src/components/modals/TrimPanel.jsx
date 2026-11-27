// Trim mode of the download card: choose the part of the video to download.
//
// In trim mode the card's thumbnail grows into a big preview (TrimPreview)
// and a timeline appears right under it (TrimTimeline); the download options
// stay below, so the folder / quality / format are always in sight.
//
// - TrimPreview: the video itself (the selected part, fetched as a light local
//   clip on Play), or its thumbnail. While the timeline is hovered or a
//   handle dragged, it shows that moment from the site's storyboard (YouTube
//   "sb" sprites — instant, no loading). Play previews the selected part.
// - TrimTimeline: filmstrip made of the storyboard, in / out handles of every
//   cut, the rest dimmed, zoom (magnifier, Alt + wheel), and the time ruler or
//   the sound waveform under it; then the start and end times (typed by hand
//   too), the total length and the reset button. Each cut becomes its own file.
//
// Files (./trim/):
//   shared.js        sizes, timings, helpers (cuts as windows, bounds, signals)
//   TrimPreview.jsx  the big preview: video clip, storyboard frames, play, volume
//   TrimTimeline.jsx the timeline block (times, length, reset) around the strip
//   Strip.jsx        filmstrip, handles, zoom, play position, right-click items
//   RulerWave.jsx    the time ruler and the sound waveform
//
// Sizes follow the card's 8 px grid: 48 px filmstrip, 32 px controls under it.
//
// This module re-exports what the download card uses.

export { TrimPreview, SideBlur } from "./trim/TrimPreview";
export { TrimTimeline } from "./trim/TrimTimeline";
export { MIN_LEN, createSignal, createPlayer, trimWindows, cutBounds } from "./trim/shared";
