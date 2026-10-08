// Lecteur de prod.
// - Lecture via un élément <audio> branché dans la Web Audio API : c'est le seul moyen
//   simple de ralentir (0,75x) sans changer la hauteur (preservesPitch).
// - Horloge « prédite » : currentTime de l'élément audio avance par à-coups ; on
//   l'extrapole à partir de l'horloge précise de l'AudioContext pour la grille, le
//   métronome et la boucle.
// Événements : 'play', 'pause', 'seek', 'ended', 'ratechange', 'loaded'.

export class Player extends EventTarget {
  constructor() {
    super();
    this.media = new Audio();
    this.media.preload = 'auto';
    this.media.preservesPitch = true;
    this.media.mozPreservesPitch = true;
    this.media.webkitPreservesPitch = true;
    this.ctx = null;
    this.url = null;
    this.loop = { enabled: false, a: 0, b: 0 };
    this.anchor = null; // { ctxTime, mediaTime }

    this.media.addEventListener('ended', () => {
      this.anchor = null;
      this.#emit('ended');
    });
    this.media.addEventListener('seeked', () => this.#reanchor());
    this.media.addEventListener('playing', () => this.#reanchor());
    this.media.addEventListener('pause', () => (this.anchor = null));
  }

  // À appeler depuis un geste utilisateur (clic) : les navigateurs bloquent sinon le son.
  ensureContext() {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const source = ctx.createMediaElementSource(this.media);
      this.beatGain = ctx.createGain();
      this.master = ctx.createGain();
      source.connect(this.beatGain).connect(this.master).connect(ctx.destination);
      this.ctx = ctx;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  async load(blob) {
    this.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.media.src = this.url;
    await new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const ko = () => { cleanup(); reject(new Error('Lecture impossible de ce fichier audio.')); };
      const cleanup = () => {
        this.media.removeEventListener('loadedmetadata', ok);
        this.media.removeEventListener('error', ko);
      };
      this.media.addEventListener('loadedmetadata', ok);
      this.media.addEventListener('error', ko);
    });
    this.#emit('loaded');
  }

  get duration() {
    return Number.isFinite(this.media.duration) ? this.media.duration : 0;
  }

  get playing() {
    return !this.media.paused && !this.media.ended;
  }

  get rate() {
    return this.media.playbackRate;
  }

  // Temps courant de la prod (s), extrapolé entre deux mises à jour de l'élément audio.
  get currentTime() {
    const raw = this.media.currentTime;
    if (!this.playing || !this.anchor || !this.ctx) return raw;
    const predicted = this.anchor.mediaTime + (this.ctx.currentTime - this.anchor.ctxTime) * this.rate;
    // Si la prédiction dérive trop, on se recale sur l'élément audio.
    if (Math.abs(predicted - raw) > 0.08) {
      this.#reanchor();
      return raw;
    }
    return predicted;
  }

  async play() {
    this.ensureContext();
    if (this.media.ended || this.media.currentTime >= this.duration - 0.01) this.media.currentTime = 0;
    await this.media.play();
    this.#reanchor();
    this.#emit('play');
  }

  pause() {
    if (!this.media.paused) {
      this.media.pause();
      this.#emit('pause');
    }
  }

  toggle() {
    return this.playing ? this.pause() : this.play();
  }

  seek(time) {
    const t = Math.max(0, Math.min(this.duration || 0, time));
    this.media.currentTime = t;
    this.anchor = this.playing && this.ctx ? { ctxTime: this.ctx.currentTime, mediaTime: t } : null;
    this.#emit('seek');
  }

  setRate(rate) {
    this.media.playbackRate = rate;
    this.#reanchor();
    this.#emit('ratechange');
  }

  setVolume(value) {
    this.ensureContext();
    this.beatGain.gain.value = value;
  }

  setLoop(a, b, enabled = true) {
    const lo = Math.max(0, Math.min(a, b));
    const hi = Math.min(this.duration || Infinity, Math.max(a, b));
    this.loop = { a: lo, b: hi, enabled: enabled && hi - lo > 0.05 };
  }

  // À appeler très souvent pendant la lecture : gère le retour au début de la boucle.
  // Retourne true si un saut a eu lieu.
  tick() {
    if (!this.playing || !this.loop.enabled) return false;
    const t = this.currentTime;
    // On anticipe d'environ une demi-trame d'affichage pour un bouclage plus net.
    if (t >= this.loop.b - 0.004 && t < this.loop.b + 0.5) {
      this.seek(this.loop.a);
      return true;
    }
    return false;
  }

  #reanchor() {
    if (this.ctx && this.playing) this.anchor = { ctxTime: this.ctx.currentTime, mediaTime: this.media.currentTime };
  }

  #emit(type) {
    this.dispatchEvent(new Event(type));
  }
}

// Décode un fichier audio en mono (Float32Array) pour la forme d'onde et l'analyse.
export async function decodeToMono(blob) {
  const data = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ctx.decodeAudioData(data);
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  let mono = channels[0];
  if (channels.length > 1) {
    mono = new Float32Array(buffer.length);
    for (const ch of channels) for (let i = 0; i < ch.length; i++) mono[i] += ch[i];
    for (let i = 0; i < mono.length; i++) mono[i] /= channels.length;
  }
  return { samples: mono, sampleRate: buffer.sampleRate, duration: buffer.duration };
}
