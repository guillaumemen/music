// Génère une « prod » synthétique : kick sur 1 et 3+, caisse claire sur 2 et 4,
// charley en croches, nappe tenue. Permet de vérifier la détection sans fichier audio.
export function synthBeat({ bpm, downbeat = 0, duration = 30, sampleRate = 44100, seed = 1, swing = 0, intro = 0 }) {
  const n = Math.floor(duration * sampleRate);
  const out = new Float32Array(n);
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const beat = 60 / bpm;

  const addKick = (t) => {
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < 0.25 * sampleRate && start + i < n; i++) {
      if (start + i < 0) continue;
      const x = i / sampleRate;
      const f = 50 + 90 * Math.exp(-x * 30);
      out[start + i] += 0.9 * Math.sin(2 * Math.PI * f * x) * Math.exp(-x * 12);
    }
  };
  const addNoise = (t, len, gain, decay) => {
    const start = Math.round(t * sampleRate);
    let lp = 0;
    for (let i = 0; i < len * sampleRate && start + i < n; i++) {
      if (start + i < 0) continue;
      const x = i / sampleRate;
      lp = 0.6 * lp + 0.4 * rand();
      out[start + i] += gain * lp * Math.exp(-x * decay);
    }
  };

  const firstBar = Math.floor(-downbeat / (4 * beat)) - 1;
  for (let bar = firstBar; ; bar++) {
    const t0 = downbeat + bar * 4 * beat;
    if (t0 > duration) break;
    if (t0 < intro) continue;
    addKick(t0);
    addKick(t0 + 2.5 * beat);
    addNoise(t0 + beat, 0.18, 0.55, 18);
    addNoise(t0 + 3 * beat, 0.18, 0.55, 18);
    for (let e = 0; e < 8; e++) {
      const off = e % 2 ? swing * beat * 0.5 : 0;
      addNoise(t0 + (e * beat) / 2 + off, 0.04, 0.12, 90);
    }
  }
  // Nappe (piano-pad) : accord tenu, changement toutes les 2 mesures.
  const chords = [[220, 261.6, 329.6], [196, 246.9, 293.7]];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const c = chords[Math.floor(Math.max(0, t - downbeat) / (8 * beat)) % 2];
    let v = 0;
    for (const f of c) v += Math.sin(2 * Math.PI * f * t);
    out[i] += 0.04 * v;
  }
  return out;
}
