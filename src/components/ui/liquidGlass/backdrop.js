// Live snapshot of the app background, used as the "scene" that the liquid
// glass refracts.
//
// The original library refracts one fixed image. Flow's background can be a
// WebGL animation, a (possibly animated) wallpaper with blur / darkening /
// gradient, or a plain color — so instead we re-compose those layers into a
// small offscreen canvas, in paint order. App.jsx marks them with attributes:
//
//   [data-glass-backdrop]            the full-screen background container
//   data-glass-layer="fill"          solid background-color (with opacity)
//   data-glass-layer="canvas"        a container holding a WebGL <canvas>
//   data-glass-layer="image"         an <img> drawn like object-fit: cover
//   data-glass-layer="gradient"      top → transparent vignette (data-glass-color)
//   data-glass-static="true"         nothing animates right now (refresh slowly)
//
// The snapshot is taken at half resolution: the glass blurs it anyway.

import { drawBlurred } from "./canvasBlur";

const SCALE = 0.5;
// Every frame while things move (8 ms only de-duplicates several glass
// surfaces asking in the same frame), so the refracted copy never lags.
const ANIMATED_INTERVAL = 8;
const STATIC_INTERVAL = 400;         // ms between snapshots otherwise

let shared = null;

// --- Animated wallpapers ------------------------------------------------------
// Canvas drawImage() of an animated GIF / WebP always paints its FIRST frame
// (browser behavior), which froze the image inside the glass. So animated
// images are decoded frame by frame with WebCodecs' ImageDecoder and the
// current frame is drawn instead. Where ImageDecoder isn't available, the
// first frame is used (the see-through core still shows the live image).

const players = new Map(); // src -> player

function sniffType(bytes) {
  const s = String.fromCharCode(...bytes.slice(0, 12));
  if (s.startsWith("GIF8")) return "image/gif";
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return "image/webp";
  if (bytes[0] === 0x89 && s.slice(1, 4) === "PNG") return "image/png"; // APNG
  return "";
}

function createPlayer(src) {
  const player = { frame: null, ready: false, decoding: false, nextAt: 0, index: 0, count: Infinity, decoder: null, closed: false };
  if (typeof ImageDecoder === "undefined") return player;
  (async () => {
    try {
      const res = await fetch(src);
      const data = await res.arrayBuffer();
      const type = sniffType(new Uint8Array(data)) || res.headers.get("content-type") || "";
      if (!type || !(await ImageDecoder.isTypeSupported(type))) return;
      const decoder = new ImageDecoder({ data, type });
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      if (player.closed || !track || !track.animated) { decoder.close(); return; } // still image: <img> is fine
      player.decoder = decoder;
      decoder.completed.then(() => { player.count = track.frameCount; }).catch(() => {});
      await stepPlayer(player);
      player.ready = !player.closed;
    } catch (e) {
      // Not decodable here: keep drawing the <img> (first frame).
    }
  })();
  return player;
}

// Decodes the next frame and schedules the one after it (GIF timing rules:
// a delay under 20 ms is played as 100 ms, like browsers do).
async function stepPlayer(player) {
  if (player.closed || !player.decoder) return;
  player.decoding = true;
  try {
    let result;
    try {
      result = await player.decoder.decode({ frameIndex: player.index });
    } catch (e) {
      if (player.index === 0) throw e;
      player.index = 0; // ran past the last frame: loop
      result = await player.decoder.decode({ frameIndex: 0 });
    }
    if (player.closed) { result.image.close(); return; }
    const previous = player.frame;
    player.frame = result.image;
    previous?.close();
    const ms = (result.image.duration ?? 0) / 1000;
    player.nextAt = performance.now() + (ms < 20 ? 100 : ms);
    player.index = player.index + 1 >= player.count ? 0 : player.index + 1;
  } finally {
    player.decoding = false;
  }
}

// The frame to draw for this <img> (a VideoFrame), or null to draw the <img>.
function currentFrame(img) {
  const src = img.currentSrc || img.src;
  if (!src) return null;
  let player = players.get(src);
  if (!player) {
    player = createPlayer(src);
    players.set(src, player);
  }
  if (player.ready && !player.decoding && performance.now() >= player.nextAt) {
    stepPlayer(player).catch(() => {});
  }
  return player.ready ? player.frame : null;
}

// Frees decoders of wallpapers that are no longer on screen.
function releasePlayers(activeSrcs) {
  for (const [src, player] of players) {
    if (activeSrcs.has(src)) continue;
    player.closed = true;
    player.frame?.close();
    player.decoder?.close();
    players.delete(src);
  }
}

function effectiveOpacity(el, root) {
  let opacity = 1;
  for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
    const o = parseFloat(getComputedStyle(n).opacity);
    if (!Number.isNaN(o)) opacity *= o;
    if (opacity <= 0.001) return 0;
  }
  return opacity;
}

function isTransparent(color) {
  return !color || color === "transparent" || /rgba?\([^)]*,\s*0\s*\)$/.test(color);
}

function createBackdrop() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let lastCapture = 0;
  let version = 0; // bumped on every new snapshot

  const root = () => document.querySelector("[data-glass-backdrop]");

  const rect = () => {
    const r = root()?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) return r;
    return { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
  };

  // Draws `el`'s box (in viewport coordinates) mapped into the snapshot.
  const box = (el, base) => {
    const r = el.getBoundingClientRect();
    return {
      x: (r.left - base.left) * SCALE,
      y: (r.top - base.top) * SCALE,
      w: r.width * SCALE,
      h: r.height * SCALE,
    };
  };

  let activeSrcs = new Set(); // wallpapers drawn in the current snapshot

  const drawLayer = (el, rootEl, base) => {
    const type = el.getAttribute("data-glass-layer");
    const alpha = effectiveOpacity(el, rootEl);
    if (alpha <= 0) return;
    const style = getComputedStyle(el);
    const b = box(el, base);
    ctx.save();
    ctx.globalAlpha = alpha;

    if (type === "fill") {
      if (!isTransparent(style.backgroundColor)) {
        ctx.fillStyle = style.backgroundColor;
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
    } else if (type === "canvas") {
      const source = el.querySelector("canvas");
      if (source && source.width > 0 && source.height > 0) {
        // The blend mode may be set on the container or on the canvas itself.
        if (style.mixBlendMode === "screen" || getComputedStyle(source).mixBlendMode === "screen") {
          ctx.globalCompositeOperation = "screen";
        }
        ctx.drawImage(source, b.x, b.y, b.w, b.h);
      }
    } else if (type === "image") {
      const img = el;
      if (img.complete && img.naturalWidth > 0) {
        activeSrcs.add(img.currentSrc || img.src);
        // Animated GIF/WebP: the live frame; otherwise the image itself.
        const frame = currentFrame(img);
        const source = frame || img;
        const nw = frame ? frame.displayWidth : img.naturalWidth;
        const nh = frame ? frame.displayHeight : img.naturalHeight;
        // object-fit: cover
        const ir = nw / nh;
        const br = b.w / b.h;
        let sw = nw, sh = nh, sx = 0, sy = 0;
        if (ir > br) { sw = sh * br; sx = (nw - sw) / 2; }
        else { sh = sw / br; sy = (nh - sh) / 2; }
        const blur = parseFloat((style.filter.match(/blur\(([\d.]+)px\)/) || [])[1] || "0");
        drawBlurred(ctx, source, sx, sy, sw, sh, b.x, b.y, b.w, b.h, blur * SCALE);
      }
    } else if (type === "gradient") {
      const color = el.getAttribute("data-glass-color") || "#000000";
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h * 0.6);
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y, b.w, b.h * 0.6);
    }
    ctx.restore();
  };

  // Re-composes the snapshot when due. Returns the snapshot version, so each
  // glass surface knows when to re-upload it.
  const capture = () => {
    if (!ctx) return version;
    const rootEl = root();
    const now = performance.now();
    const isStatic = rootEl?.getAttribute("data-glass-static") === "true";
    const interval = isStatic ? STATIC_INTERVAL : ANIMATED_INTERVAL;
    if (lastCapture && now - lastCapture < interval) return version;
    lastCapture = now;

    const base = rect();
    const w = Math.max(2, Math.round(base.width * SCALE));
    const h = Math.max(2, Math.round(base.height * SCALE));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, w, h);
    activeSrcs = new Set();
    if (rootEl) {
      try {
        if (rootEl.hasAttribute("data-glass-layer")) drawLayer(rootEl, rootEl, base);
        rootEl.querySelectorAll("[data-glass-layer]").forEach((el) => drawLayer(el, rootEl, base));
      } catch (e) {
        // A layer that can't be read (e.g. tainted image) just isn't drawn.
      }
    }
    releasePlayers(activeSrcs);
    return ++version;
  };

  return { canvas, rect, capture };
}

// One snapshot shared by every glass surface on screen.
export function getBackdrop() {
  if (!shared) shared = createBackdrop();
  return shared;
}
