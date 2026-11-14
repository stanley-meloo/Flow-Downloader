// Framing editor for the user's own wallpapers (photos and videos) (Settings → Appearance →
// Custom → a photo's page; `bare` = just the frame, used as that page's
// preview). A frame with the window's proportions shows exactly what
// the background will show (same math as the app: utils/coverBox.js):
//   - drag the photo to choose which part fills the screen;
//   - mouse wheel (or the Zoom slider in Settings) to zoom in;
//   - the blur / darken filters are previewed too.
// Changes are sent while dragging (once per frame), so the real background
// behind the dialog follows live.

import { useEffect, useRef, useState } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import { useTranslation } from "react-i18next";
import { coverBox } from "../../utils/coverBox";
import { isVideoPath, mediaBlob } from "../../utils/customPhotos";
import { streamSrc, isStreamSrc, canStream, markStreamFailed } from "../../utils/mediaSrc";

export default function PhotoPositioner({ path, x = 50, y = 50, zoom = 1, blur = 0, darken = 0, onChange, bare = false }) {
  const { t } = useTranslation();
  const frameRef = useRef(null);
  const [src, setSrc] = useState(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(() => window.innerWidth / Math.max(1, window.innerHeight));
  const [dragging, setDragging] = useState(false);
  // Local framing while interacting (smooth), sent out once per frame.
  const [local, setLocal] = useState({ x, y, zoom });
  useEffect(() => { if (!dragging) setLocal({ x, y, zoom }); }, [x, y, zoom, dragging]);
  const pending = useRef(null);
  const raf = useRef(0);
  const send = (next) => {
    setLocal(next);
    pending.current = next;
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; onChange?.(pending.current); });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // The photo / video file → a URL: a video is streamed (utils/mediaSrc.js),
  // a photo (or a video where streaming doesn't work) becomes a blob URL.
  const [streamRetry, setStreamRetry] = useState(0);
  useEffect(() => {
    let url = null, cancelled = false;
    setSrc(null);
    if (!path) return undefined;
    if (isVideoPath(path) && canStream()) {
      setSrc(streamSrc(path));
      return undefined;
    }
    readFile(path).then((bytes) => {
      if (cancelled) return;
      url = URL.createObjectURL(mediaBlob(bytes, path));
      setSrc(url);
    }).catch((e) => console.error("[photo framing]", e));
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [path, streamRetry]);

  // Frame size + the window's proportions.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    const onResize = () => setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", onResize);
    return () => { ro.disconnect(); window.removeEventListener("resize", onResize); };
  }, []);

  const img = coverBox(nat.w, nat.h, box.w, box.h, local.x, local.y, local.zoom);

  // Drag: moving the photo by N px changes the position by N / (room to move).
  const drag = useRef(null);
  const onPointerDown = (e) => {
    if (e.button !== 0 || !src) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: local.x, y: local.y };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const roomX = img.width - box.w;
    const roomY = img.height - box.h;
    const nx = roomX > 0.5 ? d.x - ((e.clientX - d.px) / roomX) * 100 : 50;
    const ny = roomY > 0.5 ? d.y - ((e.clientY - d.py) / roomY) * 100 : 50;
    send({ ...local, x: Math.min(100, Math.max(0, nx)), y: Math.min(100, Math.max(0, ny)) });
  };
  const onPointerUp = () => { drag.current = null; setDragging(false); };

  // Wheel: zoom (1× – 3×).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't scroll the Settings page
      setLocal((cur) => {
        const next = { ...cur, zoom: Math.min(3, Math.max(1, +(cur.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)).toFixed(3))) };
        pending.current = next;
        if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; onChange?.(pending.current); });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onChange]);

  return (
    <div className={bare ? "" : "space-y-2"}>
      <div
        ref={frameRef}
        data-lenis-prevent
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative w-full overflow-hidden bg-zinc-950 select-none touch-none ${bare ? "" : "rounded-2xl border border-white/10"} ${src ? (dragging ? "cursor-grabbing" : "cursor-grab") : ""}`}
        style={{ aspectRatio: aspect }}
      >
        {src && (() => {
          const style = {
            left: img.left, top: img.top, width: img.width, height: img.height,
            filter: blur ? `blur(${(blur * box.w) / Math.max(1, window.innerWidth)}px)` : undefined,
          };
          const className = "absolute max-w-none pointer-events-none";
          return isVideoPath(path) ? (
            <video
              src={src}
              autoPlay
              muted
              loop
              playsInline
              disablePictureInPicture
              crossOrigin="anonymous"
              onError={(e) => { if (isStreamSrc(e.currentTarget.currentSrc || e.currentTarget.src)) { markStreamFailed(); setStreamRetry((n) => n + 1); } }}
              onLoadedMetadata={(e) => setNat({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
              className={className}
              style={style}
            />
          ) : (
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className={className}
              style={style}
            />
          );
        })()}
        <div className="absolute inset-0 pointer-events-none bg-black" style={{ opacity: darken || 0 }} />
        {/* Thirds grid (always shown, a bit brighter while dragging) to help framing */}
        <div className={`absolute inset-0 pointer-events-none transition-opacity duration-200 ${dragging ? "opacity-100" : "opacity-70"}`}>
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
        </div>
      </div>
      {!bare && (
        <p className="text-[12px] text-zinc-300 px-1">
          {t("settings.visual.position_hint", { defaultValue: "Drag to position · scroll to zoom" })}
        </p>
      )}
    </div>
  );
}
