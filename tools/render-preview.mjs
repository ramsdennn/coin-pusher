/* ===========================================================================
   Render the audition sequence to a WAV, so the sounds can be judged without
   launching the game.

   It imports the REAL synthesis out of src/audio.js - the same voice table,
   the same renderer, the same variant spread - so what comes out of here is
   what the machine plays. The two things it approximates are the playback
   filter and the pitch shift, which in the browser are Web Audio nodes:
   a one-pole lowpass stands in for the biquad, and linear interpolation
   stands in for the resampler. Close enough to judge character by; the game
   itself is the final word on it.

       node tools/render-preview.mjs [out.wav]
   ========================================================================= */

import { writeFileSync } from 'node:fs';
import { VOICES, VARIANTS, variantParams, renderVoiceInto } from '../src/audio.js';

const SR = 48000;
const OUT = process.argv[2] || 'coin-sounds-preview.wav';

/* Mirrors the playback mapping in audio.js play(). Kept in step by hand -
   there are only four numbers, and importing the whole config just to read
   them would drag window into this. */
const MIN_GAIN      = 0.10;
const CUTOFF_SOFT   = 1400;
const CUTOFF_HARD   = 17000;
const PITCH_BY_E    = 0.10;

const LEVELS = { peg: 1.00, surface: 0.85, coin: 0.60,
                 glass: 0.45, wall: 0.40 };

/* One-pole lowpass, standing in for the browser's biquad. */
function lowpass(buf, sr, hz) {
  const dt = 1 / sr;
  const rc = 1 / (2 * Math.PI * hz);
  const a  = dt / (rc + dt);
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
  return buf;
}

/* Linear-interpolating resample, standing in for playbackRate. */
function resample(src, rate) {
  const n = Math.max(1, Math.floor(src.length / rate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * rate;
    const j = x | 0;
    const f = x - j;
    const a = src[j] || 0, b = src[j + 1] || 0;
    out[i] = a + (b - a) * f;
  }
  return out;
}

function renderHit(kind, energy, variant) {
  const def = VOICES[kind];
  const vp  = variantParams(variant);
  const n   = Math.ceil(def.dur * SR);
  const raw = new Float32Array(n);
  renderVoiceInto(raw, SR, def, vp.detune, vp.decayScale, 0x5eed + variant * 7919);

  const shifted = resample(raw, 1 + (energy - 0.5) * PITCH_BY_E);
  lowpass(shifted, SR, CUTOFF_SOFT + (CUTOFF_HARD - CUTOFF_SOFT) * energy);

  const amp = (MIN_GAIN + (1 - MIN_GAIN) * Math.pow(energy, 0.55)) * LEVELS[kind];
  for (let i = 0; i < shifted.length; i++) shifted[i] *= amp;
  return shifted;
}

/* Lay the sequence out on one timeline: every voice at three strengths, a gap
   between voices so it is obvious where one ends and the next begins. */
const kinds = Object.keys(VOICES);
const GAP_HIT   = 0.30;   // seconds between the three strengths
const GAP_VOICE = 0.75;   // seconds between voices

let cursor = 0.15;
const events = [];
kinds.forEach((k, ki) => {
  [0.15, 0.5, 1.0].forEach((e, ei) => {
    events.push({ at: cursor, buf: renderHit(k, e, ei % VARIANTS) });
    cursor += GAP_HIT;
  });
  cursor += GAP_VOICE;
});

/* Then a burst: what a coin rattling down the peg field actually sounds like,
   which is the case the whole throttling design exists for. */
cursor += 0.5;
let t = cursor;
for (let i = 0; i < 8; i++) {
  const e = 0.9 - i * 0.075 + (Math.random() - 0.5) * 0.15;
  events.push({ at: t, buf: renderHit('peg', Math.max(0.12, e), i % VARIANTS) });
  t += 0.10 + Math.random() * 0.09;
}
events.push({ at: t + 0.14, buf: renderHit('surface', 0.75, 1) });
cursor = t + 1.0;

const total = Math.ceil((cursor + 0.5) * SR);
const mix = new Float32Array(total);
for (const ev of events) {
  const off = Math.floor(ev.at * SR);
  for (let i = 0; i < ev.buf.length; i++) {
    if (off + i < total) mix[off + i] += ev.buf[i];
  }
}

/* Soft clip rather than hard, so an overlap does not buzz. */
let peak = 0;
for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(mix[i]));
const norm = peak > 0 ? 0.89 / peak : 1;
for (let i = 0; i < total; i++) mix[i] = Math.tanh(mix[i] * norm * 1.1);

/* 16-bit mono WAV. */
const bytes = Buffer.alloc(44 + total * 2);
bytes.write('RIFF', 0);
bytes.writeUInt32LE(36 + total * 2, 4);
bytes.write('WAVE', 8);
bytes.write('fmt ', 12);
bytes.writeUInt32LE(16, 16);
bytes.writeUInt16LE(1, 20);          // PCM
bytes.writeUInt16LE(1, 22);          // mono
bytes.writeUInt32LE(SR, 24);
bytes.writeUInt32LE(SR * 2, 28);
bytes.writeUInt16LE(2, 32);
bytes.writeUInt16LE(16, 34);
bytes.write('data', 36);
bytes.writeUInt32LE(total * 2, 40);
for (let i = 0; i < total; i++) {
  let v = Math.max(-1, Math.min(1, mix[i]));
  bytes.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
writeFileSync(OUT, bytes);

console.log('wrote ' + OUT);
console.log('  ' + (total / SR).toFixed(1) + 's, ' + SR + 'Hz mono');
console.log('  order: ' + kinds.join(', ') + ', then a peg-field burst');
