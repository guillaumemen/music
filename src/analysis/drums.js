// Kick et caisse claire sur une grille de 16 cases par mesure (fonction pure, testable sous Node).
//
// Pour chaque case (double croche), on lit la force des attaques autour de l'instant de la case :
// bande grave pour le kick, bande médium pour la caisse claire. Les forces sont ramenées entre 0
// et 1 par rapport à un coup « typique » du morceau, puis une case est un coup au-dessus de
// HIT_THRESHOLD.

import { normalizeEnvelope, peakNear } from './tempo.js';

export const STEPS_PER_BEAT = 4;
export const HIT_THRESHOLD = 0.5;
// À changer quand le format du résultat change : les analyses enregistrées sont alors refaites.
export const DRUMS_VERSION = 2;

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

const round2 = (v) => Math.round(v * 100) / 100;

// Le grave d'une caisse claire (et le médium d'un kick) laisse aussi une trace dans l'autre
// bande : on retire à chaque bande une part de l'autre, mesurée au même instant.
const BLEED = 0.35;

// `grid` : { bpm, downbeat, beatsPerBar }. `duration` (s) : longueur du morceau.
// Retourne { ok, steps, grid, bars: [{ bar, kick[], snare[], level, bright }], pattern }.
// `bars` commence à la mesure 0 (bout de mesure avant le premier « 1 », s'il existe).
export function analyzeDrums(features, grid, { duration } = {}) {
  const { frameRate, latency } = features;
  const nFrames = features.low.length;
  const total = duration ?? nFrames / frameRate;
  const beatsPerBar = grid.beatsPerBar || 4;
  const steps = beatsPerBar * STEPS_PER_BEAT;
  const barSec = (60 / grid.bpm) * beatsPerBar;
  const stepSec = barSec / steps;
  const radius = Math.max(1, Math.min(2, Math.floor((stepSec * frameRate) / 3)));

  const low = normalizeEnvelope(features.lowLin || features.low, frameRate);
  const mid = normalizeEnvelope(features.midLin || features.mid, frameRate);
  const lastBar = Math.floor((total - grid.downbeat) / barSec) + 1;

  const bars = [];
  for (let bar = 0; bar <= lastBar; bar++) {
    const t0 = grid.downbeat + (bar - 1) * barSec;
    const kick = new Array(steps).fill(0);
    const snare = new Array(steps).fill(0);
    for (let s = 0; s < steps; s++) {
      const t = t0 + s * stepSec;
      if (t < 0 || t >= total) continue;
      const pos = (t - latency) * frameRate;
      const k = peakNear(low, pos, radius);
      const m = peakNear(mid, pos, radius);
      kick[s] = Math.max(0, k - BLEED * m);
      snare[s] = Math.max(0, m - BLEED * k);
    }
    const f0 = Math.max(0, Math.floor(t0 * frameRate));
    const f1 = Math.min(nFrames, Math.floor((t0 + barSec) * frameRate));
    let level = 0, bright = 0;
    for (let f = f0; f < f1; f++) {
      level += features.rms?.[f] || 0;
      bright += features.bright?.[f] || 0;
    }
    const n = Math.max(1, f1 - f0);
    bars.push({ bar, kick, snare, level: 20 * Math.log10(level / n + 1e-6), bright: bright / n });
  }

  // Échelle : le coup le plus fort d'une mesure « normale » (on ignore les mesures sans batterie
  // en prenant un quantile haut des maxima par mesure).
  for (const key of ['kick', 'snare']) {
    const maxima = bars.map((b) => Math.max(...b[key])).filter((v) => v > 0);
    const scale = percentile(maxima, 0.75) || 1;
    for (const b of bars) b[key] = b[key].map((v) => round2(Math.min(1, v / scale)));
  }
  for (const b of bars) {
    b.level = round2(b.level);
    b.bright = Math.round(b.bright * 1000) / 1000;
  }

  return { ok: true, version: DRUMS_VERSION, steps, grid: { bpm: grid.bpm, downbeat: grid.downbeat, beatsPerBar }, bars, pattern: drumPattern(bars, steps) };
}

export const hitCount = (values) => values.reduce((n, v) => n + (v >= HIT_THRESHOLD ? 1 : 0), 0);

// Motif type : pour chaque case, la part des mesures (avec batterie) où elle est jouée.
// 1 = à chaque mesure, 0,5 = une mesure sur deux. En trap, le kick (souvent une 808) change
// d'une mesure à l'autre : aucune case n'atteint 0,5 et `kickVaries` le signale.
export function drumPattern(bars, steps = 16) {
  const withDrums = bars.filter((b) => b.bar >= 1 && hitCount(b.kick) + hitCount(b.snare) >= 2);
  const share = (key, s) => (withDrums.length ? round2(withDrums.filter((b) => b[key][s] >= HIT_THRESHOLD).length / withDrums.length) : 0);
  const kick = Array.from({ length: steps }, (_, s) => share('kick', s));
  const snare = Array.from({ length: steps }, (_, s) => share('snare', s));
  const kicksPerBar = withDrums.length ? withDrums.reduce((n, b) => n + hitCount(b.kick), 0) / withDrums.length : 0;
  return { kick, snare, bars: withDrums.length, kickVaries: kicksPerBar >= 1 && hitCount(kick) === 0 };
}

// Signature d'une grille : sert à savoir si une analyse de batterie est encore valable.
export const gridSignature = (g) => (g ? `${Math.round(g.bpm * 1000)}|${Math.round(g.downbeat * 10000)}|${g.beatsPerBar || 4}` : '');
