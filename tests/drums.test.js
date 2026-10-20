import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFeatures } from '../src/analysis/tempo.js';
import { analyzeDrums, drumPattern, HIT_THRESHOLD, gridSignature } from '../src/analysis/drums.js';
import { proposeSections } from '../src/analysis/sections.js';
import { synthBeat } from './synth.js';

const SR = 44100;
const hits = (values) => values.flatMap((v, i) => (v >= HIT_THRESHOLD ? [i] : []));

function drumsFor(c, duration = 30) {
  const features = computeFeatures(synthBeat({ ...c, duration, sampleRate: SR }), SR);
  return analyzeDrums(features, { bpm: c.bpm, downbeat: c.downbeat, beatsPerBar: 4 }, { duration });
}

// La prod synthétique : kick sur le 1 et le « 3 et » (cases 0 et 10), caisse claire sur 2 et 4
// (cases 4 et 12), charley en croches qui ne doit pas passer pour une caisse claire.
for (const c of [
  { bpm: 85, downbeat: 0.37 },
  { bpm: 65, downbeat: 0.9 },
  { bpm: 160, downbeat: 0.2 },
  { bpm: 88, downbeat: 0.8, swing: 0.3 },
]) {
  test(`grille 16 cases : kick et caisse claire à ${c.bpm} BPM`, () => {
    const r = drumsFor(c);
    assert.equal(r.steps, 16);
    assert.deepEqual(hits(r.pattern.kick), [0, 10]);
    assert.deepEqual(hits(r.pattern.snare), [4, 12]);
    // Mesure par mesure aussi (hors première et dernière, incomplètes).
    for (const bar of r.bars.slice(2, -2)) {
      assert.deepEqual(hits(bar.kick), [0, 10], `kick mesure ${bar.bar}`);
      assert.deepEqual(hits(bar.snare), [4, 12], `caisse claire mesure ${bar.bar}`);
    }
  });
}

test('mesures sans batterie : aucune case allumée', () => {
  const r = drumsFor({ bpm: 90, downbeat: 0.3, muted: (bar) => bar >= 5 && bar <= 6 });
  for (const n of [5, 6]) {
    const bar = r.bars.find((b) => b.bar === n);
    assert.deepEqual(hits(bar.kick), [], `kick mesure ${n}`);
    assert.deepEqual(hits(bar.snare), [], `caisse claire mesure ${n}`);
  }
  assert.deepEqual(hits(r.bars.find((b) => b.bar === 8).kick), [0, 10]);
});

test('motif type : kick qui change à chaque mesure (trap) signalé comme variable', () => {
  const steps = (list) => Array.from({ length: 16 }, (_, i) => (list.includes(i) ? 0.9 : 0));
  const kicks = [[0, 3, 10], [0, 7], [2, 11, 14], [5, 6, 15], [1, 9], [3, 12]];
  const bars = kicks.map((k, i) => ({ bar: i + 1, kick: steps(k), snare: steps([4, 12]) }));
  const p = drumPattern(bars);
  assert.equal(p.kickVaries, true);
  assert.deepEqual(hits(p.snare), [4, 12]);
  assert.equal(p.snare[4], 1);
  assert.ok(p.kick[0] > 0 && p.kick[0] < 0.5);
});

test('signature de grille', () => {
  assert.equal(gridSignature({ bpm: 90, downbeat: 0.5, beatsPerBar: 4 }), gridSignature({ bpm: 90.0001, downbeat: 0.50001 }));
  assert.notEqual(gridSignature({ bpm: 90, downbeat: 0.5 }), gridSignature({ bpm: 90, downbeat: 0.51 }));
});

test('sections proposées : intro sans batterie, puis la partie avec batterie', () => {
  // 100 BPM : mesure = 2,4 s. Batterie coupée sur les mesures 1 à 8.
  const r = drumsFor({ bpm: 100, downbeat: 0.2, muted: (bar) => bar <= 8 }, 60);
  const s = proposeSections(r);
  assert.equal(s[0].startBar, 1);
  assert.equal(s[0].label, 'Intro');
  assert.equal(s[1].startBar, 9);
  assert.equal(s[1].label, 'Partie A');
  assert.ok(s.length <= 3, JSON.stringify(s));
});

test('sections proposées : break au milieu, frontières à la mesure près', () => {
  // Batterie coupée sur les mesures 11 à 14 (frontières hors multiples de 4).
  const r = drumsFor({ bpm: 95, downbeat: 0.1, muted: (bar) => bar >= 11 && bar <= 14 }, 75);
  const s = proposeSections(r);
  const starts = s.map((x) => x.startBar);
  assert.ok(starts.includes(11), JSON.stringify(s));
  assert.ok(starts.includes(15), JSON.stringify(s));
  const brk = s.find((x) => x.startBar === 11);
  assert.equal(brk.label, 'Break');
  // Avant et après le break : même partie (même lettre).
  assert.equal(s.find((x) => x.startBar === 1).label, s.find((x) => x.startBar === 15).label);
});

test('prod uniforme : une seule partie', () => {
  const s = proposeSections(drumsFor({ bpm: 90, downbeat: 0.4 }, 45));
  assert.equal(s.length, 1, JSON.stringify(s));
});
