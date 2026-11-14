// Interactive (React) background engines that are configured by a schema.
// One entry per engine — App.jsx renders it, the Settings gallery shows it
// (with a snapshot thumbnail) and builds its options page from `schema`:
//
//   id:        saved as visuals.activeBackground
//   name:      shown in the gallery (proper name, same in every language)
//   prefix:    saved option keys are `${prefix}${prop}` (e.g. tp_lineCount)
//   defaults:  the look you picked (prop → value)
//   fixed:     props that are always passed (not user options)
//   schema:    the options page, top to bottom:
//     { prop, kind: 'color' }                       one color
//     { props: [...], kind: 'colors' }              several color props
//     { prop, kind: 'palette', size }               one array-of-colors prop
//     { prop, kind: 'slider', min, max, step, unit } unit: '%', '°', '×', 'px' or none
//     { prop, kind: 'segment', values: [...] }
//     { prop, kind: 'toggle' }
//   `label` (optional) picks the shared text in settings.visual.opt.* when it
//   differs from the prop name; segment values use settings.visual.optv.*.
//
// To add a new background: drop its component in components/features (with a
// `paused` prop and data-glass-layer support, a fresh <canvas> per mount) and
// add an entry here.

import Topography from '../features/Topography';
import Ferrofluid from '../features/Ferrofluid';
import Prism from '../features/Prism';
import DarkVeil from '../features/DarkVeil';
import SideRays from '../features/SideRays';
import LightRays from '../features/LightRays';
import Particles from '../features/Particles';
import GridScan from '../features/GridScan';
import Threads from '../features/Threads';

export const ENGINES = [
  {
    id: 'topography', name: 'Topography', component: Topography, prefix: 'tp_',
    defaults: {
      color: '#692992', lineCount: 20, lineWidth: 1.2, elevation: 1, tilt: 32, speed: 0.25, direction: 'forward',
      glow: 0.6, depthOfField: 0.7, fog: 0.35, detail: 0.56, morph: 0.3, mouseInteraction: true, hoverEffect: 'lift', clickEffect: 'pulse',
    },
    fixed: { foreground: 0.2 },
    schema: [
      { prop: 'color', kind: 'color' },
      { prop: 'speed', kind: 'slider', min: 0, max: 1.5, step: 0.05, unit: '×' },
      { prop: 'direction', kind: 'segment', values: ['forward', 'backward', 'left', 'right'] },
      { prop: 'lineCount', label: 'count', kind: 'slider', min: 6, max: 60, step: 1 },
      { prop: 'lineWidth', label: 'thickness', kind: 'slider', min: 0.4, max: 3, step: 0.1 },
      { prop: 'elevation', kind: 'slider', min: 0, max: 3, step: 0.05 },
      { prop: 'tilt', kind: 'slider', min: 12, max: 80, step: 1, unit: '°' },
      { prop: 'detail', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'morph', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'glow', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { prop: 'depthOfField', label: 'dof', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'fog', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'mouseInteraction', label: 'mouse', kind: 'toggle' },
      { prop: 'hoverEffect', label: 'hover', kind: 'segment', values: ['lift', 'trace', 'light'] },
      { prop: 'clickEffect', label: 'click', kind: 'segment', values: ['none', 'pulse', 'peak'] },
    ],
  },
  {
    id: 'ferrofluid', name: 'Ferrofluid', component: Ferrofluid, prefix: 'ff_',
    defaults: {
      colors: ['#c757e7', '#2036d7', '#ffffff'], speed: 0.5, spikeHeight: 1, sharpness: 2.5, tilt: 48, scale: 1.6,
      turbulence: 1, brightness: 1, mouseInteraction: true, clickPulse: true,
    },
    schema: [
      { prop: 'colors', kind: 'palette', size: 3 },
      { prop: 'speed', kind: 'slider', min: 0, max: 2, step: 0.05, unit: '×' },
      { prop: 'spikeHeight', label: 'spikes', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { prop: 'sharpness', kind: 'slider', min: 0.6, max: 6, step: 0.1 },
      { prop: 'tilt', kind: 'slider', min: 10, max: 70, step: 1, unit: '°' },
      { prop: 'scale', kind: 'slider', min: 0.5, max: 4, step: 0.05 },
      { prop: 'turbulence', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { prop: 'brightness', kind: 'slider', min: 0.3, max: 2, step: 0.05 },
      { prop: 'mouseInteraction', label: 'mouse', kind: 'toggle' },
      { prop: 'clickPulse', label: 'click_pulse', kind: 'toggle' },
    ],
  },
  {
    id: 'prism', name: 'Prism', component: Prism, prefix: 'pr_',
    defaults: {
      animationType: 'rotate', timeScale: 0.5, height: 3.5, baseWidth: 5.5, scale: 3.6, hueShift: 0, colorFrequency: 1,
      glow: 1, interactive: true,
    },
    schema: [
      { prop: 'animationType', label: 'animation', kind: 'segment', values: ['rotate', '3drotate', 'hover', 'static'] },
      { prop: 'timeScale', label: 'speed', kind: 'slider', min: 0, max: 2, step: 0.05, unit: '×' },
      { prop: 'hueShift', label: 'hue', kind: 'slider', min: -180, max: 180, step: 1, unit: '°' },
      { prop: 'colorFrequency', label: 'color_freq', kind: 'slider', min: 0, max: 4, step: 0.05 },
      { prop: 'glow', kind: 'slider', min: 0, max: 3, step: 0.05 },
      { prop: 'height', kind: 'slider', min: 1, max: 8, step: 0.1 },
      { prop: 'baseWidth', label: 'width', kind: 'slider', min: 1, max: 10, step: 0.1 },
      { prop: 'scale', kind: 'slider', min: 1, max: 8, step: 0.1 },
      { prop: 'interactive', label: 'mouse', kind: 'toggle' },
    ],
  },
  {
    id: 'darkVeil', name: 'Dark Veil', component: DarkVeil, prefix: 'dv_',
    defaults: { color: '#6b12ff', speed: 0.5, scale: 1, flow: 1, warp: 0, rotation: 0, brightness: 1, glow: 0.4, mouseInteraction: true },
    schema: [
      { prop: 'color', kind: 'color' },
      { prop: 'speed', kind: 'slider', min: 0, max: 2, step: 0.05, unit: '×' },
      { prop: 'scale', kind: 'slider', min: 0.3, max: 3, step: 0.05 },
      { prop: 'flow', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { prop: 'warp', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { prop: 'rotation', kind: 'slider', min: 0, max: 360, step: 1, unit: '°' },
      { prop: 'brightness', kind: 'slider', min: 0.3, max: 2, step: 0.05 },
      { prop: 'glow', kind: 'slider', min: 0, max: 1.5, step: 0.05 },
      { prop: 'mouseInteraction', label: 'mouse', kind: 'toggle' },
    ],
  },
  {
    id: 'sideRays', name: 'Side Rays', component: SideRays, prefix: 'sr_',
    defaults: {
      rayColor1: '#ea36ff', rayColor2: '#96c8ff', origin: 'top-left', speed: 2.5, intensity: 2, spread: 2, tilt: 0,
      saturation: 1.5, blend: 0.75, falloff: 1.6,
    },
    schema: [
      { props: ['rayColor1', 'rayColor2'], kind: 'colors' },
      { prop: 'origin', kind: 'segment', values: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] },
      { prop: 'speed', kind: 'slider', min: 0, max: 6, step: 0.1, unit: '×' },
      { prop: 'intensity', kind: 'slider', min: 0, max: 5, step: 0.05 },
      { prop: 'spread', kind: 'slider', min: 0, max: 5, step: 0.05 },
      { prop: 'tilt', kind: 'slider', min: -45, max: 45, step: 1, unit: '°' },
      { prop: 'saturation', kind: 'slider', min: 0, max: 3, step: 0.05 },
      { prop: 'blend', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'falloff', kind: 'slider', min: 0.5, max: 3, step: 0.05 },
    ],
  },
  {
    id: 'lightRays', name: 'Light Rays', component: LightRays, prefix: 'lr_',
    defaults: {
      raysOrigin: 'top-center', raysColor: '#f7b2ff', raysSpeed: 1, lightSpread: 0.5, rayLength: 3, intensity: 1,
      glow: 0.6, haze: 0.25, followMouse: true, mouseInfluence: 0.1, clickPulse: true,
    },
    schema: [
      { prop: 'raysColor', label: 'color', kind: 'color' },
      { prop: 'raysOrigin', label: 'origin', kind: 'segment', values: ['top-left', 'top-center', 'top-right', 'left', 'right', 'bottom-center'] },
      { prop: 'raysSpeed', label: 'speed', kind: 'slider', min: 0, max: 3, step: 0.05, unit: '×' },
      { prop: 'lightSpread', label: 'spread', kind: 'slider', min: 0.1, max: 2, step: 0.05 },
      { prop: 'rayLength', label: 'length', kind: 'slider', min: 0.5, max: 5, step: 0.1 },
      { prop: 'intensity', kind: 'slider', min: 0.2, max: 2, step: 0.05 },
      { prop: 'glow', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { prop: 'haze', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'followMouse', label: 'mouse', kind: 'toggle' },
      { prop: 'mouseInfluence', label: 'influence', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'clickPulse', label: 'click_pulse', kind: 'toggle' },
    ],
  },
  {
    id: 'particles', name: 'Particles', component: Particles, prefix: 'pa_',
    defaults: {
      particleColors: ['#ba9bff', '#d4e9ff', '#ffffff'], particleCount: 200, particleSpread: 10, speed: 0.1,
      particleBaseSize: 100, glow: 0.5, twinkle: 0.3, shape: 'circle', connections: false, moveParticlesOnHover: true,
      hoverEffect: 'parallax', clickBurst: true,
    },
    schema: [
      { prop: 'particleColors', label: 'colors', kind: 'palette', size: 3 },
      { prop: 'particleCount', label: 'count', kind: 'slider', min: 20, max: 1000, step: 10 },
      { prop: 'particleSpread', label: 'spread', kind: 'slider', min: 2, max: 30, step: 0.5 },
      { prop: 'speed', kind: 'slider', min: 0, max: 1, step: 0.01, unit: '×' },
      { prop: 'particleBaseSize', label: 'size', kind: 'slider', min: 20, max: 300, step: 5 },
      { prop: 'glow', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { prop: 'twinkle', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'shape', kind: 'segment', values: ['circle', 'square', 'ring', 'sparkle'] },
      { prop: 'connections', kind: 'toggle' },
      { prop: 'moveParticlesOnHover', label: 'mouse', kind: 'toggle' },
      { prop: 'hoverEffect', label: 'hover', kind: 'segment', values: ['parallax', 'repel', 'attract'] },
      { prop: 'clickBurst', label: 'click_pulse', kind: 'toggle' },
    ],
  },
  {
    id: 'gridScan', name: 'Grid Scan', component: GridScan, prefix: 'gs_',
    defaults: {
      linesColor: '#4d4757', scanColor: '#aa7dfc', cells: 8, depth: 1.2, autoScan: false, scanDuration: 2.4, scanDelay: 1.6,
      glow: 0.6, parallax: 1, reflection: 0.35, points: true, clickEffect: 'ping', interactive: true,
    },
    schema: [
      { props: ['linesColor', 'scanColor'], kind: 'colors' },
      { prop: 'cells', kind: 'slider', min: 2, max: 20, step: 1 },
      { prop: 'depth', kind: 'slider', min: 0.5, max: 6, step: 0.1 },
      { prop: 'autoScan', label: 'auto_scan', kind: 'toggle' },
      { prop: 'scanDuration', label: 'scan_duration', kind: 'slider', min: 0.5, max: 8, step: 0.1, unit: 's' },
      { prop: 'scanDelay', label: 'scan_delay', kind: 'slider', min: 0, max: 10, step: 0.1, unit: 's' },
      { prop: 'glow', kind: 'slider', min: 0, max: 1.5, step: 0.05 },
      { prop: 'parallax', kind: 'slider', min: 0, max: 3, step: 0.05 },
      { prop: 'reflection', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'points', kind: 'toggle' },
      { prop: 'interactive', label: 'mouse', kind: 'toggle' },
      { prop: 'clickEffect', label: 'click', kind: 'segment', values: ['none', 'ping', 'scan'] },
    ],
  },
  {
    id: 'threads', name: 'Threads', component: Threads, prefix: 'th_',
    defaults: {
      color: '#828cff', lineCount: 90, thickness: 0.6, softness: 1.3, amplitude: 1.7, distance: 0.4, waves: 1.05, speed: 0.6,
      fray: 0.5, angle: 25, taper: 0.85, brightness: 1.4, parting: 0, enableMouseInteraction: true,
    },
    fixed: { split: 0.04, fade: 0, opacity: 1 },
    schema: [
      { prop: 'color', kind: 'color' },
      { prop: 'speed', kind: 'slider', min: 0, max: 2, step: 0.05, unit: '×' },
      { prop: 'lineCount', label: 'count', kind: 'slider', min: 10, max: 200, step: 1 },
      { prop: 'thickness', kind: 'slider', min: 0.1, max: 2, step: 0.05 },
      { prop: 'softness', kind: 'slider', min: 0, max: 3, step: 0.05 },
      { prop: 'amplitude', kind: 'slider', min: 0, max: 4, step: 0.05 },
      { prop: 'distance', kind: 'slider', min: 0, max: 1, step: 0.02 },
      { prop: 'waves', kind: 'slider', min: 0.2, max: 3, step: 0.05 },
      { prop: 'fray', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'angle', kind: 'slider', min: -90, max: 90, step: 1, unit: '°' },
      { prop: 'taper', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'brightness', kind: 'slider', min: 0.25, max: 2, step: 0.05 },
      { prop: 'parting', kind: 'slider', min: 0, max: 1, step: 0.02, unit: '%' },
      { prop: 'enableMouseInteraction', label: 'mouse', kind: 'toggle' },
    ],
  },
];

export const ENGINE_IDS = ENGINES.map((e) => e.id);
export const findEngine = (id) => ENGINES.find((e) => e.id === id) || null;

// Saved value of one option (falls back to the default).
export const engineValue = (engine, visuals, prop) => {
  const saved = visuals?.[engine.prefix + prop];
  return saved === undefined || saved === null ? engine.defaults[prop] : saved;
};

// Every prop for the component, from the saved settings.
export function engineProps(engine, visuals) {
  const props = { ...engine.fixed };
  for (const prop of Object.keys(engine.defaults)) props[prop] = engineValue(engine, visuals, prop);
  return props;
}

