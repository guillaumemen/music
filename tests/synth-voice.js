// Génère un « yaourt » synthétique : des syllabes « da » (petite attaque bruitée + voyelle voisée
// avec harmoniques), à des instants connus, sur un léger bruit de fond (micro).
export function synthVoice({ times, accents = [], duration, sampleRate = 44100, f0 = 140, seed = 3, noise = 0.003, gap = 0.2 }) {
  const n = Math.floor(duration * sampleRate);
  const out = new Float32Array(n);
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) out[i] = noise * rand();
  times.forEach((t, k) => {
    const accent = accents.includes(k);
    const amp = accent ? 0.5 : 0.22;
    const f = accent ? f0 * 1.25 : f0;
    const next = times[k + 1] ?? t + 0.3;
    const len = Math.min(gap, next - t - 0.03);
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < len * sampleRate && start + i < n; i++) {
      const x = i / sampleRate;
      // Attaque en 15 ms, tenue, puis chute vers la consonne suivante.
      const env = Math.min(1, x / 0.015) * Math.min(1, Math.max(0, (len - x) / 0.04));
      let v = 0;
      for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * x) / h;
      const burst = x < 0.008 ? 0.6 * rand() : 0;
      out[start + i] += amp * env * (0.6 * v + burst);
    }
  });
  return out;
}
