import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGrid } from '../src/core/grid.js';
import { placeSyllables, flowMap } from '../src/core/flow.js';

// 120 BPM, le 1 à 0 s : double croche = 125 ms, mesure = 2 s.
const g = createGrid(120, 0);
const at = (bar, step, devMs = 0) => ({ time: (bar - 1) * 2 + step * 0.125 + devMs / 1000, accent: false });

test('placement : mesure, case et avance / retard', () => {
  const p = placeSyllables([at(1, 0), at(1, 4, -50), at(2, 6, 45), at(2, 15, 10)], g);
  assert.deepEqual(p.map((s) => [s.bar, s.step, s.timing]), [
    [1, 0, 'on'],
    [1, 4, 'early'],
    [2, 6, 'late'],
    [2, 15, 'on'],
  ]);
  assert.equal(p[1].devMs, -50);
});

test('une syllabe juste avant le 1 appartient à la mesure suivante', () => {
  const [s] = placeSyllables([at(3, 0, -20)], g);
  assert.equal(s.bar, 3);
  assert.equal(s.step, 0);
});

test('carte de flow : motifs répétés, accélération, silences', () => {
  const motif = [0, 2, 4, 6, 10];
  const sylls = [
    ...motif.map((s) => at(1, s)),
    ...motif.map((s) => at(2, s)),
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((s) => at(3, s)),
    // mesure 4 vide
    ...motif.map((s) => at(5, s, 10)),
  ];
  const m = flowMap(placeSyllables(sylls, g), g, { fromBar: 1, toBar: 5 });
  assert.deepEqual(m.bars.map((b) => b.count), [5, 5, 12, 0, 5]);
  assert.equal(m.bars[0].motif, 'A');
  assert.equal(m.bars[1].motif, 'A');
  assert.equal(m.bars[4].motif, 'A');
  assert.equal(m.bars[2].motif, null);
  assert.equal(m.bars[2].trend, 'accélère');
  assert.ok(m.bars[3].silence);
  assert.ok(m.gaps.some((x) => x.from >= 4 && x.to >= 8), JSON.stringify(m.gaps));
  assert.equal(m.stats.on, 100);
  assert.equal(m.stats.perBar, 6.8);
});
