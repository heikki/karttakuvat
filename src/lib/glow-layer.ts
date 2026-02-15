import maplibregl, { createTileMesh } from 'maplibre-gl';
import type { CustomRenderMethodInput } from 'maplibre-gl';

export interface GlowConfig {
  baseRadius: number;
  color: [number, number, number];
}

// ============================================================
// Subsolar point calculation (ported from maplibre-gl-nightlayer)
// ============================================================

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad / Math.PI) * 180;
}

/** Integer division that rounds toward negative infinity */
function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q;
}

/** Modulo that always returns a non-negative result */
function floorMod(a: bigint, b: bigint): bigint {
  return a - floorDiv(a, b) * b;
}

function isLeapYear(y: bigint): boolean {
  if (y % 4n !== 0n) return false;
  if (y % 100n !== 0n) return true;
  return y % 400n === 0n;
}

const SECS_PER_DAY = 86400n;
const EPOCH_DAYS = 719528n; // days from year 0 to Unix epoch (1970-01-01)
const DAYS_PER_400Y = 146097n;

interface DateParts {
  dayOfYear: bigint;
  secondsOfDay: number;
}

function dateParts(epochSeconds: number): DateParts {
  const totalSecs = BigInt(Math.floor(epochSeconds));
  const frac = epochSeconds - Math.floor(epochSeconds);
  const daysBig = floorDiv(totalSecs, SECS_PER_DAY);
  const secsOfDay = floorMod(totalSecs, SECS_PER_DAY);

  let epochDays = daysBig + EPOCH_DAYS;
  epochDays -= 60n; // adjust for March-based year

  const era = floorDiv(epochDays, DAYS_PER_400Y);
  const dayOfEra = epochDays - era * DAYS_PER_400Y;
  const yearOfEra = floorDiv(
    dayOfEra - dayOfEra / 1460n + dayOfEra / 36524n - dayOfEra / 146096n,
    365n
  );

  let year = yearOfEra + era * 400n;
  const dayOfYear0 = dayOfEra - (365n * yearOfEra + yearOfEra / 4n - yearOfEra / 100n);
  const m = (5n * dayOfYear0 + 2n) / 153n;
  const day = dayOfYear0 - (153n * m + 2n) / 5n + 1n;

  let month = m + 3n;
  if (month > 12n) {
    month -= 12n;
    year += 1n;
  }

  const daysInMonth = [31n, isLeapYear(year) ? 29n : 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n];
  let doy = day;
  for (let i = 0; i < Number(month) - 1; i++) {
    doy += daysInMonth[i]!;
  }

  return {
    dayOfYear: doy,
    secondsOfDay: Number(secsOfDay) + frac,
  };
}

/**
 * Compute the subsolar point (where the sun is directly overhead) for a given date.
 */
export function getSubsolarPoint(date: Date | null = null): { lng: number; lat: number } {
  const epochSec = (date ?? new Date()).getTime() / 1000;
  const { dayOfYear, secondsOfDay } = dateParts(epochSec);

  const dayFrac = Number(dayOfYear) + secondsOfDay / 86400;
  const angVel = (2 * Math.PI) / 365.24;
  const obliquity = toRad(23.44);
  const eccentricity = 0.0167;

  const meanAnomaly = (dayFrac + 9) * angVel;
  const eclipticLng = meanAnomaly + 2 * eccentricity * Math.sin((dayFrac - 3) * angVel);

  const eqTime =
    (meanAnomaly - Math.atan2(Math.sin(eclipticLng), Math.cos(eclipticLng) * Math.cos(obliquity))) / Math.PI;
  const correction = 720 * (eqTime - Math.trunc(eqTime + 0.5));

  const lng = -15 * (secondsOfDay / 3600 - 12 + correction / 60);
  const lat = toDeg(Math.asin(Math.sin(-obliquity) * Math.cos(eclipticLng)));

  return { lng, lat };
}

// ============================================================
// Shader types
// ============================================================

/** Number of blur pyramid levels */
const MIP_LEVELS = 7;

/** Blur iterations per mip level */
const BLUR_ITERATIONS = 4;

/** Gaussian blur kernel weights (9-tap) */
const BLUR_WEIGHTS = [0.227027, 0.194595, 0.121622, 0.054054, 0.016216];

interface PointShaderSet {
  program: WebGLProgram;
  aPhotoPos: number;
  aLngLat: number;
  uViewport: WebGLUniformLocation | null;
  uZoom: WebGLUniformLocation | null;
  uPointSize: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uIntensity: WebGLUniformLocation | null;
  uSunDir: WebGLUniformLocation | null;
  uMatrix: WebGLUniformLocation | null;
  uProjectionMatrix: WebGLUniformLocation | null;
  uFallbackMatrix: WebGLUniformLocation | null;
  uTileMercatorCoords: WebGLUniformLocation | null;
  uClippingPlane: WebGLUniformLocation | null;
  uProjectionTransition: WebGLUniformLocation | null;
}

interface NightShaderSet {
  program: WebGLProgram;
  aPosition: number;
  uSubsolar: WebGLUniformLocation | null;
  uOpacity: WebGLUniformLocation | null;
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
  private pointShaders = new Map<string, PointShaderSet>();
  private nightShaders = new Map<string, NightShaderSet>();
  private blurShader: BlurShader | null = null;
  private compositeShader: CompositeShader | null = null;

  // Night mesh buffers
  private nightVertexBuffer: WebGLBuffer | null = null;
  private nightIndexBuffer: WebGLBuffer | null = null;
  private nightIndexCount = 0;
  private nightMeshKey = '';

  // Bright pass FBO (full res)
  private brightFbo: WebGLFramebuffer | null = null;
  private brightTexture: WebGLTexture | null = null;
  private brightWidth = 0;
  private brightHeight = 0;

  // Blur pyramid
  private mipLevels: MipLevel[] = [];

  private instanceCount = 0;
  private config: GlowConfig;

  // Night state
  private nightDate: Date | null = null;
  private nightOpacity = 0.8;
  private nightHidden = false;

  constructor(id: string, config: GlowConfig) {
    this.id = id;
    this.config = config;
  }

  // --- Public API for night layer control ---

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
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    this.instanceBuffer = gl.createBuffer();
    this.brightFbo = gl.createFramebuffer();
    this.brightTexture = gl.createTexture();

    // Night mesh buffers
    this.nightVertexBuffer = gl.createBuffer();
    this.nightIndexBuffer = gl.createBuffer();

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

  // --- Night shadow shader ---

  private getOrCreateNightShader(
    gl: WebGL2RenderingContext,
    shaderData: CustomRenderMethodInput['shaderData']
  ): NightShaderSet {
    const key = shaderData?.variantName ?? 'default';
    const existing = this.nightShaders.get(key);
    if (existing !== undefined) return existing;

    const hasPrelude =
      shaderData?.vertexShaderPrelude !== undefined &&
      shaderData.vertexShaderPrelude.length > 0;

    const vertSrc = `#version 300 es
      precision highp float;
      in vec2 a_position;
      out vec2 v_position;
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
        gl_Position = projectTile(a_position);
        v_position = a_position;
      }
    `;

    const fragSrc = `#version 300 es
      precision highp float;
      in vec2 v_position;
      out vec4 fragColor;

      uniform vec2 u_subsolar;
      uniform float u_opacity;

      vec2 mercatorToLngLat(vec2 mercator) {
        float x = mercator.x;
        float y = mercator.y;
        float lng = x * 360.0 - 180.0;
        float lat = degrees(2.0 * atan(exp(${Math.PI} * (1.0 - 2.0 * y))) - ${Math.PI / 2});
        return vec2(lng, lat);
      }

      void main() {
        vec2 lnglat = mercatorToLngLat(v_position);
        vec2 observer = radians(lnglat);
        vec2 subsolar = radians(u_subsolar);
        float A = sin(observer.y) * sin(subsolar.y);
        float B = cos(observer.y) * cos(subsolar.y) * cos(subsolar.x - observer.x);
        float altitude = degrees(asin(A + B));

        // Smooth gradation (twilightSteps = 0)
        float twilightLevel = -altitude / 6.0;
        float brightness = clamp(pow(0.5, twilightLevel), 0.0, 1.0);
        float darkness = (1.0 - brightness) * u_opacity;
        fragColor = vec4(0.0, 0.0, 0.0, darkness);
      }
    `;

    const program = this.createProgram(gl, vertSrc, fragSrc);
    if (program === null) throw new Error('Failed to create night shader');

    const set: NightShaderSet = {
      program,
      aPosition: gl.getAttribLocation(program, 'a_position'),
      uSubsolar: gl.getUniformLocation(program, 'u_subsolar'),
      uOpacity: gl.getUniformLocation(program, 'u_opacity'),
      uMatrix: gl.getUniformLocation(program, 'u_matrix'),
      uProjectionMatrix: gl.getUniformLocation(program, 'u_projection_matrix'),
      uFallbackMatrix: gl.getUniformLocation(program, 'u_projection_fallback_matrix'),
      uTileMercatorCoords: gl.getUniformLocation(program, 'u_projection_tile_mercator_coords'),
      uClippingPlane: gl.getUniformLocation(program, 'u_projection_clipping_plane'),
      uProjectionTransition: gl.getUniformLocation(program, 'u_projection_transition'),
    };

    this.nightShaders.set(key, set);
    return set;
  }

  private updateNightMesh(gl: WebGL2RenderingContext) {
    if (this.map === null || this.nightVertexBuffer === null || this.nightIndexBuffer === null) return;

    const isGlobe = this.map.getProjection().type === 'globe';
    const meshKey = isGlobe
      ? 'globe'
      : (() => {
          const [sw, ne] = this.map!.getBounds().toArray();
          const west = Math.floor(maplibregl.MercatorCoordinate.fromLngLat(sw).x);
          const east = Math.ceil(maplibregl.MercatorCoordinate.fromLngLat(ne).x);
          return `${west},${east}`;
        })();

    if (meshKey === this.nightMeshKey) return;
    this.nightMeshKey = meshKey;

    if (isGlobe) {
      const mesh = createTileMesh(
        { granularity: 100, generateBorders: false, extendToNorthPole: true, extendToSouthPole: true },
        '16bit'
      );
      // Globe mesh vertices are Int16, need to divide by 8192 to get 0..1 range
      const verts = new Float32Array(new Int16Array(mesh.vertices)).map((v) => v / 8192);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nightVertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nightIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
      this.nightIndexCount = mesh.indices.byteLength / 2;
    } else {
      const [sw, ne] = this.map.getBounds().toArray();
      const west = Math.floor(maplibregl.MercatorCoordinate.fromLngLat(sw).x);
      const east = Math.ceil(maplibregl.MercatorCoordinate.fromLngLat(ne).x);
      const verts = new Float32Array([west, 0, east, 0, west, 1, west, 1, east, 0, east, 1]);
      const indices = new Uint16Array([0, 1, 2, 3, 4, 5]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nightVertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nightIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.DYNAMIC_DRAW);
      this.nightIndexCount = 6;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
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
      in vec2 a_lnglat;
      uniform vec2 u_viewport;
      uniform float u_zoom;
      uniform float u_point_size;
      uniform vec3 u_sun_dir;
      out float v_night;
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

        // Compute night factor: dot product of point direction and sun direction
        float lng = a_lnglat.x;
        float lat = a_lnglat.y;
        vec3 pointDir = vec3(cos(lat) * cos(lng), cos(lat) * sin(lng), sin(lat));
        float sunDot = dot(pointDir, u_sun_dir);
        // sunDot > 0 = dayside, < 0 = nightside
        // Smooth transition over twilight zone
        v_night = smoothstep(0.1, -0.1, sunDot);

        gl_PointSize = max(2.0, u_point_size * pow(1.5, u_zoom - 8.0) * weight) * v_night;
      }
    `;

    const fragSrc = `#version 300 es
      precision highp float;
      uniform vec3 u_color;
      uniform float u_intensity;
      in float v_night;
      out vec4 fragColor;
      void main() {
        if (v_night < 0.001) discard;
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float dist = length(p);
        if (dist > 1.0) discard;
        float falloff = 1.0 - dist * dist;
        fragColor = vec4(u_color * u_intensity * falloff * v_night, 1.0);
      }
    `;

    const program = this.createProgram(gl, vertSrc, fragSrc);
    if (program === null) throw new Error('Failed to create point shader');

    const set: PointShaderSet = {
      program,
      aPhotoPos: gl.getAttribLocation(program, 'a_photo_pos'),
      aLngLat: gl.getAttribLocation(program, 'a_lnglat'),
      uViewport: gl.getUniformLocation(program, 'u_viewport'),
      uZoom: gl.getUniformLocation(program, 'u_zoom'),
      uPointSize: gl.getUniformLocation(program, 'u_point_size'),
      uColor: gl.getUniformLocation(program, 'u_color'),
      uIntensity: gl.getUniformLocation(program, 'u_intensity'),
      uSunDir: gl.getUniformLocation(program, 'u_sun_dir'),
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
    const weightsStr = BLUR_WEIGHTS.map((w) => w.toFixed(6)).join(', ');

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

  // --- Projection uniform helper (shared by point and night shaders) ---

  private setProjectionUniformsGeneric(
    gl: WebGL2RenderingContext,
    shader: {
      uMatrix: WebGLUniformLocation | null;
      uProjectionMatrix: WebGLUniformLocation | null;
      uFallbackMatrix: WebGLUniformLocation | null;
      uTileMercatorCoords: WebGLUniformLocation | null;
      uClippingPlane: WebGLUniformLocation | null;
      uProjectionTransition: WebGLUniformLocation | null;
    },
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

  // --- Main render ---

  render(gl: WebGL2RenderingContext, _options: CustomRenderMethodInput) {
    const options: CustomRenderMethodInput =
      typeof (_options as unknown as Float32Array)?.length === 'number'
        ? (arguments[2] as CustomRenderMethodInput)
        : _options;

    if (
      this.map === null ||
      this.fullscreenQuadBuffer === null
    )
      return;

    const shaderData = options?.shaderData;

    const canvas = this.map.getCanvas();
    const w = canvas.width;
    const h = canvas.height;

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
    const sun = this.getSubsolarPoint();
    const DEG2RAD = Math.PI / 180;
    const slng = sun.lng * DEG2RAD;
    const slat = sun.lat * DEG2RAD;
    const sunDir: [number, number, number] = [
      Math.cos(slat) * Math.cos(slng),
      Math.cos(slat) * Math.sin(slng),
      Math.sin(slat),
    ];

    // ============================================================
    // Pass 0: Night shadow onto map
    // ============================================================
    const isGlobe = this.map.getProjection().type === 'globe';
    const nightVisible = isGlobe && !this.nightHidden && this.nightOpacity > 0;

    if (nightVisible && this.nightVertexBuffer !== null && this.nightIndexBuffer !== null) {
      this.updateNightMesh(gl);
      const nightShader = this.getOrCreateNightShader(gl, shaderData);

      gl.useProgram(nightShader.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      this.setProjectionUniformsGeneric(gl, nightShader, options);
      gl.uniform2f(nightShader.uSubsolar!, sun.lng, sun.lat);
      gl.uniform1f(nightShader.uOpacity!, this.nightOpacity);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.nightVertexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.nightIndexBuffer);
      gl.enableVertexAttribArray(nightShader.aPosition);
      gl.vertexAttribPointer(nightShader.aPosition, 2, gl.FLOAT, false, 0, 0);

      gl.drawElements(gl.TRIANGLES, this.nightIndexCount, gl.UNSIGNED_SHORT, 0);

      gl.disableVertexAttribArray(nightShader.aPosition);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    }

    // ============================================================
    // Pass 1: Render zoom-dependent point sprites into bright FBO
    // ============================================================
    if (
      this.instanceCount === 0 ||
      this.instanceBuffer === null ||
      this.brightFbo === null ||
      this.blurShader === null ||
      this.compositeShader === null
    ) {
      // Restore and return — no glow to render
      this.restoreGlState(gl, prevFbo, prevBlend, prevBlendSrc, prevBlendDst, prevBlendSrcA, prevBlendDstA, prevActiveTexture, prevViewport);
      return;
    }

    const pointShader = this.getOrCreatePointShader(gl, shaderData);
    this.ensureFboSizes(gl, w, h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.brightFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(pointShader.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR); // Screen

    this.setProjectionUniformsGeneric(gl, pointShader, options);

    gl.uniform2f(pointShader.uViewport, w, h);
    gl.uniform1f(pointShader.uZoom, zoom);
    gl.uniform1f(pointShader.uPointSize, 10.0);
    gl.uniform3fv(pointShader.uColor, this.config.color);
    gl.uniform1f(pointShader.uIntensity, 1.7);
    gl.uniform3f(pointShader.uSunDir, sunDir[0], sunDir[1], sunDir[2]);

    const STRIDE = 5 * 4; // 5 floats × 4 bytes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.enableVertexAttribArray(pointShader.aPhotoPos);
    gl.vertexAttribPointer(pointShader.aPhotoPos, 3, gl.FLOAT, false, STRIDE, 0);
    if (pointShader.aLngLat >= 0) {
      gl.enableVertexAttribArray(pointShader.aLngLat);
      gl.vertexAttribPointer(pointShader.aLngLat, 2, gl.FLOAT, false, STRIDE, 3 * 4);
    }

    gl.drawArrays(gl.POINTS, 0, this.instanceCount);

    gl.disableVertexAttribArray(pointShader.aPhotoPos);
    if (pointShader.aLngLat >= 0) gl.disableVertexAttribArray(pointShader.aLngLat);

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
    this.restoreGlState(gl, prevFbo, prevBlend, prevBlendSrc, prevBlendDst, prevBlendSrcA, prevBlendDstA, prevActiveTexture, prevViewport);
  }

  private restoreGlState(
    gl: WebGL2RenderingContext,
    prevFbo: WebGLFramebuffer | null,
    prevBlend: boolean,
    prevBlendSrc: number,
    prevBlendDst: number,
    prevBlendSrcA: number,
    prevBlendDstA: number,
    prevActiveTexture: number,
    prevViewport: Int32Array
  ) {
    if (prevBlend) {
      gl.enable(gl.BLEND);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.blendFuncSeparate(prevBlendSrc, prevBlendDst, prevBlendSrcA, prevBlendDstA);
    gl.activeTexture(prevActiveTexture);
    gl.viewport(prevViewport[0]!, prevViewport[1]!, prevViewport[2]!, prevViewport[3]!);
  }

  updateData(positions: Array<{ lng: number; lat: number; weight?: number }>) {
    const gl = this.gl;
    if (gl === null || this.instanceBuffer === null) return;

    const STRIDE = 5; // mercX, mercY, weight, lngRad, latRad
    const data = new Float32Array(positions.length * STRIDE);
    const DEG2RAD = Math.PI / 180;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      const merc = maplibregl.MercatorCoordinate.fromLngLat([p.lng, p.lat]);
      const off = i * STRIDE;
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

  onRemove(_map: maplibregl.Map, gl: WebGL2RenderingContext) {
    for (const shader of this.pointShaders.values()) {
      gl.deleteProgram(shader.program);
    }
    this.pointShaders.clear();
    for (const shader of this.nightShaders.values()) {
      gl.deleteProgram(shader.program);
    }
    this.nightShaders.clear();
    if (this.blurShader !== null) gl.deleteProgram(this.blurShader.program);
    if (this.compositeShader !== null) gl.deleteProgram(this.compositeShader.program);
    if (this.fullscreenQuadBuffer !== null) gl.deleteBuffer(this.fullscreenQuadBuffer);
    if (this.instanceBuffer !== null) gl.deleteBuffer(this.instanceBuffer);
    if (this.nightVertexBuffer !== null) gl.deleteBuffer(this.nightVertexBuffer);
    if (this.nightIndexBuffer !== null) gl.deleteBuffer(this.nightIndexBuffer);
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
    this.nightVertexBuffer = null;
    this.nightIndexBuffer = null;
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
