/* ===========================================================================
   AUDIO

   Every sound in the machine is synthesised here. There are no audio files
   and nothing to load.

   The sounds are PRE-RENDERED into buffers at startup rather than built out
   of oscillator nodes per hit. A busy machine can want a dozen clinks in a
   single frame, and standing up six oscillators and six envelopes for each
   one is how audio ends up costing more than the physics. Rendering each
   voice once and playing it back is close to free.

   Each voice is rendered in several VARIANTS with slightly different detune
   and decay. Playing the identical buffer over and over is the single thing
   that makes game audio sound like a machine gun; a handful of variants plus
   a little pitch jitter on playback is enough to break it up.
   ========================================================================= */

/* Looked up on use, not captured at import. Two reasons: editing the config
   live from the console then takes effect without a reload, and this file is
   also imported by tools/render-preview.mjs under Node, where there is no
   window to capture. The synthesis below touches none of it. */
function cfg() {
  return (typeof window !== 'undefined' && window.COIN_PUSHER_CONFIG)
    ? window.COIN_PUSHER_CONFIG.audio : null;
}

let ac = null;                 // AudioContext, made on the first user gesture
let master = null;             // everything goes through here
let limiter = null;
let buffers = {};              // kind -> [AudioBuffer, ...] variants
let voicesOut = 0;             // how many are sounding right now
let lastAt = new Map();        // body handle -> ms, for per-coin cooldown

/* ---------------------------------------------------------------------------
   VOICE DEFINITIONS

   A struck disc is INHARMONIC: its overtones are not whole multiples of the
   fundamental, which is exactly what separates a metallic clink from a
   musical note. The ratios below are what make it read as metal - space them
   evenly and it turns into a bell, remove them and it turns into a beep.

   Higher partials must also decay FASTER than low ones. That is what a real
   strike does, and it is what makes a sound brighten at the attack and mellow
   as it rings out. Give every partial the same decay and it sounds synthetic
   however good the ratios are.

   f0        fundamental, Hz
   partials  [ratio, relative gain, decay seconds]
   noise     the strike transient: [gain, decay seconds, bandpass Hz]
   dur       buffer length, seconds
   ------------------------------------------------------------------------- */
export const VOICES = {
  /* Coin on steel peg. The brightest, longest thing in the machine - the pegs
     are polished steel with restitution 0.5, so this is a genuine ping with a
     tail on it, and it is the sound the whole drop is built around. */
  peg: {
    f0: 2350,
    partials: [[1.00, 1.00, 0.34], [2.71, 0.62, 0.20], [4.83, 0.40, 0.13],
               [7.44, 0.26, 0.085], [11.2, 0.15, 0.05], [16.1, 0.08, 0.03]],
    noise: [0.35, 0.004, 5200],
    dur: 0.42
  },

  /* Coin on coin. Two thin discs damping each other: same metal, far shorter,
     and the top partials are gone almost at once. */
  coin: {
    f0: 1780,
    partials: [[1.00, 1.00, 0.11], [2.68, 0.55, 0.06], [4.91, 0.30, 0.035],
               [7.80, 0.16, 0.02]],
    noise: [0.42, 0.005, 3600],
    dur: 0.20
  },

  /* Coin on the moving deck. The deck is a big solid body, so the coin's ring
     is killed on contact - almost all transient, barely any tone. */
  deck: {
    f0: 900,
    partials: [[1.00, 0.85, 0.045], [2.42, 0.35, 0.025], [4.10, 0.15, 0.015]],
    noise: [0.70, 0.008, 2000],
    dur: 0.13
  },

  /* Coin on the fixed floor ahead of the deck. Slightly brighter and a touch
     longer than the deck - a thinner panel, and it rings a little. */
  floor: {
    f0: 1150,
    partials: [[1.00, 0.80, 0.06], [2.55, 0.38, 0.03], [4.44, 0.18, 0.018]],
    noise: [0.62, 0.007, 2400],
    dur: 0.15
  },

  /* Coin on the chute glass. Thin, high, over immediately - glass has almost
     no low end and no sustain at this size. */
  glass: {
    f0: 3100,
    partials: [[1.00, 0.70, 0.05], [2.95, 0.34, 0.025], [5.60, 0.16, 0.012]],
    noise: [0.50, 0.004, 6000],
    dur: 0.13
  },

  /* Coin on a side wall. Dead - a dull knock, no ring at all. */
  wall: {
    f0: 700,
    partials: [[1.00, 0.70, 0.035], [2.30, 0.25, 0.018]],
    noise: [0.75, 0.009, 1500],
    dur: 0.10
  }
};

/* ---------------------------------------------------------------------------
   Render one variant of a voice straight into a Float32Array.

   Done by hand rather than as an OfflineAudioContext graph because the
   per-partial decay envelopes are the whole point, and expressing six of
   those as nodes is far more code than the arithmetic is.

   Every partial starts at phase 0, so the buffer starts at exactly zero and
   there is no click at the join. The attack comes from the noise burst, which
   is what a real strike's attack is anyway.
   ------------------------------------------------------------------------- */
export function renderVoiceInto(out, sr, def, detune, decayScale, seed) {
  const n = out.length;
  const f0 = def.f0 * detune;

  for (let p = 0; p < def.partials.length; p++) {
    const ratio = def.partials[p][0];
    const gain  = def.partials[p][1];
    const decay = def.partials[p][2];
    /* Too close to Nyquist a partial just aliases into a whistle, so drop it
       rather than render rubbish. */
    if (f0 * ratio > sr * 0.45) continue;
    const w = 2 * Math.PI * f0 * ratio / sr;
    const k = 1 / (decay * decayScale * sr);
    for (let i = 0; i < n; i++) {
      out[i] += gain * Math.exp(-i * k) * Math.sin(w * i);
    }
  }

  /* Strike transient: a very short burst of band-limited noise. A two-pole
     state-variable filter is plenty - it only has to sound like a hit, not
     like one particular hit. */
  const nGain  = def.noise[0];
  const nDecay = def.noise[1];
  const nHz    = def.noise[2];
  let s = seed >>> 0;
  const rnd = function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
  const f = 2 * Math.sin(Math.PI * Math.min(nHz, sr * 0.45) / sr);
  const q = 0.6;
  let lp = 0, bp = 0;
  const nk = 1 / (nDecay * sr);
  const nn = Math.min(n, Math.ceil(nDecay * 8 * sr));
  for (let i = 0; i < nn; i++) {
    const inp = rnd() * Math.exp(-i * nk);
    const hp = inp - lp - q * bp;
    bp += f * hp;
    lp += f * bp;
    out[i] += nGain * bp;
  }

  /* Normalise, so a voice's level in config means the same thing whatever its
     partial structure is. Then a 1.5ms fade at the tail, so a truncated ring
     does not click. */
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const norm = peak > 0 ? 0.9 / peak : 0;
  const fade = Math.min(n, Math.ceil(0.0015 * sr));
  for (let i = 0; i < n; i++) {
    let g = norm;
    if (i > n - fade) g *= (n - i) / fade;
    out[i] *= g;
  }
  return out;
}

/* The AudioBuffer wrapper the browser side uses. */
function renderVoice(def, detune, decayScale, seed) {
  const sr  = ac.sampleRate;
  const buf = ac.createBuffer(1, Math.ceil(def.dur * sr), sr);
  renderVoiceInto(buf.getChannelData(0), sr, def, detune, decayScale, seed);
  return buf;
}

export const VARIANTS = 4;

/* Spread the variants a few percent either side of nominal. Small enough that
   it is the same object being struck, large enough that two in a row are
   audibly not the same recording. Shared with the preview renderer so the WAV
   and the game are the same sounds. */
export function variantParams(v) {
  return {
    detune:     1 + (v - (VARIANTS - 1) / 2) * 0.035,
    decayScale: 1 + (v % 2 ? 0.12 : -0.12)
  };
}

function renderAll() {
  buffers = {};
  let seed = 0x5eed;
  const kinds = Object.keys(VOICES);
  for (let ki = 0; ki < kinds.length; ki++) {
    const def = VOICES[kinds[ki]];
    const list = [];
    for (let v = 0; v < VARIANTS; v++) {
      const vp = variantParams(v);
      seed += 7919;
      list.push(renderVoice(def, vp.detune, vp.decayScale, seed));
    }
    buffers[kinds[ki]] = list;
  }
}

/* ---------------------------------------------------------------------------
   Start up. MUST be called from a user gesture - every browser refuses to let
   a page make noise before one, and an AudioContext created any earlier just
   sits there suspended.
   ------------------------------------------------------------------------- */
export function initAudio() {
  const A = cfg();
  if (!A || !A.enabled) return false;
  if (ac) { if (ac.state === 'suspended') ac.resume(); return true; }

  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return false;
  ac = new Ctor();

  /* A limiter, not a compressor for taste: sixty coins landing at once will
     otherwise clip the output, and clipping through a TV's speakers is the
     one thing that makes a game sound broken rather than loud. */
  limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value      = 3;
  limiter.ratio.value     = 12;
  limiter.attack.value    = 0.002;
  limiter.release.value   = 0.10;

  master = ac.createGain();
  master.gain.value = A.masterVolume;

  master.connect(limiter);
  limiter.connect(ac.destination);

  renderAll();
  if (ac.state === 'suspended') ac.resume();
  return true;
}

export function setMasterVolume(v) {
  if (master) master.gain.value = v;
}

export function audioReady() { return !!ac && ac.state === 'running'; }

/* ---------------------------------------------------------------------------
   Play one hit.

     kind    a key of VOICES
     energy  0..1, how hard. Drives loudness, brightness and pitch together -
             a soft hit on a real object is not a quiet loud one, it is duller
             and very slightly lower, and moving all three together is most of
             what makes a synthesised impact believable.
     panX    -1..1 stereo position
   ------------------------------------------------------------------------- */
export function play(kind, energy, panX) {
  const A = cfg();
  if (!ac || !A || !A.enabled) return false;
  const list = buffers[kind];
  if (!list) return false;

  const lvl = (A.levels && A.levels[kind] != null) ? A.levels[kind] : 1;
  if (lvl <= 0) return false;
  if (voicesOut >= A.maxVoices) return false;

  let e = energy;
  if (!(e >= 0)) e = 0;
  if (e > 1) e = 1;

  /* Loudness is deliberately not linear in energy. Perceived loudness runs
     closer to the square root of amplitude, and a linear map makes every
     light touch inaudible and every firm one sound the same as every other. */
  const amp = A.minGain + (1 - A.minGain) * Math.pow(e, 0.55);

  const src = ac.createBufferSource();
  src.buffer = list[(Math.random() * list.length) | 0];
  /* Pitch: a little lower for a soft hit, plus jitter so repeats differ. */
  src.playbackRate.value =
    (1 + (e - 0.5) * A.pitchByEnergy) *
    (1 + (Math.random() - 0.5) * A.pitchJitter);

  /* Brightness by energy. This is the strongest of the three cues: a soft hit
     simply has less high end in it, and a fixed filter makes every impact
     sound like it landed with the same force however you set the gain. */
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = A.cutoffSoft + (A.cutoffHard - A.cutoffSoft) * e;
  lp.Q.value = 0.7;

  const g = ac.createGain();
  g.gain.value = amp * lvl;

  let tail = g;
  if (ac.createStereoPanner && panX != null) {
    const p = ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, panX)) * A.stereoWidth;
    g.connect(p);
    tail = p;
  }

  src.connect(lp); lp.connect(g); tail.connect(master);

  voicesOut++;
  src.onended = function () { voicesOut--; };
  src.start();
  return true;
}

/* Per-coin cooldown. One coin rattling down the peg field can register
   several contacts inside a single hop, and without this each hop
   machine-guns. Returns false if this body sounded too recently. */
export function coinReady(handle, nowMs) {
  const A = cfg();
  const prev = lastAt.get(handle);
  if (prev != null && nowMs - prev < A.coinCooldownMs) return false;
  lastAt.set(handle, nowMs);
  return true;
}

export function forgetCoin(handle) { lastAt.delete(handle); }

/* Audition every voice at three strengths, for judging them by ear without
   having to make the machine produce each one. Bound to a key in game.js. */
export function auditionAll() {
  if (!ac) return null;
  const kinds = Object.keys(VOICES);
  let t = 0;
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    const energies = [0.15, 0.5, 1.0];
    for (let j = 0; j < energies.length; j++) {
      (function (kk, ee, tt) { setTimeout(function () { play(kk, ee, 0); }, tt); })(k, energies[j], t);
      t += 260;
    }
    t += 340;
  }
  return kinds;
}

export const VOICE_KINDS = Object.keys(VOICES);
