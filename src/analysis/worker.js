// Web Worker : l'analyse tourne hors du fil principal pour ne pas figer l'interface.
// Messages reçus :
//   { type: 'analyze', jobId, key, samples, sampleRate, offset }  -> analyse complète
//   { type: 'refine',  jobId, key, bpm }                            -> recalage à un BPM imposé
// `offset` (s) : début de l'extrait analysé dans le morceau (analyse d'une boucle).
import { computeFeatures, analyzeFeatures } from './tempo.js';

let cache = null; // { key, features, offset }

function shift(result, offset) {
  if (!result.ok) return result;
  return { ...result, downbeat: result.downbeat + offset };
}

self.onmessage = (event) => {
  const msg = event.data;
  const progress = (value) => self.postMessage({ type: 'progress', jobId: msg.jobId, value });
  try {
    if (msg.type === 'analyze') {
      progress(0.05);
      const features = computeFeatures(msg.samples, msg.sampleRate);
      cache = { key: msg.key, features, offset: msg.offset || 0 };
      progress(0.6);
      const result = analyzeFeatures(features, {}, progress);
      self.postMessage({ type: 'result', jobId: msg.jobId, result: shift(result, cache.offset) });
    } else if (msg.type === 'refine') {
      if (!cache || cache.key !== msg.key) {
        self.postMessage({ type: 'result', jobId: msg.jobId, result: { ok: false, reason: 'no-cache' } });
        return;
      }
      const result = analyzeFeatures(cache.features, { bpmHint: msg.bpm });
      self.postMessage({ type: 'result', jobId: msg.jobId, result: shift(result, cache.offset) });
    }
  } catch (err) {
    self.postMessage({ type: 'result', jobId: msg.jobId, result: { ok: false, reason: String(err?.message || err) } });
  }
};
