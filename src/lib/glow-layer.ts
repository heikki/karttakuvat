import maplibregl from 'maplibre-gl';
import type { CustomRenderMethodInput } from 'maplibre-gl';

export interface GlowConfig {
  baseRadius: number;
  color: [number, number, number];
}

/** Number of blur pyramid levels */
const MIP_LEVELS = 7;

/** Blur iterations per mip level */
const BLUR_ITERATIONS = 4;

/** Gaussian blur kernel weights (9-tap) */
const BLUR_WEIGHTS = [0.227027, 0.194595, 0.121622, 0.054054, 0.016216];

interface PointShaderSet {
  program: WebGLProgram;
  aPhotoPos: number;
  uViewport: WebGLUniformLocation | null;
  uZoom: WebGLUniformLocation | null;
  uPointSize: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uIntensity: WebGLUniformLocation | null;
  uMatrix: WebGLUniformLocation | null;
  uProjectionMatrix: WebGLUniformLocation | null;
  uFallbackMatrix: WebGLUniformLocation | null;
  uTileMercatorCoords: WebGLUniformLocation | null;
  uClippingPlane: WebGLUniformLocation | null;
  uProjectionTransition: WebGLUniformLocation | null;
}

interface BlurShader {
  program: WebGLProgram;
  aPos: number;
  uTexture: WebGLUniformLocation | null;
  uDirection: WebGLUniformLocation | null;
  uResolution: WebGLUniformLocation | null;
  uSpread: WebGLUniformLocation | null;
}

interface CompositeShader {
  program: WebGLProgram;
  aPos: number;
  uBloomTextures: (WebGLUniformLocation | null)[];
  uStrength: WebGLUniformLocation | null;
  uMipWeights: WebGLUniformLocation | null;
}

interface MipLevel {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  pingFbo: WebGLFramebuffer;
  pingTexture: WebGLTexture;
  width: number;
  height: number;
}

export class PhotoGlowLayer implements maplibregl.CustomLayerInterface {
  readonly id: string;
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private gl: WebGL2RenderingContext | null = null;
  private map: maplibregl.Map | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private fullscreenQuadBuffer: WebGLBuffer | null = null;
  private pointShaders = new Map<string, PointShaderSet>();
  private blurShader: BlurShader | null = null;
  private compositeShader: CompositeShader | null = null;

  // Bright pass FBO (full res)
  private brightFbo: WebGLFramebuffer | null = null;
  private brightTexture: WebGLTexture | null = null;
  private brightWidth = 0;
  private brightHeight = 0;

  // Blur pyramid
  private mipLevels: MipLevel[] = [];

  private instanceCount = 0;
  private config: GlowConfig;

  constructor(id: string, config: GlowConfig) {
    this.id = id;
    this.config = config;
  }

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;

    this.fullscreenQuadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    this.instanceBuffer = gl.createBuffer();
    this.brightFbo = gl.createFramebuffer();
    this.brightTexture = gl.createTexture();

    this.blurShader = this.createBlurShader(gl);
    this.compositeShader = this.createCompositeShader(gl);
  }

  private initTexture(gl: WebGL2RenderingContext, tex: WebGLTexture, w: number, h: number) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private ensureFboSizes(gl: WebGL2RenderingContext, w: number, h: number) {
    if (w === this.brightWidth && h === this.brightHeight) return;
    this.brightWidth = w;
    this.brightHeight = h;

    // Bright pass (full res)
    this.initTexture(gl, this.brightTexture!, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.brightTexture, 0);

    // Clean old mips
    for (const mip of this.mipLevels) {
      gl.deleteFramebuffer(mip.fbo);
      gl.deleteTexture(mip.texture);
      gl.deleteFramebuffer(mip.pingFbo);
      gl.deleteTexture(mip.pingTexture);
    }
    this.mipLevels = [];

    // Create mip pyramid
    let mw = Math.max(1, Math.floor(w / 2));
    let mh = Math.max(1, Math.floor(h / 2));
    for (let i = 0; i < MIP_LEVELS; i++) {
      const texture = gl.createTexture()!;
      this.initTexture(gl, texture, mw, mh);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

      const pingTexture = gl.createTexture()!;
      this.initTexture(gl, pingTexture, mw, mh);
      const pingFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, pingFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pingTexture, 0);

      this.mipLevels.push({ fbo, texture, pingFbo, pingTexture, width: mw, height: mh });
      mw = Math.max(1, Math.floor(mw / 2));
      mh = Math.max(1, Math.floor(mh / 2));
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // --- Point sprite shader ---

  private getOrCreatePointShader(
    gl: WebGL2RenderingContext,
    shaderData: CustomRenderMethodInput['shaderData']
  ): PointShaderSet {
    const key = shaderData?.variantName ?? 'default';
    const existing = this.pointShaders.get(key);
    if (existing !== undefined) return existing;

    const hasPrelude =
      shaderData?.vertexShaderPrelude !== undefined &&
      shaderData.vertexShaderPrelude.length > 0;

    const vertSrc = `#version 300 es
      precision highp float;
      in vec3 a_photo_pos;
      uniform vec2 u_viewport;
      uniform float u_zoom;
      uniform float u_point_size;
${
  hasPrelude
    ? `
      ${shaderData.vertexShaderPrelude}
      ${shaderData.define ?? ''}
`
    : `
      uniform mat4 u_matrix;
      vec4 projectTile(vec2 pos) {
        return u_matrix * vec4(pos, 0.0, 1.0);
      }
`
}
      void main() {
        vec4 center = projectTile(a_photo_pos.xy);
        gl_Position = center;
        float weight = a_photo_pos.z;
        gl_PointSize = max(2.0, u_point_size * pow(1.5, u_zoom - 8.0) * weight);
      }
    `;

    const fragSrc = `#version 300 es
      precision highp float;
      uniform vec3 u_color;
      uniform float u_intensity;
      out vec4 fragColor;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float dist = length(p);
        if (dist > 1.0) discard;
        float falloff = 1.0 - dist * dist;
        fragColor = vec4(u_color * u_intensity * falloff, 1.0);
      }
    `;

    const program = this.createProgram(gl, vertSrc, fragSrc);
    if (program === null) throw new Error('Failed to create point shader');

    const set: PointShaderSet = {
      program,
      aPhotoPos: gl.getAttribLocation(program, 'a_photo_pos'),
      uViewport: gl.getUniformLocation(program, 'u_viewport'),
      uZoom: gl.getUniformLocation(program, 'u_zoom'),
      uPointSize: gl.getUniformLocation(program, 'u_point_size'),
      uColor: gl.getUniformLocation(program, 'u_color'),
      uIntensity: gl.getUniformLocation(program, 'u_intensity'),
      uMatrix: gl.getUniformLocation(program, 'u_matrix'),
      uProjectionMatrix: gl.getUniformLocation(program, 'u_projection_matrix'),
      uFallbackMatrix: gl.getUniformLocation(program, 'u_projection_fallback_matrix'),
      uTileMercatorCoords: gl.getUniformLocation(program, 'u_projection_tile_mercator_coords'),
      uClippingPlane: gl.getUniformLocation(program, 'u_projection_clipping_plane'),
      uProjectionTransition: gl.getUniformLocation(program, 'u_projection_transition'),
    };

    this.pointShaders.set(key, set);
    return set;
  }

  // --- Blur shader ---

  private createBlurShader(gl: WebGL2RenderingContext): BlurShader | null {
    const vertSrc = `#version 300 es
      precision highp float;
      in vec2 a_pos;
      out vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const n = BLUR_WEIGHTS.length;
    const weightsStr = BLUR_WEIGHTS.map(w => w.toFixed(6)).join(', ');

    const fragSrc = `#version 300 es
      precision highp float;
      in vec2 v_uv;
      uniform sampler2D u_texture;
      uniform vec2 u_direction;
      uniform vec2 u_resolution;
      uniform float u_spread;
      out vec4 fragColor;
      void main() {
        float weights[${n}] = float[](${weightsStr});
        vec2 texelSize = u_direction / u_resolution * u_spread;
        vec4 result = texture(u_texture, v_uv) * weights[0];
        for (int i = 1; i < ${n}; i++) {
          vec2 off = texelSize * float(i);
          result += texture(u_texture, v_uv + off) * weights[i];
          result += texture(u_texture, v_uv - off) * weights[i];
        }
        fragColor = result;
      }
    `;

    const program = this.createProgram(gl, vertSrc, fragSrc);
    if (program === null) return null;

    return {
      program,
      aPos: gl.getAttribLocation(program, 'a_pos'),
      uTexture: gl.getUniformLocation(program, 'u_texture'),
      uDirection: gl.getUniformLocation(program, 'u_direction'),
      uResolution: gl.getUniformLocation(program, 'u_resolution'),
      uSpread: gl.getUniformLocation(program, 'u_spread'),
    };
  }

  // --- Composite shader: combines all mip levels ---

  private createCompositeShader(gl: WebGL2RenderingContext): CompositeShader | null {
    const vertSrc = `#version 300 es
      precision highp float;
      in vec2 a_pos;
      out vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    let samplers = '';
    let combine = '        vec3 bloom = vec3(0.0);\n';
    for (let i = 0; i < MIP_LEVELS; i++) {
      samplers += `      uniform sampler2D u_bloom${i};\n`;
      combine += `        bloom += texture(u_bloom${i}, v_uv).rgb * u_mip_weights[${i}];\n`;
    }

    const fragSrc = `#version 300 es
      precision highp float;
      in vec2 v_uv;
${samplers}
      uniform float u_strength;
      uniform float u_mip_weights[${MIP_LEVELS}];
      out vec4 fragColor;
      void main() {
${combine}
        bloom *= u_strength;
        fragColor = vec4(bloom, 1.0);
      }
    `;

    const program = this.createProgram(gl, vertSrc, fragSrc);
    if (program === null) return null;

    const uBloomTextures: (WebGLUniformLocation | null)[] = [];
    for (let i = 0; i < MIP_LEVELS; i++) {
      uBloomTextures.push(gl.getUniformLocation(program, `u_bloom${i}`));
    }

    return {
      program,
      aPos: gl.getAttribLocation(program, 'a_pos'),
      uBloomTextures,
      uStrength: gl.getUniformLocation(program, 'u_strength'),
      uMipWeights: gl.getUniformLocation(program, 'u_mip_weights'),
    };
  }

  // --- Main render ---

  render(gl: WebGL2RenderingContext, _options: CustomRenderMethodInput) {
    const options: CustomRenderMethodInput =
      typeof (_options as unknown as Float32Array)?.length === 'number'
        ? (arguments[2] as CustomRenderMethodInput)
        : _options;

    if (
      this.instanceCount === 0 ||
      this.instanceBuffer === null ||
      this.map === null ||
      this.brightFbo === null ||
      this.blurShader === null ||
      this.compositeShader === null ||
      this.fullscreenQuadBuffer === null
    )
      return;

    const shaderData = options?.shaderData;
    const pointShader = this.getOrCreatePointShader(gl, shaderData);

    const canvas = this.map.getCanvas();
    const w = canvas.width;
    const h = canvas.height;
    this.ensureFboSizes(gl, w, h);

    // Save GL state
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevBlend = gl.getParameter(gl.BLEND) as boolean;
    const prevBlendSrc = gl.getParameter(gl.BLEND_SRC_RGB) as number;
    const prevBlendDst = gl.getParameter(gl.BLEND_DST_RGB) as number;
    const prevBlendSrcA = gl.getParameter(gl.BLEND_SRC_ALPHA) as number;
    const prevBlendDstA = gl.getParameter(gl.BLEND_DST_ALPHA) as number;
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;

    const zoom = this.map.getZoom();

    // ============================================================
    // Pass 1: Render zoom-dependent point sprites into bright FBO
    // ============================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(pointShader.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); // Screen

    this.setProjectionUniforms(gl, pointShader, options);

    gl.uniform2f(pointShader.uViewport, w, h);
    gl.uniform1f(pointShader.uZoom, zoom);
    gl.uniform1f(pointShader.uPointSize, 10.0);
    gl.uniform3fv(pointShader.uColor, this.config.color);
    gl.uniform1f(pointShader.uIntensity, 1.7);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.enableVertexAttribArray(pointShader.aPhotoPos);
    gl.vertexAttribPointer(pointShader.aPhotoPos, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, this.instanceCount);

    gl.disableVertexAttribArray(pointShader.aPhotoPos);

    // ============================================================
    // Passes 2–N: Downsample + blur pyramid
    // ============================================================
    gl.useProgram(this.blurShader.program);
    gl.disable(gl.BLEND);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadBuffer);
    gl.enableVertexAttribArray(this.blurShader.aPos);
    gl.vertexAttribPointer(this.blurShader.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.blurShader.uTexture, 0);

    // Wider blur at low zoom too, grows further at high zoom
    const blurSpread = Math.max(0.1, Math.pow(1.4, zoom - 4.0) * 0.3);
    gl.uniform1f(this.blurShader.uSpread!, blurSpread);

    let srcTexture = this.brightTexture!;

    for (let i = 0; i < MIP_LEVELS; i++) {
      const mip = this.mipLevels[i]!;
      gl.viewport(0, 0, mip.width, mip.height);
      gl.uniform2f(this.blurShader.uResolution!, mip.width, mip.height);

      let readTex = srcTexture;

      for (let iter = 0; iter < BLUR_ITERATIONS; iter++) {
        // H blur: readTex → pingFbo
        gl.bindFramebuffer(gl.FRAMEBUFFER, mip.pingFbo);
        gl.bindTexture(gl.TEXTURE_2D, readTex);
        gl.uniform2f(this.blurShader.uDirection!, 1.0, 0.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // V blur: pingTexture → fbo
        gl.bindFramebuffer(gl.FRAMEBUFFER, mip.fbo);
        gl.bindTexture(gl.TEXTURE_2D, mip.pingTexture);
        gl.uniform2f(this.blurShader.uDirection!, 0.0, 1.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        readTex = mip.texture;
      }

      srcTexture = mip.texture;
    }

    gl.disableVertexAttribArray(this.blurShader.aPos);

    // ============================================================
    // Final pass: Combine all mip levels + screen blend onto map
    // ============================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(0, 0, w, h);

    gl.useProgram(this.compositeShader.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); // Screen onto map

    for (let i = 0; i < MIP_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.mipLevels[i]!.texture);
      gl.uniform1i(this.compositeShader.uBloomTextures[i]!, i);
    }

    // Bloom subtler at high zoom, stronger at low zoom
    const bloomStrength = 1.2;
    gl.uniform1f(this.compositeShader.uStrength!, bloomStrength);

    const mipWeights = new Float32Array([0.6, 0.3, 0.8, 2.0, 1.2, 0.6, 0.3]);
    gl.uniform1fv(this.compositeShader.uMipWeights!, mipWeights);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuadBuffer);
    gl.enableVertexAttribArray(this.compositeShader.aPos);
    gl.vertexAttribPointer(this.compositeShader.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disableVertexAttribArray(this.compositeShader.aPos);

    // Unbind textures
    for (let i = 0; i < MIP_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    // Restore GL state
    if (prevBlend) {
      gl.enable(gl.BLEND);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.blendFuncSeparate(prevBlendSrc, prevBlendDst, prevBlendSrcA, prevBlendDstA);
    gl.activeTexture(prevActiveTexture);
    gl.viewport(prevViewport[0]!, prevViewport[1]!, prevViewport[2]!, prevViewport[3]!);
  }

  private setProjectionUniforms(
    gl: WebGL2RenderingContext,
    shader: PointShaderSet,
    options: CustomRenderMethodInput
  ) {
    if ('getProjectionDataForCustomLayer' in this.map!.transform) {
      const projData = (
        this.map!.transform as {
          getProjectionDataForCustomLayer: (
            b: boolean
          ) => {
            mainMatrix: Float32Array;
            fallbackMatrix: Float32Array;
            tileMercatorCoords: [number, number, number, number];
            clippingPlane: [number, number, number, number];
            projectionTransition: number;
          };
        }
      ).getProjectionDataForCustomLayer(true);
      if (shader.uProjectionMatrix !== null)
        gl.uniformMatrix4fv(shader.uProjectionMatrix, false, projData.mainMatrix);
      if (shader.uFallbackMatrix !== null)
        gl.uniformMatrix4fv(shader.uFallbackMatrix, false, projData.fallbackMatrix);
      if (shader.uTileMercatorCoords !== null)
        gl.uniform4f(shader.uTileMercatorCoords, ...projData.tileMercatorCoords);
      if (shader.uClippingPlane !== null)
        gl.uniform4f(shader.uClippingPlane, ...projData.clippingPlane);
      if (shader.uProjectionTransition !== null)
        gl.uniform1f(shader.uProjectionTransition, projData.projectionTransition);
    } else if (shader.uMatrix !== null) {
      gl.uniformMatrix4fv(shader.uMatrix, false, options.modelViewProjectionMatrix);
    }
  }

  updateData(positions: Array<{ lng: number; lat: number; weight?: number }>) {
    const gl = this.gl;
    if (gl === null || this.instanceBuffer === null) return;

    const data = new Float32Array(positions.length * 3);
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      const merc = maplibregl.MercatorCoordinate.fromLngLat([p.lng, p.lat]);
      data[i * 3] = merc.x;
      data[i * 3 + 1] = merc.y;
      data[i * 3 + 2] = p.weight ?? 1.0;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.instanceCount = positions.length;
  }

  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    for (const shader of this.pointShaders.values()) {
      gl.deleteProgram(shader.program);
    }
    this.pointShaders.clear();
    if (this.blurShader !== null) gl.deleteProgram(this.blurShader.program);
    if (this.compositeShader !== null) gl.deleteProgram(this.compositeShader.program);
    if (this.fullscreenQuadBuffer !== null) gl.deleteBuffer(this.fullscreenQuadBuffer);
    if (this.instanceBuffer !== null) gl.deleteBuffer(this.instanceBuffer);
    if (this.brightTexture !== null) gl.deleteTexture(this.brightTexture);
    if (this.brightFbo !== null) gl.deleteFramebuffer(this.brightFbo);
    for (const mip of this.mipLevels) {
      gl.deleteFramebuffer(mip.fbo);
      gl.deleteTexture(mip.texture);
      gl.deleteFramebuffer(mip.pingFbo);
      gl.deleteTexture(mip.pingTexture);
    }
    this.mipLevels = [];
    this.fullscreenQuadBuffer = null;
    this.instanceBuffer = null;
    this.brightFbo = null;
    this.brightTexture = null;
    this.blurShader = null;
    this.compositeShader = null;
    this.gl = null;
    this.map = null;
  }

  private createProgram(
    gl: WebGL2RenderingContext,
    vertSrc: string,
    fragSrc: string
  ): WebGLProgram | null {
    const vert = gl.createShader(gl.VERTEX_SHADER);
    if (vert === null) return null;
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      console.error('Glow vertex shader error:', gl.getShaderInfoLog(vert));
      gl.deleteShader(vert);
      return null;
    }

    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    if (frag === null) {
      gl.deleteShader(vert);
      return null;
    }
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      console.error('Glow fragment shader error:', gl.getShaderInfoLog(frag));
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      return null;
    }

    const program = gl.createProgram();
    if (program === null) {
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      return null;
    }
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Glow program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
      return null;
    }

    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return program;
  }
}
