// Métronome calé sur la grille de la prod, programmé à l'avance sur l'horloge Web Audio
// (technique « lookahead ») pour des clics réguliers malgré les à-coups de l'interface.
import { beatsInRange } from '../core/grid.js';

const LOOKAHEAD = 0.12; // s d'avance programmée (temps de la prod, à vitesse 1)
const INTERVAL = 25; // ms entre deux passes du programmateur

export class Metronome {
  constructor(player) {
    this.player = player;
    this.grid = null;
    this.enabled = false;
    this.volume = 0.6;
    this.offsetMs = 0; // calage manuel si les clics semblent en avance / en retard
    this.lastScheduled = -Infinity;
    this.timer = null;
    const reset = () => (this.lastScheduled = -Infinity);
    player.addEventListener('seek', reset);
    player.addEventListener('play', reset);
    player.addEventListener('ratechange', reset);
  }

  setGrid(grid) {
    this.grid = grid;
    this.lastScheduled = -Infinity;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on && !this.timer) this.timer = setInterval(() => this.#schedule(), INTERVAL);
    if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  #schedule() {
    const p = this.player;
    if (!this.enabled || !this.grid || !p.playing || !p.ctx) return;
    const now = p.currentTime;
    let end = now + LOOKAHEAD * p.rate;
    if (p.loop.enabled && now < p.loop.b) end = Math.min(end, p.loop.b - 0.002);
    const from = Math.max(now, this.lastScheduled + 0.001);
    for (const beat of beatsInRange(from, end, this.grid)) {
      const when = p.ctx.currentTime + (beat.time - now) / p.rate + this.offsetMs / 1000;
      if (when >= p.ctx.currentTime - 0.005) this.#click(Math.max(when, p.ctx.currentTime), beat.isDownbeat);
      this.lastScheduled = beat.time;
    }
  }

  #click(when, accent) {
    const ctx = this.player.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1175;
    const peak = this.volume * (accent ? 0.9 : 0.55);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(gain).connect(this.player.master);
    osc.start(when);
    osc.stop(when + 0.06);
  }
}
