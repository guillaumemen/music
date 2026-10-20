// Écran Texte : le texte collé ligne par ligne sur la grille (une ligne = une mesure).
// Comptage des syllabes (plage min–max), comparaison avec le yaourt, alertes trop long / trop court
// / accent mal placé, avec le pourquoi. Aucun mot n'est proposé : l'app compte et place.
import { countLine, judgeLine, syllableRange } from '../core/syllables.js';

const $ = (sel) => document.querySelector(sel);
const STATUS = {
  ok: ['ok', 'Ça rentre'],
  presque: ['mid', 'Presque'],
  long: ['bad', 'Trop long'],
  court: ['bad', 'Trop court'],
  accent: ['mid', 'Accent décalé'],
  none: ['', ''],
  empty: ['', 'Mesure vide'],
};

// app : { state, saveSoon, sections, yaourt (takeMap), grid }
export function initTexte(app) {
  const project = () => app.state.project;
  const text = () => {
    const p = project();
    p.text = { body: '', startBar: 1, takeId: '', target: 8, ...(p.text || {}) };
    return p.text;
  };

  // Syllabes écrites posées sur les syllabes du yaourt : on garde d'abord les syllabes
  // obligatoires, puis autant de « e » muets que nécessaire (ceux du milieu en premier).
  function align(count, n) {
    const chunks = count.words.flatMap((w) => w.chunks.filter((c) => c.text.replace(/['_]/g, '').length && /[aeiouyàâäéèêëîïôöûùüœæ]/.test(c.text)));
    let extra = Math.max(0, n - count.min);
    const optIdx = chunks.map((c, i) => (c.optional ? i : -1)).filter((i) => i >= 0);
    // Les e muets de fin de ligne en dernier.
    optIdx.sort((a, b) => (a === chunks.length - 1) - (b === chunks.length - 1) || a - b);
    const keep = new Set(optIdx.slice(0, extra));
    const kept = chunks.filter((c, i) => !c.optional || keep.has(i));
    // Tonique : dernière syllabe non muette.
    let tonic = -1;
    kept.forEach((c, i) => {
      if (!c.optional) tonic = i;
    });
    return { kept, tonic };
  }

  function takeBars() {
    const id = text().takeId;
    const info = id ? app.yaourt.takeMap(id) : null;
    if (!info) return null;
    const bars = new Map();
    for (const s of info.placed) {
      if (!bars.has(s.bar)) bars.set(s.bar, []);
      bars.get(s.bar).push(s);
    }
    return { take: info.take, bars };
  }

  function renderSetup() {
    const t = text();
    const p = project();
    const takeSel = $('#t-take');
    takeSel.replaceChildren(
      Object.assign(document.createElement('option'), { value: '', textContent: 'Aucune prise : cible fixe' }),
      ...(p.takes || []).map((tk) => Object.assign(document.createElement('option'), { value: tk.id, textContent: `${tk.name} (mes. ${tk.region.startBar}–${tk.region.endBar})` })),
    );
    if (t.takeId && !(p.takes || []).some((tk) => tk.id === t.takeId)) t.takeId = '';
    takeSel.value = t.takeId;
    $('#t-target-wrap').hidden = !!t.takeId;
    $('#t-target').value = String(t.target);
    $('#t-start').value = String(t.startBar);
    const secSel = $('#t-section');
    secSel.replaceChildren(
      Object.assign(document.createElement('option'), { value: '', textContent: 'Caler sur une section…' }),
      ...app.sections().map((r) => Object.assign(document.createElement('option'), { value: String(r.startBar), textContent: `${r.label || 'Sans nom'} (mes. ${r.startBar})` })),
    );
    secSel.value = '';
    if (document.activeElement !== $('#t-text')) $('#t-text').value = t.body;
  }

  function renderLines() {
    const t = text();
    const list = $('#t-lines');
    list.replaceChildren();
    const lines = t.body.replace(/\s+$/, '').split('\n');
    const tb = takeBars();
    const tally = { ok: 0, presque: 0, long: 0, court: 0, accent: 0 };
    if (!t.body.trim()) {
      $('#t-summary').textContent = 'Écris ou colle ton texte à gauche : une ligne par mesure (une ligne vide = une mesure sans texte).';
      return;
    }
    lines.forEach((line, i) => {
      const bar = t.startBar + i;
      const li = document.createElement('li');
      const count = countLine(line);
      const sylls = tb?.bars.get(bar) || [];
      const target = tb ? sylls.length : t.target;
      let status, why;
      if (!line.trim()) {
        status = 'empty';
        why = tb && sylls.length ? `Ton yaourt a ${sylls.length} syllabes sur cette mesure.` : '';
      } else if (tb && !sylls.length) {
        status = 'none';
        why = tb.take.region.startBar <= bar && bar <= tb.take.region.endBar ? 'Ton yaourt est silencieux sur cette mesure.' : 'Pas de yaourt sur cette mesure (hors de la prise).';
      } else {
        ({ status, why } = judgeLine(count, target));
      }
      // Accent : la dernière syllabe forte de la ligne doit tomber sur un accent du yaourt.
      let aligned = null;
      if (tb && sylls.length && status === 'ok') {
        aligned = align(count, sylls.length);
        const hasAccent = sylls.some((s) => s.accent);
        const tonicSyl = sylls[aligned.tonic];
        if (hasAccent && tonicSyl && !tonicSyl.accent) {
          status = 'accent';
          const k = sylls.findLastIndex((s) => s.accent) + 1;
          why = `La dernière syllabe forte de ta ligne (« ${aligned.kept[aligned.tonic].text} ») tombe sur une syllabe faible du yaourt, qui accentue la syllabe n° ${k}. En français, l'accent naturel est en fin de groupe de mots : quand les deux coïncident, la ligne sonne plus naturelle.`;
        }
      } else if (tb && sylls.length) aligned = align(count, sylls.length);
      if (tally[status] !== undefined) tally[status]++;

      const [cls, label] = STATUS[status];
      li.className = `t-line ${cls}`;
      const head = document.createElement('div');
      head.className = 't-head';
      const barEl = document.createElement('span');
      barEl.className = 't-bar';
      barEl.textContent = `mes. ${bar}`;
      const syl = document.createElement('span');
      syl.className = 't-syl';
      for (const w of count.words) {
        const word = document.createElement('span');
        word.className = 'w';
        w.chunks.forEach((c, k) => {
          if (k) word.append('·');
          const el = document.createElement('span');
          if (c.optional) el.className = 'opt';
          el.textContent = c.text;
          word.append(el);
        });
        syl.append(word, w.text.endsWith("'") ? '' : ' ');
      }
      if (!line.trim()) syl.textContent = '—';
      head.append(barEl, syl);
      if (label) {
        const chip = document.createElement('span');
        chip.className = `badge ${cls}`;
        chip.textContent = label;
        head.append(chip);
      }
      li.append(head);

      if (line.trim()) {
        const meta = document.createElement('div');
        meta.className = 'small dim';
        meta.textContent = `${syllableRange(count)} syllabe${count.max > 1 ? 's' : ''}${target ? ` · ${tb ? 'yaourt' : 'cible'} : ${target}` : ''}`;
        li.append(meta);
      }

      // Bande 16 cases : syllabes du yaourt, étiquetées avec celles du texte quand ça rentre.
      if (tb && sylls.length) {
        const strip = document.createElement('div');
        strip.className = 't-strip';
        for (let k = 0; k < 4; k++) {
          const beat = document.createElement('span');
          beat.className = 'beat';
          beat.style.left = `${k * 25}%`;
          beat.textContent = String(k + 1);
          strip.append(beat);
        }
        sylls.forEach((s, k) => {
          const el = document.createElement('span');
          el.className = `syl ${s.timing}${s.accent ? ' accent' : ''}`;
          el.style.left = `${Math.max(3, Math.min(97, ((s.pos + 0.5) / 16) * 100))}%`;
          el.textContent = aligned?.kept[k]?.text || '•';
          el.title = `Syllabe ${k + 1} du yaourt${s.accent ? ' (accent)' : ''}`;
          strip.append(el);
        });
        li.append(strip);
      }

      if (why) {
        const p = document.createElement('p');
        p.className = 'small t-why';
        p.textContent = why;
        li.append(p);
      }
      list.append(li);
    });
    const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
    const parts = [
      `${pl(lines.length, 'ligne', 'lignes')} (mes. ${t.startBar} à ${t.startBar + lines.length - 1})`,
      tally.ok && pl(tally.ok, 'qui rentre', 'qui rentrent'),
      tally.presque && `${tally.presque} à une syllabe près`,
      tally.long && pl(tally.long, 'trop longue', 'trop longues'),
      tally.court && pl(tally.court, 'trop courte', 'trop courtes'),
      tally.accent && pl(tally.accent, 'accent décalé', 'accents décalés'),
    ].filter(Boolean);
    $('#t-summary').textContent = parts.join(' · ') + '.';
  }

  let timer = null;
  $('#t-text').addEventListener('input', (e) => {
    text().body = e.target.value;
    app.saveSoon();
    clearTimeout(timer);
    timer = setTimeout(renderLines, 120);
  });
  $('#t-take').onchange = (e) => {
    const t = text();
    t.takeId = e.target.value;
    t.takeChosen = true;
    const tk = project().takes.find((x) => x.id === t.takeId);
    if (tk) t.startBar = tk.region.startBar; // le texte démarre là où démarre la prise
    app.saveSoon();
    renderSetup();
    renderLines();
  };
  $('#t-start').onchange = (e) => {
    text().startBar = Math.max(1, Math.round(Number(e.target.value) || 1));
    app.saveSoon();
    renderSetup();
    renderLines();
  };
  $('#t-section').onchange = (e) => {
    if (!e.target.value) return;
    text().startBar = Number(e.target.value);
    app.saveSoon();
    renderSetup();
    renderLines();
  };
  $('#t-target').onchange = (e) => {
    text().target = Math.max(1, Math.round(Number(e.target.value) || 8));
    app.saveSoon();
    renderLines();
  };

  return {
    show() {
      if (!project()) return;
      const t = text();
      // Par défaut, on compare à la prise A du yaourt.
      if (!t.takeId && !t.takeChosen && project().yaourt?.a) {
        t.takeId = project().yaourt.a;
        const tk = (project().takes || []).find((x) => x.id === t.takeId);
        if (tk) t.startBar = tk.region.startBar;
      }
      renderSetup();
      renderLines();
    },
  };
}
