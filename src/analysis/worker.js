// Web Worker : l'analyse tourne hors du fil principal pour ne pas figer l'interface.
// Messages reçus :
//   { type: 'analyze', jobId, key, samples, sampleRate, offset, full }  -> analyse complète
//   { type: 'refine',  jobId, key, bpm }                                  -> recalage à un BPM imposé
//   { type: 'drums',   jobId, key, grid, duration, samples?, sampleRate? } -> kick / caisse claire en 16 cases
// `offset` (s) : début de l'extrait analysé dans le morceau (analyse d'une boucle).
// `full` : l'extrait est le morceau entier (ses attaques servent alors aussi à la batterie).
import { computeFeatures, analyzeFeatures } from './tempo.js';
import { analyzeDrums } from './drums.js';

let cache = null; // { key, features, offset } : dernier extrait analysé (pour 'refine')
let fullCache = null; // { key, features } : morceau entier (pour 'drums')

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
      if (msg.full) fullCache = { key: msg.key, features };
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
    } else if (msg.type === 'drums') {
      if (fullCache?.key !== msg.key) {
        if (!msg.samples) {
          self.postMessage({ type: 'result', jobId: msg.jobId, result: { ok: false, reason: 'no-cache' } });
          return;
        }
        progress(0.1);
        fullCache = { key: msg.key, features: computeFeatures(msg.samples, msg.sampleRate) };
      }
      const result = analyzeDrums(fullCache.features, msg.grid, { duration: msg.duration });
      self.postMessage({ type: 'result', jobId: msg.jobId, result });
    }
  } catch (err) {
    self.postMessage({ type: 'result', jobId: msg.jobId, result: { ok: false, reason: String(err?.message || err) } });
  }
};
