// Liquid glass WebGL renderer — adapted from LiquidGlass OSS
// (https://gitlab.com/ogtirth/liquidglass-oss, liquid-glass-web/src/core/LiquidGlassRenderer.ts),
// MIT License, Copyright (c) 2026 Liquid Glass OSS contributors. See LICENSE.md.
//
// Changes for Flow Downloader:
// - The refracted "background" is not a fixed image URL but a live canvas
//   snapshot of the app's backdrop (see backdrop.js), re-uploaded each frame.
// - The render loop pauses while the window is hidden.
// - Slider "track" and button-morph features of the original are left at
//   their neutral values (only the glass surface is used here).

import { fragmentShader, vertexShader } from "./shaders";
import { drawBlurred } from "./canvasBlur";

const UNIFORMS = [
  "u_bg", "u_res", "u_center", "u_size", "u_bgScale", "u_bgOffset", "u_blurAmount", "u_radius",
  "u_zRadius", "u_refract", "u_chroma", "u_edgeHL", "u_specular", "u_fresnel", "u_brightness",
  "u_saturation", "u_shadowAlpha", "u_shadowSpread", "u_darkTint", "u_bevelMode", "u_button", "u_pressed",
  "u_trackStart", "u_trackEnd", "u_trackY", "u_valueX", "u_distortion", "u_tintStrength", "u_opacity",
  "u_sampleBackground", "u_materialMorph", "u_tint",
  "u_tintColor", "u_trackBaseColor", "u_trackFillColor", "u_trackRadius",
  "u_coreOpacity",
];

// One WebGL context with the glass program + the backdrop texture.
// Browsers allow only ~16 WebGL contexts per page, so surfaces that can exist
// in large numbers (the download queue items) all share ONE context ("shared"
// mode): each draws there and copies the result into its own 2D canvas.
class GlassGL {
  constructor(canvas, preserve = false) {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: preserve });
    if (!gl) throw new Error("Liquid Glass requires WebGL.");
    this.canvas = canvas;
    this.gl = gl;
    this.textureKey = null; // which backdrop snapshot / blur is in the texture

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader)?.trim() || "Liquid Glass shader compilation failed.");
      }
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Shader link failed.");
    gl.useProgram(program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    UNIFORMS.forEach((name) => { this.u[name] = gl.getUniformLocation(program, name); });

    this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.u_bg, 0);
  }

  // `getSource` is only called when the texture really has to change.
  upload(getSource, key) {
    if (this.textureKey === key) return;
    const source = getSource();
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.textureKey = key;
  }

  // Shared mode: the drawing area only grows (no reallocation every draw).
  ensureSize(width, height) {
    if (this.canvas.width < width) this.canvas.width = width;
    if (this.canvas.height < height) this.canvas.height = height;
  }
}

let sharedGL = null;
function getSharedGL() {
  if (!sharedGL) sharedGL = new GlassGL(document.createElement("canvas"), true);
  return sharedGL;
}

export class LiquidGlassRenderer {
  /**
   * @param {HTMLCanvasElement} canvas  where the glass is drawn
   * @param {object} settings           material (see presets.js)
   * @param {{ canvas: HTMLCanvasElement, rect: () => DOMRect, capture: () => number }} backdrop
   */
  constructor(canvas, settings, backdrop, { shared = false } = {}) {
    this.canvas = canvas;
    this.shared = shared;
    if (shared) {
      this.gpu = getSharedGL();
      this.out = canvas.getContext("2d");
      if (!this.out) throw new Error("Canvas 2D unavailable.");
    } else {
      // preserveDrawingBuffer: the glass is only redrawn when something changed.
      // Without it, Chromium/WebView2 may show an empty or stale buffer for a
      // frame whenever the page's layers are rebuilt (e.g. the dimming starts
      // fading when the search bar gets focus) — every glass "flicked".
      this.gpu = new GlassGL(canvas, true);
    }
    this.backdrop = backdrop;
    this.settings = settings;
    this.size = { width: settings.lensWidth, height: settings.lensHeight };
    this.center = { x: 0, y: 0 };
    this.stretch = 0;
    this.pressed = false;
    this.disposed = false;
    this.hasTexture = false;
    this.uploadedVersion = -1;
    this.maxFps = 0;   // 0 = every frame
    this.paused = false; // true while covered by a dialog: no work at all
    this.lastDraw = 0;
    this.dirty = true;
    this.lastRectKey = "";
    this.frame = 0;

    // The slider "track" of the original is parked off-screen (as its input does).
    this.track = { start: -1000, end: -900, y: -1000, value: -950, radius: 2.5 };

    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  // Every frame: refresh the backdrop snapshot when it changed, and redraw
  // only when something visible changed (snapshot, position/size, settings).
  loop() {
    if (this.disposed) return;
    if (!document.hidden && !this.paused) {
      const version = this.backdrop.capture();
      if (version !== this.uploadedVersion) {
        this.uploadedVersion = version;
        this.upload();
        this.dirty = true;
      }
      const r = this.canvas.getBoundingClientRect();
      const visible = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      const key = `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)}`;
      if (key !== this.lastRectKey) {
        this.lastRectKey = key;
        this.dirty = true;
      }
      const now = performance.now();
      const minGap = this.maxFps ? 1000 / this.maxFps : 0;
      if (this.dirty && visible && now - this.lastDraw >= minGap - 1) {
        this.dirty = false;
        this.lastDraw = now;
        this.draw();
      }
    }
    this.frame = requestAnimationFrame(this.loop);
  }

  upload() {
    this.gpu.upload(() => this.blurredSource(), `${this.uploadedVersion}:${this.settings.preBlur || 0}`);
    this.hasTexture = true;
  }

  // Optional extra blur ("preBlur", in snapshot pixels) applied to the backdrop
  // BEFORE the glass shader. The shader's own blur is a 9-tap kernel that gets
  // streaky when pushed; a real gaussian here gives a smooth, strong frost.
  blurredSource() {
    const source = this.backdrop.canvas;
    const amount = this.settings.preBlur || 0;
    if (amount <= 0) return source;
    if (!this.blurCanvas) {
      this.blurCanvas = document.createElement("canvas");
      this.blurCtx = this.blurCanvas.getContext("2d");
    }
    const ctx = this.blurCtx;
    if (!ctx) return source;
    const { width: w, height: h } = source;
    if (this.blurCanvas.width !== w || this.blurCanvas.height !== h) {
      this.blurCanvas.width = w;
      this.blurCanvas.height = h;
    }
    // Draw once unblurred underneath so the blurred edges don't fade to transparent.
    ctx.drawImage(source, 0, 0);
    drawBlurred(ctx, source, 0, 0, w, h, 0, 0, w, h, amount); // works on macOS too
    return this.blurCanvas;
  }

  setSettings(settings) {
    this.settings = settings; // a different preBlur changes the texture key → re-upload on draw
    this.size = { width: settings.lensWidth, height: settings.lensHeight };
    this.dirty = true;
  }

  setGeometry(x, y, stretch, pressed) {
    this.center = { x, y };
    this.stretch = stretch;
    this.pressed = pressed;
    this.dirty = true;
  }

  resize(width, height) {
    // Supersample small surfaces a little for crisp edges, but stay light:
    // the shader takes ~70 texture reads per pixel.
    // Large panels (e.g. a whole dialog) render at 1x: they're mostly flat glass.
    const large = width * height > 200000;
    const scale = large ? Math.min(window.devicePixelRatio || 1, 1.25) : Math.min(2, Math.max(window.devicePixelRatio || 1, 1.5));
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.dirty = true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    if (this.shared) return; // the shared context lives on for the other surfaces
    const { gl } = this.gpu;
    gl.deleteTexture(this.gpu.texture);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // The context is NOT force-lost: React (StrictMode) may mount the same
    // canvas again right away and needs a working context.
  }

  draw() {
    if (!this.hasTexture) return;
    const { canvas, settings: s } = this;
    const { gl, u } = this.gpu;
    // A shared context may hold another surface's texture (different blur).
    this.gpu.upload(() => this.blurredSource(), `${this.uploadedVersion}:${this.settings.preBlur || 0}`);
    if (this.shared) this.gpu.ensureSize(canvas.width, canvas.height);
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    const rect = canvas.getBoundingClientRect();
    // The snapshot covers the backdrop element exactly (same aspect ratio), so
    // the original's "object-fit: cover" mapping reduces to a plain offset/scale.
    const bgRect = this.backdrop.rect();
    const viewportWidth = Math.max(1, bgRect.width);
    const viewportHeight = Math.max(1, bgRect.height);
    const localScaleX = rect.width / viewportWidth;
    const localScaleY = rect.height / viewportHeight;
    const localOffsetX = (rect.left - bgRect.left) / viewportWidth;
    const localOffsetY = (bgRect.bottom - rect.bottom) / viewportHeight;
    const width = this.size.width * (1 + this.stretch);
    const height = this.size.height * (1 - this.stretch * 0.48);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.u_res, canvas.width, canvas.height);
    gl.uniform2f(u.u_center, this.center.x * dpr, this.center.y * dpr);
    gl.uniform2f(u.u_size, width * dpr, height * dpr);
    gl.uniform2f(u.u_bgScale, localScaleX, localScaleY);
    gl.uniform2f(u.u_bgOffset, localOffsetX, localOffsetY);
    gl.uniform1f(u.u_blurAmount, s.blur);
    gl.uniform1f(u.u_radius, Math.min(s.radius, height * 0.5) * dpr);
    gl.uniform1f(u.u_zRadius, s.depth * dpr);
    gl.uniform1f(u.u_refract, s.refraction);
    gl.uniform1f(u.u_chroma, s.chromaticAberration);
    gl.uniform1f(u.u_edgeHL, s.edgeHighlight);
    gl.uniform1f(u.u_specular, s.specular);
    gl.uniform1f(u.u_fresnel, s.fresnel);
    gl.uniform1f(u.u_brightness, s.brightness);
    gl.uniform1f(u.u_saturation, s.saturation);
    gl.uniform1f(u.u_shadowAlpha, s.shadow);
    gl.uniform1f(u.u_shadowSpread, (12 + s.shadow * 18) * dpr);
    gl.uniform1f(u.u_darkTint, s.darkTint);
    gl.uniform1f(u.u_distortion, s.distortion);
    gl.uniform1f(u.u_tintStrength, s.tintStrength);
    gl.uniform1f(u.u_tint, s.tint);
    gl.uniform3fv(u.u_tintColor, s.tintColor);
    gl.uniform1f(u.u_opacity, s.opacity);
    gl.uniform1f(u.u_coreOpacity, s.coreOpacity ?? 1);
    gl.uniform1f(u.u_sampleBackground, 1);
    gl.uniform1f(u.u_materialMorph, 1);
    gl.uniform3f(u.u_trackBaseColor, 0.31, 0.32, 0.34);
    gl.uniform3f(u.u_trackFillColor, 0.035, 0.5, 1.0);
    gl.uniform1f(u.u_bevelMode, s.bevel);
    gl.uniform1f(u.u_button, 0);
    gl.uniform1f(u.u_pressed, this.pressed ? 1 : 0);
    gl.uniform1f(u.u_trackStart, this.track.start * dpr);
    gl.uniform1f(u.u_trackEnd, this.track.end * dpr);
    gl.uniform1f(u.u_trackY, this.track.y * dpr);
    gl.uniform1f(u.u_valueX, this.track.value * dpr);
    gl.uniform1f(u.u_trackRadius, this.track.radius * dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Shared mode: copy the drawn area (bottom-left in GL = bottom of the
    // shared canvas) into this surface's own 2D canvas.
    if (this.shared) {
      const src = this.gpu.canvas;
      this.out.clearRect(0, 0, canvas.width, canvas.height);
      this.out.drawImage(src, 0, src.height - canvas.height, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    }
  }
}
