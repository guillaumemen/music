import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/core/sections.js';

const starts = (list) => list.map((s) => s.startBar);

test('splitAt sur une liste vide crée aussi la section de départ', () => {
  const list = S.splitAt([], 9);
  assert.deepEqual(starts(list), [1, 9]);
  assert.equal(list[0].label, 'Intro');
  assert.equal(list[1].label, 'Couplet');
  assert.deepEqual(starts(S.splitAt(list, 9)), [1, 9], 'pas de doublon');
  assert.equal(S.splitAt(list, 25)[2].label, 'Refrain');
});

test('sectionRanges et sectionAtBar', () => {
  const list = S.normalizeSections([{ startBar: 9, label: 'Couplet' }, { startBar: 1, label: 'Intro' }]);
  const ranges = S.sectionRanges(list, 40);
  assert.deepEqual(ranges.map((r) => [r.startBar, r.endBar]), [[1, 9], [9, 41]]);
  assert.equal(S.sectionAtBar(list, 8).label, 'Intro');
  assert.equal(S.sectionAtBar(list, 9).label, 'Couplet');
  assert.equal(S.sectionAtBar(list.slice(1), 3), null);
});

test('moveSection reste entre les voisines, removeSection rallonge la précédente', () => {
  let list = S.normalizeSections([{ startBar: 1 }, { startBar: 9 }, { startBar: 17 }]);
  const mid = list[1].id;
  assert.deepEqual(starts(S.moveSection(list, mid, 30)), [1, 16, 17]);
  assert.deepEqual(starts(S.moveSection(list, mid, -3)), [1, 2, 17]);
  list = S.removeSection(list, mid);
  assert.deepEqual(starts(list), [1, 17]);
  assert.deepEqual(S.sectionRanges(list, 20).map((r) => r.endBar), [17, 21]);
});

test('couleur stable par nom', () => {
  assert.equal(S.sectionColor('Couplet'), S.sectionColor('couplet 2'));
  assert.notEqual(S.sectionColor('Couplet'), S.sectionColor('Refrain'));
});
