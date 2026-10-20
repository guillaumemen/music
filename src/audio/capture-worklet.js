// AudioWorklet : capture du micro, sans traitement, avec l'instant exact (horloge Web Audio)
// du premier échantillon de chaque morceau. Envoie { frame, samples } toutes les 2048 trames.
const CHUNK = 2048;

class FlowlabCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CHUNK);
    this.n = 0;
    this.startFrame = 0;
    this.running = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        if (this.n) this.port.postMessage({ frame: this.startFrame, samples: this.buf.slice(0, this.n) });
        this.port.postMessage({ done: true });
        this.running = false;
      }
    };
  }

  process(inputs) {
    if (!this.running) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.startFrame = currentFrame + i;
        this.buf[this.n++] = ch[i];
        if (this.n === CHUNK) {
          this.port.postMessage({ frame: this.startFrame, samples: this.buf }, [this.buf.buffer]);
          this.buf = new Float32Array(CHUNK);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('flowlab-capture', FlowlabCapture);
