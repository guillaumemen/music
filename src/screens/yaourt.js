// Écran Yaourt : enregistrement au casque, guide visuel en direct, carte de flow, prises,
// prise fantôme et comparaison A / B.
import * as G from '../core/grid.js';
import { formatTime } from '../core/format.js';
import { OnsetDetector, analyzeVoice } from '../analysis/voice.js';
import { placeSyllables, flowMap } from '../core/flow.js';
import { HIT_THRESHOLD, gridSignature } from '../analysis/drums.js';
import { sectionColor } from '../core/sections.js';
import { Recorder, TakeDeck, halveRate } from '../audio/recorder.js';
import * as db from '../store/db.js';

const $ = (sel) => document.querySelector(sel);
const median = (values) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const TIMING_LABEL = { on: 'dans le temps', early: 'en avance', late: 'en retard' };

// app : { state, player, metronome, grid, saveSoon, toast, applyLoop, setRate, sections,
//         currentDrums, loadSettings, saveSettings, lastBar }
export function initYaourt(app) {
  const { player, metronome } = app;
  const recorder = new Recorder(player);
  const deck = new TakeDeck(player, () => metronome.offsetMs);
  const audio = new Map(); // id -> { samples, sampleRate }
  const placedCache = new Map(); // `${id}|${grille}` -> syllabes placées
  const ui = { listen: 'a', rec: null, visible: false, page: null };

  const project = () => app.state.project;
  const takes = () => project()?.takes || [];
  const takeById = (id) => takes().find((t) => t.id === id) || null;
  const settings = () => ({ latencyMs: null, calibrated: false, ghostAudible: false, countIn: true, ...app.loadSettings() });
  const sel = () => project()?.yaourt || { a: '', b: '', ghost: '' };
  function setSel(patch) {
    project().yaourt = { ...sel(), ...patch };
    app.saveSoon();
  }

  // Latence par défaut (non calibrée) : ce que le navigateur annonce, + ~20 ms d'entrée micro.
  function latencyMs() {
    const s = settings();
    if (Number.isFinite(s.latencyMs)) return s.latencyMs;
    const ctx = player.ctx;
    return ctx ? Math.round(((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000 + 20) : 60;
  }

  /* ---------------------------------------------------------------- */
  /* Passage enregistré                                                */
  /* ---------------------------------------------------------------- */

  const barOf = (t, g) => Math.max(1, G.positionAt(t + 1e-6, g).bar);

  // Passage : la boucle si elle est active, sinon depuis la mesure en cours jusqu'à la fin.
  function passage() {
    const g = app.grid();
    if (!g || !app.state.audio) return null;
    const loop = project().loop;
    if (loop.enabled && loop.b - loop.a > 0.5) {
      return { a: loop.a, b: loop.b, startBar: barOf(loop.a, g), endBar: barOf(loop.b - 0.02, g), free: false };
    }
    const startBar = barOf(player.currentTime, g);
    return { a: G.barStart(startBar, g), b: app.state.audio.duration, startBar, endBar: app.lastBar(), free: true };
  }

  function renderPassage() {
    const g = app.grid();
    const select = $('#y-passage');
    const loop = project()?.loop;
    const ranges = g ? app.sections() : [];
    const opts = [['free', 'Libre : depuis la mesure en cours']];
    if (loop?.b - loop?.a > 0.5) opts.push(['loop', `Boucle actuelle (${formatTime(loop.a)} → ${formatTime(loop.b)})`]);
    for (const r of ranges) opts.push([`sec:${r.id}`, `${r.label || 'Sans nom'} · mes. ${r.startBar}–${r.endBar - 1}`]);
    select.replaceChildren(...opts.map(([v, t]) => Object.assign(document.createElement('option'), { value: v, textContent: t })));
    let value = 'free';
    if (loop?.enabled && loop.b - loop.a > 0.5) {
      const match = ranges.find((r) => Math.abs(G.barStart(r.startBar, g) - loop.a) < 0.01 && Math.abs(Math.min(app.state.audio?.duration ?? Infinity, G.barStart(r.endBar, g)) - loop.b) < 0.01);
      value = match ? `sec:${match.id}` : 'loop';
    }
    select.value = value;
    select.disabled = !g || !!ui.rec;
    const ps = passage();
    $('#y-region').textContent = !g
      ? 'Il faut un BPM (écran Prod) pour enregistrer sur la grille.'
      : ps.free
        ? `À partir de la mesure ${ps.startBar}, jusqu'à ce que tu arrêtes.`
        : `Mesures ${ps.startBar} à ${ps.endBar} (${ps.endBar - ps.startBar + 1} mes.), une passe par prise.`;
    $('#y-rec').disabled = !g;
  }

  function choosePassage(value) {
    const g = app.grid();
    const loop = project().loop;
    if (value === 'free') app.applyLoop({ ...loop, enabled: false });
    else if (value === 'loop') app.applyLoop({ ...loop, enabled: true });
    else if (value.startsWith('sec:')) {
      const r = app.sections().find((x) => `sec:${x.id}` === value);
      if (r) {
        const a = G.barStart(r.startBar, g);
        app.applyLoop({ a, b: Math.min(app.state.audio.duration, G.barStart(r.endBar, g)), enabled: true });
        player.seek(a);
      }
    }
    renderPassage();
    ui.page = null;
  }

  /* ---------------------------------------------------------------- */
  /* Prises : audio, placement, lecture                                */
  /* ---------------------------------------------------------------- */

  async function takeAudio(id) {
    if (!audio.has(id)) {
      const data = await db.getTakeAudio(id);
      if (data) audio.set(id, data);
    }
    return audio.get(id) || null;
  }

  function placed(take) {
    const g = app.grid();
    if (!take || !g) return [];
    const key = `${take.id}|${gridSignature(g)}`;
    if (!placedCache.has(key)) {
      const abs = take.sylls.map((s) => ({ ...s, time: s.time + take.start, end: s.end + take.start }));
      placedCache.set(key, placeSyllables(abs, g).filter((s) => s.bar >= take.region.startBar && s.bar <= take.region.endBar));
    }
    return placedCache.get(key);
  }

  function mapOf(take) {
    if (!take) return null;
    return flowMap(placed(take), app.grid(), { fromBar: take.region.startBar, toBar: take.region.endBar });
  }

  // Les prises A, B et fantôme sont chargées dans la platine ; le volume dit laquelle on entend.
  async function syncDeck() {
    const s = sel();
    const wanted = new Set([s.a, s.b, s.ghost].filter(Boolean));
    for (const id of [...deck.voices.keys()]) if (!wanted.has(id)) deck.remove(id);
    for (const id of wanted) {
      if (deck.has(id)) continue;
      const t = takeById(id);
      const data = t && (await takeAudio(id));
      if (data) deck.set(id, { ...data, start: t.start }, 0);
    }
    updateGains();
  }

  function updateGains() {
    const s = sel();
    const ghostOn = settings().ghostAudible;
    for (const id of deck.voices.keys()) {
      let g = 0;
      if (ui.rec) g = id === s.ghost && ghostOn ? 0.35 : 0;
      else if (ui.listen === 'a' && id === s.a) g = 1;
      else if (ui.listen === 'b' && id === s.b) g = 1;
      deck.setGain(id, g);
    }
    for (const b of document.querySelectorAll('[data-listen]')) b.setAttribute('aria-pressed', String(b.dataset.listen === ui.listen));
  }

  /* ---------------------------------------------------------------- */
  /* Enregistrement                                                    */
  /* ---------------------------------------------------------------- */

  async function openMic() {
    try {
      await recorder.open();
      $('#y-mic').textContent = `Micro : ${recorder.deviceLabel || 'ouvert'}`;
      return true;
    } catch (e) {
      app.toast(`Micro inaccessible : ${e.message}. Autorise le micro pour ce site (icône à gauche de l'adresse).`, 6000);
      return false;
    }
  }

  async function startRecording() {
    const g = app.grid();
    if (!g || ui.rec) return;
    if (!(await openMic())) return;
    if (player.rate !== 1) {
      app.setRate(1);
      app.toast('Vitesse remise à 1x pour enregistrer.');
    }
    const ps = passage();
    const s = settings();
    const from = Math.max(0, ps.a - (s.countIn ? G.barDuration(g) : 0));
    const loop = { ...project().loop };
    player.setLoop(loop.a, loop.b, false); // une seule passe par prise
    const rec = { ps, chunks: [], offsets: [], firstCtx: null, detector: null, live: [], loop, latency: latencyMs() };
    ui.rec = rec;
    updateGains();
    player.seek(from);
    await player.play();
    rec.stop = recorder.start((ctxTime, samples) => {
      if (ui.rec !== rec) return;
      // Écart entre l'horloge de la prod et celle de Web Audio, mesuré à chaque morceau (médiane).
      rec.offsets.push(player.currentTime - player.ctx.currentTime);
      if (rec.firstCtx === null) {
        rec.firstCtx = ctxTime;
        rec.detector = new OnsetDetector(player.ctx.sampleRate);
      }
      rec.chunks.push(samples);
      const start = takeStart(rec);
      for (const syl of rec.detector.push(samples)) rec.live.push({ time: start + syl.time, accent: false });
    });
    renderState();
    renderPassage();
  }

  const takeStart = (rec) => rec.firstCtx + median(rec.offsets) - metronome.offsetMs / 1000 - rec.latency / 1000;

  async function stopRecording({ keep = true } = {}) {
    const rec = ui.rec;
    if (!rec || rec.stopping) return;
    rec.stopping = true;
    const reached = player.currentTime;
    await rec.stop();
    player.pause();
    player.setLoop(rec.loop.a, rec.loop.b, rec.loop.enabled);
    ui.rec = null;
    renderState();
    renderPassage();
    updateGains();
    if (!keep) return app.toast('Prise annulée.');
    if (rec.firstCtx === null || reached < rec.ps.a + 0.5) return app.toast('Prise trop courte : rien n\'a été gardé.');

    const g = app.grid();
    const sr = player.ctx.sampleRate;
    const total = rec.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of rec.chunks) {
      all.set(c, o);
      o += c.length;
    }
    const { samples, sampleRate } = halveRate(all, sr);
    const sylls = analyzeVoice(samples, sampleRate);
    const b = Math.min(rec.ps.b, reached);
    const take = {
      id: newId(),
      name: `Prise ${takes().length + 1}`,
      createdAt: Date.now(),
      start: takeStart(rec),
      duration: samples.length / sampleRate,
      region: { a: rec.ps.a, b, startBar: rec.ps.startBar, endBar: Math.max(rec.ps.startBar, barOf(b - 0.02, g)) },
      latencyMs: rec.latency,
      sylls,
    };
    try {
      await db.saveTakeAudio(take.id, { samples, sampleRate });
    } catch (e) {
      return app.toast(`Impossible d'enregistrer la prise : ${e.message}`);
    }
    audio.set(take.id, { samples, sampleRate });
    project().takes.push(take);
    // La nouvelle prise devient A, l'ancienne A passe en B pour comparer tout de suite.
    const s = sel();
    setSel({ a: take.id, b: s.a && s.a !== take.id ? s.a : s.b });
    ui.listen = 'a';
    await syncDeck();
    render();
    if (!sylls.length) app.toast('Aucune syllabe détectée : vérifie le micro et parle plus fort, en « da / ta ».', 6000);
  }

  /* ---------------------------------------------------------------- */
  /* Calibration de la latence                                         */
  /* ---------------------------------------------------------------- */

  async function calibrate() {
    const dlg = $('#calib-dialog');
    const out = $('#calib-result');
    const status = $('#calib-status');
    $('#calib-apply').hidden = true;
    out.textContent = '';
    if (!(await openMic())) return;
    player.pause();
    const ctx = player.ctx;
    const beat = 0.6; // 100 BPM
    const n = 12;
    const t0 = ctx.currentTime + 0.6;
    const clicks = [];
    for (let i = 0; i < n; i++) {
      const when = t0 + i * beat;
      clicks.push(when);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i % 4 === 0 ? 1760 : 1175;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.6, when + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      osc.connect(gain).connect(player.master);
      osc.start(when);
      osc.stop(when + 0.06);
    }
    const onsets = [];
    let first = null, det = null;
    const stop = recorder.start((ctxTime, samples) => {
      if (first === null) {
        first = ctxTime;
        det = new OnsetDetector(ctx.sampleRate);
      }
      for (const s of det.push(samples)) onsets.push(first + s.time);
    });
    const timer = setInterval(() => {
      const k = Math.floor((ctx.currentTime - t0) / beat) + 1;
      status.textContent = k < 1 ? 'Prépare-toi…' : k <= 4 ? `Écoute : ${k}` : k <= n ? `Dis « ta » : ${k - 4} / ${n - 4}` : 'Calcul…';
    }, 50);
    await new Promise((r) => setTimeout(r, (t0 - ctx.currentTime + n * beat + 0.5) * 1000));
    clearInterval(timer);
    await stop();
    const diffs = [];
    for (const c of clicks.slice(4)) {
      const near = onsets.filter((o) => o > c - 0.15 && o < c + 0.45).sort((x, y) => Math.abs(x - c) - Math.abs(y - c))[0];
      if (near !== undefined) diffs.push(near - c);
    }
    if (diffs.length < 5) {
      status.textContent = 'Pas assez de « ta » entendus.';
      out.textContent = `${diffs.length} sur 8. Rapproche le micro, parle plus fort, et garde le casque (sinon le micro entend les clics).`;
      return;
    }
    const lat = median(diffs);
    const spread = median(diffs.map((d) => Math.abs(d - lat)));
    status.textContent = 'Mesure faite.';
    out.textContent = `Latence mesurée : ${Math.round(lat * 1000)} ms (${diffs.length}/8 clics, régularité ±${Math.round(spread * 1000)} ms).`;
    const apply = $('#calib-apply');
    apply.hidden = false;
    apply.onclick = () => {
      app.saveSettings({ latencyMs: Math.round(lat * 1000), calibrated: true });
      renderLatency();
      dlg.close();
      app.toast('Latence enregistrée pour cet appareil.');
    };
  }

  function renderLatency() {
    const s = settings();
    const v = latencyMs();
    $('#y-latency').value = String(v);
    $('#y-latency-label').textContent = `${v} ms ${s.calibrated ? '(calibrée)' : '(estimée, à calibrer)'}`;
  }

  /* ---------------------------------------------------------------- */
  /* Affichage                                                         */
  /* ---------------------------------------------------------------- */

  function renderState() {
    const rec = ui.rec;
    const btn = $('#y-rec');
    btn.classList.toggle('on', !!rec);
    btn.textContent = rec ? '■' : '●';
    btn.setAttribute('aria-label', rec ? 'Arrêter la prise' : 'Enregistrer une prise');
    $('#y-state').textContent = rec ? 'Enregistrement' : player.playing ? 'Lecture' : 'Prêt';
    $('#y-play').textContent = player.playing && !rec ? '❚❚' : '▶';
    $('#y-play').disabled = !!rec;
  }

  function renderTakes() {
    const list = $('#take-list');
    const s = sel();
    list.replaceChildren();
    $('#take-empty').hidden = takes().length > 0;
    for (const t of [...takes()].reverse()) {
      const li = document.createElement('li');
      li.classList.toggle('is-a', t.id === s.a);
      li.classList.toggle('is-b', t.id === s.b);
      const pick = document.createElement('span');
      pick.className = 'seg';
      for (const [k, label, title] of [['a', 'A', 'Prise principale'], ['b', 'B', 'Prise à comparer'], ['ghost', '👻', 'Prise fantôme : affichée en cercles pendant la prise suivante']]) {
        const b = document.createElement('button');
        b.className = 'seg-btn';
        b.textContent = label;
        b.title = title;
        b.setAttribute('aria-label', `${title} : ${t.name}`);
        b.setAttribute('aria-pressed', String(s[k] === t.id));
        b.onclick = async () => {
          const cur = sel();
          const patch = { [k]: cur[k] === t.id ? '' : t.id };
          if (k === 'a' && cur.b === t.id) patch.b = '';
          if (k === 'b' && cur.a === t.id) patch.a = '';
          setSel(patch);
          await syncDeck();
          render();
        };
        pick.append(b);
      }
      const name = document.createElement('input');
      name.className = 'name';
      name.value = t.name;
      name.setAttribute('aria-label', 'Nom de la prise');
      name.oninput = () => {
        t.name = name.value;
        app.saveSoon();
        renderCompare();
      };
      const meta = document.createElement('span');
      meta.className = 'meta small dim';
      const m = mapOf(t);
      meta.textContent = `mes. ${t.region.startBar}–${t.region.endBar} · ${m.stats.total} syll. · ${m.stats.on} % dans le temps · ${new Date(t.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
      const play = document.createElement('button');
      play.className = 'btn small';
      play.textContent = '▶';
      play.title = 'Écouter cette prise sur la prod';
      play.onclick = async () => {
        const cur = sel();
        if (cur.b === t.id) ui.listen = 'b';
        else {
          if (cur.a !== t.id) setSel({ a: t.id });
          ui.listen = 'a';
        }
        await syncDeck();
        render();
        player.seek(Math.max(0, t.region.a - 0.05));
        player.play();
      };
      const del = document.createElement('button');
      del.className = 'btn small danger';
      del.textContent = '✕';
      del.title = 'Supprimer la prise';
      del.onclick = async () => {
        if (!confirm(`Supprimer « ${t.name} » ?`)) return;
        project().takes = takes().filter((x) => x !== t);
        const cur = sel();
        setSel(Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v === t.id ? '' : v])));
        deck.remove(t.id);
        audio.delete(t.id);
        await db.deleteTakeAudio(t.id).catch(() => {});
        render();
      };
      li.append(pick, name, meta, play, del);
      list.append(li);
    }
  }

  function renderSummary() {
    const box = $('#flow-summary');
    const t = takeById(sel().a);
    box.replaceChildren();
    if (!t || !app.grid()) {
      box.innerHTML = '<p class="small dim">Enregistre une prise : sa carte de flow s\'affiche ici (syllabes par mesure, placement, accents, silences, motifs qui reviennent).</p>';
      return;
    }
    const m = mapOf(t);
    const st = m.stats;
    const lead = st.meanDevMs < -8 ? `tu as tendance à être en avance (${-st.meanDevMs} ms)` : st.meanDevMs > 8 ? `tu as tendance à être en retard (${st.meanDevMs} ms)` : 'pas de tendance avance / retard';
    const p = document.createElement('p');
    p.className = 'small';
    p.textContent = `${t.name} : ${st.total} syllabes, ${st.perBar} par mesure en moyenne, ${st.accents} accents. ${st.on} % dans le temps, ${st.early} % en avance, ${st.late} % en retard ; ${lead}.`;
    box.append(p);

    const max = Math.max(1, ...m.bars.map((b) => b.count));
    const table = document.createElement('table');
    table.className = 'flow-table';
    table.innerHTML = '<thead><tr><th>Mes.</th><th>Syllabes</th><th>Dans le temps</th><th>Accents</th><th>Motif</th><th></th></tr></thead>';
    const body = document.createElement('tbody');
    for (const b of m.bars) {
      const tr = document.createElement('tr');
      const notes = [b.silence ? 'silence' : '', b.trend || ''].filter(Boolean).join(', ');
      tr.innerHTML = `<td>${b.bar}</td><td><span class="bar-fill" style="--w:${(b.count / max) * 100}%"></span>${b.count}</td><td>${b.count ? Math.round((b.onBeat / b.count) * 100) + ' %' : '–'}</td><td>${b.accents || '–'}</td><td>${b.motif ? `<span class="motif">${b.motif}</span>` : ''}</td><td class="dim">${notes}</td>`;
      body.append(tr);
    }
    table.append(body);
    box.append(table);
    const extra = document.createElement('p');
    extra.className = 'small dim';
    const gaps = m.gaps.map((gp) => {
      const pos = G.positionAt(gp.from, app.grid());
      return `mes. ${pos.bar} temps ${pos.beat} (${String(gp.beats).replace('.', ',')} temps)`;
    });
    const motifs = m.motifs.map((x) => `${x.letter} : mes. ${x.bars.join(', ')}`);
    extra.textContent = [gaps.length ? `Respirations : ${gaps.join(' · ')}.` : 'Aucune respiration d\'un temps ou plus.', motifs.length ? `Motifs qui reviennent : ${motifs.join(' · ')}.` : ''].filter(Boolean).join(' ');
    box.append(extra);
  }

  function renderCompare() {
    const box = $('#ab-compare');
    const a = takeById(sel().a), b = takeById(sel().b);
    if (!a || !b || !app.grid()) {
      box.innerHTML = '<p class="small dim">Choisis une prise A et une prise B dans la liste pour les comparer. Pendant la lecture, « Écouter A / B » passe de l\'une à l\'autre sans couper la prod.</p>';
      return;
    }
    const ma = mapOf(a).stats, mb = mapOf(b).stats;
    const rows = [
      ['Syllabes par mesure', ma.perBar, mb.perBar, ''],
      ['Dans le temps', ma.on, mb.on, ' %'],
      ['En avance', ma.early, mb.early, ' %'],
      ['En retard', ma.late, mb.late, ' %'],
      ['Écart moyen', ma.meanAbsDevMs, mb.meanAbsDevMs, ' ms'],
      ['Accents', ma.accents, mb.accents, ''],
    ];
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    let html = `<table class="flow-table"><thead><tr><th></th><th>A · ${esc(a.name)}</th><th>B · ${esc(b.name)}</th></tr></thead><tbody>`;
    for (const [label, x, y, unit] of rows) html += `<tr><td>${label}</td><td>${String(x).replace('.', ',')}${unit}</td><td>${String(y).replace('.', ',')}${unit}</td></tr>`;
    html += '</tbody></table>';
    const notes = [];
    const dd = Math.round((ma.perBar - mb.perBar) * 10) / 10;
    if (Math.abs(dd) >= 0.5) notes.push(`A est ${dd > 0 ? 'plus dense' : 'plus posée'} que B (${dd > 0 ? '+' : ''}${String(dd).replace('.', ',')} syll. par mesure)`);
    const don = ma.on - mb.on;
    if (Math.abs(don) >= 5) notes.push(`A est ${don > 0 ? 'plus' : 'moins'} en place (${don > 0 ? '+' : ''}${don} points dans le temps)`);
    html += `<p class="small">${notes.length ? notes.join(' ; ') + '.' : 'Les deux prises sont proches en densité et en placement.'}</p>`;
    box.innerHTML = html;
  }

  function render() {
    if (!project()) return;
    renderPassage();
    renderState();
    renderTakes();
    renderSummary();
    renderCompare();
    renderLatency();
    const s = settings();
    $('#y-ghost-audible').checked = s.ghostAudible;
    $('#y-countin').checked = s.countIn;
    ui.page = null;
  }

  /* ---------------------------------------------------------------- */
  /* Guide visuel (canvas)                                             */
  /* ---------------------------------------------------------------- */

  const canvas = $('#flow-canvas');
  let dims = { w: 1, h: 1, dpr: 1 };
  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    dims = { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr: window.devicePixelRatio || 1 };
    canvas.width = Math.round(dims.w * dims.dpr);
    canvas.height = Math.round(dims.h * dims.dpr);
  }).observe(canvas);

  // Mesures affichées : 4 (libre) ou jusqu'à 8 (boucle), par pages qui suivent la lecture.
  function visibleBars(curBar) {
    const ps = ui.rec?.ps || passage();
    if (!ps) return [];
    const per = ps.free ? 4 : Math.min(8, ps.endBar - ps.startBar + 1);
    const base = ps.startBar;
    const idx = Math.max(0, Math.floor((Math.max(curBar, base) - base) / per));
    let first = base + idx * per;
    if (!ps.free && first + per - 1 > ps.endBar) first = Math.max(base, ps.endBar - per + 1);
    return Array.from({ length: per }, (_, i) => first + i);
  }

  function draw() {
    const g = app.grid();
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dims.dpr, 0, 0, dims.dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);
    const t = player.currentTime;
    if (!g) return;
    const pos = G.positionAt(t, g);
    const bars = visibleBars(pos.bar);
    const s = sel();
    const B = !ui.rec ? takeById(s.b) : null;
    const lanes = B ? 2 : 1;
    const labelW = dims.w < 500 ? 40 : 64;
    const gridW = dims.w - labelW - 8;
    const rowH = Math.min(lanes === 2 ? 64 : 48, (dims.h - 8) / Math.max(1, bars.length));
    const steps = g.beatsPerBar * 4;
    const xOf = (p) => labelW + (Math.max(-0.4, Math.min(steps - 0.01, p)) / steps) * gridW;
    const colors = { on: cssVar('--ok'), early: '#8fb3ff', late: cssVar('--warn') };
    const drums = app.currentDrums();
    const ranges = app.sections();
    ctx.font = '11px system-ui, sans-serif';

    // Données par mesure
    const group = (list) => {
      const m = new Map();
      for (const x of list) {
        if (!m.has(x.bar)) m.set(x.bar, []);
        m.get(x.bar).push(x);
      }
      return m;
    };
    const lane1 = group(ui.rec ? placeSyllables(ui.rec.live, g) : placed(takeById(s.a)));
    const lane2 = B ? group(placed(B)) : new Map();
    const ghost = group(s.ghost && (ui.rec || s.ghost !== s.a) ? placed(takeById(s.ghost)) : []);

    bars.forEach((bar, r) => {
      const y0 = 4 + r * rowH;
      const current = bar === pos.bar;
      ctx.fillStyle = current ? cssVar('--surface-2') : cssVar('--bg');
      ctx.fillRect(labelW, y0, gridW, rowH - 4);
      const sec = ranges.find((x) => bar >= x.startBar && bar < x.endBar);
      if (sec) {
        ctx.fillStyle = sectionColor(sec.label);
        ctx.fillRect(0, y0, 3, rowH - 4);
      }
      ctx.fillStyle = current ? cssVar('--text') : cssVar('--text-dim');
      ctx.fillText(`${labelW < 60 ? '' : 'mes. '}${bar}`, 8, y0 + 15);
      // Temps et doubles croches
      for (let i = 0; i <= steps; i++) {
        const x = Math.round(labelW + (i / steps) * gridW) + 0.5;
        ctx.strokeStyle = i % 4 === 0 ? cssVar('--grid-bar') : cssVar('--grid-beat');
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + rowH - 4);
        ctx.stroke();
      }
      // Batterie en fond : kick (bas) et caisse claire (haut), discrets
      const d = drums?.bars[bar];
      if (d) {
        for (let i = 0; i < steps; i++) {
          const x = labelW + ((i + 0.5) / steps) * gridW;
          if (d.kick[i] >= HIT_THRESHOLD) {
            ctx.fillStyle = cssVar('--kick');
            ctx.globalAlpha = 0.35;
            ctx.fillRect(x - gridW / steps / 2 + 1, y0 + rowH - 8, gridW / steps - 2, 3);
          }
          if (d.snare[i] >= HIT_THRESHOLD) {
            ctx.fillStyle = cssVar('--snare');
            ctx.globalAlpha = 0.35;
            ctx.fillRect(x - gridW / steps / 2 + 1, y0, gridW / steps - 2, 3);
          }
          ctx.globalAlpha = 1;
        }
      }
      const laneH = (rowH - 4) / lanes;
      const dot = (syl, lane, hollow) => {
        // Le point est posé à l'instant réel ; la case la plus proche est sa référence.
        const x = labelW + ((syl.pos + 0.5) / steps) * gridW;
        const y = y0 + laneH * (lane + 0.5);
        const stepW = gridW / steps;
        const rad = Math.max(2, Math.min(syl.accent ? 7 : 4.5, stepW * (syl.accent ? 0.42 : 0.28)));
        ctx.beginPath();
        ctx.arc(Math.max(labelW + 2, Math.min(labelW + gridW - 2, x)), y, rad, 0, Math.PI * 2);
        if (hollow) {
          ctx.strokeStyle = cssVar('--text-dim');
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.fillStyle = colors[syl.timing];
          ctx.fill();
        }
      };
      for (const syl of ghost.get(bar) || []) dot(syl, 0, true);
      for (const syl of lane1.get(bar) || []) dot(syl, 0, false);
      for (const syl of lane2.get(bar) || []) dot(syl, 1, false);
      if (lanes === 2) {
        ctx.fillStyle = cssVar('--text-dim');
        ctx.fillText('A', labelW - 14, y0 + laneH * 0.5 + 4);
        ctx.fillText('B', labelW - 14, y0 + laneH * 1.5 + 4);
      }
      // Tête de lecture
      if (current && (player.playing || ui.rec)) {
        const x = xOf((pos.beat - 1 + pos.fraction) * 4 - 0.5) + gridW / steps / 2;
        ctx.strokeStyle = cssVar('--playhead');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + rowH - 4);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    });

    // Décompte avant le début du passage
    const cd = $('#y-countdown');
    if (ui.rec && t < ui.rec.ps.a) {
      const left = Math.ceil((ui.rec.ps.a - t) / G.beatDuration(g) - 1e-6);
      cd.hidden = false;
      cd.textContent = String(Math.min(left, g.beatsPerBar));
    } else cd.hidden = true;
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!ui.visible || !project()) return;
    const g = app.grid();
    const t = player.currentTime;
    if (ui.rec && !ui.rec.stopping && (t >= ui.rec.ps.b + 0.25 || (!player.playing && rec0()))) stopRecording();
    if (g) {
      const pos = G.positionAt(t, g);
      $('#y-bar').textContent = pos.bar >= 1 ? pos.bar : '–';
      [...$('#y-dots').children].forEach((dot, i) => {
        dot.classList.toggle('on', (player.playing || !!ui.rec) && i === pos.beat - 1);
        dot.classList.toggle('down', i === 0);
      });
    }
    draw();
  }
  // Fin du morceau pendant une prise libre.
  const rec0 = () => ui.rec && ui.rec.firstCtx !== null && player.media.ended;

  /* ---------------------------------------------------------------- */
  /* Branchements                                                      */
  /* ---------------------------------------------------------------- */

  $('#y-rec').onclick = () => (ui.rec ? stopRecording() : startRecording());
  $('#y-play').onclick = () => {
    if (ui.rec) return;
    if (!player.playing) {
      const ps = passage();
      if (ps && !ps.free && (player.currentTime < ps.a || player.currentTime >= ps.b)) player.seek(ps.a);
    }
    player.toggle();
  };
  $('#y-passage').onchange = (e) => choosePassage(e.target.value);
  for (const b of document.querySelectorAll('[data-listen]')) {
    b.onclick = () => {
      ui.listen = b.dataset.listen;
      updateGains();
    };
  }
  $('#y-ghost-audible').onchange = (e) => {
    app.saveSettings({ ghostAudible: e.target.checked });
    updateGains();
  };
  $('#y-countin').onchange = (e) => app.saveSettings({ countIn: e.target.checked });
  $('#y-latency').oninput = (e) => {
    app.saveSettings({ latencyMs: Number(e.target.value), calibrated: false });
    renderLatency();
  };
  $('#y-calibrate').onclick = () => {
    $('#calib-status').textContent = 'Mets ton casque, puis lance la mesure.';
    $('#calib-result').textContent = '';
    $('#calib-apply').hidden = true;
    $('#calib-dialog').showModal();
  };
  $('#calib-start').onclick = calibrate;
  for (const ev of ['play', 'pause', 'ended']) player.addEventListener(ev, renderState);
  $('#y-dots').replaceChildren(...Array.from({ length: 4 }, () => document.createElement('span')));

  document.addEventListener('keydown', (e) => {
    if (!ui.visible || !project()) return;
    if (e.target.closest?.('input, select, textarea, [contenteditable]') || e.ctrlKey || e.metaKey) return;
    if (document.querySelector('dialog[open]')) return;
    const key = e.key.toLowerCase();
    const actions = {
      r: () => $('#y-rec').click(),
      ' ': () => (ui.rec ? stopRecording() : $('#y-play').click()),
      escape: () => ui.rec && stopRecording({ keep: false }),
      a: () => document.querySelector('[data-listen="a"]').click(),
      b: () => document.querySelector('[data-listen="b"]').click(),
    };
    if (actions[key]) {
      e.preventDefault();
      if (e.target instanceof HTMLButtonElement) e.target.blur();
      actions[key]();
    }
  });

  requestAnimationFrame(frame);

  return {
    show() {
      ui.visible = true;
      $('#y-project').textContent = project()?.name || '';
      render();
      syncDeck();
    },
    hide() {
      ui.visible = false;
      if (ui.rec) stopRecording({ keep: false });
    },
    // Projet fermé / changé : on vide la platine.
    reset() {
      if (ui.rec) stopRecording({ keep: false });
      deck.clear();
      audio.clear();
      placedCache.clear();
    },
    // Grille changée (BPM, « 1 ») : les placements sont à refaire.
    gridChanged() {
      if (ui.visible) render();
    },
    takeMap: (id) => {
      const t = takeById(id);
      return t ? { take: t, placed: placed(t), map: mapOf(t) } : null;
    },
  };
}
