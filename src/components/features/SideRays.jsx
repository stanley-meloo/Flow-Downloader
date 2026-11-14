// SideRays — background: two-tone light rays fanning in from a corner. From
// React Bits (https://reactbits.dev), adapted for the app:
//   - set up ONCE; settings changes only update uniforms (the original rebuilt
//     the whole WebGL scene on every prop change, e.g. while dragging a slider);
//   - `paused` (not in the original) freezes the rays and stops the loop;
//   - preserveDrawingBuffer + data-glass-layer, so the liquid-glass search bar
//     can sample it; no IntersectionObserver gate (it's always on screen);
//   - written with plain WebGL 2 (no `ogl` dependency).

import { useEffect, useRef } from 'react';

const hexToRgb = hex => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
};

const originToFlip = origin => {
  switch (origin) {
    case 'top-left': return [1, 0];
    case 'bottom-right': return [0, 1];
    case 'bottom-left': return [1, 1];
    default: return [0, 0];
  }
};

const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;

uniform float iTime;
uniform vec2 iResolution;
uniform float iSpeed;
uniform vec3 iRayColor1;
uniform vec3 iRayColor2;
uniform float iIntensity;
uniform float iSpread;
uniform float iFlipX;
uniform float iFlipY;
uniform float iTilt;
uniform float iSaturation;
uniform float iBlend;
uniform float iFalloff;
uniform float iOpacity;
out vec4 outColor;

float rayStrength(vec2 raySource, vec2 rayRefDirection, vec2 coord, float seedA, float seedB, float speed) {
  vec2 sourceToCoord = coord - raySource;
  float cosAngle = dot(normalize(sourceToCoord), rayRefDirection);
  return clamp(
    (0.45 + 0.15 * sin(cosAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-cosAngle * seedB + iTime * speed)),
    0.0, 1.0) *
    clamp((iResolution.x - length(sourceToCoord)) / iResolution.x, 0.5, 1.0);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  if (iFlipX > 0.5) fragCoord.x = iResolution.x - fragCoord.x;
  if (iFlipY > 0.5) fragCoord.y = iResolution.y - fragCoord.y;

  vec2 coord = vec2(fragCoord.x, iResolution.y - fragCoord.y);
  vec2 rayPos = vec2(iResolution.x * 1.1, -0.5 * iResolution.y);

  float tiltRad = iTilt * 3.14159265 / 180.0;
  float cs = cos(tiltRad);
  float sn = sin(tiltRad);
  vec2 rel = coord - rayPos;
  vec2 tiltedCoord = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs) + rayPos;

  float halfSpread = iSpread * 0.275;
  vec2 rayRefDir1 = normalize(vec2(cos(0.785398 + halfSpread), sin(0.785398 + halfSpread)));
  vec2 rayRefDir2 = normalize(vec2(cos(0.785398 - halfSpread), sin(0.785398 - halfSpread)));

  vec4 rays1 = vec4(iRayColor1, 1.0) * rayStrength(rayPos, rayRefDir1, tiltedCoord, 36.2214, 21.11349, iSpeed);
  vec4 rays2 = vec4(iRayColor2, 1.0) * rayStrength(rayPos, rayRefDir2, tiltedCoord, 22.3991, 18.0234, iSpeed * 0.2);

  vec4 color = rays1 * (1.0 - iBlend) * 0.9 + rays2 * iBlend * 0.9;

  float distanceToLight = length(fragCoord.xy - vec2(rayPos.x, iResolution.y - rayPos.y)) / iResolution.y;
  float brightness = iIntensity * 0.4 / pow(max(distanceToLight, 0.001), iFalloff);
  color.rgb *= brightness;

  float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  color.rgb = mix(vec3(gray), color.rgb, iSaturation);

  // Premultiplied output (the canvas is premultiplied).
  float alpha = clamp(max(color.r, max(color.g, color.b)) * iOpacity, 0.0, 1.0);
  outColor = vec4(min(color.rgb * iOpacity, vec3(alpha)), alpha);
}`;

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error('[SideRays] shader:', gl.isContextLost() ? 'WebGL context lost' : gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
};

const SideRays = ({
  speed = 2.5,
  rayColor1 = '#EAB308',
  rayColor2 = '#96c8ff',
  intensity = 2,
  spread = 2,
  origin = 'top-right',
  tilt = 0,
  saturation = 1.5,
  blend = 0.75,
  falloff = 1.6,
  opacity = 1.0,
  paused = false, // freeze the rays (e.g. while a dialog covers the screen / a still thumbnail)
  className = '',
  'data-glass-layer': glassLayer // lets the liquid-glass search bar sample this canvas
}) => {
  const containerRef = useRef(null);
  const wakeRef = useRef(null);
  const settingsRef = useRef(null);
  settingsRef.current = { speed, rayColor1, rayColor2, intensity, spread, origin, tilt, saturation, blend, falloff, opacity, paused };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: true });
    if (!gl) {
      canvas.remove();
      return undefined;
    }
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      canvas.remove();
      return undefined;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[SideRays] link:', gl.getProgramInfoLog(program));
      canvas.remove();
      return undefined;
    }
    const names = ['iTime', 'iResolution', 'iSpeed', 'iRayColor1', 'iRayColor2', 'iIntensity', 'iSpread', 'iFlipX', 'iFlipY', 'iTilt', 'iSaturation', 'iBlend', 'iFalloff', 'iOpacity'];
    const u = Object.fromEntries(names.map(n => [n, gl.getUniformLocation(program, n)]));
    const vao = gl.createVertexArray();

    let time = 0;
    let last = 0;
    let raf = 0;

    const draw = () => {
      const s = settingsRef.current;
      const [flipX, flipY] = originToFlip(s.origin);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform1f(u.iTime, time);
      gl.uniform2f(u.iResolution, canvas.width, canvas.height);
      gl.uniform1f(u.iSpeed, s.speed);
      gl.uniform3fv(u.iRayColor1, hexToRgb(s.rayColor1));
      gl.uniform3fv(u.iRayColor2, hexToRgb(s.rayColor2));
      gl.uniform1f(u.iIntensity, s.intensity);
      gl.uniform1f(u.iSpread, s.spread);
      gl.uniform1f(u.iFlipX, flipX);
      gl.uniform1f(u.iFlipY, flipY);
      gl.uniform1f(u.iTilt, s.tilt);
      gl.uniform1f(u.iSaturation, s.saturation);
      gl.uniform1f(u.iBlend, s.blend);
      gl.uniform1f(u.iFalloff, s.falloff);
      gl.uniform1f(u.iOpacity, s.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const loop = now => {
      raf = 0;
      if (document.hidden) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      time += dt;
      draw();
      if (!settingsRef.current.paused) raf = requestAnimationFrame(loop);
      else last = 0;
    };

    const wake = () => {
      if (raf) return;
      if (settingsRef.current.paused) { draw(); return; } // still: one frame with the new settings
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(container.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(container.clientHeight * ratio));
      draw();
      wake();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    const onVisibility = () => { last = 0; wake(); };
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    wakeRef.current = wake;

    return () => {
      cancelAnimationFrame(raf);
      wakeRef.current = null;
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    wakeRef.current?.();
  });

  return (
    <div
      ref={containerRef}
      data-glass-layer={glassLayer}
      className={`relative w-full h-full overflow-hidden pointer-events-none ${className}`.trim()}
    />
  );
};

export default SideRays;
