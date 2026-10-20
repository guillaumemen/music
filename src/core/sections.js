// Sections d'une prod (intro, couplet, refrain…), calées sur les mesures.
// Une section = { id, startBar, label } ; elle dure jusqu'au début de la suivante.
// La liste découpe le morceau à partir de la première section (mesures numérotées à partir de 1).

export const SECTION_LABELS = ['Intro', 'Couplet', 'Refrain', 'Pont', 'Break', 'Outro'];

const PALETTE = ['#9d8cff', '#5ac8e6', '#5fd39a', '#f0b75a', '#ef7a7a', '#e58ad8', '#8fb3ff', '#c9d36a'];

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// Couleur stable par nom : deux « Couplet » ont la même couleur.
export function sectionColor(label = '') {
  const base = label.trim().toLowerCase().replace(/\s*\d+$/, '');
  const fixed = SECTION_LABELS.findIndex((l) => l.toLowerCase() === base);
  if (fixed >= 0) return PALETTE[fixed];
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Trie, arrondit, retire les doublons (même mesure de début) et les mesures < 1.
export function normalizeSections(list = []) {
  const out = [];
  for (const s of [...list].sort((a, b) => a.startBar - b.startBar)) {
    const startBar = Math.max(1, Math.round(s.startBar));
    if (out.length && out[out.length - 1].startBar === startBar) continue;
    out.push({ id: s.id || newId(), startBar, label: s.label ?? '' });
  }
  return out;
}

// Ajoute `endBar` (exclue) à chaque section ; `lastBar` = dernière mesure du morceau.
export function sectionRanges(sections, lastBar) {
  const list = normalizeSections(sections).filter((s) => s.startBar <= lastBar);
  return list.map((s, i) => ({ ...s, endBar: i + 1 < list.length ? list[i + 1].startBar : lastBar + 1 }));
}

export function sectionAtBar(sections, bar) {
  let found = null;
  for (const s of normalizeSections(sections)) {
    if (s.startBar <= bar) found = s;
    else break;
  }
  return found;
}

// Nom proposé pour une nouvelle section, selon ce qui existe déjà.
function defaultLabel(sections, bar) {
  if (!sections.length || bar <= 1) return 'Intro';
  return sectionAtBar(sections, bar)?.label === 'Couplet' ? 'Refrain' : 'Couplet';
}

// Coupe à la mesure `bar`. Sur une liste vide, crée aussi la section de départ (mesure 1).
export function splitAt(sections, bar, label) {
  bar = Math.max(1, Math.round(bar));
  let list = normalizeSections(sections);
  if (list.some((s) => s.startBar === bar)) return list;
  if (!list.length && bar > 1) list = [{ id: newId(), startBar: 1, label: 'Intro' }];
  return normalizeSections([...list, { id: newId(), startBar: bar, label: label ?? defaultLabel(list, bar) }]);
}

// Supprimer une section rallonge la précédente.
export const removeSection = (sections, id) => normalizeSections(sections.filter((s) => s.id !== id));

// Déplace le début d'une section, sans dépasser ses voisines.
export function moveSection(sections, id, startBar) {
  const list = normalizeSections(sections);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return list;
  const min = i > 0 ? list[i - 1].startBar + 1 : 1;
  const max = i + 1 < list.length ? list[i + 1].startBar - 1 : Infinity;
  list[i] = { ...list[i], startBar: Math.max(min, Math.min(max, Math.round(startBar))) };
  return list;
}

export const renameSection = (sections, id, label) =>
  normalizeSections(sections).map((s) => (s.id === id ? { ...s, label } : s));
