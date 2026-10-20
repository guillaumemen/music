import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countLine, syllabify, judgeLine } from '../src/core/syllables.js';

const cases = [
  ['maison', 2, 2], ['samedi', 2, 3], ['petit', 1, 2], ["p'tit", 1, 1], ["j'suis", 1, 1], ['je suis', 1, 2],
  ['la vie', 2, 2], ['ville', 1, 2], ['passion', 2, 3], ['bien', 1, 2], ['oiseau', 2, 2], ['quelque', 1, 2],
  ['quand', 1, 1], ['guerre', 1, 2], ['mangeons', 2, 2], ['poète', 2, 3], ['réel', 2, 2], ['naïf', 2, 2],
  ["aujourd'hui", 3, 3], ['elle a', 2, 2], ['ils chantent', 2, 3], ['le moment', 2, 3], ['nuit', 1, 1],
  ['oui', 1, 1], ['les yeux', 2, 2], ['année', 2, 2], ['voyage', 2, 3], ['mélancolie', 4, 4], ['peut-être', 2, 3],
  ["j'marche seul dans la nuit", 5, 6],
];

for (const [text, min, max] of cases) {
  test(`syllabes : « ${text} » = ${min}–${max}`, () => {
    const r = countLine(text);
    assert.deepEqual([r.min, r.max], [min, max], syllabify(text));
  });
}

test('découpe affichée', () => {
  assert.equal(syllabify('samedi soir'), 'sa·(me)·di soir');
  assert.equal(syllabify('quelque chose'), 'quel·(que) cho·(se)');
});

test('jugement par rapport au yaourt', () => {
  const c = countLine('je marche seul dans la nuit'); // 5 à 7
  assert.equal(judgeLine(c, 6).status, 'ok');
  assert.equal(judgeLine(c, 8).status, 'presque');
  assert.equal(judgeLine(c, 10).status, 'court');
  assert.equal(judgeLine(c, 3).status, 'long');
  assert.equal(judgeLine(c, 0).status, 'none');
});
