// Grille rythmique : BPM + position d'un premier temps (« le 1 ») + temps par mesure.
// Tous les temps sont en secondes, dans le temps de la prod (indépendant de la vitesse de lecture).

export function createGrid(bpm, downbeat = 0, beatsPerBar = 4) {
  return { bpm, downbeat, beatsPerBar };
}

export function isValidGrid(grid) {
  return !!grid && Number.isFinite(grid.bpm) && grid.bpm > 0 && Number.isFinite(grid.downbeat);
}

export const beatDuration = (grid) => 60 / grid.bpm;
export const barDuration = (grid) => beatDuration(grid) * grid.beatsPerBar;

// Position musicale d'un instant : mesure (à partir de 1), temps (1..beatsPerBar), fraction du temps.
export function positionAt(time, grid) {
  const beatPos = (time - grid.downbeat) / beatDuration(grid);
  const beatIndex = Math.floor(beatPos + 1e-9);
  const bar = Math.floor(beatIndex / grid.beatsPerBar) + 1;
  const beat = ((beatIndex % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar + 1;
  return { bar, beat, beatIndex, fraction: beatPos - beatIndex };
}

export const barStart = (bar, grid) => grid.downbeat + (bar - 1) * barDuration(grid);

// Temps compris dans [t0, t1).
export function beatsInRange(t0, t1, grid) {
  const d = beatDuration(grid);
  const out = [];
  let i = Math.ceil((t0 - grid.downbeat) / d - 1e-9);
  for (let t = grid.downbeat + i * d; t < t1; i++, t = grid.downbeat + i * d) {
    const inBar = ((i % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar;
    out.push({ time: t, index: i, isDownbeat: inBar === 0, bar: Math.floor(i / grid.beatsPerBar) + 1 });
  }
  return out;
}

export function snapToBeat(time, grid) {
  const d = beatDuration(grid);
  return grid.downbeat + Math.round((time - grid.downbeat) / d) * d;
}

export function snapToBar(time, grid) {
  const d = barDuration(grid);
  return grid.downbeat + Math.round((time - grid.downbeat) / d) * d;
}

// Ramène le « 1 » dans la première mesure du morceau (garde la même grille).
export function normalizeDownbeat(grid) {
  const d = barDuration(grid);
  let db = grid.downbeat % d;
  if (db < 0) db += d;
  return { ...grid, downbeat: db };
}

// ×2 : les temps existants restent, on en ajoute un entre chaque.
export const doubleTempo = (grid) => ({ ...grid, bpm: grid.bpm * 2 });

// ÷2 : on garde un temps sur deux, en conservant le « 1 ».
export const halveTempo = (grid) => normalizeDownbeat({ ...grid, bpm: grid.bpm / 2 });

// Décale le « 1 » d'un nombre de temps (ex. +1 : le 2 actuel devient le 1).
export const shiftBeats = (grid, beats) =>
  normalizeDownbeat({ ...grid, downbeat: grid.downbeat + beats * beatDuration(grid) });

export const nudge = (grid, seconds) => normalizeDownbeat({ ...grid, downbeat: grid.downbeat + seconds });

// Place le « 1 » sur un instant précis.
export const setDownbeatAt = (grid, time) => normalizeDownbeat({ ...grid, downbeat: time });
