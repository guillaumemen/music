// Détection des syllabes d'un yaourt (fonctions pures, testables sous Node).
//
// On suit l'énergie de la voix (fenêtre de 20 ms, une mesure toutes les 5 ms, en dB). Une syllabe
// commence quand l'énergie remonte nettement après un creux (la consonne entre deux voyelles) :
// « da-da-da » donne trois attaques, un « mmmh » continu n'en donne qu'une (limite connue).
// Le même détecteur sert en direct (morceau par morceau, pendant l'enregistrement) et après la
// prise (analyse complète, qui ajoute la hauteur et les accents).

const HOP = 0.005;
const WIN = 0.02;

export const VOICE_DEFAULTS = {
  riseDb: 7, // remontée minimale depuis le creux précédent
  dipDb: 4, // creux minimal sous le sommet pour réarmer
  aboveFloorDb: 14, // au-dessus du bruit de fond
  minGap: 0.085, // s entre deux syllabes
};

const toDb = (x) => 10 * Math.log10(x + 1e-12);

export class OnsetDetector {
  constructor(sampleRate, options = {}) {
    this.opts = { ...VOICE_DEFAULTS, ...options };
    this.sampleRate = sampleRate;
    this.hop = Math.max(1, Math.round(HOP * sampleRate));
    this.win = Math.max(this.hop, Math.round(WIN * sampleRate));
    this.ring = new Float32Array(this.win); // carrés des derniers échantillons
    this.ringPos = 0;
    this.ringSum = 0;
    this.count = 0; // échantillons reçus
    this.sinceHop = 0;
    this.floor = null; // bruit de fond estimé (dB)
    this.armed = true;
    this.low = Infinity; // creux depuis le réarmement
    this.lowTime = 0;
    this.peak = -Infinity;
    this.lastOnset = -Infinity;
    this.current = null; // syllabe en cours (pour durée et sommet)
    this.frames = []; // énergie par trame (dB), gardée pour l'analyse complète
  }

  // `samples` : Float32Array. Retourne les syllabes détectées dans ce morceau
  // ({ time, peakDb }, time en s depuis le premier échantillon reçu).
  push(samples) {
    const out = [];
    for (let i = 0; i < samples.length; i++) {
      const sq = samples[i] * samples[i];
      this.ringSum += sq - this.ring[this.ringPos];
      this.ring[this.ringPos] = sq;
      this.ringPos = (this.ringPos + 1) % this.win;
      this.count++;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        const done = this.#frame(toDb(Math.max(0, this.ringSum) / this.win), (this.count - this.win / 2) / this.sampleRate);
        if (done) out.push(done);
      }
    }
    return out;
  }

  // Termine la syllabe en cours (fin de prise).
  flush() {
    const s = this.current;
    this.current = null;
    return s ? [s] : [];
  }

  #frame(db, time) {
    this.frames.push(db);
    const o = this.opts;
    // Bruit de fond : suit vite vers le bas, très lentement vers le haut.
    if (this.floor === null) this.floor = db;
    else if (db < this.floor) this.floor = 0.7 * this.floor + 0.3 * db;
    else this.floor += Math.min(0.02, (db - this.floor) * 0.002);

    let finished = null;
    if (this.current) {
      if (db > this.current.peakDb) {
        this.current.peakDb = db;
        this.current.peakTime = time;
      }
      if (db < this.current.peakDb - 10 && !this.current.end) this.current.end = time;
    }

    if (this.armed) {
      if (db < this.low) {
        this.low = db;
        this.lowTime = time;
      }
      const loud = db > this.floor + o.aboveFloorDb;
      if (loud && db - this.low >= o.riseDb && time - this.lastOnset >= o.minGap) {
        if (this.current) finished = this.#close(time);
        // Le seuil est franchi pendant la montée : c'est l'instant de l'attaque (mesuré à ~2 ms
        // près sur des syllabes synthétiques).
        const onset = Math.max(this.lowTime, time);
        this.current = { time: onset, peakDb: db, peakTime: time, end: 0 };
        this.lastOnset = onset;
        this.armed = false;
        this.peak = db;
      }
    } else {
      if (db > this.peak) this.peak = db;
      if (db < this.peak - o.dipDb) {
        this.armed = true;
        this.low = db;
        this.lowTime = time;
      }
    }
    return finished;
  }

  #close(nextTime) {
    const s = this.current;
    if (!s.end) s.end = nextTime;
    s.end = Math.min(s.end, nextTime);
    return s;
  }
}

// Hauteur (Hz) par autocorrélation sur ~40 ms autour de `time` ; 0 si non voisé.
export function pitchAt(samples, sampleRate, time) {
  const n = Math.round(0.04 * sampleRate);
  const start = Math.round(time * sampleRate - n / 2);
  if (start < 0 || start + n >= samples.length) return 0;
  const minLag = Math.floor(sampleRate / 400), maxLag = Math.ceil(sampleRate / 70);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += samples[start + i] ** 2;
  if (energy <= 1e-9) return 0;
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0, e2 = 0;
    for (let i = 0; i < n - lag; i++) {
      s += samples[start + i] * samples[start + i + lag];
      e2 += samples[start + i + lag] ** 2;
    }
    const r = s / Math.sqrt(energy * e2 + 1e-12);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return best > 0.5 ? sampleRate / bestLag : 0;
}

const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Analyse complète d'une prise : syllabes { time, end, peakDb, pitch, accent }.
// Accent = syllabe nettement plus forte que la médiane, ou plus haute et plus longue.
export function analyzeVoice(samples, sampleRate, options = {}) {
  const det = new OnsetDetector(sampleRate, options);
  const sylls = [...det.push(samples), ...det.flush()];
  const total = samples.length / sampleRate;
  for (let i = 0; i < sylls.length; i++) {
    const s = sylls[i];
    const next = sylls[i + 1]?.time ?? total;
    if (!s.end || s.end > next) s.end = next;
    s.pitch = Math.round(pitchAt(samples, sampleRate, s.peakTime));
  }
  const medDb = median(sylls.map((s) => s.peakDb));
  const pitched = sylls.map((s) => s.pitch).filter((p) => p > 0);
  const medPitch = median(pitched);
  const medDur = median(sylls.map((s) => s.end - s.time));
  return sylls.map((s) => {
    const loud = s.peakDb >= medDb + 3;
    const high = medPitch > 0 && s.pitch > medPitch * 1.12 && s.end - s.time >= medDur;
    return {
      time: round3(s.time),
      end: round3(s.end),
      peakDb: Math.round(s.peakDb * 10) / 10,
      pitch: s.pitch,
      accent: loud || high,
    };
  });
}

const round3 = (v) => Math.round(v * 1000) / 1000;
