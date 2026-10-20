import * as db from './store/db.js';
import { newProject } from './core/project.js';
import * as G from './core/grid.js';
import { TapTempo } from './core/tap.js';
import { formatTime, formatBpm } from './core/format.js';
import { Player, decodeToMono } from './audio/player.js';
import { Metronome } from './audio/metronome.js';
import { AnalysisClient } from './analysis/client.js';
import { WaveformView, buildPeaks } from './ui/waveform.js';
import { HIT_THRESHOLD, DRUMS_VERSION, gridSignature } from './analysis/drums.js';
import { proposeSections } from './analysis/sections.js';
import * as S from './core/sections.js';
import { initYaourt } from './screens/yaourt.js';
import { initTexte } from './screens/texte.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const player = new Player();
const metronome = new Metronome(player);
const analysis = new AnalysisClient();
const tap = new TapTempo();

const state = {
  project: null,
  audio: null, // { samples, sampleRate, duration }
  analyzing: false,
  drumView: 'bar', // 'bar' (mesure en cours) | 'pattern' (motif type)
};

const overview = new WaveformView($('#overview'), { mode: 'overview' });
const detail = new WaveformView($('#detail'), { mode: 'detail' });

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

let toastTimer = null;
function toast(message, ms = 3200) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

let saveTimer = null;
function saveSoon() {
  if (!state.project) return;
  clearTimeout(saveTimer);
  const project = state.project;
  saveTimer = setTimeout(() => db.saveProject(project).catch((e) => toast(`Sauvegarde impossible : ${e.message}`)), 400);
}

const grid = () => (G.isValidGrid(state.project?.grid) ? state.project.grid : null);

function showScreen(name) {
  for (const s of $$('.screen')) s.hidden = s.id !== `screen-${name}`;
  for (const t of $$('.tab[data-screen]')) {
    if (t.dataset.screen === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  if (name === 'projects') {
    player.pause();
    renderProjects();
  }
  if (name === 'yaourt') yaourt.show();
  else yaourt.hide();
  if (name === 'texte') texte.show();
}

const SCREEN_TABS = ['prod', 'yaourt', 'texte'];
const setScreenTabs = (enabled) => SCREEN_TABS.forEach((n) => ($(`.tab[data-screen="${n}"]`).disabled = !enabled));

/* ------------------------------------------------------------------ */
/* Écran Projets                                                       */
/* ------------------------------------------------------------------ */

async function renderProjects() {
  const list = $('#project-list');
  const projects = await db.listProjects().catch(() => []);
  list.replaceChildren();
  $('#project-empty').hidden = projects.length > 0;
  for (const p of projects) {
    const li = document.createElement('li');
    li.className = 'project-item';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    const bpm = p.grid ? `${formatBpm(p.grid.bpm)} BPM` : 'BPM ?';
    meta.textContent = `${bpm} · ${formatTime(p.duration).replace(/\.\d$/, '')} · ${new Date(p.updatedAt).toLocaleDateString('fr-FR')}`;
    const open = document.createElement('button');
    open.className = 'btn primary';
    open.textContent = 'Ouvrir';
    open.onclick = () => openProject(p.id);
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = 'Supprimer';
    del.onclick = async () => {
      if (!confirm(`Supprimer « ${p.name} » ? Le fichier audio stocké dans le navigateur sera effacé.`)) return;
      await db.deleteProject(p.id, (p.takes || []).map((t) => t.id));
      if (state.project?.id === p.id) closeProject();
      renderProjects();
    };
    li.append(name, meta, open, del);
    list.append(li);
  }
}

async function importFile(file) {
  if (!file) return;
  if (!/^audio\//.test(file.type) && !/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name)) {
    toast('Ce fichier ne semble pas être un fichier audio.');
    return;
  }
  player.ensureContext(); // l'import est un geste utilisateur : on débloque le son ici
  const project = newProject(file);
  try {
    await db.createProject(project, file);
  } catch (e) {
    toast(`Impossible d'enregistrer le fichier : ${e.message}`);
    return;
  }
  await openProject(project.id);
}

function closeProject() {
  player.pause();
  drumsJob++;
  yaourt.reset();
  state.project = null;
  state.audio = null;
  setScreenTabs(false);
}

/* ------------------------------------------------------------------ */
/* Ouverture d'une prod                                                */
/* ------------------------------------------------------------------ */

async function openProject(id) {
  const project = await db.getProject(id);
  const blob = await db.getAudio(id);
  if (!project || !blob) {
    toast('Projet introuvable.');
    return;
  }
  player.ensureContext();
  yaourt.reset();
  state.project = { ...newProject({ name: '' }), ...project };
  state.audio = null;
  setScreenTabs(true);
  showScreen('prod');
  renderProjectInfo();
  setAnalysisMessage('Chargement de la prod…');

  try {
    await player.load(blob);
    state.audio = await decodeToMono(blob);
  } catch (e) {
    setAnalysisMessage('');
    toast(`Impossible de lire ce fichier : ${e.message}`);
    return;
  }
  if (state.project?.id !== id) return; // un autre projet a été ouvert entre-temps

  state.project.duration = state.audio.duration;
  const peaks = buildPeaks(state.audio.samples, state.audio.sampleRate);
  overview.setPeaks(peaks);
  detail.setPeaks(peaks);
  setZoom(grid() ? G.barDuration(grid()) * 8 : 20, 0);
  player.seek(0);
  applyGrid(state.project.grid, state.project.gridSource, { save: false });
  applyLoop(state.project.loop);
  $('#time-total').textContent = formatTime(state.audio.duration);
  saveSoon();

  if (!state.project.grid) runAnalysis();
  else setAnalysisMessage('');
}

function renderProjectInfo() {
  const p = state.project;
  $('#project-name').value = p.name;
  $('#project-file').textContent = p.fileName;
  $('#key-select').value = p.key || '';
  $('#yt-input').value = p.youtubeUrl || '';
  renderYoutubeLink();
  renderMarkers();
  renderBpm();
  renderSections();
  renderDrums();
}

/* ------------------------------------------------------------------ */
/* Détection du tempo                                                  */
/* ------------------------------------------------------------------ */

function setAnalysisMessage(text) {
  $('#analysis-message').textContent = text;
}

function setProgress(value) {
  const bar = $('#analysis-progress');
  bar.hidden = value === null;
  if (value !== null) bar.firstElementChild.style.width = `${Math.round(value * 100)}%`;
}

async function runAnalysis({ region = null } = {}) {
  if (!state.audio || state.analyzing) return;
  const { samples, sampleRate } = state.audio;
  let slice = samples, offset = 0;
  if (region) {
    const a = Math.floor(region.a * sampleRate), b = Math.floor(region.b * sampleRate);
    slice = samples.subarray(a, b);
    offset = region.a;
  }
  state.analyzing = true;
  const projectId = state.project.id;
  setProgress(0);
  setAnalysisMessage(region ? 'Détection du tempo sur la boucle…' : 'Détection du tempo…');
  const result = await analysis.analyze(projectId, slice, sampleRate, { offset, full: !region, onProgress: setProgress });
  state.analyzing = false;
  setProgress(null);
  if (state.project?.id !== projectId) return;

  if (!result.ok) {
    setAnalysisMessage(`Détection impossible : ${result.reason} Tape le tempo (Tap) ou saisis-le.`);
    return;
  }
  state.project.analysis = { ...result, region };
  applyGrid({ bpm: result.bpm, downbeat: result.downbeat, beatsPerBar: 4 }, 'auto');
  const tips = {
    faible: 'Confiance faible : écoute avec le métronome, et essaie « Détecter sur la boucle » sur un passage avec batterie.',
    moyenne: 'Vérifie avec le métronome : si ça sonne deux fois trop vite ou trop lent, utilise ÷2 / ×2.',
    élevée: 'Vérifie le « 1 » avec le métronome (le clic aigu tombe sur le premier temps).',
  };
  setAnalysisMessage(tips[result.confidenceLabel]);
}

// BPM imposé (÷2, ×2, alternative) : le worker recale la grille et le « 1 » à ce tempo.
async function forceBpm(bpm, fallbackGrid) {
  if (!state.project) return;
  const projectId = state.project.id;
  let result = { ok: false };
  if (state.audio) result = await analysis.refine(projectId, bpm);
  if (state.project?.id !== projectId) return;
  if (result.ok) applyGrid({ bpm: result.bpm, downbeat: result.downbeat, beatsPerBar: 4 }, 'auto');
  else applyGrid(fallbackGrid || { ...(grid() || { downbeat: 0, beatsPerBar: 4 }), bpm }, 'manual');
}

function applyGrid(g, source, { save = true } = {}) {
  const p = state.project;
  if (!p) return;
  p.grid = g && G.isValidGrid(g) ? G.normalizeDownbeat({ beatsPerBar: 4, ...g }) : null;
  p.gridSource = p.grid ? source : null;
  metronome.setGrid(p.grid);
  overview.grid = p.grid;
  detail.grid = p.grid;
  detail.cache = null;
  renderBpm();
  renderBeatDots();
  updateZoomLabel();
  renderSections();
  scheduleDrums();
  yaourt.gridChanged();
  if (save) saveSoon();
}

function renderBpm() {
  const p = state.project;
  const g = grid();
  $('#bpm-value').textContent = g ? formatBpm(g.bpm) : '—';
  const sourceLabels = { auto: 'détecté automatiquement', tap: 'tapé à la main', manual: 'saisi à la main' };
  $('#bpm-source').textContent = g ? sourceLabels[p.gridSource] || '' : '';

  const badge = $('#bpm-confidence');
  const a = p?.analysis;
  if (a?.ok && p.gridSource === 'auto') {
    badge.hidden = false;
    badge.textContent = `Confiance ${a.confidenceLabel}`;
    badge.className = `badge ${{ élevée: 'high', moyenne: 'mid', faible: 'low' }[a.confidenceLabel]}`;
  } else badge.hidden = true;

  const chips = $('#bpm-alternatives');
  chips.replaceChildren();
  for (const alt of a?.ok ? a.alternatives : []) {
    if (g && Math.abs(alt.bpm - g.bpm) < 0.5) continue;
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.textContent = `${formatBpm(alt.bpm)} ?`;
    chip.title = alt.reason;
    chip.onclick = () => forceBpm(alt.bpm);
    chips.append(chip);
  }

  for (const id of ['#bpm-half', '#bpm-double', '#db-here', '#db-prev-beat', '#db-next-beat', '#db-nudge-minus', '#db-nudge-plus']) {
    $(id).disabled = !g;
  }
  $('#db-info').textContent = g ? `1er temps à ${formatTime(g.downbeat)} · mesure = ${G.barDuration(g).toFixed(2)} s` : '';
  if (g && document.activeElement !== $('#bpm-input')) $('#bpm-input').value = formatBpm(g.bpm);
}

function renderBeatDots() {
  const g = grid();
  const dots = $('#beat-dots');
  const n = g ? g.beatsPerBar : 4;
  if (dots.children.length !== n) {
    dots.replaceChildren(...Array.from({ length: n }, () => document.createElement('span')));
  }
}

/* ------------------------------------------------------------------ */
/* Batterie : kick / caisse claire sur 16 cases                        */
/* ------------------------------------------------------------------ */

// L'analyse de batterie dépend de la grille : elle n'est valable que pour la grille actuelle.
function currentDrums() {
  const d = state.project?.drums;
  const g = grid();
  return d?.ok && d.version === DRUMS_VERSION && g && gridSignature(d.grid) === gridSignature(g) ? d : null;
}

let drumsTimer = null;
let drumsJob = 0;
function scheduleDrums() {
  clearTimeout(drumsTimer);
  drumsTimer = setTimeout(requestDrums, 150);
  renderDrums();
}

async function requestDrums() {
  const p = state.project;
  const g = grid();
  if (!p || !g || !state.audio || currentDrums()) return renderDrums();
  const job = ++drumsJob;
  setDrumMessage('Lecture de la batterie…');
  const result = await analysis.drums(p.id, g, state.audio);
  if (job !== drumsJob || state.project !== p) return;
  if (!result.ok) {
    setDrumMessage(`Batterie illisible : ${result.reason}`);
    return;
  }
  if (gridSignature(result.grid) !== gridSignature(grid())) return; // grille changée entre-temps
  p.drums = result;
  saveSoon();
  renderDrums();
}

function setDrumMessage(text) {
  $('#drum-message').textContent = text;
}

const stepCount = () => (grid()?.beatsPerBar || 4) * 4;

// Construit la grille : ligne des temps comptés (1 · et · 2 …), puis kick et caisse claire.
function buildDrumGrid() {
  const n = stepCount();
  const root = $('#drum-grid');
  if (root.dataset.steps === String(n)) return;
  root.dataset.steps = String(n);
  const nodes = [];
  const lane = (text) => {
    const el = document.createElement('span');
    el.className = 'lane';
    el.textContent = text;
    nodes.push(el);
  };
  lane('');
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span');
    el.className = 'count';
    if (i % 4 === 0) el.classList.add('beat', 'beat-start');
    el.textContent = i % 4 === 0 ? String(i / 4 + 1) : i % 4 === 2 ? 'et' : '·';
    el.dataset.step = String(i);
    nodes.push(el);
  }
  for (const [key, name] of [['kick', 'Kick'], ['snare', 'Caisse cl.']]) {
    lane(name);
    for (let i = 0; i < n; i++) {
      const el = document.createElement('button');
      el.className = `cell ${key}`;
      if (i % 4 === 0) el.classList.add('beat-start');
      el.dataset.step = String(i);
      el.dataset.lane = key;
      nodes.push(el);
    }
  }
  root.replaceChildren(...nodes);
}

// Dernier état affiché (vue|mesure|case|grille), pour ne toucher au DOM qu'au changement.
let drumShown = '';

function renderDrums() {
  drumShown = '';
  buildDrumGrid();
  const g = grid();
  const d = currentDrums();
  detail.drums = d;
  $('#section-auto').disabled = !d;
  if (!g) setDrumMessage('Il faut un BPM pour placer la batterie sur la grille.');
  else if (!d) setDrumMessage(state.audio ? 'Lecture de la batterie…' : '');
  else setDrumMessage(describePattern(d.pattern));
  updateDrumGrid(player.currentTime);
}

const stepName = (s) => (s % 4 === 0 ? `le ${s / 4 + 1}` : `la case ${s + 1}`);

// Résumé en mots du motif type, plus un conseil si le « 1 » semble décalé.
function describePattern(pattern) {
  if (!pattern.bars) return "Pas de batterie nette pour l'instant. Si l'intro est calme, la grille se remplira à l'entrée de la batterie.";
  const hits = (v) => v.flatMap((x, i) => (x >= HIT_THRESHOLD ? [i] : []));
  const k = hits(pattern.kick);
  const sn = hits(pattern.snare);
  const list = (a) => (a.length ? a.map(stepName).join(', ') : 'rien de net');
  const kickText = pattern.kickVaries ? "un placement qui change d'une mesure à l'autre (808 / trap)" : list(k);
  let text = `Motif type (cases jouées au moins une mesure sur deux) : kick sur ${kickText} · caisse claire sur ${list(sn)}.`;
  const on = (i) => sn.includes(i);
  if (on(4) && on(12)) text += ' Caisse claire sur le 2 et le 4 : le schéma classique du rap.';
  else if (on(8) && !on(4) && !on(12)) text += ' Caisse claire sur le 3 seulement : prod en half-time (fréquent en trap).';
  else if ((on(0) || on(8)) && !on(4) && !on(12)) text += " Caisse claire sur le 1 et le 3 : le « 1 » est sûrement décalé d'un temps (← 1 temps / 1 temps →).";
  return text;
}

function updateDrumGrid(t) {
  const g = grid();
  const d = currentDrums();
  const n = stepCount();
  let bar = null, step = -1;
  if (g) {
    const pos = G.positionAt(t, g);
    bar = pos.bar;
    step = Math.min(n - 1, Math.floor((pos.beat - 1 + pos.fraction) * 4));
  }
  const head = `${state.drumView}|${bar}|${d ? gridSignature(d.grid) : ''}`;
  const key = `${head}|${step}|${player.playing}`;
  if (key === drumShown) return;
  const barChanged = !drumShown.startsWith(`${head}|`);
  drumShown = key;

  const source = !d ? null : state.drumView === 'pattern' ? d.pattern : d.bars[bar] || null;
  for (const el of $('#drum-grid').children) {
    if (!el.dataset.step) continue;
    const i = Number(el.dataset.step);
    el.classList.toggle('now', i === step && player.playing);
    if (barChanged && el.dataset.lane) {
      const v = source ? source[el.dataset.lane][i] || 0 : 0;
      el.style.setProperty('--v', String(v));
      el.classList.toggle('hit', v >= HIT_THRESHOLD);
      const name = el.dataset.lane === 'kick' ? 'Kick' : 'Caisse claire';
      el.title = `${name}, case ${i + 1} : ${v >= HIT_THRESHOLD ? 'coup' : v >= 0.2 ? 'léger' : 'rien'} (${Math.round(v * 100)} %)`;
    }
  }
  if (barChanged) {
    const caption = $('#drum-caption');
    if (!g) caption.textContent = '–';
    else if (state.drumView === 'pattern') caption.textContent = d ? `Sur ${d.pattern.bars} mesures avec batterie : plus la case est vive, plus elle revient souvent` : '';
    else caption.textContent = bar >= 1 ? `Mesure ${bar}` : 'Avant la mesure 1';
    renderCurrentSection(bar);
  }
}

// Clic sur une case : aller à cet instant de la mesure en cours.
function seekToStep(step) {
  const g = grid();
  if (!g) return;
  const bar = Math.max(0, G.positionAt(player.currentTime + 0.001, g).bar);
  player.seek(Math.max(0, G.barStart(bar, g) + (step * G.barDuration(g)) / stepCount()));
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function lastBar() {
  const g = grid();
  return g && state.audio ? Math.max(1, G.positionAt(state.audio.duration - 0.01, g).bar) : 0;
}

function setSections(list) {
  state.project.sections = S.normalizeSections(list);
  renderSections();
  saveSoon();
}

function sectionTimes(ranges) {
  const g = grid();
  return ranges.map((r) => ({
    a: G.barStart(r.startBar, g),
    b: Math.min(state.audio?.duration ?? Infinity, G.barStart(r.endBar, g)),
    label: r.label,
    color: S.sectionColor(r.label),
  }));
}

function renderSections() {
  const p = state.project;
  if (!p) return;
  const g = grid();
  const ranges = g ? S.sectionRanges(p.sections, lastBar()) : [];
  detail.sections = overview.sections = sectionTimes(ranges);
  $('#section-add').disabled = !g;

  const list = $('#section-list');
  list.replaceChildren();
  $('#section-empty').hidden = ranges.length > 0;
  for (const r of ranges) {
    const li = document.createElement('li');
    li.dataset.id = r.id;
    li.style.setProperty('--tag', S.sectionColor(r.label));
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    const name = document.createElement('input');
    name.className = 'name';
    name.value = r.label;
    name.placeholder = 'Nom';
    name.setAttribute('list', 'section-labels');
    name.setAttribute('aria-label', 'Nom de la section');
    name.oninput = () => {
      p.sections = S.renameSection(p.sections, r.id, name.value);
      li.style.setProperty('--tag', S.sectionColor(name.value));
      detail.sections = overview.sections = sectionTimes(S.sectionRanges(p.sections, lastBar()));
      drumShown = '';
      saveSoon();
    };
    const bars = document.createElement('span');
    bars.className = 'bars';
    const start = document.createElement('input');
    start.type = 'number';
    start.min = '1';
    start.value = String(r.startBar);
    start.title = 'Mesure de début';
    start.setAttribute('aria-label', 'Mesure de début');
    start.onchange = () => setSections(S.moveSection(p.sections, r.id, Number(start.value)));
    const len = document.createElement('span');
    len.textContent = `· ${r.endBar - r.startBar} mes.`;
    bars.append('mes.', start, len);
    const actions = document.createElement('span');
    actions.className = 'actions';
    const button = (text, title, onclick, extra = '') => {
      const b = document.createElement('button');
      b.className = `btn small ${extra}`;
      b.textContent = text;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.onclick = onclick;
      return b;
    };
    actions.append(
      button('▶', 'Aller au début de la section', () => player.seek(G.barStart(r.startBar, g))),
      button('⟳', 'Boucler la section', () => {
        const [{ a, b }] = sectionTimes([r]);
        applyLoop({ a, b, enabled: true });
        player.seek(a);
      }),
      button('✕', 'Supprimer (la section précédente se rallonge)', () => setSections(S.removeSection(p.sections, r.id)), 'danger'),
    );
    li.append(swatch, name, bars, actions);
    list.append(li);
  }
  drumShown = '';
}

function renderCurrentSection(bar) {
  const p = state.project;
  const tag = $('#drum-section');
  const s = p && bar !== null ? S.sectionAtBar(p.sections, bar) : null;
  tag.hidden = !s || state.drumView === 'pattern';
  if (s) {
    tag.textContent = s.label || 'Sans nom';
    tag.style.setProperty('--tag', S.sectionColor(s.label));
  }
  for (const li of $('#section-list').children) li.classList.toggle('current', li.dataset.id === s?.id);
}

function addSectionHere() {
  const g = grid();
  if (!g) {
    toast('Il faut un BPM pour placer des sections.');
    return;
  }
  const bar = Math.max(1, G.positionAt(player.currentTime + 0.02, g).bar);
  setSections(S.splitAt(state.project.sections, bar));
}

function proposeSectionsNow() {
  const d = currentDrums();
  if (!d) {
    toast('La batterie est encore en cours de lecture, réessaie dans un instant.');
    return;
  }
  if (state.project.sections.length && !confirm('Remplacer les sections actuelles par la proposition ?')) return;
  const proposal = proposeSections(d);
  setSections(proposal);
  const n = proposal.length;
  toast(`${n} section${n > 1 ? 's' : ''} proposée${n > 1 ? 's' : ''}. Renomme-les (couplet, refrain…) et corrige les débuts si besoin.`, 5000);
}

/* ------------------------------------------------------------------ */
/* Lecture, boucle, zoom                                               */
/* ------------------------------------------------------------------ */

function applyLoop(loop) {
  const p = state.project;
  if (!p) return;
  p.loop = { a: loop.a || 0, b: loop.b || 0, enabled: !!loop.enabled && loop.b > loop.a };
  player.setLoop(p.loop.a, p.loop.b, p.loop.enabled);
  p.loop.enabled = player.loop.enabled;
  detail.loop = overview.loop = p.loop;
  const has = p.loop.b - p.loop.a > 0.05;
  $('#loop-toggle').setAttribute('aria-pressed', String(p.loop.enabled));
  $('#loop-toggle').disabled = !has;
  $('#analyze-loop').disabled = !has || p.loop.b - p.loop.a < 4;
  let info = 'Pas de boucle';
  if (has) {
    info = `${formatTime(p.loop.a)} → ${formatTime(p.loop.b)}`;
    const g = grid();
    if (g) {
      const bars = (p.loop.b - p.loop.a) / G.barDuration(g);
      if (Math.abs(bars - Math.round(bars)) < 0.02) info += ` · ${Math.round(bars)} mes.`;
    }
    if (!p.loop.enabled) info += ' (coupée)';
  }
  $('#loop-info').textContent = info;
  saveSoon();
}

function loopBars(count) {
  const g = grid();
  if (!g) {
    toast('Il faut un BPM pour boucler des mesures.');
    return;
  }
  const t = player.currentTime;
  const bar = Math.max(1, G.positionAt(t, g).bar);
  const a = G.barStart(bar, g);
  const b = Math.min(state.audio?.duration || Infinity, a + count * G.barDuration(g));
  applyLoop({ a, b, enabled: true });
  if (t < a || t >= b) player.seek(a);
}

function setZoom(duration, start = detail.view.start) {
  const total = state.audio?.duration || duration;
  const d = Math.max(1, Math.min(total, duration));
  detail.setView(start, d);
  overview.detailView = detail.view;
  updateZoomLabel();
}

function zoomBy(factor, at = player.currentTime) {
  const v = detail.view;
  const d = v.duration * factor;
  const ratio = (at - v.start) / v.duration;
  setZoom(d, at - ratio * d);
}

function updateZoomLabel() {
  const g = grid();
  const d = detail.view.duration;
  $('#zoom-label').textContent = g ? `${Math.round(d / G.barDuration(g))} mesures` : `${Math.round(d)} s`;
}

function setRate(rate) {
  player.setRate(rate);
  for (const b of $$('[data-rate]')) b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === rate));
}

function updatePlayButton() {
  const btn = $('#play-btn');
  btn.textContent = player.playing ? '❚❚' : '▶';
  btn.setAttribute('aria-label', player.playing ? 'Pause' : 'Lecture');
}

/* ------------------------------------------------------------------ */
/* Repères                                                             */
/* ------------------------------------------------------------------ */

function addMarker(time = player.currentTime) {
  const p = state.project;
  if (!p) return;
  const g = grid();
  const label = g ? `Mesure ${Math.max(1, G.positionAt(time, g).bar)}` : `Repère ${p.markers.length + 1}`;
  p.markers.push({ id: `${Date.now()}${Math.random().toString(16).slice(2, 6)}`, time, label });
  p.markers.sort((a, b) => a.time - b.time);
  renderMarkers();
  saveSoon();
}

function renderMarkers() {
  const p = state.project;
  const list = $('#marker-list');
  list.replaceChildren();
  $('#marker-empty').hidden = p.markers.length > 0;
  detail.markers = overview.markers = p.markers;
  for (const m of p.markers) {
    const li = document.createElement('li');
    const t = document.createElement('button');
    t.className = 't';
    t.textContent = formatTime(m.time);
    t.title = 'Aller au repère';
    t.onclick = () => player.seek(m.time);
    const input = document.createElement('input');
    input.value = m.label;
    input.setAttribute('aria-label', 'Nom du repère');
    input.oninput = () => {
      m.label = input.value;
      detail.cache = null;
      saveSoon();
    };
    const del = document.createElement('button');
    del.className = 'btn small danger';
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Supprimer le repère');
    del.onclick = () => {
      p.markers = p.markers.filter((x) => x !== m);
      renderMarkers();
      saveSoon();
    };
    li.append(t, input, del);
    list.append(li);
  }
}

/* ------------------------------------------------------------------ */
/* Infos                                                               */
/* ------------------------------------------------------------------ */

function fillKeySelect() {
  const notes = ['Do', 'Do#', 'Ré', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
  const select = $('#key-select');
  const add = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    select.append(o);
  };
  add('', 'Inconnue');
  for (const mode of ['mineur', 'majeur']) for (const n of notes) add(`${n} ${mode}`, `${n} ${mode}`);
}

function renderYoutubeLink() {
  const url = state.project?.youtubeUrl || '';
  const link = $('#yt-link');
  let valid = false;
  try {
    valid = /^https?:$/.test(new URL(url).protocol);
  } catch {}
  link.hidden = !valid;
  if (valid) link.href = url;
}

/* ------------------------------------------------------------------ */
/* Boucle d'animation                                                  */
/* ------------------------------------------------------------------ */

let lastBeatShown = -1;
function frame() {
  requestAnimationFrame(frame);
  if (!state.project || $('#screen-prod').hidden) return;
  player.tick();
  const t = player.currentTime;
  $('#time-now').textContent = formatTime(t);

  // Vue détaillée qui suit la lecture (par pages, pour garder une image stable).
  if ($('#follow').checked && player.playing) {
    const v = detail.view;
    if (t < v.start || t > v.start + v.duration * 0.92) {
      setZoom(v.duration, t - v.duration * 0.08);
    }
  }
  overview.detailView = detail.view;
  overview.playhead = detail.playhead = t;
  overview.draw();
  detail.draw();

  const g = grid();
  if (g) {
    const pos = G.positionAt(t, g);
    $('#bar-num').textContent = pos.bar >= 1 ? pos.bar : '–';
    const key = pos.beatIndex;
    if (key !== lastBeatShown) {
      lastBeatShown = key;
      [...$('#beat-dots').children].forEach((dot, i) => {
        dot.classList.toggle('on', i === pos.beat - 1);
        dot.classList.toggle('down', i === 0);
      });
    }
  } else {
    $('#bar-num').textContent = '–';
  }
  updateDrumGrid(t);
}

// La boucle est aussi surveillée hors affichage pour un retour plus précis.
setInterval(() => player.tick(), 5);

/* ------------------------------------------------------------------ */
/* Branchements                                                        */
/* ------------------------------------------------------------------ */

function bind() {
  for (const t of $$('.tab[data-screen]')) t.onclick = () => showScreen(t.dataset.screen);
  $('#help-btn').onclick = () => $('#help-dialog').showModal();

  // Import
  const input = $('#file-input');
  input.onchange = () => {
    importFile(input.files[0]);
    input.value = '';
  };
  const dz = $('#dropzone');
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    importFile(e.dataTransfer.files[0]);
  });

  // Nom du projet
  $('#project-name').oninput = (e) => {
    state.project.name = e.target.value || 'Sans titre';
    saveSoon();
  };

  // Transport
  $('#play-btn').onclick = () => player.toggle();
  $('#back-btn').onclick = () => player.seek(player.currentTime - 2);
  player.addEventListener('play', updatePlayButton);
  player.addEventListener('pause', updatePlayButton);
  player.addEventListener('ended', updatePlayButton);
  for (const b of $$('[data-rate]')) b.onclick = () => setRate(Number(b.dataset.rate));
  $('#loop-toggle').onclick = () => applyLoop({ ...state.project.loop, enabled: !state.project.loop.enabled });
  for (const b of $$('[data-loopbars]')) b.onclick = () => loopBars(Number(b.dataset.loopbars));
  $('#zoom-in').onclick = () => zoomBy(0.5);
  $('#zoom-out').onclick = () => zoomBy(2);

  // Forme d'onde
  const seek = (e) => player.seek(e.detail.time);
  overview.addEventListener('seek', (e) => {
    seek(e);
    const v = detail.view;
    if (e.detail.time < v.start || e.detail.time > v.start + v.duration) setZoom(v.duration, e.detail.time - v.duration / 2);
  });
  detail.addEventListener('seek', seek);
  detail.addEventListener('loopselect', (e) => {
    const { a, b, final } = e.detail;
    detail.loop = overview.loop = { a, b, enabled: true };
    if (final) {
      applyLoop({ a, b, enabled: true });
      const t = player.currentTime;
      if (t < a || t >= b) player.seek(a);
    }
  });
  detail.addEventListener('zoom', (e) => zoomBy(e.detail.factor, e.detail.at));
  detail.addEventListener('scroll', (e) => {
    $('#follow').checked = false;
    setZoom(detail.view.duration, detail.view.start + e.detail.delta);
  });

  // Tempo
  $('#bpm-half').onclick = () => {
    const g = grid();
    forceBpm(g.bpm / 2, G.halveTempo(g));
  };
  $('#bpm-double').onclick = () => {
    const g = grid();
    forceBpm(g.bpm * 2, G.doubleTempo(g));
  };
  const applyManual = () => {
    const v = parseFloat(String($('#bpm-input').value).replace(',', '.'));
    if (!(v >= 40 && v <= 240)) {
      toast('Indique un BPM entre 40 et 240.');
      return;
    }
    applyGrid({ ...(grid() || { downbeat: 0, beatsPerBar: 4 }), bpm: v }, 'manual');
  };
  $('#bpm-apply').onclick = applyManual;
  $('#bpm-input').addEventListener('keydown', (e) => e.key === 'Enter' && applyManual());
  $('#tap-btn').onclick = doTap;
  $('#db-here').onclick = () => applyGrid(G.setDownbeatAt(grid(), player.currentTime), state.project.gridSource);
  $('#db-prev-beat').onclick = () => applyGrid(G.shiftBeats(grid(), -1), state.project.gridSource);
  $('#db-next-beat').onclick = () => applyGrid(G.shiftBeats(grid(), 1), state.project.gridSource);
  $('#db-nudge-minus').onclick = () => applyGrid(G.nudge(grid(), -0.01), state.project.gridSource);
  $('#db-nudge-plus').onclick = () => applyGrid(G.nudge(grid(), 0.01), state.project.gridSource);
  $('#reanalyze').onclick = () => runAnalysis();
  $('#analyze-loop').onclick = () => runAnalysis({ region: state.project.loop });

  // Écoute
  const settings = loadSettings();
  $('#metro-volume').value = metronome.volume = settings.metroVolume;
  $('#metro-offset').value = metronome.offsetMs = settings.metroOffset;
  $('#metro-offset-label').textContent = `${settings.metroOffset} ms`;
  $('#metro-on').onchange = (e) => metronome.setEnabled(e.target.checked);
  $('#metro-volume').oninput = (e) => {
    metronome.volume = Number(e.target.value);
    saveSettings({ metroVolume: metronome.volume });
  };
  $('#metro-offset').oninput = (e) => {
    metronome.offsetMs = Number(e.target.value);
    $('#metro-offset-label').textContent = `${metronome.offsetMs} ms`;
    saveSettings({ metroOffset: metronome.offsetMs });
  };
  $('#beat-volume').oninput = (e) => player.setVolume(Number(e.target.value));

  // Infos
  fillKeySelect();
  $('#key-select').onchange = (e) => {
    state.project.key = e.target.value;
    saveSoon();
  };
  $('#yt-input').oninput = (e) => {
    state.project.youtubeUrl = e.target.value.trim();
    renderYoutubeLink();
    saveSoon();
  };

  // Repères
  $('#marker-add').onclick = () => addMarker();

  // Batterie et sections
  for (const b of $$('[data-drumview]')) {
    b.onclick = () => {
      state.drumView = b.dataset.drumview;
      for (const x of $$('[data-drumview]')) x.setAttribute('aria-pressed', String(x === b));
      drumShown = '';
    };
  }
  $('#drum-grid').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-step]');
    if (cell) seekToStep(Number(cell.dataset.step));
  });
  $('#section-add').onclick = addSectionHere;
  $('#section-auto').onclick = proposeSectionsNow;
  $('#section-labels').replaceChildren(
    ...S.SECTION_LABELS.map((l) => Object.assign(document.createElement('option'), { value: l })),
  );

  document.addEventListener('keydown', onKey);
}

function doTap() {
  const bpm = tap.tap(performance.now() / 1000);
  const btn = $('#tap-btn');
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 80);
  $('#tap-info').textContent = bpm ? formatBpm(Math.round(bpm * 10) / 10) : `${tap.count}/4`;
  if (bpm && state.project) {
    // Le tap donne le tempo ; le « 1 » se recale ensuite avec « Le 1 est ici ».
    applyGrid({ ...(grid() || { downbeat: player.currentTime, beatsPerBar: 4 }), bpm: Math.round(bpm * 10) / 10 }, 'tap');
  }
}

function onKey(e) {
  if (!state.project || $('#screen-prod').hidden) return;
  if (e.target.closest('input, select, textarea, [contenteditable]') || e.ctrlKey || e.metaKey) return;
  if ($('#help-dialog').open) return;
  const g = grid();
  const step = e.shiftKey && g ? G.barDuration(g) : 2;
  const key = e.key.toLowerCase();
  const actions = {
    ' ': () => player.toggle(),
    arrowleft: () => player.seek(player.currentTime - step),
    arrowright: () => player.seek(player.currentTime + step),
    home: () => player.seek(0),
    l: () => $('#loop-toggle').disabled || $('#loop-toggle').click(),
    '[': () => applyLoop({ a: player.currentTime, b: Math.max(state.project.loop.b, player.currentTime + 1), enabled: true }),
    ']': () => applyLoop({ a: Math.min(state.project.loop.a, player.currentTime - 1), b: player.currentTime, enabled: true }),
    s: () => setRate(player.rate === 1 ? 0.75 : 1),
    k: () => {
      const box = $('#metro-on');
      box.checked = !box.checked;
      metronome.setEnabled(box.checked);
    },
    t: doTap,
    m: () => addMarker(),
    n: addSectionHere,
  };
  const action = actions[key];
  if (action) {
    e.preventDefault();
    if (e.target instanceof HTMLButtonElement) e.target.blur();
    action();
  }
}

const SETTINGS_KEY = 'flowlab.settings';
function loadSettings() {
  const defaults = { metroVolume: 0.6, metroOffset: 0 };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return defaults;
  }
}
function saveSettings(patch) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch {}
}

// Écrans Yaourt et Texte : modules à part, qui reçoivent ce dont ils ont besoin.
const app = {
  state,
  player,
  metronome,
  grid,
  saveSoon,
  toast,
  applyLoop,
  setRate,
  currentDrums,
  lastBar,
  loadSettings,
  saveSettings,
  sections: () => (grid() && state.project ? S.sectionRanges(state.project.sections, lastBar()) : []),
};
const yaourt = initYaourt(app);
app.yaourt = yaourt;
const texte = initTexte(app);

bind();
renderBeatDots();
buildDrumGrid();
renderProjects();
requestAnimationFrame(frame);
