// Modèle de données d'un projet (une prod + son travail).
export function newProject(file) {
  const now = Date.now();
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `p${now}${Math.random().toString(16).slice(2)}`,
    name: file.name.replace(/\.[^.]+$/, ''),
    fileName: file.name,
    fileType: file.type,
    duration: 0,
    createdAt: now,
    updatedAt: now,
    // Grille rythmique : null tant que le BPM n'est pas connu.
    grid: null, // { bpm, downbeat, beatsPerBar }
    gridSource: null, // 'auto' | 'tap' | 'manual'
    analysis: null, // dernier résultat de détection automatique
    key: '',
    youtubeUrl: '',
    markers: [], // { id, time, label }
    loop: { a: 0, b: 0, enabled: false },
    sections: [], // { id, startBar, label } : voir core/sections.js
    drums: null, // kick / caisse claire en 16 cases pour une grille donnée (analysis/drums.js)
    takes: [], // { id, name, createdAt, start, duration, region, latencyMs, sylls } (audio : store 'takes')
    text: { body: '', startBar: 1, takeId: '', target: 8 }, // écran Texte
  };
}
