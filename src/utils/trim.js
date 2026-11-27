// Trim (download only part of a video): time formatting / parsing and the
// storyboard tile lookup, shared by the trim view and the downloader.

const pad = (n) => String(n).padStart(2, "0");

// "1h02m03s" / "2m05s" / "45s" — compact, safe in file names.
export function shortTime(t) {
  const s = Math.max(0, Math.round(t));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h${pad(m)}m${pad(sec)}s` : m ? `${m}m${pad(sec)}s` : `${sec}s`;
}

// File-name suffix of a manual range: "1m20s-2m05s".
export const rangeLabel = (a, b) => `${shortTime(a)}-${shortTime(b)}`;

// Clock shown in the UI: "1:05:09" / "3:07" (+ tenths when asked: "3:07.4").
export function formatClock(t, tenths = false) {
  const v = Math.max(0, Number(t) || 0);
  const whole = tenths ? Math.floor(v) : Math.round(v);
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  const base = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (!tenths) return base;
  const d = Math.floor((v - whole) * 10 + 1e-6);
  return d ? `${base}.${d}` : base;
}


// Storyboard tile shown for time t: { url, x, y } in tile units (column/row of
// the sprite sheet), or null.
export function tileAt(board, t) {
  if (!board?.sheets?.length) return null;
  const time = Math.max(0, Math.min(t, (board.duration || t) - 0.001));
  let sheet = board.sheets[board.sheets.length - 1];
  for (const s of board.sheets) {
    if (time < s.start + s.duration) { sheet = s; break; }
  }
  const perSheet = board.rows * board.cols;
  const tiles = Math.max(1, Math.min(perSheet, Math.ceil(sheet.duration / board.perTile - 1e-6)));
  const local = Math.max(0, Math.min(tiles - 1, Math.floor((time - sheet.start) / board.perTile)));
  return { url: sheet.url, x: local % board.cols, y: Math.floor(local / board.cols) };
}

// CSS background for a storyboard tile drawn `h` px tall.
export function tileStyle(board, tile, h) {
  if (!tile) return null;
  const k = h / board.height;
  const w = board.width * k;
  return {
    backgroundImage: `url("${tile.url}")`,
    backgroundSize: `${board.cols * w}px ${board.rows * h}px`,
    backgroundPosition: `${-tile.x * w}px ${-tile.y * h}px`,
    backgroundRepeat: "no-repeat",
  };
}
