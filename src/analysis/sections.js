// Proposition automatique de sections (fonction pure). L'utilisateur valide ou corrige ensuite.
//
// On décrit chaque mesure par son niveau, sa brillance et le nombre de coups de kick et de caisse
// claire. Avant chaque mesure, on compare les 4 mesures d'avant aux 4 d'après : un gros écart =
// début d'une nouvelle partie (on garde les écarts les plus nets, à 4 mesures d'intervalle au
// moins). Les parties qui se ressemblent reçoivent la même lettre (Partie A, B…) ; une partie sans
// batterie au début / au milieu / à la fin = Intro / Break / Outro.

import { hitCount } from './drums.js';

// Échelles : un écart de « 1 » ≈ 4 dB, 5 % de brillance, ou 1,5 coup par mesure.
const SCALE = { level: 4, bright: 0.05, kick: 1.5, snare: 1.5 };
const BOUNDARY = 1.0;
const SAME_PART = 0.75;
const WINDOW = 4;
const MIN_PART = 4;

function describe(bar) {
  return { level: bar.level, bright: bar.bright, kick: hitCount(bar.kick), snare: hitCount(bar.snare) };
}

function mean(list) {
  const out = { level: 0, bright: 0, kick: 0, snare: 0 };
  for (const d of list) for (const k in out) out[k] += d[k] / list.length;
  return out;
}

function distance(a, b) {
  let s = 0;
  for (const k in SCALE) s += ((a[k] - b[k]) / SCALE[k]) ** 2;
  return Math.sqrt(s);
}

const hasDrums = (d) => d.kick + d.snare >= 1;

// `drums` : résultat de analyzeDrums. Retourne [{ startBar, label }].
export function proposeSections(drums) {
  const bars = drums.bars.filter((b) => b.bar >= 1);
  const desc = bars.map(describe);
  const n = desc.length;
  if (n < MIN_PART * 2) return [{ startBar: 1, label: 'Partie A' }];

  // Nouveauté avant chaque mesure i : 4 mesures avant contre 4 après (moins près des bords).
  const novelty = new Array(n).fill(0);
  for (let i = 2; i <= n - 2; i++) {
    const w = Math.min(WINDOW, i, n - i);
    novelty[i] = distance(mean(desc.slice(i - w, i)), mean(desc.slice(i, i + w)));
  }
  // Les plus nettes d'abord, à MIN_PART mesures les unes des autres (et des bords).
  const candidates = novelty
    .map((v, i) => ({ i, v }))
    .filter((c) => c.v >= BOUNDARY && c.i >= 2)
    .sort((a, b) => b.v - a.v);
  // Une intro courte (2 ou 3 mesures) reste permise : seul l'écart avec le début n'est pas imposé.
  const starts = [0];
  for (const c of candidates) {
    if (starts.some((s) => s !== 0 && Math.abs(s - c.i) < MIN_PART)) continue;
    starts.push(c.i);
  }
  starts.sort((a, b) => a - b);
  const parts = starts.map((s, k) => ({ start: s, d: mean(desc.slice(s, starts[k + 1] ?? n)) }));

  // Deux parties sans batterie qui se suivent n'en font qu'une (fin qui s'éteint, par exemple).
  const merged = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if (prev && !hasDrums(prev.d) && !hasDrums(p.d)) continue;
    merged.push(p);
  }
  for (let k = 0; k < merged.length; k++) merged[k].d = mean(desc.slice(merged[k].start, merged[k + 1]?.start ?? n));

  const groups = [];
  return merged.map((p, i) => {
    let label;
    if (merged.length > 1 && !hasDrums(p.d)) label = i === 0 ? 'Intro' : i === merged.length - 1 ? 'Outro' : 'Break';
    else {
      let g = groups.find((x) => distance(x.d, p.d) < SAME_PART);
      if (!g) groups.push((g = { d: p.d, letter: String.fromCharCode(65 + groups.length) }));
      label = `Partie ${g.letter}`;
    }
    return { startBar: bars[p.start].bar, label };
  });
}
