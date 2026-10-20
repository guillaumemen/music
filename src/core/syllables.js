// Comptage des syllabes en français, pensé pour le rap (fonctions pures).
//
// Le résultat est une plage min–max : le « e » muet se dit ou s'avale (« samedi » = 2 ou 3,
// « je sais » = « j'sais »), une diérèse peut ajouter une syllabe (« passion » = 2 ou 3).
// L'élision écrite (« j'suis », « p'tit ») est comptée telle qu'elle est écrite.
// C'est un outil de comptage : il ne propose aucun mot.

const VOWELS = 'aeiouyàâäéèêëîïôöûùüœæ';
const isVowel = (c) => !!c && VOWELS.includes(c);

// Voyelles écrites à plusieurs lettres qui ne font qu'un son (les plus longues d'abord).
const DIGRAPHS = ['oeu', 'œu', 'eau', 'eui', 'œi', 'uei', 'oui', 'ai', 'ay', 'ei', 'ey', 'au', 'eu', 'ou', 'oi', 'oy', 'ui', 'œ'];
// Unités qui peuvent glisser sur la voyelle suivante (i, u, ou, y) : « bien », « jouer », « nation ».
const GLIDES = new Set(['i', 'u', 'ou', 'y']);
// Groupes de consonnes qu'on ne coupe pas (« ta-ble », « ou-vrir »).
const CLUSTERS = new Set(['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tr', 'vr', 'ch', 'ph', 'th', 'gn']);
// Petits mots dont le « e » s'avale souvent en rap : « je sais » -> « j'sais ».
// Pour l'affichage seulement : « qu », « gu », « ge », « ce » restent avec la voyelle qui suit.
const DISPLAY_CLUSTERS = new Set([...CLUSTERS, 'qu', 'gu', 'ge', 'ce']);
const ELIDABLE = new Set(['je', 'me', 'te', 'se', 'le', 'ne', 'de', 'que', 'ce']);

// Découpe un groupe de voyelles en unités sonores.
function vowelUnits(run) {
  const units = [];
  let i = 0;
  while (i < run.length) {
    const d = DIGRAPHS.find((g) => run.startsWith(g, i));
    const u = d || run[i];
    units.push(u);
    i += u.length;
  }
  return units;
}

// Noyaux (voyelles prononcées) d'un mot. Chaque noyau : { start, end, optional, extra }.
// optional : peut s'avaler (e muet) ; extra : peut compter double (diérèse).
function nuclei(word, { beforeVowel = false, lineEnd = false, afterIls = false } = {}) {
  // « qu » / « gu » devant voyelle : le u ne se prononce pas. « ge » devant a/o/u : e muet.
  const w = word
    .replace(/q(u)(?=[aeiouyàâéèêîïôûœ])/g, 'q_')
    .replace(/g(u)(?=[eéèêiîy])/g, 'g_')
    .replace(/([gc])e(?=[aoauâô])/g, '$1_')
    // « y » en début de mot devant une voyelle est une consonne (« yeux », « yaourt »).
    .replace(/^y(?=[aeiouàâéèêîôû])/, 'j');
  const runs = [];
  for (let i = 0; i < w.length; ) {
    if (isVowel(w[i])) {
      let j = i;
      while (j < w.length && isVowel(w[j])) j++;
      runs.push({ start: i, text: w.slice(i, j) });
      i = j;
    } else i++;
  }

  const out = [];
  const tailAfter = (end) => w.slice(end);
  for (const run of runs) {
    let pos = run.start;
    const runEnd = run.start + run.text.length;
    // « e » final collé à une voyelle (« vie », « joue ») : unité à part, jamais une diérèse.
    const finalE = run.text.length > 1 && run.text.endsWith('e') && ['', 's'].includes(tailAfter(runEnd));
    const units = finalE ? [...vowelUnits(run.text.slice(0, -1)), 'e'] : vowelUnits(run.text);
    for (let k = 0; k < units.length; k++) {
      const u = units[k];
      const nextU = units[k + 1];
      const nextIsFinalE = finalE && k + 1 === units.length - 1;
      if (nextU && !nextIsFinalE && GLIDES.has(u) && !'ïü'.includes(nextU[0])) {
        // Glissement : une syllabe, ou deux en diérèse. On fusionne avec la suivante.
        out.push({ start: pos, end: pos + u.length + nextU.length, optional: false, extra: true, unit: u + nextU });
        pos += u.length + nextU.length;
        k++;
        continue;
      }
      out.push({ start: pos, end: pos + u.length, optional: false, extra: false, unit: u });
      pos += u.length;
    }
  }
  if (!out.length) return { nuclei: [], w };

  // « e » final (e, es, et verbes en -ent après « ils / elles »).
  const last = out[out.length - 1];
  const tail = w.slice(last.end);
  const endsMute =
    last.unit === 'e' &&
    (tail === '' || tail === 's' || (tail === 'nt' && afterIls)) &&
    last.start > 0;
  if (endsMute) {
    const afterVowel = isVowel(w[last.start - 1]);
    if (out.length === 1) {
      // Mot d'une seule syllabe (« je », « le », « que ») : prononcé, ou avalé pour les petits mots.
      if (ELIDABLE.has(word) && tail === '') last.optional = true;
    } else if (afterVowel) {
      out.pop(); // « vie », « joue », « année » : le e final ne se dit pas
    } else if (beforeVowel && tail === '') {
      out.pop(); // élision devant une voyelle : « elle a » = « el-l'a »
    } else {
      last.optional = true; // « la vill(e) », « ils chant(ent) »
      last.final = true;
    }
  }

  // « e » muet à l'intérieur : consonne simple de chaque côté (« sam(e)di », « p(e)tit »).
  const consonantsBetween = (a, b) => w.slice(a, b).replace(/_/g, '');
  for (let k = 0; k < out.length - 1; k++) {
    const n = out[k];
    if (n.unit !== 'e') continue;
    const before = consonantsBetween(k > 0 ? out[k - 1].end : 0, n.start);
    const after = consonantsBetween(n.end, out[k + 1].start);
    const single = (c) => c.length === 1 || CLUSTERS.has(c);
    if (single(before) && after.length === 1 && after !== 'x') n.optional = true;
  }
  return { nuclei: out, w };
}

// Découpe d'affichage en syllabes écrites (« sa·me·di »).
function chunksOf(word, list) {
  if (!list.length) return [{ text: word, optional: false }];
  const cuts = [0];
  for (let k = 1; k < list.length; k++) {
    const from = list[k - 1].end, to = list[k].start;
    const cons = word.slice(from, to);
    let cut;
    if (cons.length <= 1) cut = from;
    else if (DISPLAY_CLUSTERS.has(cons.slice(-2))) cut = to - 2;
    else cut = to - 1;
    cuts.push(Math.max(cut, cuts[cuts.length - 1] + 1));
  }
  return list.map((n, k) => ({
    text: word.slice(k === 0 ? 0 : cuts[k], k + 1 < list.length ? cuts[k + 1] : word.length),
    optional: n.optional,
    extra: n.extra,
  }));
}

const startsWithVowelSound = (w) => !!w && (isVowel(w[0]) || w[0] === 'h');

// Compte une ligne. Retourne { min, max, words: [{ text, chunks }], finalOptional }.
export function countLine(line) {
  const raw = line.toLowerCase().replace(/[’`]/g, "'").match(/[a-zàâäéèêëîïôöûùüçœæ'_-]+/g) || [];
  // Mots de comptage : on coupe aux tirets et aux apostrophes (« j'suis » -> j' + suis).
  const tokens = [];
  for (const r of raw) {
    for (const part of r.split('-')) {
      if (!part) continue;
      const pieces = part.split("'");
      pieces.forEach((p, i) => {
        if (p || i < pieces.length - 1) tokens.push({ text: p + (i < pieces.length - 1 ? "'" : ''), core: p });
      });
    }
  }
  let min = 0, max = 0;
  const words = [];
  tokens.forEach((t, i) => {
    const next = tokens.slice(i + 1).find((x) => x.core);
    const prevWords = tokens.slice(Math.max(0, i - 3), i).map((x) => x.core);
    const { nuclei: list } = nuclei(t.core, {
      beforeVowel: !!next && startsWithVowelSound(next.core),
      lineEnd: !next,
      afterIls: prevWords.some((p) => p === 'ils' || p === 'elles'),
    });
    for (const n of list) {
      max += 1 + (n.extra ? 1 : 0);
      if (!n.optional) min += 1;
    }
    words.push({ text: t.text, chunks: t.core ? chunksOf(t.text, list) : [{ text: t.text, optional: false }], nuclei: list.length });
  });
  const lastWord = [...words].reverse().find((w) => w.nuclei > 0);
  const lastChunk = lastWord?.chunks[lastWord.chunks.length - 1];
  return { min, max, words, finalOptional: !!lastChunk?.optional };
}

// Texte affichable : syllabes séparées par « · », syllabes facultatives entre parenthèses.
export function syllabify(line) {
  return countLine(line)
    .words.map((w) => w.chunks.map((c) => (c.optional ? `(${c.text})` : c.text)).join('·'))
    .join(' ')
    .replace(/' /g, "'");
}

// Compare une ligne à une cible (nombre de syllabes du yaourt dans la mesure).
// Retourne { status: 'ok' | 'presque' | 'long' | 'court', why }.
export function judgeLine(count, target) {
  const { min, max } = count;
  if (!target) return { status: 'none', why: '' };
  if (target >= min && target <= max) {
    return { status: 'ok', why: `Ta ligne fait ${range(count)} syllabes : elle peut tenir les ${target} places de ton yaourt.` };
  }
  if (min > target) {
    const d = min - target;
    return {
      status: d === 1 ? 'presque' : 'long',
      why: `Même en avalant les « e » muets, il reste ${min} syllabes pour ${target} places : ${d === 1 ? 'une syllabe de trop, à serrer' : `${d} syllabes de trop, il faudra accélérer ou déborder sur la mesure suivante`}.`,
    };
  }
  const d = target - max;
  return {
    status: d === 1 ? 'presque' : 'court',
    why: `Au plus ${max} syllabes pour ${target} places : ${d === 1 ? 'une place reste libre' : `${d} places restent libres`} (silence, syllabe tenue, ou flow plus posé que ton yaourt).`,
  };
}

const range = ({ min, max }) => (min === max ? String(min) : `${min} à ${max}`);
export { range as syllableRange };
