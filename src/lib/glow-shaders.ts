import type { CustomRenderMethodInput } from 'maplibre-gl';
import type maplibregl from 'maplibre-gl';

// ============================================================
// Shared constants
// ============================================================

export const MIP_LEVELS = 7;

/** Gaussian blur kernel weights (9-tap) */
const BLUR_WEIGHTS = [0.227027, 0.194595, 0.121622, 0.054054, 0.016216];

// ============================================================
// Shader interfaces
// ============================================================

export interface PointShaderSet {
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

export interface NightShaderSet {
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

export interface BlurShader {
  program: WebGLProgram;
  aPos: number;
  uTexture: WebGLUniformLocation | null;
  uDirection: WebGLUniformLocation | null;
  uResolution: WebGLUniformLocation | null;
  uSpread: WebGLUniformLocation | null;
}

export interface CompositeShader {
  program: WebGLProgram;
  aPos: number;
  uBloomTextures: Array<WebGLUniformLocation | null>;
  uStrength: WebGLUniformLocation | null;
  uMipWeights: WebGLUniformLocation | null;
}

/** Uniforms shared by night and point shaders for globe projection */
interface ProjectionUniforms {
  uMatrix: WebGLUniformLocation | null;
  uProjectionMatrix: WebGLUniformLocation | null;
  uFallbackMatrix: WebGLUniformLocation | null;
  uTileMercatorCoords: WebGLUniformLocation | null;
  uClippingPlane: WebGLUniformLocation | null;
  uProjectionTransition: WebGLUniformLocation | null;
}

// ============================================================
// Program compilation
// ============================================================

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string
): WebGLProgram | null {
  const vert = gl.createShader(gl.VERTEX_SHADER);
  if (vert === null) { return null; }
  gl.shaderSource(vert, vertSrc);
  gl.compileShader(vert);
  if (gl.getShaderParameter(vert, gl.COMPILE_STATUS) === false) {
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
  if (gl.getShaderParameter(frag, gl.COMPILE_STATUS) === false) {
    console.error('Glow fragment shader error:', gl.getShaderInfoLog(frag));
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return null;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (gl.getProgramParameter(program, gl.LINK_STATUS) === false) {
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

// ============================================================
// Vertex shader prelude (shared by night + point shaders)
// ============================================================

type ShaderData = CustomRenderMethodInput['shaderData'];

function projectionPrelude(shaderData: ShaderData): string {
  if (shaderData.vertexShaderPrelude.length > 0) {
    return `${shaderData.vertexShaderPrelude}\n${shaderData.define}`;
  }
  return `
    uniform mat4 u_matrix;
    vec4 projectTile(vec2 pos) {
      return u_matrix * vec4(pos, 0.0, 1.0);
    }`;
}

function extractProjectionUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): ProjectionUniforms {
  return {
    uMatrix: gl.getUniformLocation(program, 'u_matrix'),
    uProjectionMatrix: gl.getUniformLocation(program, 'u_projection_matrix'),
    uFallbackMatrix: gl.getUniformLocation(program, 'u_projection_fallback_matrix'),
    uTileMercatorCoords: gl.getUniformLocation(program, 'u_projection_tile_mercator_coords'),
    uClippingPlane: gl.getUniformLocation(program, 'u_projection_clipping_plane'),
    uProjectionTransition: gl.getUniformLocation(program, 'u_projection_transition'),
  };
}

// ============================================================
// Night shadow shader
// ============================================================

export function createNightShader(gl: WebGL2RenderingContext, shaderData: ShaderData): NightShaderSet {
  const vertSrc = `#version 300 es
    precision highp float;
    in vec2 a_position;
    out vec2 v_position;
    ${projectionPrelude(shaderData)}
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
      float lng = mercator.x * 360.0 - 180.0;
      float lat = degrees(2.0 * atan(exp(${Math.PI} * (1.0 - 2.0 * mercator.y))) - ${Math.PI / 2});
      return vec2(lng, lat);
    }

    void main() {
      vec2 lnglat = mercatorToLngLat(v_position);
      vec2 observer = radians(lnglat);
      vec2 subsolar = radians(u_subsolar);
      float A = sin(observer.y) * sin(subsolar.y);
      float B = cos(observer.y) * cos(subsolar.y) * cos(subsolar.x - observer.x);
      float altitude = degrees(asin(A + B));

      float twilightLevel = -altitude / 6.0;
      float brightness = clamp(pow(0.5, twilightLevel), 0.0, 1.0);
      float darkness = (1.0 - brightness) * u_opacity;
      fragColor = vec4(0.0, 0.0, 0.0, darkness);
    }
  `;

  const program = compileProgram(gl, vertSrc, fragSrc);
  if (program === null) { throw new Error('Failed to create night shader'); }

  return {
    program,
    aPosition: gl.getAttribLocation(program, 'a_position'),
    uSubsolar: gl.getUniformLocation(program, 'u_subsolar'),
    uOpacity: gl.getUniformLocation(program, 'u_opacity'),
    ...extractProjectionUniforms(gl, program),
  };
}

// ============================================================
// Point sprite shader (bright pass for bloom)
// ============================================================

export function createPointShader(gl: WebGL2RenderingContext, shaderData: ShaderData): PointShaderSet {
  const vertSrc = `#version 300 es
    precision highp float;
    in vec3 a_photo_pos;
    in vec2 a_lnglat;
    uniform vec2 u_viewport;
    uniform float u_zoom;
    uniform float u_point_size;
    uniform vec3 u_sun_dir;
    out float v_night;
    ${projectionPrelude(shaderData)}
    void main() {
      gl_Position = projectTile(a_photo_pos.xy);
      float weight = a_photo_pos.z;

      float lng = a_lnglat.x;
      float lat = a_lnglat.y;
      vec3 pointDir = vec3(cos(lat) * cos(lng), cos(lat) * sin(lng), sin(lat));
      float sunDot = dot(pointDir, u_sun_dir);
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

  const program = compileProgram(gl, vertSrc, fragSrc);
  if (program === null) { throw new Error('Failed to create point shader'); }

  return {
    program,
    aPhotoPos: gl.getAttribLocation(program, 'a_photo_pos'),
    aLngLat: gl.getAttribLocation(program, 'a_lnglat'),
    uViewport: gl.getUniformLocation(program, 'u_viewport'),
    uZoom: gl.getUniformLocation(program, 'u_zoom'),
    uPointSize: gl.getUniformLocation(program, 'u_point_size'),
    uColor: gl.getUniformLocation(program, 'u_color'),
    uIntensity: gl.getUniformLocation(program, 'u_intensity'),
    uSunDir: gl.getUniformLocation(program, 'u_sun_dir'),
    ...extractProjectionUniforms(gl, program),
  };
}

// ============================================================
// Gaussian blur shader
// ============================================================

export function createBlurShader(gl: WebGL2RenderingContext): BlurShader {
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

  const program = compileProgram(gl, vertSrc, fragSrc);
  if (program === null) { throw new Error('Failed to create blur shader'); }

  return {
    program,
    aPos: gl.getAttribLocation(program, 'a_pos'),
    uTexture: gl.getUniformLocation(program, 'u_texture'),
    uDirection: gl.getUniformLocation(program, 'u_direction'),
    uResolution: gl.getUniformLocation(program, 'u_resolution'),
    uSpread: gl.getUniformLocation(program, 'u_spread'),
  };
}

// ============================================================
// Composite shader (combines mip levels)
// ============================================================

export function createCompositeShader(gl: WebGL2RenderingContext): CompositeShader {
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
  let combine = '    vec3 bloom = vec3(0.0);\n';
  for (let i = 0; i < MIP_LEVELS; i++) {
    samplers += `  uniform sampler2D u_bloom${i};\n`;
    combine += `    bloom += texture(u_bloom${i}, v_uv).rgb * u_mip_weights[${i}];\n`;
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

  const program = compileProgram(gl, vertSrc, fragSrc);
  if (program === null) { throw new Error('Failed to create composite shader'); }

  const uBloomTextures: Array<WebGLUniformLocation | null> = [];
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

// ============================================================
// Projection uniform helper
// ============================================================

export function setProjectionUniforms(
  gl: WebGL2RenderingContext,
  shader: ProjectionUniforms,
  map: maplibregl.Map,
  options: CustomRenderMethodInput
) {
  if ('getProjectionDataForCustomLayer' in map.transform) {
    const projData = (
      map.transform as unknown as {
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
    if (shader.uProjectionMatrix !== null) {
      gl.uniformMatrix4fv(shader.uProjectionMatrix, false, projData.mainMatrix);
    }
    if (shader.uFallbackMatrix !== null) {
      gl.uniformMatrix4fv(shader.uFallbackMatrix, false, projData.fallbackMatrix);
    }
    if (shader.uTileMercatorCoords !== null) {
      gl.uniform4f(shader.uTileMercatorCoords, ...projData.tileMercatorCoords);
    }
    if (shader.uClippingPlane !== null) {
      gl.uniform4f(shader.uClippingPlane, ...projData.clippingPlane);
    }
    if (shader.uProjectionTransition !== null) {
      gl.uniform1f(shader.uProjectionTransition, projData.projectionTransition);
    }
  } else if (shader.uMatrix !== null) {
    gl.uniformMatrix4fv(shader.uMatrix, false, options.modelViewProjectionMatrix as Float32Array);
  }
}
