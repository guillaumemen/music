import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTempo, analyzeFeatures, computeFeatures } from '../src/analysis/tempo.js';
import { synthBeat } from './synth.js';

const SR = 44100;

function circularBarError(a, b, bpm) {
  const bar = (4 * 60) / bpm;
  let d = Math.abs(a - b) % bar;
  return Math.min(d, bar - d);
}

const cases = [
  { bpm: 85, downbeat: 0.37 },
  { bpm: 72, downbeat: 1.2 },
  { bpm: 93.5, downbeat: 0.05 },
  { bpm: 140, downbeat: 0.6 },
  { bpm: 160, downbeat: 0.2 },
  { bpm: 65, downbeat: 0.9 },
  { bpm: 100, downbeat: 2.0, intro: 5 },
  { bpm: 88, downbeat: 0.8, swing: 0.3 },
];

for (const c of cases) {
  test(`détecte ${c.bpm} BPM et le 1 (${JSON.stringify(c)})`, () => {
    const samples = synthBeat({ ...c, duration: 30, sampleRate: SR });
    const r = analyzeTempo(samples, SR);
    assert.ok(r.ok, r.reason);
    const exact = Math.abs(r.bpm - c.bpm) < 0.1;
    // Erreur d'octave tolérée si la bonne valeur est proposée en alternative (bouton ×2 / ÷2).
    const offered = r.alternatives.some((a) => Math.abs(a.bpm - c.bpm) < 0.2);
    assert.ok(exact || offered, `BPM ${r.bpm} au lieu de ${c.bpm}, alternatives ${JSON.stringify(r.alternatives)}`);
    if (exact) {
      const err = circularBarError(r.downbeat, c.downbeat, c.bpm);
      assert.ok(err < 0.01, `le 1 décalé de ${(err * 1000).toFixed(1)} ms (trouvé ${r.downbeat.toFixed(3)})`);
    }
    assert.ok(r.confidence > 0.3, `confiance ${r.confidence}`);
  });
}

test('refuse un extrait trop court', () => {
  const r = analyzeTempo(new Float32Array(SR), SR);
  assert.equal(r.ok, false);
});

test('signal sans pulsation : confiance faible', () => {
  let s = 7;
  const noise = new Float32Array(SR * 20).map(() => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.2);
  const r = analyzeTempo(noise, SR);
  assert.ok(!r.ok || r.confidence < 0.5, `confiance ${r.confidence}`);
});

test('BPM imposé (×2) : recale aussi le 1 au nouveau tempo', () => {
  const c = { bpm: 140, downbeat: 0.6 };
  const features = computeFeatures(synthBeat({ ...c, duration: 30 }), SR);
  const r = analyzeFeatures(features, { bpmHint: 140 });
  assert.ok(r.ok);
  assert.ok(Math.abs(r.bpm - 140) < 0.1, `BPM ${r.bpm}`);
  assert.ok(circularBarError(r.downbeat, c.downbeat, c.bpm) < 0.01, `le 1 trouvé à ${r.downbeat}`);
});
