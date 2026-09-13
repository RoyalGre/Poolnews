/* =========================================================================
   defi.js — Le défi de la semaine.

   Chaque semaine, les pooleurs prédisent COMMENT les buts de la fin de
   semaine vont se répartir entre trois zones, en pourcentages :

       enclave gauche / enclave droite / partout ailleurs

   Une zone d'enclave = à moins de 34 pi de la ligne de but (x >= 55) et à
   moins de 22 pi de l'axe central. Ces bornes ne sont pas inventées : sur
   les 8 086 buts de data/goals.js elles donnent 37,6 / 42,1 / 20,3 %, et sur
   les 26 fins de semaine jeu/ven/dim de la saison la moyenne tient à
   37,4 / 43,3 / 19,3 avec un écart-type de 6,2 / 6,8 / 3,7. Assez stable
   pour raisonner, assez mouvant pour qu'une bonne semaine batte la moyenne.

   Pointage : l'erreur absolue totale entre les trois pourcentages devinés et
   les trois réels. Le plus petit total gagne. Deviner la moyenne donne un
   score honnête mais rarement gagnant — c'est voulu.

   Les coordonnées sont déjà rabattues vers +x par build-goals.ps1 : peu
   importe le côté réel de la patinoire, tout attaque vers le même but.
   ========================================================================= */

/* ---- Les zones ----------------------------------------------------------
   ry() dessine +y vers le HAUT, alors l'enclave « gauche » (y > 0) est celle
   du haut sur la patinoire, vue depuis le lanceur qui attaque vers la droite.
   Le même repère que la page Pooleurs, pour que les deux se lisent pareil. */
const SLOT_DEPTH = 34;   // pi depuis la ligne de but (89 pi)
const SLOT_HALFW = 22;   // pi de part et d'autre de l'axe
const GOAL_LINE  = 89;

const ZONES = [
  { k: 'g', nom: 'Enclave gauche',   court: 'Gauche' },
  { k: 'd', nom: 'Enclave droite',   court: 'Droite' },
  { k: 'a', nom: 'Partout ailleurs', court: 'Ailleurs' }
];

function zoneOf(g) {
  const x = g.x, y = g.y;
  if (x === undefined || y === undefined || x === null || y === null) return 'a';
  if (x >= GOAL_LINE - SLOT_DEPTH && Math.abs(y) <= SLOT_HALFW) {
    return y > 0 ? 'g' : 'd';
  }
  return 'a';
}

/* ---- Les données des buts ----------------------------------------------
   Mêmes globales que la page Pooleurs. La page doit rester lisible même sans
   goals.js : chaque bloc se retire tout seul si sa source manque. */
const G_DATA = window.NHL_GOALS || null;
const G_LIST = G_DATA ? G_DATA.goals : [];
const G_INFO = G_DATA ? (G_DATA.gameInfo || {}) : {};

function gDate(g) { const m = G_INFO[g.gid]; return m ? m[0] : ''; }

/* ---- La fin de semaine --------------------------------------------------
   Jeudi, vendredi, dimanche. Le samedi est exclu volontairement : c'est le
   gros soir de hockey et il écraserait les trois autres jours à lui seul.
   Une fin de semaine est identifiée par la date de son jeudi. */
const JOURS_DEFI = [4, 5, 0];   // getUTCDay : 0 = dimanche, 4 = jeudi

/* Les dates arrivent en 'YYYY-MM-DD'. On les lit en UTC pour qu'un fuseau
   ne décale pas un match d'un jour. */
function dayOf(iso) {
  const p = iso.split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
}
function isDefiDay(iso) { return iso && JOURS_DEFI.indexOf(dayOf(iso)) >= 0; }

/* Le jeudi qui ouvre la fin de semaine d'une date donnée. Un dimanche
   appartient à la fin de semaine du jeudi qui le précède, pas du suivant. */
function weekendKey(iso) {
  const p = iso.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  const back = (d.getUTCDay() - 4 + 7) % 7;   // recule jusqu'au jeudi
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/* Toutes les fins de semaine jouées, de la plus récente à la plus ancienne. */
function weekends() {
  const m = new Map();
  for (const g of G_LIST) {
    const d = gDate(g);
    if (!isDefiDay(d)) continue;
    const k = weekendKey(d);
    let e = m.get(k);
    if (!e) { e = { key: k, goals: [], days: new Set() }; m.set(k, e); }
    e.goals.push(g);
    e.days.add(d);
  }
  return [...m.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/* Le vrai partage d'une fin de semaine, en pourcentages. */
function splitOf(goals) {
  const c = { g: 0, d: 0, a: 0 };
  for (const x of goals) c[zoneOf(x)]++;
  const t = goals.length || 1;
  return {
    n: goals.length,
    counts: c,
    pct: { g: 100 * c.g / t, d: 100 * c.d / t, a: 100 * c.a / t }
  };
}

/* ---- Pointage ----------------------------------------------------------
   Somme des écarts absolus. Trois pourcentages qui totalisent 100 des deux
   côtés : l'erreur va de 0 (parfait) à 200 (aussi loin que possible). */
function scorePick(pick, pct) {
  return Math.abs(pick.g - pct.g) + Math.abs(pick.d - pct.d) + Math.abs(pick.a - pct.a);
}

/* =========================================================================
   Les prédictions

   TOUTE lecture et écriture des prédictions passe par ici. Aujourd'hui c'est
   data/defi.js (publié à la main, comme data/pool.js) ; demain ce sera
   Firestore. Le reste de la page ne sait pas d'où viennent les prédictions et
   n'a pas à le savoir, alors brancher le serveur ne touchera que ce bloc.
   ========================================================================= */
const PICKS_DATA = window.DEFI_PICKS || null;

/* Les prédictions d'une fin de semaine : [{ name, g, d, a }]. */
function picksFor(key) {
  if (!PICKS_DATA || !PICKS_DATA.weekends) return [];
  const w = PICKS_DATA.weekends[key];
  return Array.isArray(w) ? w : [];
}

/* La date limite : le jeudi à 18 h, heure de l'Est. Une prédiction envoyée
   après ne compte pas — c'est la règle que Firestore appliquera tout seul. */
function lockOf(key) { return key + ' 18:00'; }

/* =========================================================================
   Rendu
   ========================================================================= */
let curKey = null;      // la fin de semaine affichée

function render() {
  const box = $('content');
  box.innerHTML = '';

  if (!G_DATA) {
    const p = el('div', 'panel');
    p.append(el('div', 'empty-state',
      'data/goals.js est absent. Lancez build-goals.ps1 pour calculer les zones.'));
    box.append(p);
    return;
  }

  const list = weekends();
  if (!list.length) {
    const p = el('div', 'panel');
    p.append(el('div', 'empty-state',
      'Aucune partie de jeudi, vendredi ou dimanche dans les données.'));
    box.append(p);
    return;
  }

  if (!curKey || !list.some(w => w.key === curKey)) curKey = list[0].key;
  const cur = list.find(w => w.key === curKey);
  const sp  = splitOf(cur.goals);

  box.append(buildToolbar(list, cur));
  box.append(buildRules());

  const split = el('div', 'df-split');
  split.append(buildRink(cur, sp));
  split.append(buildBoard(cur, sp));
  box.append(split);
}

/* ---- La barre d'outils : quelle fin de semaine ------------------------- */
function buildToolbar(list, cur) {
  const bar = el('div', 'toolbar');

  const nav = el('span', 'pl-nav');
  const i = list.findIndex(w => w.key === cur.key);

  const prev = el('button', null, '‹');
  prev.title = 'Fin de semaine précédente';
  prev.disabled = i >= list.length - 1;
  prev.onclick = () => { curKey = list[i + 1].key; render(); };

  const next = el('button', null, '›');
  next.title = 'Fin de semaine suivante';
  next.disabled = i <= 0;
  next.onclick = () => { curKey = list[i - 1].key; render(); };

  nav.append(prev, next);

  const sel = el('select');
  list.forEach(w => {
    const o = el('option', null, labelOf(w));
    o.value = w.key;
    sel.append(o);
  });
  sel.value = cur.key;
  sel.onchange = () => { curKey = sel.value; render(); };

  bar.append(nav, sel, el('span', 'grow'));
  const nj = cur.days.size;
  bar.append(el('span', 'hint',
    cur.goals.length + ' buts · ' + nj + (nj > 1 ? ' jours' : ' jour')));
  return bar;
}

function labelOf(w) {
  const p = w.key.split('-');
  return 'Fin de semaine du ' + p[2] + '/' + p[1];
}

/* ---- Les règles, dites une fois ---------------------------------------- */
function buildRules() {
  const p = el('div', 'panel');
  p.append(el('h2', null, 'La règle'));
  const d = el('div', 'prose');
  d.innerHTML =
    'Devinez comment les buts du <b>jeudi, vendredi et dimanche</b> vont se ' +
    'partager entre les trois zones — en pourcentages qui totalisent 100. ' +
    'Une <b>enclave</b> va jusqu\'à ' + SLOT_DEPTH + ' pi de la ligne de but et ' +
    SLOT_HALFW + ' pi de chaque côté de l\'axe. Le pointage est la somme des ' +
    'trois écarts : <b>le plus petit total gagne</b>. Sur la saison, le partage ' +
    'tourne autour de <b>37 / 43 / 19</b> — deviner la moyenne est honnête, ' +
    'mais rarement gagnant. Les prédictions ferment le <b>jeudi à 18 h</b>.';
  p.append(d);
  return p;
}

/* ---- La patinoire, avec les trois zones -------------------------------- */
const DF_RINK = { pad: 26, w: 640, h: 400 };
DF_RINK.iw = DF_RINK.w - DF_RINK.pad * 2;
DF_RINK.ih = DF_RINK.h - DF_RINK.pad * 2;
DF_RINK.fx = DF_RINK.iw / 100;
DF_RINK.fy = DF_RINK.ih / 85;
const dx = ft => DF_RINK.pad + ft * DF_RINK.fx;
const dy = ft => DF_RINK.pad + (42.5 - ft) * DF_RINK.fy;

const DFNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs) {
  const e = document.createElementNS(DFNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function buildRink(w, sp) {
  const p = el('div', 'panel');
  p.append(el('h2', null, 'Où les buts sont allés'));

  const holder = el('div', 'rink-holder');
  const svg = sv('svg', {
    class: 'rink', viewBox: '0 0 ' + DF_RINK.w + ' ' + DF_RINK.h,
    role: 'img', 'aria-label': 'Les buts de la fin de semaine par zone'
  });

  // La glace, comme sur la page Pooleurs : moitié offensive seulement.
  const r = 20 * DF_RINK.fy;
  const x0 = dx(0), x1 = dx(100), yT = dy(42.5), yB = dy(-42.5);
  svg.append(sv('path', {
    d: 'M ' + x0 + ' ' + yT + ' H ' + (x1 - r) +
       ' A ' + r + ' ' + r + ' 0 0 1 ' + x1 + ' ' + (yT + r) +
       ' V ' + (yB - r) +
       ' A ' + r + ' ' + r + ' 0 0 1 ' + (x1 - r) + ' ' + yB + ' H ' + x0 + ' Z',
    fill: 'var(--rink-ice)', stroke: 'var(--rink-board)', 'stroke-width': 2.5
  }));

  // Les deux enclaves, peintes avant les lignes pour rester dessous.
  const zx = dx(GOAL_LINE - SLOT_DEPTH);
  const zw = dx(GOAL_LINE) - zx;
  svg.append(sv('rect', { x: zx, y: dy(SLOT_HALFW), width: zw,
    height: dy(0) - dy(SLOT_HALFW), class: 'df-zone df-zg' }));
  svg.append(sv('rect', { x: zx, y: dy(0), width: zw,
    height: dy(0) - dy(SLOT_HALFW), class: 'df-zone df-zd' }));

  svg.append(sv('line', { x1: dx(89), y1: yT + 1, x2: dx(89), y2: yB - 1,
    stroke: 'var(--rink-red)', 'stroke-width': 2 }));
  svg.append(sv('line', { x1: dx(25), y1: yT, x2: dx(25), y2: yB,
    stroke: 'var(--rink-blue)', 'stroke-width': 6 }));
  svg.append(sv('line', { x1: dx(0), y1: yT, x2: dx(0), y2: yB,
    stroke: 'var(--rink-red)', 'stroke-width': 6 }));
  svg.append(sv('path', {
    d: 'M ' + dx(89) + ' ' + dy(4) + ' A ' + (6 * DF_RINK.fx) + ' ' + (4 * DF_RINK.fy) +
       ' 0 0 0 ' + dx(89) + ' ' + dy(-4) + ' Z',
    fill: 'var(--rink-crease)', stroke: 'var(--rink-red)', 'stroke-width': 1.2
  }));

  // Un point par but, éventail compris : les coordonnées sont au pied près,
  // alors une dizaine de buts se cacheraient sous un seul point.
  const stack = new Map();
  for (const g of w.goals) {
    const key = g.x + ',' + g.y;
    const n = stack.get(key) || 0;
    stack.set(key, n + 1);
    const ang = n * 2.39996, rad = n ? 2.4 * Math.sqrt(n) : 0;
    svg.append(sv('circle', {
      cx: dx(g.x) + Math.cos(ang) * rad,
      cy: dy(g.y) + Math.sin(ang) * rad,
      r: 3.6, class: 'df-goal df-' + zoneOf(g)
    }));
  }

  // L'étiquette de chaque zone, posée sur la glace.
  svg.append(lbl(dx(72), dy(11),  sp.pct.g, 'Gauche'));
  svg.append(lbl(dx(72), dy(-11), sp.pct.d, 'Droite'));
  svg.append(lbl(dx(30), dy(32),  sp.pct.a, 'Ailleurs'));

  holder.append(svg);
  p.append(holder);
  return p;
}

function lbl(x, y, pct, nom) {
  const g = sv('g', {});
  const t = sv('text', { x: x, y: y, class: 'df-lbl', 'text-anchor': 'middle' });
  t.textContent = pct.toFixed(1) + ' %';
  const s = sv('text', { x: x, y: y + 15, class: 'df-lbl-s', 'text-anchor': 'middle' });
  s.textContent = nom;
  g.append(t, s);
  return g;
}

/* ---- Le tableau : le vrai partage, puis les prédictions ---------------- */
function buildBoard(w, sp) {
  const wrap = el('div');

  const p = el('div', 'panel');
  p.append(el('h2', null, 'Le partage réel'));
  ZONES.forEach(z => {
    const row = el('div', 'df-bar');
    row.append(el('span', 'df-bk', z.court));
    const track = el('span', 'df-track');
    const fill = el('span', 'df-fill df-f' + z.k);
    fill.style.width = sp.pct[z.k].toFixed(1) + '%';
    track.append(fill);
    row.append(track);
    row.append(el('span', 'df-bv', sp.pct[z.k].toFixed(1) + ' %'));
    row.append(el('span', 'df-bn', '(' + sp.counts[z.k] + ')'));
    p.append(row);
  });
  wrap.append(p);

  wrap.append(buildPicks(w, sp));
  return wrap;
}

function buildPicks(w, sp) {
  const p = el('div', 'panel');
  p.append(el('h2', null, 'Les prédictions'));

  const rows = picksFor(w.key).map(pk => ({
    name:  pk.name,
    pick:  pk,
    score: scorePick(pk, sp.pct)
  })).sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));

  if (!rows.length) {
    p.append(el('div', 'empty-state',
      'Aucune prédiction pour cette fin de semaine. Les prédictions ferment le jeudi à 18 h.'));
    return p;
  }

  const t = el('table', 'standings');
  const head = el('tr');
  ['', 'Pooleur', 'G', 'D', 'A', 'Écart'].forEach((h, i) => {
    head.append(el('th', i >= 2 ? 'right' : null, h));
  });
  const thead = el('thead');
  thead.append(head);
  t.append(thead);

  const tb = el('tbody');
  rows.forEach((r, i) => {
    const tr = el('tr');
    tr.append(el('td', 'rank' + (i < 3 ? ' r' + (i + 1) : ''), String(i + 1)));
    tr.append(el('td', null, r.name));
    ZONES.forEach(z => tr.append(el('td', 'right num-cell', r.pick[z.k] + ' %')));
    tr.append(el('td', 'right num-cell', r.score.toFixed(1)));
    tb.append(tr);
  });
  t.append(tb);

  const tw = el('div', 'tablewrap');
  tw.append(t);
  p.append(tw);
  p.append(el('p', 'hint',
    'Écart = somme des trois différences avec le partage réel. Le plus petit gagne.'));
  return p;
}

/* ---- Go ---------------------------------------------------------------- */
wireThemeToggle();
wirePublishedBadge();
renderStamp(G_DATA ? (G_LIST.length.toLocaleString('fr-CA') + ' buts localisés') : null);
render();
