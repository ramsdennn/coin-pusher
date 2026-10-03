/* ============================================================================
   BACKDROP - the dot wall behind everything

   A grid of soft round lights on a near-black ground, with broad glows
   drifting slowly behind it and paler columns sweeping across. Nothing snaps;
   the whole thing is meant to be noticed once and then forgotten about.

   Drawn PROCEDURALLY rather than from a picture or a video, and the reason is
   sharpness. A video loop bakes in one resolution and its compression, which
   on a television blown up to 1920 wide looks worse than the reference it
   came from. This is generated per pixel, so it is exactly as crisp at 4K as
   at 720p - and the dot grid is measured in SCREEN PIXELS rather than in
   fractions of the frame, so the dots stay the same physical size and land on
   the pixel grid instead of shimmering as the window changes shape.

   It also loads nothing. The photograph it replaced was 1.4MB.

   Two ways to run it
   ------------------
   createBackdrop(scene, cfg)   a full-screen quad inside the game's own
                                scene, drawn first every frame
   createBackdropCanvas(cfg)    its own canvas and renderer, for the title
                                screen, which exists before the game does

   Both share one clock - performance.now() - so when the title screen's
   canvas is thrown away and the game's quad takes over, it is the same
   animation continuing rather than a second one starting.
   ========================================================================= */

import * as THREE from 'three';

/* ---------------------------------------------------------------------------
   A tileable value-noise texture. Tileable matters: the glows drift forever,
   and a seam crossing the screen every few seconds would be the one thing
   about the background anyone noticed.

   Wrapping comes from taking the lattice indices modulo the octave's period,
   so every octave repeats within the same unit square.
   ------------------------------------------------------------------------- */
function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(u, v, period, seed) {
  const x = u * period, y = v * period;
  const i = Math.floor(x), j = Math.floor(y);
  const fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const m = (n) => ((n % period) + period) % period;
  const i0 = m(i), i1 = m(i + 1), j0 = m(j), j1 = m(j + 1);
  const a = hash2(i0, j0, seed), b = hash2(i1, j0, seed);
  const c = hash2(i0, j1, seed), d = hash2(i1, j1, seed);
  const top = a + (b - a) * sx;
  const bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

function fbm(u, v, period, octaves, seed) {
  let sum = 0, amp = 0.5, total = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u, v, p, seed + o * 17);
    total += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / total;
}

let noiseTexture = null;

function makeNoiseTexture(size) {
  if (noiseTexture) return noiseTexture;
  const data = new Uint8Array(size * size * 4);
  /* R: the broad glow.  G: a finer layer over it.  B: the column sweep. */
  const chans = [
    { period: 3, octaves: 4, seed: 1 },
    { period: 6, octaves: 3, seed: 97 },
    { period: 2, octaves: 2, seed: 613 }
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const k = chans[c];
        data[o + c] = Math.max(0, Math.min(255,
          Math.round(fbm(u, v, k.period, k.octaves, k.seed) * 255)));
      }
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  noiseTexture = tex;
  return tex;
}

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  /* Straight to clip space. The quad is PlaneGeometry(1,1), so position.xy
     runs -0.5..0.5; doubling covers the viewport whatever the camera does. */
  gl_Position = vec4(position.xy * 2.0, 1.0, 1.0);
}`;

const FRAG = `
precision highp float;

uniform sampler2D noiseMap;
uniform float time;
uniform vec2  screen;

uniform float pitch;        // dot spacing, in screen pixels
uniform float dotRadius;    // of the spacing
uniform float softness;     // edge feather, of the radius

uniform float driftSpeed, glowScale, columnScale, columnSpeed;
uniform float floorLevel, contrast, gamma;

uniform vec3  colGround, colDim, colMid, colHot;
uniform float groundGlow, exposure, vignette;

varying vec2 vUv;

/* The field the dots are lit by: two broad glows drifting at different
   speeds and in different directions, plus a slow column sweep that depends
   only on x. Three texture reads rather than fbm per pixel - this runs over
   every pixel of a television. */
float field(vec2 p) {
  float t = time * driftSpeed;
  float a = texture2D(noiseMap, p * glowScale        + vec2( t * 0.021,  t * 0.013)).r;
  float b = texture2D(noiseMap, p * glowScale * 2.1  + vec2(-t * 0.017,  t * 0.026)).g;
  float c = texture2D(noiseMap, vec2(p.x * columnScale + time * columnSpeed, 0.37)).b;
  return a * 0.44 + b * 0.28 + c * 0.28;
}

void main() {
  vec2 frag = vUv * screen;

  /* THE GRID IS IN PIXELS, not in fractions of the frame. That is what keeps
     the dots the same size on any screen and stops them crawling when the
     window is resized. */
  vec2 cell = frag / pitch;
  vec2 off  = fract(cell) - 0.5;
  float d   = length(off);

  /* Feathered by the size of one pixel in cell units, so the edge is the same
     softness however big the dots are - and never aliases. */
  float px = 1.0 / pitch;
  float edge = max(softness * dotRadius, px * 1.2);
  /* Named dotMask, not dot: GLSL's dot() is a builtin, and shadowing it
     here breaks the vignette below, which uses it. */
  float dotMask = 1.0 - smoothstep(dotRadius - edge, dotRadius + edge, d);

  /* The lighting behind the grid. Shaped so most of the wall sits low and the
     bright regions are the exception, which is what stops it reading as an
     evenly lit texture. */
  float f = field(vUv);
  f = clamp((f - floorLevel) * contrast, 0.0, 1.0);
  f = pow(f, gamma);

  vec3 lit = mix(colDim, colMid, smoothstep(0.10, 0.70, f));
  lit = mix(lit, colHot, smoothstep(0.74, 1.0, f));

  /* The ground is not flat black: a little of the glow bleeds between the
     dots, which is what makes it read as lights behind glass rather than
     dots painted on a board. */
  vec3 col = colGround + lit * (groundGlow * f);
  col += lit * dotMask * (0.25 + f);

  vec2 v = (vUv - 0.5) * 2.0;
  col *= exposure * (1.0 - vignette * dot(v, v) * 0.25);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

function buildUniforms(cfg) {
  const D = cfg.dots;
  return {
    noiseMap:    { value: makeNoiseTexture(cfg.noiseSize || 256) },
    time:        { value: 0 },
    screen:      { value: new THREE.Vector2(1, 1) },

    pitch:       { value: D.pitchPx },
    dotRadius:   { value: D.radius },
    softness:    { value: D.softness },

    driftSpeed:  { value: D.driftSpeed },
    glowScale:   { value: D.glowScale },
    columnScale: { value: D.columnScale },
    columnSpeed: { value: D.columnSpeed },

    floorLevel:  { value: D.floor },
    contrast:    { value: D.contrast },
    gamma:       { value: D.gamma },

    colGround:   { value: new THREE.Color(D.ground) },
    colDim:      { value: new THREE.Color(D.dim) },
    colMid:      { value: new THREE.Color(D.mid) },
    colHot:      { value: new THREE.Color(D.hot) },
    groundGlow:  { value: D.groundGlow },

    exposure:    { value: cfg.exposure },
    vignette:    { value: cfg.vignette }
  };
}

function buildMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: uniforms, vertexShader: VERT, fragmentShader: FRAG,
    depthTest: false, depthWrite: false, fog: false
  });
}

/* One clock for both ways of running this, so the title screen's canvas and
   the game's quad are the same animation rather than two of them. */
function clock() { return performance.now() / 1000; }

/* ---------------------------------------------------------------------------
   In the game's own scene: a full-screen quad at renderOrder -1 with depth
   testing off, so the ordinary render call draws it first and everything else
   lands on top. No second scene, no second pass.
   ------------------------------------------------------------------------- */
export function createBackdrop(scene, cfg) {
  if (!cfg || !cfg.enabled) return null;

  const uniforms = buildUniforms(cfg);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
                              buildMaterial(uniforms));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.name = 'backdrop';
  scene.add(mesh);

  return {
    mesh: mesh,
    uniforms: uniforms,
    update: function (seconds, width, height) {
      uniforms.time.value = seconds != null ? seconds : clock();
      uniforms.screen.value.set(width, height);
    },
    set: function (name, value) {
      if (!(name in uniforms)) return false;
      if (uniforms[name].value && uniforms[name].value.isColor) {
        uniforms[name].value.set(value);
      } else {
        uniforms[name].value = value;
      }
      return true;
    }
  };
}

/* ---------------------------------------------------------------------------
   Standalone, for the title screen - which exists long before the game's
   renderer does. Its own canvas, its own tiny scene, its own loop.

   It is thrown away the moment the game's own backdrop is up. Because both
   read the same clock and run the same shader, the handover is invisible:
   the frame the game draws first is the frame this would have drawn next.
   ------------------------------------------------------------------------- */
export function createBackdropCanvas(cfg, host) {
  if (!cfg || !cfg.enabled) return null;

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const el = renderer.domElement;
  el.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;display:block;z-index:0;';
  (host || document.body).appendChild(el);

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const uniforms = buildUniforms(cfg);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
                              buildMaterial(uniforms));
  mesh.frustumCulled = false;
  scene.add(mesh);

  let alive = true;

  function size() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    uniforms.screen.value.set(w, h);
  }
  size();
  window.addEventListener('resize', size);

  (function loop() {
    if (!alive) return;
    requestAnimationFrame(loop);
    uniforms.time.value = clock();
    renderer.render(scene, camera);
  })();

  return {
    dispose: function () {
      if (!alive) return;
      alive = false;
      window.removeEventListener('resize', size);
      if (el.parentNode) el.parentNode.removeChild(el);
      mesh.geometry.dispose();
      mesh.material.dispose();
      renderer.dispose();
    }
  };
}
