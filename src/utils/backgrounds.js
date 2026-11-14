// Built-in wallpapers:
//   - the few that ship inside the app, loaded at build time with Vite's
//     import.meta.glob from src/assets/backgrounds;
//   - the wallpaper pack (all the others), downloaded from Settings into the
//     app's data folder (Rust wallpaper_pack.rs) and added here at runtime
//     (loadWallpaperPack) — galleries re-render through useWallpaperPresets().
//   GIFs/ -> animated (animated WebP/GIF, or MP4 video loops)   |   JPGs/ -> static
// Both are OPTIMIZED copies made by `npm run optimize-wallpapers` from the
// originals in assets-src/backgrounds (scripts/pack-wallpapers.mjs decides
// which ones ship). _thumbs/ holds small still previews for the gallery; video
// wallpapers also come in bigger sizes (_hd/<height>/), picked to match the
// window (utils/videoTiers.js).
//
// A chosen wallpaper is saved as "@preset:<id>", where id = "<folder>/<name>"
// (e.g. "GIFs/adventure"). Unlike the asset URL, the id never changes between
// builds, so the choice survives app updates.

import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';

const PREFIX = '@preset:';
const BASE = '../assets/backgrounds/';

const glob = {
  GIFs: import.meta.glob('../assets/backgrounds/GIFs/*.{webp,gif,mp4}', { eager: true, query: '?url', import: 'default' }),
  JPGs: import.meta.glob('../assets/backgrounds/JPGs/*.{webp,jpg,jpeg,png,avif}', { eager: true, query: '?url', import: 'default' }),
};
const thumbs = import.meta.glob('../assets/backgrounds/_thumbs/*/*.webp', { eager: true, query: '?url', import: 'default' });
// Small animated previews (GIFs only), played while hovering a gallery card.
const previews = import.meta.glob('../assets/backgrounds/_previews/*/*.webp', { eager: true, query: '?url', import: 'default' });
// Bigger versions of the video wallpapers: _hd/<height>/<folder>/<name>.mp4.
const hd = import.meta.glob('../assets/backgrounds/_hd/*/*/*.mp4', { eager: true, query: '?url', import: 'default' });

// "cyber-city" -> "cyber city"
const prettyName = (stem) => stem.replace(/[_-]+/g, ' ').trim() || stem;

function toPresets(folder) {
  return Object.entries(glob[folder])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, url]) => {
      const stem = path.split('/').pop().replace(/\.[^.]+$/, '');
      const id = `${folder}/${stem}`;
      // MP4 loops (from motionbgs.com) play in a <video>; their gallery hover
      // preview is the video itself (no extra file). Everything else comes
      // from wallpaperaccess.com.
      const video = /\.mp4$/i.test(path);
      // Sizes of a video, smallest first: { h, url } (the base file is <= 1080p).
      const tiers = video
        ? [{ h: 1080, url }, ...Object.entries(hd)
          .map(([p, u]) => [p.match(/_hd\/(\d+)\/([^/]+)\/([^/]+)\.mp4$/), u])
          .filter(([m]) => m && `${m[2]}/${m[3]}` === id)
          .map(([m, u]) => ({ h: Number(m[1]), url: u }))].sort((a, b) => a.h - b.h)
        : null;
      return {
        id,
        name: prettyName(stem),
        url,
        video,
        source: video ? 'motionbgs' : 'wallpaperaccess',
        thumb: thumbs[`${BASE}_thumbs/${id}.webp`] || url,
        preview: previews[`${BASE}_previews/${id}.webp`] || (video ? url : null),
        tiers,
      };
    });
}

// Arrays (not copies) shared with the whole app: the pack's wallpapers are
// added to them in place when it loads.
export const ANIMATED_PRESETS = toPresets('GIFs');
export const STATIC_PRESETS = toPresets('JPGs');
const allPresets = () => [...ANIMATED_PRESETS, ...STATIC_PRESETS];

// --- Wallpaper pack -----------------------------------------------------------
// A pack wallpaper has no bundled `url`: `file` is its path on disk (read into
// a blob URL when shown, like the user's own photos), `pack: true`. Its
// thumbnail / hover preview are small files read into blob URLs here.

let version = 0;
const listeners = new Set();
const notify = () => { version += 1; listeners.forEach((fn) => fn()); };
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
/** Re-renders a component when the pack's wallpapers are added. */
export const useWallpaperPresets = () => useSyncExternalStore(subscribe, () => version);

const fileUrl = async (path) => URL.createObjectURL(new Blob([await readFile(path)]));

// Galleries ("GIFs" / "JPGs") whose pack download was started but not finished.
let incompleteParts = new Set();

// Calls run one after another (they await file reads between "is it there
// yet?" and adding it, so two at once could add the same wallpaper twice).
let packQueue = Promise.resolve();
/** Adds a pack ({ dir, manifest, files, incomplete } from Rust) to the galleries. Returns how many wallpapers it has. */
export function addWallpaperPack(pack) {
  const run = packQueue.then(() => addPackNow(pack));
  packQueue = run.catch(() => {});
  return run;
}

async function addPackNow(pack) {
  if (!pack?.manifest) return 0;
  const { items = [] } = JSON.parse(pack.manifest);
  const inc = new Set(Array.isArray(pack.incomplete) ? pack.incomplete : []);
  let changed = inc.size !== incompleteParts.size || [...inc].some((c) => !incompleteParts.has(c));
  incompleteParts = inc;
  const dir = String(pack.dir).replace(/\/+$/, '');
  // Only what's on disk: a video's 4K version is downloaded on big screens only.
  const present = Array.isArray(pack.files) ? new Set(pack.files) : null;
  const has = (name) => !!name && (!present || present.has(name));
  let added = 0;
  for (const item of items) {
    // Bigger versions (1440p / 4K) of a wallpaper that ships with the app:
    // only its Full HD file is bundled; these come with the pack.
    if (item.builtin) {
      const preset = allPresets().find((p) => p.id === item.id);
      if (!preset?.tiers) continue;
      for (const [h, f] of Object.entries(item.tiers || {})) {
        if (!has(f) || preset.tiers.some((t) => t.h === Number(h))) continue;
        preset.tiers.push({ h: Number(h), file: `${dir}/${f}` });
        added += 1;
      }
      preset.tiers.sort((a, b) => a.h - b.h);
      continue;
    }
    const list = item.folder === 'JPGs' ? STATIC_PRESETS : item.folder === 'GIFs' ? ANIMATED_PRESETS : null;
    if (!list) continue;
    // Already in the gallery (added earlier in this download): only its bigger
    // versions may have arrived since.
    const existing = allPresets().find((p) => p.id === item.id);
    if (existing) {
      if (existing.pack && existing.tiers) {
        for (const [h, f] of Object.entries(item.tiers || {})) {
          if (!has(f) || existing.tiers.some((t) => t.h === Number(h))) continue;
          existing.tiers.push({ h: Number(h), file: `${dir}/${f}` });
          existing.tiers.sort((a, b) => a.h - b.h);
        }
      }
      continue;
    }
    // A card shows once its wallpaper AND its thumbnail are on disk.
    if (!has(item.file) || (item.thumb && !has(item.thumb))) continue;
    const file = `${dir}/${item.file}`;
    const [thumb, preview] = await Promise.all([
      has(item.thumb) ? fileUrl(`${dir}/${item.thumb}`).catch(() => null) : null,
      has(item.preview) ? fileUrl(`${dir}/${item.preview}`).catch(() => null) : null,
    ]);
    list.push({
      id: item.id,
      name: prettyName(item.id.split('/').pop()),
      url: null,
      file,
      pack: true,
      video: !!item.video,
      source: item.video ? 'motionbgs' : 'wallpaperaccess',
      thumb,
      preview,
      // Pack videos have no preview file: the wallpaper itself plays on hover,
      // read from disk only then (SettingsModal HoverPreview).
      previewFile: item.video && !preview ? file : null,
      tiers: item.video
        ? [{ h: 1080, file }, ...Object.entries(item.tiers || {}).filter(([, f]) => has(f)).map(([h, f]) => ({ h: Number(h), file: `${dir}/${f}` }))].sort((a, b) => a.h - b.h)
        : null,
    });
    added += 1;
  }
  if (added) {
    ANIMATED_PRESETS.sort((a, b) => a.id.localeCompare(b.id));
    STATIC_PRESETS.sort((a, b) => a.id.localeCompare(b.id));
  }
  if (added || changed) notify();
  return items.filter((i) => !i.builtin).length;
}

/** Whether a wallpaper pack is downloaded (its wallpapers are in the galleries). */
// category: "GIFs" / "JPGs" — that gallery's part of the pack (any part if omitted).
export const hasWallpaperPack = (category) => allPresets().some((p) => p.pack && (!category || p.id.startsWith(`${category}/`)));
/** That gallery's part of the pack is fully downloaded (not just started / canceled halfway). */
export const wallpaperPackComplete = (category) => hasWallpaperPack(category) && !incompleteParts.has(category);

// While downloading, each finished file adds the wallpapers it completes
// (calls coalesce: one refresh at a time, one more queued at most).
let refreshing = false;
let refreshAgain = false;
const refreshPack = async () => {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      await addWallpaperPack(await invoke('wallpaper_pack_local'));
    } while (refreshAgain);
  } catch (e) {
    console.warn('[wallpaper pack]', e);
  } finally {
    refreshing = false;
  }
};
listen('wallpaper-pack-file', refreshPack).catch(() => {});

// The downloaded pack, loaded once at startup. useSettings waits for it before
// checking the saved wallpaper (a pack wallpaper must be known by then).
export const wallpaperPackReady = invoke('wallpaper_pack_local')
  .then(addWallpaperPack)
  .catch((e) => { console.warn('[wallpaper pack]', e); return 0; });

export const presetValue = (preset) => `${PREFIX}${preset.id}`;
export const isPresetValue = (value) => typeof value === 'string' && value.startsWith(PREFIX);

// Finds the preset a saved value points to. Also understands the values older
// versions saved ("@preset:<asset url>", e.g. "/assets/adventure-AbC123xy.gif"
// or "/src/assets/backgrounds/GIFs/adventure.gif") by matching the file name.
export function findPreset(value) {
  if (!isPresetValue(value)) return null;
  const ref = value.slice(PREFIX.length);
  const ALL = allPresets();
  const byId = ALL.find((p) => p.id === ref);
  if (byId) return byId;
  let file = ref.split(/[?#]/)[0].split('/').pop() || '';
  try { file = decodeURIComponent(file); } catch { /* keep as is */ }
  const stem = file.replace(/\.[^.]+$/, '');
  const exact = ALL.find((p) => p.id.endsWith(`/${stem}`));
  if (exact) return exact;
  // Built file names carry a hash suffix ("adventure-AbC123xy"): longest match wins.
  return ALL
    .filter((p) => stem.startsWith(`${p.id.split('/').pop()}-`))
    .sort((a, b) => b.id.length - a.id.length)[0] || null;
}

// Rewrites a legacy preset value into the stable id form (other values unchanged).
export function normalizePresetValue(value) {
  if (!isPresetValue(value)) return value;
  const preset = findPreset(value);
  return preset ? presetValue(preset) : null;
}
