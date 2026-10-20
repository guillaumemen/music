// Carte de flow : les syllabes d'une prise posées sur la grille (fonctions pures).
//
// Chaque syllabe est rattachée à la double croche la plus proche ; l'écart dit si elle tombe en
// avance, dans le temps ou en retard. Par mesure : nombre de syllabes, accents, silences,
// accélérations, et motifs rythmiques qui reviennent (même lettre = même placement).

import { barDuration, beatDuration } from './grid.js';

export const STEPS_PER_BEAT = 4;

// Tolérance « dans le temps » : 35 ms, ou moins si la double croche est très courte.
export function timingTolerance(grid) {
  const stepSec = beatDuration(grid) / STEPS_PER_BEAT;
  return Math.min(0.035, stepSec * 0.3);
}

// `sylls` : [{ time (s, temps de la prod), accent, ... }].
export function placeSyllables(sylls, grid) {
  const steps = grid.beatsPerBar * STEPS_PER_BEAT;
  const stepSec = barDuration(grid) / steps;
  const tol = timingTolerance(grid);
  return sylls.map((s) => {
    const pos = (s.time - grid.downbeat) / stepSec; // en doubles croches depuis le 1er « 1 »
    const nearest = Math.round(pos);
    const dev = (pos - nearest) * stepSec;
    const bar = Math.floor(nearest / steps) + 1;
    const step = ((nearest % steps) + steps) % steps;
    const timing = dev < -tol ? 'early' : dev > tol ? 'late' : 'on';
    return { ...s, bar, step, pos: pos - (bar - 1) * steps, devMs: Math.round(dev * 1000), timing };
  });
}

const jaccard = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 1;
};

// Carte de flow sur les mesures [fromBar, toBar].
export function flowMap(placed, grid, { fromBar, toBar } = {}) {
  const steps = grid.beatsPerBar * STEPS_PER_BEAT;
  const beat = beatDuration(grid);
  if (fromBar === undefined) fromBar = placed.length ? Math.min(...placed.map((p) => p.bar)) : 1;
  if (toBar === undefined) toBar = placed.length ? Math.max(...placed.map((p) => p.bar)) : fromBar;

  const bars = [];
  for (let bar = fromBar; bar <= toBar; bar++) {
    const list = placed.filter((p) => p.bar === bar);
    bars.push({
      bar,
      count: list.length,
      accents: list.filter((p) => p.accent).length,
      steps: [...new Set(list.map((p) => p.step))].sort((a, b) => a - b),
      onBeat: list.filter((p) => p.timing === 'on').length,
      motif: null,
      trend: null, // 'accélère' | 'ralentit'
      silence: list.length === 0,
    });
  }

  // Accélérations / ralentissements d'une mesure à l'autre.
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1].count, b = bars[i].count;
    if (b >= a + 3 && b >= a * 1.5) bars[i].trend = 'accélère';
    else if (a >= b + 3 && a >= b * 1.5) bars[i].trend = 'ralentit';
  }

  // Motifs : deux mesures dont les placements se recouvrent à 70 % reçoivent la même lettre.
  const motifs = [];
  for (const b of bars) {
    if (b.count < 3) continue;
    const set = new Set(b.steps);
    let m = motifs.find((x) => jaccard(x.set, set) >= 0.7);
    if (!m) motifs.push((m = { set, letter: String.fromCharCode(65 + (motifs.length % 26)), bars: [] }));
    m.bars.push(b.bar);
    b.motif = m.letter;
  }
  for (const b of bars) if (b.motif && motifs.find((m) => m.letter === b.motif).bars.length < 2) b.motif = null;

  // Silences d'au moins un temps entre deux syllabes (respirations).
  const ordered = [...placed].sort((a, b) => a.time - b.time);
  const gaps = [];
  for (let i = 1; i < ordered.length; i++) {
    const g = ordered[i].time - (ordered[i - 1].end || ordered[i - 1].time);
    if (g >= beat) gaps.push({ from: ordered[i - 1].end || ordered[i - 1].time, to: ordered[i].time, beats: Math.round((g / beat) * 10) / 10 });
  }

  const n = placed.length || 1;
  const pct = (k) => Math.round((placed.filter((p) => p.timing === k).length / n) * 100);
  const active = bars.filter((b) => b.count > 0);
  return {
    bars,
    gaps,
    motifs: motifs.filter((m) => m.bars.length >= 2).map((m) => ({ letter: m.letter, bars: m.bars })),
    stats: {
      total: placed.length,
      on: pct('on'),
      early: pct('early'),
      late: pct('late'),
      meanAbsDevMs: Math.round(placed.reduce((s, p) => s + Math.abs(p.devMs), 0) / n),
      // Écart moyen signé : négatif = tu as tendance à être en avance.
      meanDevMs: Math.round(placed.reduce((s, p) => s + p.devMs, 0) / n),
      perBar: active.length ? Math.round((placed.length / active.length) * 10) / 10 : 0,
      accents: placed.filter((p) => p.accent).length,
    },
  };
}
