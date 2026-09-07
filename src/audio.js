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

   These are MEASURED, not invented. The first attempt at this file was built
   from theory - inharmonic ratios off a struck-plate model - and it was so
   far off the mark it was not worth keeping. The numbers below come out of
   real Tipping Point footage the host supplied, analysed hit by hit.

   How: FFT of the 85ms after each strike, minus the FFT of the 85ms BEFORE
   it. That second part matters - the recording has a continuous bed of
   audience and music under it, and subtracting a noise print taken from the
   moment before the hit leaves the coin and drops the studio. Then the
   spectra of several hits of the same kind are averaged, so a resonance that
   is genuinely the object reinforces and a stray bit of music that happened
   to land under one hit averages away. Decay per partial comes from tracking
   each bin across short frames and fitting its log.

   THE HEADLINE: the peg clang has its fundamental at 434 Hz. The synthesised
   guess had it at 2350 Hz - five times too high - which is exactly why it
   sounded thin and cheap instead of like a clang. Real metal impacts in a
   machine this size are far lower and far chunkier than intuition says.

   partials  [absolute Hz, relative gain, decay seconds]
   noise     the strike transient: [gain, decay seconds, bandpass Hz]
   dur       buffer length, seconds
   tune      multiplies every partial - the one knob for pitching a voice
             up or down as a whole without re-measuring anything

   Where a measured decay is marked ADJUSTED it is because the source hits are
   SERIES of clangs, not isolated strikes: a partial's tail gets cut off by
   the next hit, or the studio bed keeps a bin alive long after the coin has
   stopped. Those readings came back as 0.47s on partials that plainly do not
   ring that long, so they are set by ear against the rest of the set.
   ------------------------------------------------------------------------- */
export const VOICES = {
  /* COIN ON PEG - measured from 0:41.94 and 0:42.79.
     A clang: strong low fundamental, a dense middle, and a bright edge that
     dies fast. */
  peg: {
    tune: 1,
    partials: [
      [ 434, 1.00, 0.24],    // measured tau 0.054, ADJUSTED - cut off by the
                             // next clang in the series
      [ 822, 0.45, 0.18],    // ADJUSTED from 0.49, bed-contaminated bin
      [ 998, 0.75, 0.16],    // ADJUSTED from 0.037
      [1243, 0.34, 0.11],
      [1392, 0.33, 0.13],
      [1584, 0.47, 0.10],

      /* The top of the voice, WEIGHTED UP against the raw measurement.

         Built straight from the measured gains the voice came out at a
         centroid of 1168 Hz against the real hits' 2852 and 3021 - two and a
         half times too dark, and it sounded like a thud instead of a clang.
         The per-partial decay fitting is the reason: the fundamental's tail
         gets cut short by the next clang in the series, so shortening it
         while keeping the highs short too leaves the low end dominating.

         These are the measured FREQUENCIES with their gains scaled 4.5x and
         decays 1.8x, converged against two metrics taken the same way on the
         real hits and on the synthesis:

             centroid          synth 2715   real 2852 / 3021
             energy >2kHz/<2kHz  synth 1.02   real 0.89 / 1.20

         5550 and 7020 came out of the single-hit analysis and are added back
         to give the top end somewhere to sit. */
      [3362, 1.22, 0.090],
      [4205, 1.30, 0.099],
      [5342, 1.26, 0.072],
      [5550, 0.99, 0.068],
      [7020, 0.72, 0.054]
    ],
    noise: [0.65, 0.006, 4200],
    dur: 0.55
  },

  /* COIN ON SURFACE - measured from 1:08.16, 1:09.76, 1:10.99 and 1:11.36.
     All four were confirmed as the right sound by the host.

     The surprise here is the top end. There is a hard, bright component at
     7.5-9.2 kHz that is LOUDER than the fundamental, and it is real, not an
     artefact - it sits 5.8 to 11.6 times above the noise bed and lands at the
     same frequency in all four hits. That bright tick is most of what makes
     the sound read as a counter on a hard surface rather than a thud. */
  surface: {
    tune: 1,
    partials: [
      [ 514, 1.00, 0.100],
      [ 726, 0.12, 0.056],
      [1014, 0.16, 0.049],
      [1220, 0.36, 0.120],
      [1391, 0.14, 0.088],
      [2502, 0.11, 0.037],
      [7560, 0.42, 0.018],
      [9023, 1.20, 0.060],   // measured 1.67 relative, trimmed - at full
                             // strength it is piercing on repeat
      [9200, 0.90, 0.050]
    ],
    noise: [0.45, 0.004, 7000],
    dur: 0.30
  },

  /* Everything below is DERIVED from the two measured voices, not measured -
     there is no reference footage for a counter hitting glass. Each is the
     surface voice moved and damped by ear. Marked so nobody later mistakes
     them for measurements. */

  /* Coin on coin: the surface sound with the bright tick pulled down and the
     tail shortened - two thin discs damp each other. */
  coin: {
    tune: 1.18,
    partials: [
      [ 514, 0.70, 0.045],
      [1014, 0.30, 0.030],
      [1220, 0.40, 0.050],
      [2502, 0.16, 0.022],
      [7560, 0.30, 0.012],
      [9023, 0.55, 0.022],
      [9200, 0.40, 0.018]
    ],
    noise: [0.55, 0.004, 6000],
    dur: 0.20
  },

  /* Coin on the chute glass: thin, higher, no low end. */
  glass: {
    tune: 1.35,
    partials: [
      [1220, 0.35, 0.040],
      [2502, 0.30, 0.030],
      [7560, 0.55, 0.016],
      [9023, 0.85, 0.030],
      [9200, 0.60, 0.024]
    ],
    noise: [0.50, 0.003, 8000],
    dur: 0.18
  },

  /* Coin on a side wall: a dull knock, the bright end gone entirely. */
  wall: {
    tune: 0.85,
    partials: [
      [ 514, 0.85, 0.035],
      [ 726, 0.25, 0.025],
      [1014, 0.20, 0.018],
      [2502, 0.06, 0.012]
    ],
    noise: [0.70, 0.007, 1600],
    dur: 0.14
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
  const tune = (def.tune || 1) * detune;

  for (let p = 0; p < def.partials.length; p++) {
    const hz    = def.partials[p][0] * tune;
    const gain  = def.partials[p][1];
    const decay = def.partials[p][2];
    /* Too close to Nyquist a partial just aliases into a whistle, so drop it
       rather than render rubbish. */
    if (hz > sr * 0.45) continue;
    const w = 2 * Math.PI * hz / sr;
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
  loadSamples();            // async; the synth voices cover until it lands
  if (ac.state === 'suspended') ac.resume();
  return true;
}

/* ---------------------------------------------------------------------------
   SAMPLES

   Synthesis was tried twice for the peg hit and rejected both times. Modal
   resynthesis of the host's reference clip reached a spectrogram correlation
   of 0.74 against the original, which sounded like a good number and was not
   a good sound. The clip itself always was the answer.

   The dynamics argument against samples is real but narrower than it looks. A
   sample cannot change its SPECTRAL CONTENT with impact force - a hard strike
   excites modes a soft one never touches, and filtering a soft recording
   brighter does not invent them. Over the speed range of a coin falling down
   a chute that difference is small, and gain, pitch and filter cover it. What
   actually makes sampled impacts sound fake is REPETITION, and pitch jitter
   plus the cooldown deals with that.
   ------------------------------------------------------------------------- */
let samples = {};                    // kind -> AudioBuffer

export async function loadSamples() {
  const A = cfg();
  if (!ac || !A || !A.samples) return;
  const names = Object.keys(A.samples);
  await Promise.all(names.map(async function (kind) {
    try {
      const res = await fetch(A.samples[kind]);
      if (!res.ok) throw new Error(res.status + ' ' + A.samples[kind]);
      samples[kind] = await ac.decodeAudioData(await res.arrayBuffer());
    } catch (e) {
      console.warn('[audio] could not load sample "' + kind + '":', e.message);
    }
  }));
  return Object.keys(samples);
}

export function hasSample(kind) { return !!samples[kind]; }

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
  /* A loaded sample always wins over the synthesised voice of the same name.
     Everything downstream - energy curve, pitch, filter, pan, limiter - is
     identical either way, so swapping one for the other changes the sound and
     nothing else. */
  const buf = samples[kind]
    ? samples[kind]
    : (buffers[kind] ? buffers[kind][(Math.random() * buffers[kind].length) | 0] : null);
  if (!buf) return false;

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
  src.buffer = buf;
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
