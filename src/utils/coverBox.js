// Where a custom background photo goes on screen: like CSS `object-fit: cover`,
// plus the user's framing — which part of the photo is shown (x / y, 0–100 %:
// 0 = left/top edge, 50 = centered) and how much it's zoomed in (≥ 1).
// Returns the image box { left, top, width, height } in px inside a box of
// boxW × boxH. Used by the app background and by the positioning editor
// (Settings → Appearance → Custom → Photo), so both show the exact same crop.
export const DEFAULT_FRAMING = { x: 50, y: 50, zoom: 1 };

export function coverBox(natW, natH, boxW, boxH, x = 50, y = 50, zoom = 1) {
  if (!natW || !natH || !boxW || !boxH) return { left: 0, top: 0, width: boxW, height: boxH };
  const scale = Math.max(boxW / natW, boxH / natH) * Math.max(1, zoom);
  const width = natW * scale;
  const height = natH * scale;
  return {
    left: ((boxW - width) * clamp(x)) / 100,
    top: ((boxH - height) * clamp(y)) / 100,
    width,
    height,
  };
}

const clamp = (v) => Math.min(100, Math.max(0, Number(v) || 0));
