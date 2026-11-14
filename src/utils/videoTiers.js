// Video wallpapers come in up to three sizes (<= 1080p, 1440p, 2160p — made
// by scripts/optimize-wallpapers.mjs for the built-in ones and by Rust
// import_wallpaper for the user's own). The app plays the smallest one that
// still covers the window pixel for pixel: the window's size in real pixels
// (× devicePixelRatio, so a 4K screen at 150 % counts as 4K) and, for the
// user's own video, × its zoom. A 4K screen in full screen gets the 2160p file;
// a normal window doesn't pay for decoding 4K non-stop.

/** tiers: [{ h, url | file }], smallest first. */
export function pickTier(tiers, zoom = 1) {
  if (!tiers?.length) return null;
  const dpr = window.devicePixelRatio || 1;
  // The height a 16:9 video needs to cover the window (a wide window counts by its width).
  const need = Math.max(window.innerHeight, (window.innerWidth * 9) / 16) * dpr * (zoom || 1);
  // 8 % short is still sharp (and avoids switching for a few pixels).
  return tiers.find((t) => t.h >= need * 0.92) || tiers[tiers.length - 1];
}

/** The sizes of the user's own video: "<name>.mp4" (<= 1080p) + "<name>@<h>.mp4". */
export const ownVideoTiers = (path, heights = []) => [
  { h: 1080, file: path },
  ...heights.map((h) => ({ h, file: path.replace(/\.mp4$/i, `@${h}.mp4`) })),
].sort((a, b) => a.h - b.h);
