'use strict';
/* Animated aurora sky (WebGL fragment shader). Falls back to the CSS gradient when WebGL is unavailable. */
(function () {
  const canvas = document.getElementById('sky');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  const colors = { cP: [0.71, 0.30, 1.0], cS: [1.0, 0.44, 0.85], cA: [0.31, 0.88, 0.91], cBg: [0.043, 0.024, 0.078], inten: 1 };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  let redraw = () => {};
  window.StarlitSky = {
    /** Applies theme colours (hex strings) and the sky effect strength (0..1). */
    set(o) {
      colors.cP = hex(o.primary); colors.cS = hex(o.secondary); colors.cA = hex(o.accent); colors.cBg = hex(o.background);
      colors.inten = Math.max(0, Math.min(1, o.intensity)); redraw();
    },
  };
  if (!gl) { document.body.classList.add('no-webgl'); return; }

  const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const fs = `
precision mediump float;
uniform vec2 res; uniform float t; uniform vec3 cP; uniform vec3 cS; uniform vec3 cA; uniform vec3 cBg; uniform float inten;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / res;
  float asp = res.x / res.y;
  vec3 top = cBg * 0.55, mid = mix(cBg, cP * 0.30, 0.55), low = mix(cBg, cA * 0.22, 0.55);
  vec3 col = mix(low, mid, smoothstep(0.0, 0.55, uv.y));
  col = mix(col, top, smoothstep(0.5, 1.0, uv.y));
  // aurora curtains
  float glow = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = uv.x * asp * (1.4 + fi * 0.5) + t * (0.03 + fi * 0.015) + fi * 3.1;
    float wave = fbm(vec2(x, t * 0.04 + fi)) - 0.5;
    float centre = 0.62 + fi * 0.07 + wave * 0.45;
    float d = (uv.y - centre);
    float band = exp(-pow(d * (4.0 - fi * 0.6), 2.0)) * smoothstep(-0.05, 0.25, d + 0.35);
    float rays = 0.55 + 0.45 * fbm(vec2(uv.x * asp * 38.0 + fi * 9.0, t * 0.15));
    glow += band * rays * (0.9 - fi * 0.22);
  }
  vec3 lilac = cP, pink = cS, blue = cA;
  vec3 aur = mix(lilac, pink, smoothstep(0.35, 0.95, uv.y)) ;
  aur = mix(aur, blue, 0.25 * sin(uv.x * 4.0 + t * 0.1) + 0.25);
  col += aur * glow * 0.55 * inten;
  // stars
  vec2 g = floor(gl_FragCoord.xy / 3.0);
  float s = step(0.9965, hash(g));
  float tw = 0.6 + 0.4 * sin(t * 2.0 + hash(g + 7.0) * 6.28);
  col += vec3(0.9, 0.85, 1.0) * s * tw * smoothstep(0.35, 0.9, uv.y) * 0.8;
  // soft vignette
  col *= 0.75 + 0.25 * smoothstep(1.2, 0.2, length((uv - 0.5) * vec2(asp * 0.8, 1.0)));
  gl_FragColor = vec4(col, 1.0);
}`;
  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { console.warn('aurora shader disabled:', e); document.body.classList.add('no-webgl'); return; }

  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(prog, n);
  const uRes = U('res'), uT = U('t'), uP = U('cP'), uS = U('cS'), uA = U('cA'), uBg = U('cBg'), uI = U('inten');

  const SCALE = 0.5; // render at half resolution: smooth look, cheap on the GPU
  function resize() {
    canvas.width = Math.max(2, Math.floor(innerWidth * SCALE));
    canvas.height = Math.max(2, Math.floor(innerHeight * SCALE));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  addEventListener('resize', resize); resize();

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  let last = 0;
  function frame(now) {
    if (!document.hidden && (now - last > 33 || reduce)) {
      last = now;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uT, reduce ? 12.0 : (now - t0) / 1000);
      gl.uniform3fv(uP, colors.cP); gl.uniform3fv(uS, colors.cS); gl.uniform3fv(uA, colors.cA); gl.uniform3fv(uBg, colors.cBg); gl.uniform1f(uI, colors.inten);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  redraw = () => { if (reduce) requestAnimationFrame(frame); };
  if (reduce) addEventListener('resize', () => requestAnimationFrame(frame));
})();
