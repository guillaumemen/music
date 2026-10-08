import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/core/grid.js';
import { TapTempo } from '../src/core/tap.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('positionAt : mesure et temps', () => {
  const g = G.createGrid(120, 0.5); // temps = 0,5 s, mesure = 2 s
  assert.deepEqual(G.positionAt(0.5, g).bar, 1);
  assert.equal(G.positionAt(0.5, g).beat, 1);
  assert.equal(G.positionAt(1.6, g).beat, 3);
  assert.equal(G.positionAt(2.5, g).bar, 2);
  assert.equal(G.positionAt(0.1, g).bar, 0);
  assert.equal(G.positionAt(0.1, g).beat, 4);
});

test('beatsInRange marque les premiers temps', () => {
  const g = G.createGrid(120, 0);
  const beats = G.beatsInRange(0, 2.01, g);
  assert.equal(beats.length, 5);
  assert.deepEqual(beats.map((b) => b.isDownbeat), [true, false, false, false, true]);
});

test('×2 / ÷2 conservent le 1', () => {
  const g = G.createGrid(80, 0.3);
  const h = G.halveTempo(g);
  close(h.bpm, 40);
  close(h.downbeat, 0.3);
  const d = G.doubleTempo(g);
  close(d.bpm, 160);
  close(d.downbeat, 0.3);
});

test('shiftBeats et normalisation', () => {
  const g = G.createGrid(120, 0.25);
  close(G.shiftBeats(g, 1).downbeat, 0.75);
  close(G.shiftBeats(g, -1).downbeat, 1.75);
  close(G.snapToBar(4.3, g), 4.25);
  close(G.snapToBeat(1.1, g), 1.25);
});

test('tap tempo', () => {
  const t = new TapTempo();
  [0, 0.5, 1, 1.5].forEach((x) => t.tap(x));
  close(t.bpm, 120);
  t.tap(10); // longue pause : on recommence
  assert.equal(t.count, 1);
  assert.equal(t.bpm, null);
});
