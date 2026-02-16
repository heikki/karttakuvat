import maplibregl, { createTileMesh } from 'maplibre-gl';
import type { CustomRenderMethodInput } from 'maplibre-gl';

import {
  MIP_LEVELS,
  createBlurShader,
  createCompositeShader,
  createNightShader,
  createPointShader,
  setProjectionUniforms,
  type BlurShader,
  type CompositeShader,
  type NightShaderSet,
  type PointShaderSet,
} from './glow-shaders';
import { getSubsolarPoint } from './subsolar';

export type { NightShaderSet, PointShaderSet };
export { getSubsolarPoint };

export interface GlowConfig {
  color: [number, number, number];
}

interface MipLevel {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  pingFbo: WebGLFramebuffer;
  pingTexture: WebGLTexture;
  width: number;
  height: number;
}

interface GlState {
  fbo: WebGLFramebuffer | null;
  blend: boolean;
  blendSrc: number;
  blendDst: number;
  blendSrcA: number;
  blendDstA: number;
  activeTexture: number;
  viewport: Int32Array;
}

interface BrightPassParams {
  options: CustomRenderMethodInput;
  w: number;
  h: number;
  sun: { lng: number; lat: number };
}

const BLUR_ITERATIONS = 4;
const POINT_STRIDE = 5 * 4; // 5 floats × 4 bytes
const DEG2RAD = Math.PI / 180;
const BLOOM_STRENGTH = 1.2;
const MIP_WEIGHTS = new Float32Array([0.6, 0.3, 0.8, 2.0, 1.2, 0.6, 0.3]);

function saveGlState(gl: WebGL2RenderingContext): GlState {
  return {
    fbo: gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    blend: gl.getParameter(gl.BLEND) as boolean,
    blendSrc: gl.getParameter(gl.BLEND_SRC_RGB) as number,
    blendDst: gl.getParameter(gl.BLEND_DST_RGB) as number,
    blendSrcA: gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
    blendDstA: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
    activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE) as number,
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
  };
}

function restoreGlState(gl: WebGL2RenderingContext, s: GlState) {
  if (s.blend) { gl.enable(gl.BLEND); } else { gl.disable(gl.BLEND); }
  gl.blendFuncSeparate(s.blendSrc, s.blendDst, s.blendSrcA, s.blendDstA);
  gl.activeTexture(s.activeTexture);
  gl.viewport(s.viewport[0]!, s.viewport[1]!, s.viewport[2]!, s.viewport[3]!);
}

function initTexture(gl: WebGL2RenderingContext, tex: WebGLTexture, w: number, h: number) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

// ============================================================
// PhotoGlowLayer — combines night shadow + bloom glow
// ============================================================

export class PhotoGlowLayer implements maplibregl.CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private gl: WebGL2RenderingContext | null = null;
  private map: maplibregl.Map | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private fullscreenQuadBuffer: WebGLBuffer | null = null;
  private readonly pointShaders = new Map<string, PointShaderSet>();
  private readonly nightShaders = new Map<string, NightShaderSet>();
  private blurShader: BlurShader | null = null;
  private compositeShader: CompositeShader | null = null;

  // Night mesh
  private nightVertexBuffer: WebGLBuffer | null = null;
  private nightIndexBuffer: WebGLBuffer | null = null;
  private nightIndexCount = 0;

  // Bright pass FBO (full res)
  private brightFbo: WebGLFramebuffer | null = null;
  private brightTexture: WebGLTexture | null = null;
  private brightWidth = 0;
  private brightHeight = 0;

  // Blur pyramid
  private mipLevels: MipLevel[] = [];

  private instanceCount = 0;
  private readonly config: GlowConfig;

  // Night state
  private nightDate: Date | null = null;
  private readonly nightOpacity = 0.8;
  private nightHidden = false;

  constructor(id: string, config: GlowConfig) {
    this.id = id;
    this.config = config;
  }

  setNightDate(date: Date | null) {
    this.nightDate = date;
    this.map?.triggerRepaint();
  }

  getNightDate(): Date | null {
    return this.nightDate;
  }

  setNightHidden(hidden: boolean) {
    this.nightHidden = hidden;
    this.map?.triggerRepaint();
  }

  getSubsolarPoint(): { lng: number; lat: number } {
    return getSubsolarPoint(this.nightDate);
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;

    this.fullscreenQuadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.instanceBuffer = gl.createBuffer();
    this.brightFbo = gl.createFramebuffer();
    this.brightTexture = gl.createTexture();
    this.nightVertexBuffer = gl.createBuffer();
    this.nightIndexBuffer = gl.createBuffer();

    this.blurShader = createBlurShader(gl);
    this.compositeShader = createCompositeShader(gl);
  }

  // --- FBO management ---

  private ensureFboSizes(gl: WebGL2RenderingContext, w: number, h: number) {
    if (w === this.brightWidth && h === this.brightHeight) { return; }
    this.brightWidth = w;
    this.brightHeight = h;

    initTexture(gl, this.brightTexture!, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.brightTexture, 0);

    for (const mip of this.mipLevels) {
      gl.deleteFramebuffer(mip.fbo);
      gl.deleteTexture(mip.texture);
      gl.deleteFramebuffer(mip.pingFbo);
      gl.deleteTexture(mip.pingTexture);
    }
    this.mipLevels = [];

    let mw = Math.max(1, Math.floor(w / 2));
    let mh = Math.max(1, Math.floor(h / 2));
    for (let i = 0; i < MIP_LEVELS; i++) {
      const texture = gl.createTexture();
      initTexture(gl, texture, mw, mh);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

      const pingTexture = gl.createTexture();
      initTexture(gl, pingTexture, mw, mh);
      const pingFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, pingFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pingTexture, 0);

      this.mipLevels.push({ fbo, texture, pingFbo, pingTexture, width: mw, height: mh });
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // --- Night mesh (globe only) ---

  private updateNightMesh(gl: WebGL2RenderingContext) {
    if (this.nightVertexBuffer === null || this.nightIndexBuffer === null) { return; }

    const mesh = createTileMesh(
      { granularity: 100, generateBorders: false, extendToNorthPole: true, extendToSouthPole: true },
      '16bit'
    );
    const verts = new Float32Array(new Int16Array(mesh.vertices)).map((v) => v / 8192);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nightVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nightIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
    this.nightIndexCount = mesh.indices.byteLength / 2;

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  // --- Shader caching ---

  private getNightShader(gl: WebGL2RenderingContext, shaderData: CustomRenderMethodInput['shaderData']): NightShaderSet {
    const key = shaderData.variantName;
    let shader = this.nightShaders.get(key);
    if (shader === undefined) {
      shader = createNightShader(gl, shaderData);
      this.nightShaders.set(key, shader);
    }
    return shader;
  }

  private getPointShader(gl: WebGL2RenderingContext, shaderData: CustomRenderMethodInput['shaderData']): PointShaderSet {
    const key = shaderData.variantName;
    let shader = this.pointShaders.get(key);
    if (shader === undefined) {
      shader = createPointShader(gl, shaderData);
      this.pointShaders.set(key, shader);
    }
    return shader;
  }

  // --- Render passes ---

  private renderNightShadow(
    gl: WebGL2RenderingContext,
    options: CustomRenderMethodInput,
    sun: { lng: number; lat: number }
  ) {
    if (this.nightHidden || this.nightVertexBuffer === null || this.nightIndexBuffer === null) {
      return;
    }

    this.updateNightMesh(gl);
    const shader = this.getNightShader(gl, options.shaderData);

    gl.useProgram(shader.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    setProjectionUniforms(gl, shader, this.map!, options);
    gl.uniform2f(shader.uSubsolar, sun.lng, sun.lat);
    gl.uniform1f(shader.uOpacity, this.nightOpacity);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.nightVertexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nightIndexBuffer);
    gl.enableVertexAttribArray(shader.aPosition);
    gl.vertexAttribPointer(shader.aPosition, 2, gl.FLOAT, false, 0, 0);

    gl.drawElements(gl.TRIANGLES, this.nightIndexCount, gl.UNSIGNED_SHORT, 0);

    gl.disableVertexAttribArray(shader.aPosition);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  private renderBrightPass(gl: WebGL2RenderingContext, params: BrightPassParams) {
    const { options, w, h, sun } = params;
    const shader = this.getPointShader(gl, options.shaderData);
    this.ensureFboSizes(gl, w, h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(shader.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);

    setProjectionUniforms(gl, shader, this.map!, options);

    const zoom = this.map!.getZoom();
    const slng = sun.lng * DEG2RAD;
    const slat = sun.lat * DEG2RAD;

    gl.uniform2f(shader.uViewport, w, h);
    gl.uniform1f(shader.uZoom, zoom);
    gl.uniform1f(shader.uPointSize, 10.0);
    gl.uniform3fv(shader.uColor, this.config.color);
    gl.uniform1f(shader.uIntensity, 1.7);
    gl.uniform3f(shader.uSunDir,
      Math.cos(slat) * Math.cos(slng),
      Math.cos(slat) * Math.sin(slng),
      Math.sin(slat)
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.enableVertexAttribArray(shader.aPhotoPos);
    gl.vertexAttribPointer(shader.aPhotoPos, 3, gl.FLOAT, false, POINT_STRIDE, 0);
    if (shader.aLngLat >= 0) {
      gl.enableVertexAttribArray(shader.aLngLat);
      gl.vertexAttribPointer(shader.aLngLat, 2, gl.FLOAT, false, POINT_STRIDE, 3 * 4);
    }

    gl.drawArrays(gl.POINTS, 0, this.instanceCount);

    gl.disableVertexAttribArray(shader.aPhotoPos);
    if (shader.aLngLat >= 0) { gl.disableVertexAttribArray(shader.aLngLat); }
  }

  private renderBlurPyramid(gl: WebGL2RenderingContext) {
    const blur = this.blurShader!;
    gl.useProgram(blur.program);
    gl.disable(gl.BLEND);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadBuffer);
    gl.enableVertexAttribArray(blur.aPos);
    gl.vertexAttribPointer(blur.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(blur.uTexture, 0);

    const zoom = this.map!.getZoom();
    const blurSpread = Math.max(0.1, 1.4 ** (zoom - 4.0) * 0.3);
    gl.uniform1f(blur.uSpread, blurSpread);

    let srcTexture = this.brightTexture!;

    for (let i = 0; i < MIP_LEVELS; i++) {
      const mip = this.mipLevels[i]!;
      gl.viewport(0, 0, mip.width, mip.height);
      gl.uniform2f(blur.uResolution, mip.width, mip.height);

      let readTex = srcTexture;
      for (let iter = 0; iter < BLUR_ITERATIONS; iter++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, mip.pingFbo);
        gl.bindTexture(gl.TEXTURE_2D, readTex);
        gl.uniform2f(blur.uDirection, 1.0, 0.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.bindFramebuffer(gl.FRAMEBUFFER, mip.fbo);
        gl.bindTexture(gl.TEXTURE_2D, mip.pingTexture);
        gl.uniform2f(blur.uDirection, 0.0, 1.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        readTex = mip.texture;
      }
      srcTexture = mip.texture;
    }

    gl.disableVertexAttribArray(blur.aPos);
  }

  private renderComposite(gl: WebGL2RenderingContext, prevFbo: WebGLFramebuffer | null, w: number, h: number) {
    const comp = this.compositeShader!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(0, 0, w, h);

    gl.useProgram(comp.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);

    for (let i = 0; i < MIP_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.mipLevels[i]!.texture);
      gl.uniform1i(comp.uBloomTextures[i]!, i);
    }

    gl.uniform1f(comp.uStrength, BLOOM_STRENGTH);
    gl.uniform1fv(comp.uMipWeights, MIP_WEIGHTS);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadBuffer);
    gl.enableVertexAttribArray(comp.aPos);
    gl.vertexAttribPointer(comp.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(comp.aPos);

    for (let i = 0; i < MIP_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  // --- Main render ---

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (this.map === null || this.fullscreenQuadBuffer === null) { return; }

    const gl = _gl as WebGL2RenderingContext;
    const canvas = this.map.getCanvas();
    const w = canvas.width;
    const h = canvas.height;
    const saved = saveGlState(gl);
    const sun = this.getSubsolarPoint();
    const isGlobe = this.map.getProjection().type === 'globe';

    // Pass 0: Night shadow (globe only)
    if (isGlobe) {
      this.renderNightShadow(gl, options, sun);
    }

    // Passes 1+: Bloom glow
    if (this.instanceCount > 0 && this.instanceBuffer !== null && this.brightFbo !== null &&
        this.blurShader !== null && this.compositeShader !== null) {
      this.renderBrightPass(gl, { options, w, h, sun });
      this.renderBlurPyramid(gl);
      this.renderComposite(gl, saved.fbo, w, h);
    }

    restoreGlState(gl, saved);
  }

  // --- Data upload ---

  updateData(positions: Array<{ lng: number; lat: number; weight?: number }>) {
    const gl = this.gl;
    if (gl === null || this.instanceBuffer === null) { return; }

    const data = new Float32Array(positions.length * 5);
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      const merc = maplibregl.MercatorCoordinate.fromLngLat([p.lng, p.lat]);
      const off = i * 5;
      data[off] = merc.x;
      data[off + 1] = merc.y;
      data[off + 2] = p.weight ?? 1.0;
      data[off + 3] = p.lng * DEG2RAD;
      data[off + 4] = p.lat * DEG2RAD;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.instanceCount = positions.length;
  }

  // --- Cleanup ---

  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    const programs = [
      ...Array.from(this.pointShaders.values()).map((s) => s.program),
      ...Array.from(this.nightShaders.values()).map((s) => s.program),
      this.blurShader?.program,
      this.compositeShader?.program,
    ];
    for (const p of programs) {
      if (p !== undefined) { gl.deleteProgram(p); }
    }
    this.pointShaders.clear();
    this.nightShaders.clear();

    const buffers = [this.fullscreenQuadBuffer, this.instanceBuffer, this.nightVertexBuffer, this.nightIndexBuffer];
    for (const b of buffers) {
      if (b !== null) { gl.deleteBuffer(b); }
    }

    if (this.brightTexture !== null) { gl.deleteTexture(this.brightTexture); }
    if (this.brightFbo !== null) { gl.deleteFramebuffer(this.brightFbo); }

    for (const mip of this.mipLevels) {
      gl.deleteFramebuffer(mip.fbo);
      gl.deleteTexture(mip.texture);
      gl.deleteFramebuffer(mip.pingFbo);
      gl.deleteTexture(mip.pingTexture);
    }

    this.mipLevels = [];
    this.gl = null;
    this.map = null;
  }
}
