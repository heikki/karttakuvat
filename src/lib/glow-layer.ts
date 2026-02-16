import maplibregl, { createTileMesh } from 'maplibre-gl';
import type { CustomRenderMethodInput } from 'maplibre-gl';

import {
  MIP_LEVELS, type Shader,
  createBlurShader, createCompositeShader, createNightShader, createPointShader,
  setProjectionUniforms,
} from './glow-shaders';
import { getSubsolarPoint } from './subsolar';

export { getSubsolarPoint };

export interface GlowConfig {
  color: [number, number, number];
}

interface MipLevel {
  fbo: WebGLFramebuffer; tex: WebGLTexture;
  pingFbo: WebGLFramebuffer; pingTex: WebGLTexture;
  w: number; h: number;
}

const BLUR_ITERS = 2;
const STRIDE = 5 * 4;
const DEG2RAD = Math.PI / 180;
const MIP_W = new Float32Array([1.0, 0.8, 0.5, 0.3]);

function initTex(gl: WebGL2RenderingContext, tex: WebGLTexture, w: number, h: number) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

type GlState = [WebGLFramebuffer | null, boolean, number, number, number, number, number, Int32Array];

function saveGl(gl: WebGL2RenderingContext): GlState {
  return [
    gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    gl.getParameter(gl.BLEND) as boolean,
    gl.getParameter(gl.BLEND_SRC_RGB) as number, gl.getParameter(gl.BLEND_DST_RGB) as number,
    gl.getParameter(gl.BLEND_SRC_ALPHA) as number, gl.getParameter(gl.BLEND_DST_ALPHA) as number,
    gl.getParameter(gl.ACTIVE_TEXTURE) as number,
    gl.getParameter(gl.VIEWPORT) as Int32Array,
  ];
}

function restoreGl(gl: WebGL2RenderingContext, s: GlState) {
  if (s[1]) { gl.enable(gl.BLEND); } else { gl.disable(gl.BLEND); }
  gl.blendFuncSeparate(s[2], s[3], s[4], s[5]);
  gl.activeTexture(s[6]);
  gl.viewport(s[7][0]!, s[7][1]!, s[7][2]!, s[7][3]!);
}

export class PhotoGlowLayer implements maplibregl.CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private gl: WebGL2RenderingContext | null = null;
  private map: maplibregl.Map | null = null;
  private instanceBuf: WebGLBuffer | null = null;
  private quadBuf: WebGLBuffer | null = null;
  private readonly shaders = new Map<string, Shader>();
  private blur: Shader | null = null;
  private composite: Shader | null = null;

  private nightVB: WebGLBuffer | null = null;
  private nightIB: WebGLBuffer | null = null;
  private nightCount = 0;
  private nightBuilt = false;

  private brightFbo: WebGLFramebuffer | null = null;
  private brightTex: WebGLTexture | null = null;
  private fbW = 0;
  private fbH = 0;
  private mips: MipLevel[] = [];

  private instanceCount = 0;
  private readonly config: GlowConfig;
  private nightDate: Date | null = null;
  private readonly nightOpacity = 0.8;
  private nightHidden = false;

  constructor(id: string, config: GlowConfig) {
    this.id = id;
    this.config = config;
  }

  setNightDate(date: Date | null) { this.nightDate = date; this.map?.triggerRepaint(); }
  getNightDate(): Date | null { return this.nightDate; }
  setNightHidden(hidden: boolean) { this.nightHidden = hidden; this.map?.triggerRepaint(); }
  getSubsolarPoint(): { lng: number; lat: number } { return getSubsolarPoint(this.nightDate); }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.instanceBuf = gl.createBuffer();
    this.brightFbo = gl.createFramebuffer();
    this.brightTex = gl.createTexture();
    this.nightVB = gl.createBuffer();
    this.nightIB = gl.createBuffer();
    this.blur = createBlurShader(gl);
    this.composite = createCompositeShader(gl);
  }

  private cached(key: string, create: () => Shader): Shader {
    let s = this.shaders.get(key);
    if (s === undefined) { s = create(); this.shaders.set(key, s); }
    return s;
  }

  private ensureFbos(gl: WebGL2RenderingContext, w: number, h: number) {
    if (w === this.fbW && h === this.fbH) { return; }
    this.fbW = w;
    this.fbH = h;
    initTex(gl, this.brightTex!, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.brightTex, 0);
    for (const m of this.mips) {
      gl.deleteFramebuffer(m.fbo); gl.deleteTexture(m.tex);
      gl.deleteFramebuffer(m.pingFbo); gl.deleteTexture(m.pingTex);
    }
    this.mips = [];
    let mw = Math.max(1, w >> 1);
    let mh = Math.max(1, h >> 1);
    for (let i = 0; i < MIP_LEVELS; i++) {
      const tex = gl.createTexture(); initTex(gl, tex, mw, mh);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const pingTex = gl.createTexture(); initTex(gl, pingTex, mw, mh);
      const pingFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, pingFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pingTex, 0);
      this.mips.push({ fbo, tex, pingFbo, pingTex, w: mw, h: mh });
      mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private buildNightMesh(gl: WebGL2RenderingContext) {
    if (this.nightBuilt || this.nightVB === null || this.nightIB === null) { return; }
    this.nightBuilt = true;
    const mesh = createTileMesh(
      { granularity: 100, generateBorders: false, extendToNorthPole: true, extendToSouthPole: true }, '16bit'
    );
    const verts = new Float32Array(new Int16Array(mesh.vertices)).map((v) => v / 8192);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nightVB);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nightIB);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.nightCount = mesh.indices.byteLength / 2;
  }

  private drawNight(gl: WebGL2RenderingContext, options: CustomRenderMethodInput, sun: { lng: number; lat: number }) {
    if (this.nightHidden || this.nightVB === null || this.nightIB === null) { return; }
    this.buildNightMesh(gl);
    const s = this.cached(`night-${options.shaderData.variantName}`, () => createNightShader(gl, options.shaderData));
    gl.useProgram(s.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    setProjectionUniforms(gl, s, this.map!, options);
    gl.uniform2f(s.u('u_subsolar'), sun.lng, sun.lat);
    gl.uniform1f(s.u('u_opacity'), this.nightOpacity);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nightVB);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nightIB);
    gl.enableVertexAttribArray(s.a('a_pos'));
    gl.vertexAttribPointer(s.a('a_pos'), 2, gl.FLOAT, false, 0, 0);
    gl.drawElements(gl.TRIANGLES, this.nightCount, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(s.a('a_pos'));
  }

  private drawBright(gl: WebGL2RenderingContext, options: CustomRenderMethodInput, sun: { lng: number; lat: number }) {
    const { width: w, height: h } = this.map!.getCanvas();
    const s = this.cached(`point-${options.shaderData.variantName}`, () => createPointShader(gl, options.shaderData));
    this.ensureFbos(gl, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(s.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    setProjectionUniforms(gl, s, this.map!, options);
    const zoom = this.map!.getZoom();
    const slng = sun.lng * DEG2RAD;
    const slat = sun.lat * DEG2RAD;
    gl.uniform2f(s.u('u_viewport'), w, h);
    gl.uniform1f(s.u('u_zoom'), zoom);
    gl.uniform1f(s.u('u_point_size'), 10.0);
    gl.uniform3fv(s.u('u_color'), this.config.color);
    gl.uniform1f(s.u('u_intensity'), 1.7);
    gl.uniform3f(s.u('u_sun_dir'), Math.cos(slat) * Math.cos(slng), Math.cos(slat) * Math.sin(slng), Math.sin(slat));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.enableVertexAttribArray(s.a('a_photo_pos'));
    gl.vertexAttribPointer(s.a('a_photo_pos'), 3, gl.FLOAT, false, STRIDE, 0);
    const lnglat = s.a('a_lnglat');
    if (lnglat >= 0) {
      gl.enableVertexAttribArray(lnglat);
      gl.vertexAttribPointer(lnglat, 2, gl.FLOAT, false, STRIDE, 3 * 4);
    }
    gl.drawArrays(gl.POINTS, 0, this.instanceCount);
    gl.disableVertexAttribArray(s.a('a_photo_pos'));
    if (lnglat >= 0) { gl.disableVertexAttribArray(lnglat); }
  }

  private drawBlur(gl: WebGL2RenderingContext) {
    const b = this.blur!;
    gl.useProgram(b.program);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(b.a('a_pos'));
    gl.vertexAttribPointer(b.a('a_pos'), 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(b.u('u_tex'), 0);
    gl.uniform1f(b.u('u_spread'), Math.min(3.0, Math.max(0.1, 1.4 ** (this.map!.getZoom() - 4.0) * 0.3)));
    let src = this.brightTex!;
    for (const mip of this.mips) {
      gl.viewport(0, 0, mip.w, mip.h);
      gl.uniform2f(b.u('u_res'), mip.w, mip.h);
      let read = src;
      for (let j = 0; j < BLUR_ITERS; j++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, mip.pingFbo);
        gl.bindTexture(gl.TEXTURE_2D, read);
        gl.uniform2f(b.u('u_dir'), 1, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, mip.fbo);
        gl.bindTexture(gl.TEXTURE_2D, mip.pingTex);
        gl.uniform2f(b.u('u_dir'), 0, 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        read = mip.tex;
      }
      src = mip.tex;
    }
    gl.disableVertexAttribArray(b.a('a_pos'));
  }

  private drawComposite(gl: WebGL2RenderingContext, prevFbo: WebGLFramebuffer | null, w: number, h: number) {
    const c = this.composite!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(c.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    for (let i = 0; i < MIP_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.mips[i]!.tex);
      gl.uniform1i(c.u(`u_b${i}`), i);
    }
    gl.uniform1f(c.u('u_strength'), 1.2 / Math.max(1, (this.map!.getZoom() - 4) * 0.5));
    gl.uniform1fv(c.u('u_w'), MIP_W);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(c.a('a_pos'));
    gl.vertexAttribPointer(c.a('a_pos'), 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(c.a('a_pos'));
    for (let i = 0; i < MIP_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
    if (this.map === null || this.quadBuf === null) { return; }
    const gl = _gl as WebGL2RenderingContext;
    const { width: w, height: h } = this.map.getCanvas();
    const saved = saveGl(gl);
    const sun = this.getSubsolarPoint();
    if (this.map.getProjection().type === 'globe') {
      this.drawNight(gl, options, sun);
    }
    if (this.instanceCount > 0 && this.instanceBuf !== null && this.brightFbo !== null &&
        this.blur !== null && this.composite !== null) {
      this.drawBright(gl, options, sun);
      this.drawBlur(gl);
      this.drawComposite(gl, saved[0], w, h);
    }
    restoreGl(gl, saved);
  }

  updateData(positions: Array<{ lng: number; lat: number; weight?: number }>) {
    const gl = this.gl;
    if (gl === null || this.instanceBuf === null) { return; }
    const data = new Float32Array(positions.length * 5);
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      const m = maplibregl.MercatorCoordinate.fromLngLat([p.lng, p.lat]);
      const o = i * 5;
      data[o] = m.x; data[o + 1] = m.y; data[o + 2] = p.weight ?? 1.0;
      data[o + 3] = p.lng * DEG2RAD; data[o + 4] = p.lat * DEG2RAD;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.instanceCount = positions.length;
  }

  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    for (const s of this.shaders.values()) { gl.deleteProgram(s.program); }
    this.shaders.clear();
    if (this.blur !== null) { gl.deleteProgram(this.blur.program); }
    if (this.composite !== null) { gl.deleteProgram(this.composite.program); }
    for (const b of [this.quadBuf, this.instanceBuf, this.nightVB, this.nightIB]) {
      if (b !== null) { gl.deleteBuffer(b); }
    }
    if (this.brightTex !== null) { gl.deleteTexture(this.brightTex); }
    if (this.brightFbo !== null) { gl.deleteFramebuffer(this.brightFbo); }
    for (const m of this.mips) {
      gl.deleteFramebuffer(m.fbo); gl.deleteTexture(m.tex);
      gl.deleteFramebuffer(m.pingFbo); gl.deleteTexture(m.pingTex);
    }
    this.mips = [];
    this.gl = null;
    this.map = null;
  }
}
