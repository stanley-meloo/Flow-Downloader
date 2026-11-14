// Live, interactive preview of a background inside Settings (the page that
// configures one background). Renders the real engine with the same props as
// the app's background (utils/backgroundProps.js), so every change shows up
// here instantly — colors, line count, mouse interaction, darken, blur…
//
// Wallpapers (GIF / image / gradient) are drawn like App.jsx does, with the
// blur scaled to the preview's size so it matches what the full window shows.

import { useEffect, useRef, useState } from "react";
import FloatingLines from "./FloatingLines";
import GhostFibers from "./GhostFibers";
import GradientWaves from "./GradientWaves";
import { findEngine, engineProps } from "../backgrounds/engines";
import { floatingLinesProps, ghostFibersProps, gradientWavesProps } from "../../utils/backgroundProps";
import { findPreset } from "../../utils/backgrounds";
import { streamSrc } from "../../utils/mediaSrc";

export default function BackgroundPreview({ kind, visuals, className = "" }) {
  const ref = useRef(null);
  const [scale, setScale] = useState(0.5); // preview width / window width
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / (window.innerWidth || 1));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const preset = kind === "static" ? findPreset(visuals.bgImage) : null;
  // A pack wallpaper has no bundled URL: its file is streamed (utils/mediaSrc.js).
  const img = preset?.url || (preset?.file ? streamSrc(preset.file) : null);
  const isVideo = !!preset?.video; // MP4 wallpaper: a <video>, not an <img>

  return (
    <div ref={ref} className={`relative isolate overflow-hidden bg-[#09090b] ${className}`}>
      {kind === "floatingLines" && <FloatingLines {...floatingLinesProps(visuals)} />}
      {kind === "ghostFibers" && <GhostFibers {...ghostFibersProps(visuals)} />}
      {kind === "gradientWaves" && <GradientWaves {...gradientWavesProps(visuals)} />}
      {(() => {
        const engine = findEngine(kind);
        if (!engine) return null;
        const Engine = engine.component;
        return <Engine {...engineProps(engine, visuals)} />;
      })()}
      {kind === "static" && (
        <div className="absolute inset-0" style={{ backgroundColor: visuals.staticColor }}>
          {img && (isVideo ? (
            <video
              key={img}
              src={img}
              autoPlay
              muted
              loop
              playsInline
              disablePictureInPicture
              crossOrigin="anonymous"
              className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-300"
              style={{ filter: `blur(${(visuals.imageBlur || 0) * scale}px)`, transform: visuals.imageBlur ? "scale(1.04)" : undefined }}
            />
          ) : (
            <img
              src={img}
              alt=""
              className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-300"
              style={{ filter: `blur(${(visuals.imageBlur || 0) * scale}px)`, transform: visuals.imageBlur ? "scale(1.04)" : undefined }}
            />
          ))}
          <div className="absolute inset-0 pointer-events-none transition-opacity duration-300" style={{ backgroundColor: "black", opacity: visuals.imageDarken || 0 }} />
          <div
            className="absolute inset-0 pointer-events-none transition-opacity duration-500"
            style={{
              opacity: visuals.staticGradientEnabled ? 0.8 : 0,
              background: `linear-gradient(to bottom, ${visuals.staticGradientColor || "#000000"} 0%, transparent 60%)`,
            }}
          />
        </div>
      )}
    </div>
  );
}
