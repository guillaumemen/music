// Interface côté page vers le worker d'analyse (promesses + progression).
export class AnalysisClient {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.jobs = new Map();
    this.nextId = 1;
    this.worker.onmessage = (event) => {
      const { type, jobId, value, result } = event.data;
      const job = this.jobs.get(jobId);
      if (!job) return;
      if (type === 'progress') job.onProgress?.(value);
      else if (type === 'result') {
        this.jobs.delete(jobId);
        job.resolve(result);
      }
    };
  }

  // samples : Float32Array mono (copiée puis transférée au worker).
  // `full` : l'extrait est le morceau entier (le worker le garde pour l'analyse de la batterie).
  analyze(key, samples, sampleRate, { offset = 0, full = false, onProgress } = {}) {
    const copy = samples.slice();
    return this.#send({ type: 'analyze', key, samples: copy, sampleRate, offset, full }, onProgress, [copy.buffer]);
  }

  refine(key, bpm) {
    return this.#send({ type: 'refine', key, bpm });
  }

  // Kick / caisse claire en 16 cases pour une grille. Le signal n'est envoyé que si le worker
  // n'a pas déjà les attaques du morceau entier.
  async drums(key, grid, audio, { onProgress } = {}) {
    const base = { type: 'drums', key, grid: { ...grid }, duration: audio.duration };
    const result = await this.#send(base);
    if (result.ok || result.reason !== 'no-cache') return result;
    const copy = audio.samples.slice();
    return this.#send({ ...base, samples: copy, sampleRate: audio.sampleRate }, onProgress, [copy.buffer]);
  }

  #send(message, onProgress, transfer = []) {
    const jobId = this.nextId++;
    return new Promise((resolve) => {
      this.jobs.set(jobId, { resolve, onProgress });
      this.worker.postMessage({ ...message, jobId }, transfer);
    });
  }
}
