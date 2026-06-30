// Auto-loads the wallpapers from the assets/backgrounds subfolders at build time
// using Vite's import.meta.glob (eager, resolved to asset URLs).
//   GIFs/ -> animated   |   JPGs/ -> static   |   by Nipp/ -> guest artist
// Just drop files into a folder; the gallery (and each name) is built automatically.

const gifModules = import.meta.glob(
  '../assets/backgrounds/GIFs/*.{gif,webp}',
  { eager: true, query: '?url', import: 'default' }
);
const stillModules = import.meta.glob(
  '../assets/backgrounds/JPGs/*.{jpg,jpeg,png,webp,avif}',
  { eager: true, query: '?url', import: 'default' }
);
// Guest artist artwork (Nipp) -> the "by Nipp" folder. Accepts both stills and GIFs.
const nippModules = import.meta.glob(
  '../assets/backgrounds/by Nipp/*.{jpg,jpeg,png,webp,avif,gif}',
  { eager: true, query: '?url', import: 'default' }
);

// Turns a filename into a readable display name ("cyber-city.gif" -> "cyber city").
function prettyName(path) {
  const file = (path.split('/').pop() || '').replace(/\.[^.]+$/, '');
  return file.replace(/[_-]+/g, ' ').trim() || file;
}

// Maps a glob result ({ path: url }) into a sorted preset list. `id` is the file
// path (used as a stable React key and to detect GIFs by extension).
function toPresets(modules) {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, url]) => ({ id: path, name: prettyName(path), url }));
}

export const ANIMATED_PRESETS = toPresets(gifModules);
export const STATIC_PRESETS = toPresets(stillModules);
export const NIPP_PRESETS = toPresets(nippModules);
