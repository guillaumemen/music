// Détection de tempo et de grille pour une prod (fonctions pures, testables sous Node).
//
// Chaîne de traitement :
//   1. mono + sous-échantillonnage (~22 kHz)
//   2. « flux spectral » : énergie des attaques par trame, globale + bande grave (kick)
//      + bande médium (caisse claire)
//   3. autocorrélation de l'enveloppe d'attaques -> candidats de tempo
//   4. ajustement fin d'une grille constante (BPM + phase) sur l'enveloppe
//   5. placement du premier temps (« le 1 ») à partir du kick et de la caisse claire

import { createFFT } from './fft.js';

export const TEMPO_DEFAULTS = {
  minBpm: 60,
  maxBpm: 180,
  // Préférence douce pour les tempos rap (centre ~90 BPM, largeur en octaves).
  priorCenter: 90,
  priorWidth: 1.0,
  frameSize: 1024,
  hopSize: 256,
  targetSampleRate: 22050,
};

export function mixToMono(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

export function downsample(samples, sampleRate, targetSampleRate = TEMPO_DEFAULTS.targetSampleRate) {
  const factor = Math.max(1, Math.floor(sampleRate / targetSampleRate));
  if (factor === 1) return { samples, sampleRate };
  const n = Math.floor(samples.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) s += samples[base + j];
    out[i] = s / factor;
  }
  return { samples: out, sampleRate: sampleRate / factor };
}

// Flux spectral (différences positives du log-spectre entre deux trames).
// Le temps d'une attaque détectée à la trame f est f / frameRate + latency : le flux
// culmine quand l’attaque a parcouru ~72 % de la fenêtre
// (mesuré sur des signaux synthétiques).
export function onsetFeatures(samples, sampleRate, options = {}) {
  const { frameSize, hopSize } = { ...TEMPO_DEFAULTS, ...options };
  const fft = createFFT(frameSize);
  const bins = frameSize / 2;
  const win = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameSize);

  const binHz = sampleRate / frameSize;
  const lowMax = Math.max(1, Math.round(150 / binHz));
  const midMin = Math.round(200 / binHz);
  const midMax = Math.min(bins, Math.round(5000 / binHz));

  const nFrames = samples.length >= frameSize ? Math.floor((samples.length - frameSize) / hopSize) + 1 : 0;
  const full = new Float32Array(nFrames);
  const low = new Float32Array(nFrames);
  const mid = new Float32Array(nFrames);

  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);
  const prev = new Float64Array(bins + 1);

  for (let f = 0; f < nFrames; f++) {
    const start = f * hopSize;
    for (let i = 0; i < frameSize; i++) {
      re[i] = samples[start + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let sFull = 0, sLow = 0, sMid = 0;
    for (let b = 1; b <= bins; b++) {
      const mag = Math.log1p(100 * Math.hypot(re[b], im[b]));
      const d = mag - prev[b];
      prev[b] = mag;
      if (d <= 0 || f === 0) continue;
      sFull += d;
      if (b <= lowMax) sLow += d;
      else if (b >= midMin && b <= midMax) sMid += d;
    }
    full[f] = sFull;
    low[f] = sLow;
    mid[f] = sMid;
  }

  return {
    frameRate: sampleRate / hopSize,
    latency: (0.72 * frameSize) / sampleRate,
    full,
    low,
    mid,
  };
}

// Retire la tendance lente (moyenne glissante), redresse et normalise.
export function normalizeEnvelope(env, frameRate, windowSec = 0.4) {
  const n = env.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  const half = Math.max(1, Math.round((windowSec * frameRate) / 2));
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + env[i];
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const v = env[i] - (prefix[b] - prefix[a]) / (b - a);
    out[i] = v > 0 ? v : 0;
    sumSq += out[i] * out[i];
  }
  const rms = Math.sqrt(sumSq / n) || 1;
  for (let i = 0; i < n; i++) out[i] /= rms;
  return out;
}

function autocorrelation(env, maxLag) {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n || 1;
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) e[i] = env[i] - mean;
  const acf = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += e[i] * e[i + lag];
    acf[lag] = s / (n - lag);
  }
  const zero = acf[0] || 1;
  for (let lag = 0; lag <= maxLag; lag++) acf[lag] /= zero;
  return acf;
}

// Candidats de tempo par autocorrélation, pondérée par une préférence « rap ».
export function tempoCandidates(env, frameRate, options = {}) {
  const { minBpm, maxBpm, priorCenter, priorWidth } = { ...TEMPO_DEFAULTS, ...options };
  const minLag = Math.max(1, Math.floor((frameRate * 60) / maxBpm));
  const maxLag = Math.ceil((frameRate * 60) / minBpm);
  const acf = autocorrelation(env, maxLag * 2 + 2);

  const at = (lag) => (lag < acf.length ? acf[lag] : 0);
  const score = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    // Renforcement harmonique : un vrai temps se répète aussi à 2x la période.
    const raw = at(lag) + 0.5 * Math.max(at(2 * lag - 1), at(2 * lag), at(2 * lag + 1));
    const bpm = (frameRate * 60) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / priorCenter) / priorWidth) ** 2);
    score[lag] = raw * prior;
  }

  const peaks = [];
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (score[lag] > 0 && score[lag] >= score[lag - 1] && score[lag] > score[lag + 1]) {
      // Interpolation parabolique pour un lag fractionnaire.
      const a = score[lag - 1], b = score[lag], c = score[lag + 1];
      const denom = a - 2 * b + c;
      const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
      peaks.push({ bpm: (frameRate * 60) / (lag + shift), score: b, correlation: acf[lag] });
    }
  }
  peaks.sort((p, q) => q.score - p.score);
  return peaks;
}

function sampleAt(env, pos) {
  const i = Math.floor(pos);
  if (i < 0 || i + 1 >= env.length) return 0;
  const frac = pos - i;
  return env[i] * (1 - frac) + env[i + 1] * frac;
}

function bestPhase(env, period, phaseStep = 0.5) {
  let best = { phase: 0, score: -Infinity };
  for (let phase = 0; phase < period; phase += phaseStep) {
    let s = 0, count = 0;
    for (let pos = phase; pos < env.length - 1; pos += period) {
      // Le maximum local autour du temps tolère ±1 trame d'imprécision.
      s += Math.max(sampleAt(env, pos - 1), sampleAt(env, pos), sampleAt(env, pos + 1)) * 0.5 + sampleAt(env, pos) * 0.5;
      count++;
    }
    const score = count ? s / count : 0;
    if (score > best.score) best = { phase, score };
  }
  return best;
}

// Ajuste une grille constante : BPM précis (0,01) + phase du premier temps.
export function fitGrid(env, frameRate, bpmGuess, { range = 1.5 } = {}) {
  const evaluate = (bpm) => ({ bpm, ...bestPhase(env, (frameRate * 60) / bpm) });
  let best = evaluate(bpmGuess);
  for (const [span, step] of [[range, 0.05], [0.06, 0.01]]) {
    const center = best.bpm;
    for (let bpm = center - span; bpm <= center + span + 1e-9; bpm += step) {
      const r = evaluate(bpm);
      if (r.score > best.score) best = r;
    }
  }
  // Les producteurs travaillent presque toujours en BPM entiers (ou demi) : on arrondit
  // si l'arrondi explique aussi bien les attaques.
  for (const snap of [Math.round(best.bpm), Math.round(best.bpm * 2) / 2]) {
    if (Math.abs(snap - best.bpm) < 0.15) {
      const r = evaluate(snap);
      if (r.score >= best.score * 0.97) {
        best = r;
        break;
      }
    }
  }
  return { bpm: best.bpm, phaseFrames: best.phase, score: best.score };
}

function peakNear(env, pos, radius = 2) {
  let m = 0;
  for (let p = Math.round(pos) - radius; p <= Math.round(pos) + radius; p++) {
    if (p >= 0 && p < env.length && env[p] > m) m = env[p];
  }
  return m;
}

// Trouve quel temps de la mesure est « le 1 » : kick sur 1, caisse claire sur 2 et 4.
export function findDownbeat(features, bpm, phaseFrames, beatsPerBar = 4) {
  const { frameRate } = features;
  const low = normalizeEnvelope(features.low, frameRate);
  const mid = normalizeEnvelope(features.mid, frameRate);
  const period = (frameRate * 60) / bpm;
  const kick = new Float64Array(beatsPerBar);
  const snare = new Float64Array(beatsPerBar);
  const counts = new Float64Array(beatsPerBar);
  let k = 0;
  for (let pos = phaseFrames; pos < low.length; pos += period, k++) {
    const slot = k % beatsPerBar;
    kick[slot] += peakNear(low, pos);
    snare[slot] += peakNear(mid, pos);
    counts[slot]++;
  }
  for (let i = 0; i < beatsPerBar; i++) {
    kick[i] /= counts[i] || 1;
    snare[i] /= counts[i] || 1;
  }
  const scores = [];
  for (let d = 0; d < beatsPerBar; d++) {
    let s = kick[d];
    if (beatsPerBar === 4) {
      s += snare[(d + 1) % 4] + snare[(d + 3) % 4] - snare[d] - snare[(d + 2) % 4];
      s += 0.3 * (kick[d] - kick[(d + 2) % 4]);
    }
    scores.push(s);
  }
  let best = 0;
  for (let d = 1; d < beatsPerBar; d++) if (scores[d] > scores[best]) best = d;
  const sorted = [...scores].sort((a, b) => b - a);
  const spread = Math.abs(sorted[0]) + Math.abs(sorted[sorted.length - 1]) || 1;
  return { beatIndex: best, confidence: Math.max(0, Math.min(1, (sorted[0] - sorted[1]) / spread)) };
}

function confidenceLabel(c) {
  if (c >= 0.66) return 'élevée';
  if (c >= 0.33) return 'moyenne';
  return 'faible';
}

// Point d'entrée : analyse complète d'un signal mono.
// Retourne des temps en secondes relatifs au début de `samples`.
export function analyzeTempo(samples, sampleRate, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const features = computeFeatures(samples, sampleRate, options);
  onProgress(0.6);
  return analyzeFeatures(features, options, onProgress);
}

export function computeFeatures(samples, sampleRate, options = {}) {
  const opts = { ...TEMPO_DEFAULTS, ...options };
  const ds = downsample(samples, sampleRate, opts.targetSampleRate);
  return onsetFeatures(ds.samples, ds.sampleRate, opts);
}

export function analyzeFeatures(features, options = {}, onProgress = () => {}) {
  const opts = { ...TEMPO_DEFAULTS, ...options };
  const { frameRate, latency } = features;
  const env = normalizeEnvelope(features.full, frameRate);
  if (env.length < frameRate * 4) {
    return { ok: false, reason: 'Extrait trop court (il faut au moins quelques secondes avec de la batterie).' };
  }
  const peaks = tempoCandidates(env, frameRate, opts);
  onProgress(0.75);
  if (!peaks.length) return { ok: false, reason: 'Aucune pulsation régulière trouvée.' };

  // Avec un BPM imposé (×2, ÷2, alternative choisie), on ne cherche qu'autour de lui.
  const grid = options.bpmHint
    ? fitGrid(env, frameRate, options.bpmHint, { range: 0.5 })
    : fitGrid(env, frameRate, peaks[0].bpm);
  onProgress(0.9);
  const beatSec = 60 / grid.bpm;
  const firstBeat = grid.phaseFrames / frameRate + latency;
  const down = findDownbeat(features, grid.bpm, grid.phaseFrames, 4);
  const barSec = beatSec * 4;
  let downbeat = (firstBeat + down.beatIndex * beatSec) % barSec;
  if (downbeat < 0) downbeat += barSec;

  // Confiance tempo : corrélation à la période retenue + netteté du pic de grille.
  const top = peaks[0];
  const second = peaks.find((p) => Math.abs(Math.log2(p.bpm / top.bpm)) > 0.05);
  const margin = second ? 1 - second.score / top.score : 1;
  const confidence = Math.max(0, Math.min(1, 0.6 * Math.min(1, top.correlation / 0.35) + 0.4 * margin));

  // Alternatives proposées : moitié / double + autres pics, dédoublonnées.
  const alternatives = [];
  const push = (bpm, reason) => {
    if (bpm < 40 || bpm > 220) return;
    const r = Math.round(bpm * 10) / 10;
    if (Math.abs(r - grid.bpm) < 1) return;
    if (alternatives.some((a) => Math.abs(a.bpm - r) < 1)) return;
    alternatives.push({ bpm: r, reason });
  };
  push(grid.bpm / 2, 'moitié (half-time)');
  push(grid.bpm * 2, 'double');
  for (const p of peaks.slice(1, 4)) push(p.bpm, 'autre pulsation');

  onProgress(1);
  return {
    ok: true,
    bpm: Math.round(grid.bpm * 100) / 100,
    downbeat,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    downbeatConfidence: down.confidence,
    alternatives: alternatives.slice(0, 3),
  };
}
