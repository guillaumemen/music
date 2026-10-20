import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVoice, OnsetDetector } from '../src/analysis/voice.js';
import { synthVoice } from './synth-voice.js';

const SR = 44100;

function phrase() {
  const times = [];
  let t = 0.5;
  for (let i = 0; i < 24; i++) {
    times.push(Math.round(t * 1000) / 1000);
    t += [0.17, 0.17, 0.34, 0.17, 0.12, 0.5][i % 6];
  }
  return { times, accents: [2, 8, 14, 20], duration: t + 0.5 };
}

test('yaourt « da-da » : chaque syllabe trouvée à 10 ms près', () => {
  const p = phrase();
  const r = analyzeVoice(synthVoice({ ...p, sampleRate: SR }), SR);
  assert.equal(r.length, p.times.length);
  r.forEach((s, i) => assert.ok(Math.abs(s.time - p.times[i]) < 0.01, `syllabe ${i} : ${s.time} au lieu de ${p.times[i]}`));
});

test('accents : les syllabes plus fortes et plus hautes', () => {
  const p = phrase();
  const r = analyzeVoice(synthVoice({ ...p, sampleRate: SR }), SR);
  const found = r.flatMap((s, i) => (s.accent ? [i] : []));
  assert.deepEqual(found, p.accents);
  assert.ok(r[2].pitch > r[1].pitch, 'hauteur plus haute sur l\'accent');
});

test('syllabes rapides (double croches à 100 BPM)', () => {
  const times = Array.from({ length: 16 }, (_, i) => 0.4 + i * 0.15);
  const r = analyzeVoice(synthVoice({ times, duration: 3.2, sampleRate: SR, gap: 0.12 }), SR);
  assert.equal(r.length, 16);
});

test('silence et bruit de fond seuls : aucune syllabe', () => {
  const r = analyzeVoice(synthVoice({ times: [], duration: 3, sampleRate: SR, noise: 0.01 }), SR);
  assert.equal(r.length, 0);
});

test('en direct (morceau par morceau) = même résultat', () => {
  const p = phrase();
  const x = synthVoice({ ...p, sampleRate: SR });
  const det = new OnsetDetector(SR);
  const live = [];
  for (let i = 0; i < x.length; i += 2048) live.push(...det.push(x.subarray(i, i + 2048)));
  live.push(...det.flush());
  assert.equal(live.length, p.times.length);
});
