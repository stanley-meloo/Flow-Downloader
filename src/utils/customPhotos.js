// The user's own wallpapers (Settings → Appearance → Custom → "My wallpapers").
// Saved in settings.visuals.customPhotos as
//   { id, path, x, y, zoom, thumb }
// path  = the image or video file on disk (read when it's the background).
//         Videos are converted on import (Rust import_wallpaper) to a
//         background-sized MP4 and play muted in a loop.
// x/y/zoom = its framing (utils/coverBox.js)
// thumb = a small WebP of the framed photo for the gallery card (data URL),
//         so the gallery never has to read the full-size files.

import { readFile } from "@tauri-apps/plugin-fs";
import { coverBox, DEFAULT_FRAMING } from "./coverBox";

const THUMB_W = 320;

export const newPhotoId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Video wallpapers (the app's converted MP4 copy, or the original file when it
// couldn't be converted).
const VIDEO_TYPES = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo" };
const extOf = (path) => (String(path || "").match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
export const isVideoPath = (path) => !!VIDEO_TYPES[extOf(path)];
// File bytes -> blob (with the right type, so a video plays from the blob URL).
export const mediaBlob = (bytes, path) => new Blob([bytes], VIDEO_TYPES[extOf(path)] ? { type: VIDEO_TYPES[extOf(path)] } : {});

// A frame of a video (blob URL), ready to draw: loaded, then sought a bit in
// (the very first frame is often black).
function loadVideoFrame(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 0) / 2); };
    v.onseeked = () => resolve(v);
    v.onerror = () => reject(new Error("video can't be read"));
    v.src = url;
  });
}

export const findPhoto = (visuals, path) =>
  (visuals?.customPhotos || []).find((p) => p.path === path) || null;

export const framingOf = (photo) => ({
  x: photo?.x ?? DEFAULT_FRAMING.x,
  y: photo?.y ?? DEFAULT_FRAMING.y,
  zoom: photo?.zoom ?? DEFAULT_FRAMING.zoom,
});

// Small picture of the photo (or a frame of the video) as it's framed on
// screen (window proportions).
export async function makePhotoThumb(path, framing = DEFAULT_FRAMING) {
  const bytes = await readFile(path);
  const url = URL.createObjectURL(mediaBlob(bytes, path));
  try {
    const media = isVideoPath(path) ? await loadVideoFrame(url) : await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const natW = media.videoWidth || media.naturalWidth;
    const natH = media.videoHeight || media.naturalHeight;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const w = THUMB_W, h = Math.round(THUMB_W / aspect);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const b = coverBox(natW, natH, w, h, framing.x, framing.y, framing.zoom);
    canvas.getContext("2d").drawImage(media, b.left, b.top, b.width, b.height);
    return canvas.toDataURL("image/webp", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}
