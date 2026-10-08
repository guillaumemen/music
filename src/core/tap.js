// Tap tempo : moyenne des intervalles récents, remise à zéro après une pause.
export class TapTempo {
  constructor({ resetAfter = 2, maxTaps = 12 } = {}) {
    this.resetAfter = resetAfter;
    this.maxTaps = maxTaps;
    this.taps = [];
  }

  // `time` en secondes (horloge quelconque, croissante). Retourne le BPM ou null.
  tap(time) {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && time - last > this.resetAfter) this.taps = [];
    this.taps.push(time);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    return this.bpm;
  }

  get count() {
    return this.taps.length;
  }

  get bpm() {
    if (this.taps.length < 4) return null;
    const span = this.taps[this.taps.length - 1] - this.taps[0];
    return span > 0 ? (60 * (this.taps.length - 1)) / span : null;
  }

  reset() {
    this.taps = [];
  }
}
