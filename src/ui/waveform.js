// Forme d'onde + grille rythmique sur <canvas>.
// Deux vues partagent ce composant : l'aperçu (morceau entier) et la vue détaillée (zoom).
import { beatsInRange, isValidGrid, barDuration, snapToBar, snapToBeat } from '../core/grid.js';

const BLOCK = 256; // échantillons par bloc min/max précalculé

// Précalcule min/max par blocs : le dessin d'une vue ne parcourt plus tout le signal.
export function buildPeaks(samples, sampleRate) {
  const n = Math.ceil(samples.length / BLOCK);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let lo = 1, hi = -1;
    const end = Math.min(samples.length, (b + 1) * BLOCK);
    for (let i = b * BLOCK; i < end; i++) {
      const v = samples[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max, blockDuration: BLOCK / sampleRate, duration: samples.length / sampleRate };
}

function cssVar(el, name) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export class WaveformView extends EventTarget {
  // options.mode : 'overview' (morceau entier, clic = aller à) ou 'detail'
  constructor(canvas, { mode = 'detail' } = {}) {
    super();
    this.canvas = canvas;
    this.mode = mode;
    this.peaks = null;
    this.grid = null;
    this.markers = [];
    this.loop = null;
    this.playhead = 0;
    this.view = { start: 0, duration: 10 };
    this.detailView = null; // pour l'aperçu : rectangle de la vue détaillée
    this.cache = null;
    this.drag = null;
    this.#bindPointer();
    new ResizeObserver(() => this.#resize()).observe(canvas);
    this.#resize();
  }

  setPeaks(peaks) {
    this.peaks = peaks;
    if (this.mode === 'overview') this.view = { start: 0, duration: peaks.duration };
    this.cache = null;
  }

  setView(start, duration) {
    const total = this.peaks?.duration || duration;
    const d = Math.min(duration, total);
    const s = Math.max(0, Math.min(start, total - d));
    if (s !== this.view.start || d !== this.view.duration) {
      this.view = { start: s, duration: d };
      this.cache = null;
    }
  }

  timeToX(t) {
    return ((t - this.view.start) / this.view.duration) * this.width;
  }

  xToTime(x) {
    return this.view.start + (x / this.width) * this.view.duration;
  }

  #resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.dpr = dpr;
    this.cache = null;
    this.draw();
  }

  // Couche statique (forme d'onde) mise en cache tant que la vue ne change pas.
  #drawWave() {
    const key = `${this.view.start}|${this.view.duration}|${this.canvas.width}|${this.canvas.height}`;
    if (this.cache?.key === key) return this.cache.canvas;
    const off = this.cache?.canvas || document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const g = off.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.width, this.height);
    if (this.peaks) {
      const { min, max, blockDuration } = this.peaks;
      const mid = this.height / 2;
      const amp = this.height * 0.46;
      g.fillStyle = cssVar(this.canvas, '--wave');
      for (let x = 0; x < this.width; x++) {
        const b0 = Math.floor(this.xToTime(x) / blockDuration);
        const b1 = Math.max(b0 + 1, Math.floor(this.xToTime(x + 1) / blockDuration));
        let lo = 0, hi = 0;
        for (let b = Math.max(0, b0); b < Math.min(min.length, b1); b++) {
          if (min[b] < lo) lo = min[b];
          if (max[b] > hi) hi = max[b];
        }
        const top = mid - hi * amp;
        g.fillRect(x, top, 1, Math.max(1, (hi - lo) * amp));
      }
    }
    this.cache = { key, canvas: off };
    return off;
  }

  draw() {
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { width: w, height: h } = this;

    // Boucle
    if (this.loop && this.loop.b > this.loop.a) {
      const x0 = this.timeToX(this.loop.a), x1 = this.timeToX(this.loop.b);
      g.fillStyle = cssVar(this.canvas, this.loop.enabled ? '--loop-bg' : '--loop-bg-off');
      g.fillRect(x0, 0, x1 - x0, h);
    }

    // Grille : temps, mesures, numéros (densité adaptée au zoom)
    if (isValidGrid(this.grid)) {
      const t0 = this.view.start, t1 = t0 + this.view.duration;
      const pxPerBar = (barDuration(this.grid) / this.view.duration) * w;
      const showBeats = pxPerBar > 24;
      const barEvery = pxPerBar > 18 ? 1 : pxPerBar > 5 ? 4 : 16;
      g.font = '11px system-ui, sans-serif';
      for (const beat of beatsInRange(t0, t1, this.grid)) {
        const x = Math.round(this.timeToX(beat.time)) + 0.5;
        if (beat.isDownbeat) {
          if ((beat.bar - 1) % barEvery !== 0) continue;
          const strong = (beat.bar - 1) % 4 === 0;
          g.strokeStyle = cssVar(this.canvas, strong ? '--grid-strong' : '--grid-bar');
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x, h);
          g.stroke();
          if (this.mode === 'detail' && beat.bar >= 1) {
            g.fillStyle = cssVar(this.canvas, '--text-dim');
            g.fillText(String(beat.bar), x + 3, 12);
          }
        } else if (showBeats) {
          g.strokeStyle = cssVar(this.canvas, '--grid-beat');
          g.beginPath();
          g.moveTo(x, h * 0.2);
          g.lineTo(x, h * 0.8);
          g.stroke();
        }
      }
    }

    g.drawImage(this.#drawWave(), 0, 0, w, h);

    // Rectangle de la vue détaillée (dans l'aperçu)
    if (this.detailView) {
      const x0 = this.timeToX(this.detailView.start);
      const x1 = this.timeToX(this.detailView.start + this.detailView.duration);
      g.strokeStyle = cssVar(this.canvas, '--accent');
      g.lineWidth = 1;
      g.strokeRect(x0 + 0.5, 0.5, Math.max(2, x1 - x0 - 1), h - 1);
    }

    // Repères
    for (const m of this.markers) {
      const x = Math.round(this.timeToX(m.time)) + 0.5;
      if (x < -2 || x > w + 2) continue;
      g.strokeStyle = cssVar(this.canvas, '--marker');
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.fillStyle = cssVar(this.canvas, '--marker');
      g.beginPath();
      g.moveTo(x - 5, 0);
      g.lineTo(x + 5, 0);
      g.lineTo(x, 7);
      g.fill();
      if (this.mode === 'detail' && m.label) {
        g.font = '11px system-ui, sans-serif';
        g.fillText(m.label, x + 6, h - 6);
      }
    }

    // Tête de lecture
    const px = Math.round(this.timeToX(this.playhead)) + 0.5;
    g.strokeStyle = cssVar(this.canvas, '--playhead');
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px, 0);
    g.lineTo(px, h);
    g.stroke();
  }

  // Clic = aller à. Glisser (vue détaillée) = sélectionner une boucle, aimantée aux
  // mesures (Maj : aux temps, Alt : libre).
  #bindPointer() {
    const c = this.canvas;
    const localX = (e) => e.clientX - c.getBoundingClientRect().left;
    const snap = (t, e) => {
      if (!isValidGrid(this.grid) || e.altKey) return t;
      return e.shiftKey ? snapToBeat(t, this.grid) : snapToBar(t, this.grid);
    };
    c.addEventListener('pointerdown', (e) => {
      if (!this.peaks) return;
      c.setPointerCapture(e.pointerId);
      this.drag = { x: localX(e), t: this.xToTime(localX(e)), moved: false };
      if (this.mode === 'overview') this.#emit('seek', { time: this.drag.t });
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const x = localX(e);
      if (this.mode === 'overview') {
        this.#emit('seek', { time: this.xToTime(x) });
        return;
      }
      if (Math.abs(x - this.drag.x) > 4) this.drag.moved = true;
      if (this.drag.moved) {
        const a = snap(this.drag.t, e), b = snap(this.xToTime(x), e);
        this.#emit('loopselect', { a: Math.min(a, b), b: Math.max(a, b), final: false });
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (!this.drag) return;
      const x = localX(e);
      if (this.mode === 'detail') {
        if (this.drag.moved) {
          const a = snap(this.drag.t, e), b = snap(this.xToTime(x), e);
          this.#emit('loopselect', { a: Math.min(a, b), b: Math.max(a, b), final: true });
        } else {
          this.#emit('seek', { time: this.xToTime(x) });
        }
      }
      this.drag = null;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'detail' || !this.peaks) return;
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) this.#emit('zoom', { factor: e.deltaY > 0 ? 1.25 : 0.8, at: this.xToTime(localX(e)) });
        else this.#emit('scroll', { delta: ((e.deltaX || e.deltaY) / this.width) * this.view.duration });
      },
      { passive: false },
    );
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
