export function initTex(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
  w: number,
  h: number
) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

type GlState = [
  WebGLFramebuffer | null,
  boolean,
  number,
  number,
  number,
  number,
  number,
  Int32Array
];

export function saveGl(gl: WebGL2RenderingContext): GlState {
  return [
    gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    gl.getParameter(gl.BLEND) as boolean,
    gl.getParameter(gl.BLEND_SRC_RGB) as number,
    gl.getParameter(gl.BLEND_DST_RGB) as number,
    gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
    gl.getParameter(gl.BLEND_DST_ALPHA) as number,
    gl.getParameter(gl.ACTIVE_TEXTURE) as number,
    gl.getParameter(gl.VIEWPORT) as Int32Array
  ];
}

export function restoreGl(gl: WebGL2RenderingContext, s: GlState) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, s[0]);
  if (s[1]) {
    gl.enable(gl.BLEND);
  } else {
    gl.disable(gl.BLEND);
  }
  gl.blendFuncSeparate(s[2], s[3], s[4], s[5]);
  gl.activeTexture(s[6]);
  gl.viewport(s[7][0]!, s[7][1]!, s[7][2]!, s[7][3]!);
}

export interface MipLevel {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  pingFbo: WebGLFramebuffer;
  pingTex: WebGLTexture;
  w: number;
  h: number;
}

export function deleteMips(gl: WebGL2RenderingContext, mips: MipLevel[]) {
  for (const m of mips) {
    gl.deleteFramebuffer(m.fbo);
    gl.deleteTexture(m.tex);
    gl.deleteFramebuffer(m.pingFbo);
    gl.deleteTexture(m.pingTex);
  }
}

export function buildMips(
  gl: WebGL2RenderingContext,
  opts: {
    brightTex: WebGLTexture;
    brightFbo: WebGLFramebuffer;
    oldMips: MipLevel[];
    w: number;
    h: number;
  }
): MipLevel[] {
  const { brightTex, brightFbo, oldMips, w, h } = opts;
  initTex(gl, brightTex, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, brightFbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    brightTex,
    0
  );
  deleteMips(gl, oldMips);
  const mips: MipLevel[] = [];
  let mw = Math.max(1, w >> 1);
  let mh = Math.max(1, h >> 1);
  for (let i = 0; i < 4; i++) {
    const tex = gl.createTexture();
    initTex(gl, tex, mw, mh);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0
    );
    const pingTex = gl.createTexture();
    initTex(gl, pingTex, mw, mh);
    const pingFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, pingFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      pingTex,
      0
    );
    mips.push({ fbo, tex, pingFbo, pingTex, w: mw, h: mh });
    mw = Math.max(1, mw >> 1);
    mh = Math.max(1, mh >> 1);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return mips;
}
