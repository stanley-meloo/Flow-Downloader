// Gaussian-ish blur for 2D canvas drawing that works on every webview.
//
// Chromium (Windows / WebView2) supports `ctx.filter = "blur(Npx)"`. Safari's
// WKWebView (macOS) may expose the property without applying it, so support
// is detected by actually drawing; without it, a cheap fallback is used:
// shrink the image a lot and scale it back up with smoothing.

let realFilter = null;

function supportsRealFilter() {
  if (realFilter !== null) return realFilter;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 12;
    const ctx = c.getContext("2d");
    const dot = document.createElement("canvas");
    dot.width = dot.height = 2;
    const dctx = dot.getContext("2d");
    dctx.fillStyle = "#fff";
    dctx.fillRect(0, 0, 2, 2);
    ctx.filter = "blur(2px)";
    ctx.drawImage(dot, 5, 5);
    // A real blur spreads the white dot to pixels around it.
    realFilter = ctx.getImageData(2, 6, 1, 1).data[3] > 0;
  } catch (e) {
    realFilter = false;
  }
  return realFilter;
}

let scratch = null;

/**
 * Draws `source` (sx, sy, sw, sh) into ctx at (dx, dy, dw, dh), blurred by
 * `radius` CSS-like pixels (in destination pixels). radius <= 0 draws normally.
 */
export function drawBlurred(ctx, source, sx, sy, sw, sh, dx, dy, dw, dh, radius) {
  if (!(radius > 0)) {
    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
    return;
  }
  if (supportsRealFilter()) {
    const previous = ctx.filter;
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.filter = previous;
    return;
  }
  // Fallback: downscale by ~radius, then upscale with smoothing.
  const factor = Math.max(2, radius);
  const w = Math.max(1, Math.round(dw / factor));
  const h = Math.max(1, Math.round(dh / factor));
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const sctx = scratch.getContext("2d");
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.clearRect(0, 0, w, h);
  sctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(scratch, 0, 0, w, h, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = smoothing;
}
