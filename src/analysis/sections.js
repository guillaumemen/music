// Proposition automatique de sections (fonction pure). L'utilisateur valide ou corrige ensuite.
//
// On décrit chaque mesure par son niveau, sa brillance et le nombre de coups de kick et de caisse
// claire. On compare des blocs de 4 mesures consécutifs : un gros écart = début d'une nouvelle
// partie. La frontière est ensuite affinée à ±2 mesures. Les parties qui se ressemblent reçoivent
// la même lettre (Partie A, B…) ; une partie sans batterie au début / à la fin = Intro / Outro.

import { hitCount } from './drums.js';

// Échelles : un écart de « 1 » ≈ 4 dB, 5 % de brillance, ou 1,5 coup par mesure.
const SCALE = { level: 4, bright: 0.05, kick: 1.5, snare: 1.5 };
const BOUNDARY = 1.0;
const SAME_PART = 0.75;

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
export function proposeSections(drums, { blockBars = 4 } = {}) {
  const bars = drums.bars.filter((b) => b.bar >= 1);
  // Dernière mesure souvent incomplète (fin du fichier) : on ne la laisse pas créer une partie.
  const desc = bars.map(describe);
  if (desc.length < blockBars * 2) return [{ startBar: 1, label: 'Partie A' }];

  const blocks = [];
  for (let i = 0; i + blockBars <= desc.length; i += blockBars) blocks.push(mean(desc.slice(i, i + blockBars)));

  // Frontières entre blocs, puis affinage à la mesure près.
  const starts = [0];
  for (let k = 1; k < blocks.length; k++) {
    if (distance(blocks[k - 1], blocks[k]) < BOUNDARY) continue;
    const center = k * blockBars;
    let best = center, bestD = -1;
    for (let i = center - 2; i <= center + 2; i++) {
      if (i <= starts[starts.length - 1] + 1 || i + 2 > desc.length) continue;
      const d = distance(mean(desc.slice(i - 2, i)), mean(desc.slice(i, i + 2)));
      if (d > bestD + 0.05 || (Math.abs(d - bestD) <= 0.05 && Math.abs(i - center) < Math.abs(best - center))) {
        best = i;
        bestD = d;
      }
    }
    starts.push(best);
  }

  // Description moyenne de chaque partie, puis regroupement par ressemblance.
  const parts = starts.map((s, i) => ({ start: s, d: mean(desc.slice(s, starts[i + 1] ?? desc.length)) }));
  const groups = [];
  return parts.map((p, i) => {
    let label;
    if (parts.length > 1 && !hasDrums(p.d)) label = i === 0 ? 'Intro' : i === parts.length - 1 ? 'Outro' : 'Break';
    else {
      let g = groups.find((x) => distance(x.d, p.d) < SAME_PART);
      if (!g) groups.push((g = { d: p.d, letter: String.fromCharCode(65 + groups.length) }));
      label = `Partie ${g.letter}`;
    }
    return { startBar: bars[p.start].bar, label };
  });
}
