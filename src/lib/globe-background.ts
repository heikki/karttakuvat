// Animated cosmic background shader for globe projection mode
// Renders flowing nebula, color gradients, and particles behind the transparent map canvas
// Globe glow adjusts to the globe's apparent size on screen

const VERTEX_SRC = `#version 300 es
in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_globeRadius; // globe radius in normalized coords (0..1 relative to min dimension)

out vec4 fragColor;

// Hash functions for noise
vec3 hash33(vec3 p) {
  p = fract(p * vec3(443.8975, 397.2973, 491.1871));
  p += dot(p.zxy, p.yxz + 19.19);
  return fract(vec3(p.x * p.y, p.z * p.x, p.y * p.z));
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Smooth noise
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n = mix(
    mix(mix(dot(hash33(i) - 0.5, f),
            dot(hash33(i + vec3(1,0,0)) - 0.5, f - vec3(1,0,0)), f.x),
        mix(dot(hash33(i + vec3(0,1,0)) - 0.5, f - vec3(0,1,0)),
            dot(hash33(i + vec3(1,1,0)) - 0.5, f - vec3(1,1,0)), f.x), f.y),
    mix(mix(dot(hash33(i + vec3(0,0,1)) - 0.5, f - vec3(0,0,1)),
            dot(hash33(i + vec3(1,0,1)) - 0.5, f - vec3(1,0,1)), f.x),
        mix(dot(hash33(i + vec3(0,1,1)) - 0.5, f - vec3(0,1,1)),
            dot(hash33(i + vec3(1,1,1)) - 0.5, f - vec3(1,1,1)), f.x), f.y),
    f.z);
  return n + 0.5;
}

// Fractal brownian motion
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  vec3 shift = vec3(100.0);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

// Star/particle layer
float stars(vec2 uv, float scale, float brightness) {
  vec2 id = floor(uv * scale);
  vec2 gv = fract(uv * scale) - 0.5;
  float h = hash21(id);
  float star = 0.0;
  if (h > 0.97) {
    float d = length(gv);
    float twinkle = sin(u_time * (1.0 + h * 3.0) + h * 6.28) * 0.5 + 0.5;
    star = brightness * smoothstep(0.05, 0.0, d) * (0.5 + 0.5 * twinkle);
  }
  return star;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 centered = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);
  float t = u_time * 0.03;

  // Flowing nebula using domain-warped FBM
  vec3 p = vec3(centered * 2.0, t * 0.5);
  float warp1 = fbm(p + vec3(0.0, 0.0, t));
  float warp2 = fbm(p + vec3(5.2, 1.3, t * 0.7));
  float nebula = fbm(p + vec3(warp1, warp2, 0.0) * 1.5);

  // Color palette - deep space with purple, blue, teal accents
  vec3 col1 = vec3(0.08, 0.02, 0.15); // deep purple-black
  vec3 col2 = vec3(0.05, 0.08, 0.18); // deep blue
  vec3 col3 = vec3(0.02, 0.12, 0.15); // teal
  vec3 col4 = vec3(0.15, 0.04, 0.12); // warm purple

  vec3 color = mix(col1, col2, smoothstep(0.2, 0.6, nebula));
  color = mix(color, col3, smoothstep(0.4, 0.8, warp1) * 0.6);
  color = mix(color, col4, smoothstep(0.5, 0.9, warp2) * 0.4);

  // Add glow highlights in the nebula
  float glow = smoothstep(0.55, 0.75, nebula) * 0.15;
  vec3 glowColor = mix(vec3(0.15, 0.1, 0.3), vec3(0.05, 0.2, 0.25), warp1);
  color += glow * glowColor;

  // Floating particles - multiple layers for depth
  float p1 = stars(uv + vec2(t * 0.01, t * 0.005), 80.0, 0.8);
  float p2 = stars(uv + vec2(-t * 0.008, t * 0.012), 120.0, 0.5);
  float p3 = stars(uv + vec2(t * 0.006, -t * 0.003), 200.0, 0.3);
  float particleBrightness = p1 + p2 + p3;
  color += vec3(0.7, 0.8, 1.0) * particleBrightness;

  // Globe glow - adapts to globe radius
  float dist = length(centered);
  float r = u_globeRadius;
  // Soft glow ring around the globe edge
  float glowRing = exp(-pow((dist - r) * 4.0 / max(r, 0.1), 2.0)) * 0.12;
  // Faint atmospheric haze
  float haze = smoothstep(r + 0.5, r * 0.6, dist) * 0.06;
  vec3 globeGlowCol = mix(vec3(0.25, 0.35, 0.6), vec3(0.15, 0.25, 0.5), nebula);
  color += globeGlowCol * (glowRing + haze);

  // Subtle vignette
  float vignette = 1.0 - 0.25 * smoothstep(0.5, 1.5, dist);
  color *= max(vignette, 0.0);

  fragColor = vec4(color, 1.0);
}`;

let canvas: HTMLCanvasElement | null = null;
let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let animationId: number | null = null;
let resizeObserver: ResizeObserver | null = null;
let uTimeLoc: WebGLUniformLocation | null = null;
let uResolutionLoc: WebGLUniformLocation | null = null;
let uGlobeRadiusLoc: WebGLUniformLocation | null = null;
let startTime = 0;
let currentGlobeRadius = 0.45; // default normalized radius

function createShader(
  ctx: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = ctx.createShader(type);
  if (shader === null) return null;
  ctx.shaderSource(shader, source);
  ctx.compileShader(shader);
  if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
    console.error('Shader compile error:', ctx.getShaderInfoLog(shader));
    ctx.deleteShader(shader);
    return null;
  }
  return shader;
}

function initGL(container: HTMLElement): boolean {
  canvas = document.createElement('canvas');
  canvas.id = 'globe-bg';
  container.prepend(canvas);

  gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (gl === null) return false;

  const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (vs === null || fs === null) return false;

  program = gl.createProgram();
  if (program === null) return false;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return false;
  }

  // Fullscreen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // prettier-ignore
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  uTimeLoc = gl.getUniformLocation(program, 'u_time');
  uResolutionLoc = gl.getUniformLocation(program, 'u_resolution');
  uGlobeRadiusLoc = gl.getUniformLocation(program, 'u_globeRadius');

  gl.useProgram(program);

  return true;
}

function resize() {
  if (canvas === null || gl === null) return;
  const dpr = window.devicePixelRatio;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    gl.viewport(0, 0, pw, ph);
  }
}

function render() {
  if (gl === null) return;
  resize();
  const elapsed = (performance.now() - startTime) / 1000;
  gl.uniform1f(uTimeLoc, elapsed);
  gl.uniform2f(uResolutionLoc, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.uniform1f(uGlobeRadiusLoc, currentGlobeRadius);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  animationId = requestAnimationFrame(render);
}

export function setGlobeRadius(radiusPixels: number, viewportMinDim: number) {
  currentGlobeRadius = radiusPixels / viewportMinDim;
}

export function startGlobeBackground() {
  if (canvas !== null) {
    canvas.style.display = 'block';
  }
  if (animationId !== null) return;
  startTime = performance.now();
  animationId = requestAnimationFrame(render);
}

export function stopGlobeBackground() {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  if (canvas !== null) {
    canvas.style.display = 'none';
  }
}

export function initGlobeBackground(container: HTMLElement) {
  if (!initGL(container)) {
    console.warn('Globe background: WebGL2 not available');
    return;
  }

  resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(container);

  // Start hidden
  if (canvas !== null) {
    canvas.style.display = 'none';
  }
}

export function destroyGlobeBackground() {
  stopGlobeBackground();
  resizeObserver?.disconnect();
  canvas?.remove();
  canvas = null;
  gl = null;
  program = null;
}
