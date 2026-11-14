// Props of the interactive backgrounds built from the saved visual settings.
// Shared by the real background (App.jsx) and the live preview in Settings,
// so both always look the same.

const FALLBACK = ['#4f46e5', '#ec4899', '#06b6d4', '#14b8a6'];

export function floatingLinesProps(v = {}) {
  const n = v.lineCount || 6;
  const d = v.lineDistance || 5;
  return {
    linesGradient: v.showColors ? [1, 2, 3, 4].map((i) => v[`lineColor${i}`] || FALLBACK[i - 1]) : null,
    lineCount: [n, n, n],
    lineDistance: [d, d, d],
    bendRadius: v.bendRadius || 5.0,
  };
}


// Ghost Fibers (React Bits). Saved keys: gf_color, gf_layers, gf_twist,
// gf_threads, gf_style, gf_dof, gf_speed, gf_glow, gf_particles, gf_hover,
// gf_mouse, gf_pulse.
const GF_DEFAULTS = {
  glowColor: '#8b5cf6', layers: 3, twist: 1.2, threads: 72, fiberStyle: 'dots', depthOfField: 0.85,
  speed: 0.5, glow: 0.8, particles: 0.5, hoverEffect: 'focus', mouseInteraction: true, pulseOnClick: true,
};
export function ghostFibersProps(v = {}) {
  const d = GF_DEFAULTS;
  return {
    glowColor: v.gf_color || d.glowColor,
    layers: v.gf_layers ?? d.layers,
    twist: v.gf_twist ?? d.twist,
    threads: v.gf_threads ?? d.threads,
    fiberStyle: v.gf_style || d.fiberStyle,
    depthOfField: v.gf_dof ?? d.depthOfField,
    speed: v.gf_speed ?? d.speed,
    glow: v.gf_glow ?? d.glow,
    particles: v.gf_particles ?? d.particles,
    hoverEffect: v.gf_hover || d.hoverEffect,
    mouseInteraction: v.gf_mouse !== false,
    pulseOnClick: v.gf_pulse !== false,
    intro: true,
  };
}

// Gradient Waves (React Bits). Saved keys: gw_horizon, gw_wave, gw_crest,
// gw_speed, gw_amplitude, gw_scale, gw_height, gw_relief, gw_light, gw_sheen,
// gw_quality, gw_mouse, gw_swell. No grain of its own (the app's Film grain
// covers the whole window).
const GW_DEFAULTS = {
  horizonColor: '#5227FF', waveColor: '#FF9FFC', crestColor: '#FFFFFF', speed: 0.4, amplitude: 2.5,
  waveScale: 0.88, height: 5, relief: 1, lightAngle: 120, sheen: 0.24, quality: 'high',
  mouseInteraction: true, swellOnClick: true,
};
export function gradientWavesProps(v = {}) {
  const d = GW_DEFAULTS;
  return {
    horizonColor: v.gw_horizon || d.horizonColor,
    waveColor: v.gw_wave || d.waveColor,
    crestColor: v.gw_crest || d.crestColor,
    speed: v.gw_speed ?? d.speed,
    amplitude: v.gw_amplitude ?? d.amplitude,
    waveScale: v.gw_scale ?? d.waveScale,
    height: v.gw_height ?? d.height,
    relief: v.gw_relief ?? d.relief,
    lightAngle: v.gw_light ?? d.lightAngle,
    sheen: v.gw_sheen ?? d.sheen,
    grain: 0,
    quality: v.gw_quality || d.quality,
    mouseInteraction: v.gw_mouse !== false,
    swellOnClick: v.gw_swell !== false,
  };
}
