// Micro : ouverture (sans traitement de la voix), capture horodatée, et lecture des prises calée
// sur la prod.
//
// Calage dans le temps : l'horloge de référence est celle de l'AudioContext, la même que le
// métronome. Un échantillon capté à l'instant C (horloge Web Audio) correspond à ce que tu
// entendais dans la prod à  prodAt(C) − latence , où la latence (sortie casque + entrée micro +
// ton propre réflexe) se mesure une fois par appareil avec la calibration.

export class Recorder {
  constructor(player) {
    this.player = player;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.moduleReady = null;
  }

  get isOpen() {
    return !!this.stream;
  }

  // À appeler depuis un geste utilisateur. Demande l'accès au micro.
  async open() {
    const ctx = this.player.ensureContext();
    if (!this.moduleReady) this.moduleReady = ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    await this.moduleReady;
    // Micro débranché ou piste arrêtée : on le rouvre.
    if (this.stream && this.stream.getAudioTracks().every((t) => t.readyState === 'ended')) this.close();
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      this.source = ctx.createMediaStreamSource(this.stream);
    }
    return ctx;
  }

  get deviceLabel() {
    return this.stream?.getAudioTracks()[0]?.label || '';
  }

  // onChunk(ctxTime, samples) pour chaque morceau capté. Retourne une fonction stop() -> Promise.
  start(onChunk) {
    const ctx = this.player.ctx;
    const node = new AudioWorkletNode(ctx, 'flowlab-capture', { numberOfInputs: 1, numberOfOutputs: 1 });
    const mute = ctx.createGain();
    mute.gain.value = 0; // le nœud doit être relié à la sortie pour tourner, mais sans son
    this.source.connect(node).connect(mute).connect(ctx.destination);
    let finish;
    const done = new Promise((resolve) => (finish = resolve));
    node.port.onmessage = (e) => {
      if (e.data.done) {
        this.source.disconnect(node);
        node.disconnect();
        mute.disconnect();
        finish();
      } else onChunk(e.data.frame / ctx.sampleRate, e.data.samples);
    };
    this.node = node;
    return () => {
      node.port.postMessage('stop');
      return done;
    };
  }

  close() {
    for (const t of this.stream?.getTracks() || []) t.stop();
    this.stream = null;
    this.source = null;
  }
}

// Divise la fréquence d'échantillonnage par 2 (moyenne) : assez pour une voix, deux fois moins lourd.
export function halveRate(samples, sampleRate) {
  if (sampleRate < 32000) return { samples, sampleRate };
  const out = new Float32Array(samples.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (samples[2 * i] + samples[2 * i + 1]);
  return { samples: out, sampleRate: sampleRate / 2 };
}

// Lecture des prises en même temps que la prod, recalée à chaque lecture / saut / changement de
// vitesse. `offsetMs()` : calage du métronome (même règle que les clics).
export class TakeDeck {
  constructor(player, offsetMs = () => 0) {
    this.player = player;
    this.offsetMs = offsetMs;
    this.voices = new Map(); // id -> { buffer, start, gain, src, out }
    for (const ev of ['play', 'seek', 'ratechange']) player.addEventListener(ev, () => this.resync());
    for (const ev of ['pause', 'ended']) player.addEventListener(ev, () => this.#stopAll());
  }

  has(id) {
    return this.voices.has(id);
  }

  // take : { samples, sampleRate, start } (start = instant de la prod du premier échantillon).
  set(id, take, gain = 1) {
    const ctx = this.player.ensureContext();
    this.remove(id);
    const buffer = ctx.createBuffer(1, take.samples.length, take.sampleRate);
    buffer.copyToChannel(take.samples, 0);
    const out = ctx.createGain();
    out.gain.value = gain;
    out.connect(this.player.master);
    this.voices.set(id, { buffer, start: take.start, out, src: null });
    if (this.player.playing) this.resync();
  }

  setGain(id, gain) {
    const v = this.voices.get(id);
    if (v) v.out.gain.setTargetAtTime(gain, this.player.ctx.currentTime, 0.01);
  }

  remove(id) {
    const v = this.voices.get(id);
    if (!v) return;
    this.#stop(v);
    v.out.disconnect();
    this.voices.delete(id);
  }

  clear() {
    for (const id of [...this.voices.keys()]) this.remove(id);
  }

  resync() {
    this.#stopAll();
    const p = this.player;
    if (!p.playing || !p.ctx) return;
    const ctx = p.ctx;
    const now = p.currentTime;
    for (const v of this.voices.values()) {
      const offset = now - v.start;
      if (offset >= v.buffer.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = v.buffer;
      src.playbackRate.value = p.rate;
      src.connect(v.out);
      const when = ctx.currentTime + Math.max(0, -offset) / p.rate + this.offsetMs() / 1000;
      src.start(Math.max(ctx.currentTime, when), Math.max(0, offset));
      v.src = src;
    }
  }

  #stop(v) {
    try {
      v.src?.stop();
    } catch {}
    v.src?.disconnect();
    v.src = null;
  }

  #stopAll() {
    for (const v of this.voices.values()) this.#stop(v);
  }
}
