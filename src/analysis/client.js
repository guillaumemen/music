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
  analyze(key, samples, sampleRate, { offset = 0, onProgress } = {}) {
    const copy = samples.slice();
    return this.#send({ type: 'analyze', key, samples: copy, sampleRate, offset }, onProgress, [copy.buffer]);
  }

  refine(key, bpm) {
    return this.#send({ type: 'refine', key, bpm });
  }

  #send(message, onProgress, transfer = []) {
    const jobId = this.nextId++;
    return new Promise((resolve) => {
      this.jobs.set(jobId, { resolve, onProgress });
      this.worker.postMessage({ ...message, jobId }, transfer);
    });
  }
}
