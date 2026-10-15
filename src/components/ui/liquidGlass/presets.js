// Material presets — values from LiquidGlass OSS (liquid-glass-web/src/core/types.ts),
// MIT License, Copyright (c) 2026 Liquid Glass OSS contributors. See LICENSE.md.

const liquidGlassPresets = {
  clear: {
    blur: 1, refraction: 1.2, chromaticAberration: 0.012, distortion: 0, edgeHighlight: 0,
    specular: 0.04, fresnel: 0.56, radius: 18, depth: 14, brightness: 0.02, saturation: 0,
    shadow: 0, darkTint: 0, tintStrength: 0.38, tintColor: [0.92, 0.95, 1.05], tint: 0,
    opacity: 0.88, bevel: 1, lensWidth: 56, lensHeight: 32,
  },
  frosted: {
    blur: 0.52, refraction: 0.58, chromaticAberration: 0.035, distortion: 0.025, edgeHighlight: 0.11,
    specular: 0.08, fresnel: 0.95, radius: 22, depth: 36, brightness: 0.04, saturation: -0.08,
    shadow: 0, darkTint: 0.09, tintStrength: 0.12, tintColor: [0.92, 0.95, 1.05], tint: 0,
    opacity: 1, bevel: 0, lensWidth: 54, lensHeight: 34,
  },
  dark: {
    blur: 0.18, refraction: 0.72, chromaticAberration: 0.045, distortion: 0.015, edgeHighlight: 0.08,
    specular: 0.14, fresnel: 1.08, radius: 22, depth: 42, brightness: -0.03, saturation: 0.03,
    shadow: 0, darkTint: 0.28, tintStrength: 0.06, tintColor: [0.92, 0.95, 1.05], tint: 0,
    opacity: 1, bevel: 0, lensWidth: 54, lensHeight: 34,
  },
  prism: {
    blur: 0.06, refraction: 0.82, chromaticAberration: 0.18, distortion: 0.035, edgeHighlight: 0.13,
    specular: 0.08, fresnel: 1.18, radius: 22, depth: 48, brightness: 0.02, saturation: 0.1,
    shadow: 0, darkTint: 0.12, tintStrength: 0.14, tintColor: [0.92, 0.95, 1.05], tint: 0,
    opacity: 1, bevel: 0, lensWidth: 58, lensHeight: 36,
  },
  dome: {
    blur: 0.08, refraction: 0.74, chromaticAberration: 0.06, distortion: 0.01, edgeHighlight: 0.12,
    specular: 0.16, fresnel: 1.05, radius: 22, depth: 56, brightness: 0.02, saturation: 0.02,
    shadow: 0, darkTint: 0.11, tintStrength: 0.1, tintColor: [0.92, 0.95, 1.05], tint: 0,
    opacity: 1, bevel: 1, lensWidth: 56, lensHeight: 38,
  },
};

// Flow Downloader: material shared by every dialog (Settings, video, playlist, setup).
// The glass core is partly see-through (coreOpacity < 1), like the search bar:
// what's really behind the dialog — the title, the search bar, the queue —
// shows through, blurred by the dialog's own CSS backdrop blur (backdrop-blur-md
// on the dialog box). The rim stays fully refractive. Darker than the search bar
// so text stays readable; a thinner rim (depth) suits large panels; preBlur is
// a strong gaussian blur of the background before the glass (snapshot px ≈ 2× on screen).
export const DIALOG_GLASS = { blur: 1, preBlur: 14, darkTint: 0.5, edgeHighlight: 0.12, depth: 26, coreOpacity: 0.6 };

export function resolveLiquidGlassSettings(variant = "frosted", overrides) {
  return { ...(liquidGlassPresets[variant] || liquidGlassPresets.frosted), ...overrides };
}
