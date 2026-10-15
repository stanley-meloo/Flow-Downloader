// Small persistent "recent" data for the right-click menu (localStorage — it
// survives restarts; every access is guarded because storage can throw).
//   - search history: the last links that were analyzed successfully
//   - last download folder: the folder the user last downloaded into

const HISTORY_KEY = "flow.searchHistory";
const FOLDER_KEY = "flow.lastDownloadFolder";
const MAX_HISTORY = 8;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full / unavailable: not important */
  }
}

// [{ url, title, at }], newest first, no duplicates.
export function getSearchHistory() {
  const list = read(HISTORY_KEY, []);
  return Array.isArray(list) ? list.filter((e) => e && typeof e.url === "string") : [];
}
export function addSearchHistory(url, title) {
  if (!url) return;
  const list = getSearchHistory().filter((e) => e.url !== url);
  list.unshift({ url, title: title || url, at: Date.now() });
  write(HISTORY_KEY, list.slice(0, MAX_HISTORY));
}
export function getLastDownloadFolder() {
  const v = read(FOLDER_KEY, null);
  return typeof v === "string" && v ? v : null;
}
export function setLastDownloadFolder(dir) {
  if (dir) write(FOLDER_KEY, dir);
}
