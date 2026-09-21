/* =========================================================================
   poolers.js — la page personnelle de chaque pooleur.

   Le classement dit QUI mène. Cette page dit D'OÙ viennent les points : le
   pooleur choisit sa semaine, et chaque but auquel son alignement a touché
   est tracé sur la patinoire, à l'endroit exact du tir.

   Deux nuances que le reste du site n'a pas à gérer :

     * Le pool compte les buts ET les passes. Une rondelle n'est donc pas
       « un but de mon joueur » mais « un but où mon joueur a récolté un
       point » — souvent un tir décoché par quelqu'un d'autre.

     * Un même but peut valoir deux points quand deux joueurs du même
       alignement y touchent (le buteur et son passeur). Compter les buts
       plutôt que les rôles donnerait un total trop bas.

   Les coordonnées viennent de data/goals.js (build-goals.ps1), déjà
   normalisées : chaque tir attaque vers +x, peu importe le côté réel.
   ========================================================================= */

const GOALS_DATA = window.NHL_GOALS || null;

/* ---- Index des buts ----------------------------------------------------
   Un seul passage sur les ~8 000 buts pour savoir, pour chaque joueur, les
   buts où il a marqué et ceux où il a aidé. Tout le reste de la page lit
   ensuite cet index au lieu de rebalayer la liste. */
const BY_PLAYER = new Map();   // playerId -> [{ gi, role }]
const GOAL_LIST = GOALS_DATA ? GOALS_DATA.goals : [];
const GAME_INFO = GOALS_DATA ? (GOALS_DATA.gameInfo || {}) : {};
const CLIP_PRE  = GOALS_DATA ? (GOALS_DATA.clipPrefix || '') : '';

function noteRole(pid, gi, role) {
  if (!pid) return;
  let arr = BY_PLAYER.get(pid);
  if (!arr) { arr = []; BY_PLAYER.set(pid, arr); }
  arr.push({ gi, role });
}
GOAL_LIST.forEach((g, i) => {
  noteRole(g.s,  i, 'B');     // but
  noteRole(g.a1, i, 'P');     // passe
  noteRole(g.a2, i, 'P');
});

/* La date d'un but vit dans la table des matchs, pas sur le but lui-même. */
function goalDate(g)    { const m = GAME_INFO[g.gid]; return m ? m[0] : ''; }
function goalMatchup(g) { const m = GAME_INFO[g.gid]; return m ? m[1] : ''; }
function goalClip(g)    { return g.c ? CLIP_PRE + g.c : null; }

/* ---- Semaines ----------------------------------------------------------
   history.js donne des totaux cumulatifs « au » dimanche de chaque semaine.
   Une semaine couvre donc les jours qui suivent la borne précédente, jusqu'à
   la sienne inclusivement. */
function weekWindow(wi) {
  const end   = WEEKS[wi] ? WEEKS[wi].d : null;
  const start = wi > 0 ? WEEKS[wi - 1].d : null;
  return { start, end };
}

function inWindow(dateStr, win) {
  if (!dateStr) return false;
  if (win.end && dateStr > win.end) return false;
  if (win.start && dateStr <= win.start) return false;
  if (!win.start && win.end && dateStr > win.end) return false;
  return true;
}

/* ---- État de la page ---------------------------------------------------- */
let curPooler = null;     // objet pooleur
let curWeek   = null;     // index 0-based, ou -1 pour « toute la saison »
let curPlayer = null;     // playerId isolé, ou null
let curRole   = 'tous';   // tous | B | P
let curDay    = null;     // 'YYYY-MM-DD' isolé, ou null

const PAGE_KEY = 'hockeyPool.poolersView';

function saveView() {
  try {
    localStorage.setItem(PAGE_KEY, JSON.stringify({
      pooler: curPooler ? curPooler.id : null, week: curWeek
    }));
  } catch (e) { }
}
function loadView() {
  try { return JSON.parse(localStorage.getItem(PAGE_KEY)) || {}; }
  catch (e) { return {}; }
}

/* =========================================================================
   Calcul : les points d'un alignement sur une fenêtre
   ========================================================================= */
function collect(pooler, win) {
  const owned = new Set(pooler.picks.filter(id => id !== null));
  const byGoal = new Map();      // indice du but -> [{ pid, role }]

  owned.forEach(pid => {
    const hits = BY_PLAYER.get(pid);
    if (!hits) return;
    for (const h of hits) {
      const g = GOAL_LIST[h.gi];
      if (!inWindow(goalDate(g), win)) continue;
      let roles = byGoal.get(h.gi);
      if (!roles) { roles = []; byGoal.set(h.gi, roles); }
      roles.push({ pid, role: h.role });
    }
  });

  const events = [];
  byGoal.forEach((roles, gi) => {
    // Buteur d'abord : c'est lui qui décide de l'allure de la rondelle.
    roles.sort((a, b) => (a.role === 'B' ? -1 : 1) - (b.role === 'B' ? -1 : 1));
    events.push({ gi, g: GOAL_LIST[gi], roles });
  });
  events.sort((a, b) => {
    const da = goalDate(a.g), db = goalDate(b.g);
    return da.localeCompare(db) || a.g.gid - b.g.gid || a.g.p - b.g.p ||
           String(a.g.tm).localeCompare(String(b.g.tm));
  });
  return events;
}

/* Total attendu selon history.js — sert de vérification croisée. */
function expectedPoints(pooler, wi) {
  if (!HISTORY || wi < 0 || !WEEKS[wi]) return null;
  const w = WEEKS[wi], prev = wi > 0 ? WEEKS[wi - 1] : null;
  let t = 0;
  for (const pid of pooler.picks) {
    if (pid === null) continue;
    const j = HIST_COL.get(pid);
    if (j === undefined) continue;
    t += (w.g[j] + w.a[j]) - (prev ? (prev.g[j] + prev.a[j]) : 0);
  }
  return t;
}

/* =========================================================================
   Patinoire
   Glace réglementaire : 200 x 85 pi. On dessine la moitié offensive, de la
   ligne rouge centrale (x = 0) jusqu'à la bande de fond (x = 100).
   ========================================================================= */
const RINK = { pad: 26, w: 640, h: 400 };
RINK.iw = RINK.w - RINK.pad * 2;
RINK.ih = RINK.h - RINK.pad * 2;
RINK.fx = RINK.iw / 100;
RINK.fy = RINK.ih / 85;
const rx = ft => RINK.pad + ft * RINK.fx;
const ry = ft => RINK.pad + (42.5 - ft) * RINK.fy;

function drawRink(svg) {
  const g = svgEl2('g', {});
  const r = 20 * RINK.fy;
  const x0 = rx(0), x1 = rx(100), yT = ry(42.5), yB = ry(-42.5);

  g.append(svgEl2('path', {
    d: 'M ' + x0 + ' ' + yT + ' H ' + (x1 - r) +
       ' A ' + r + ' ' + r + ' 0 0 1 ' + x1 + ' ' + (yT + r) +
       ' V ' + (yB - r) +
       ' A ' + r + ' ' + r + ' 0 0 1 ' + (x1 - r) + ' ' + yB + ' H ' + x0 + ' Z',
    fill: 'var(--rink-ice)', stroke: 'var(--rink-board)', 'stroke-width': 2.5
  }));

  // ligne de but (89 pi), ligne bleue (25 pi), ligne rouge centrale
  g.append(svgEl2('line', { x1: rx(89), y1: yT + 1, x2: rx(89), y2: yB - 1,
    stroke: 'var(--rink-red)', 'stroke-width': 2 }));
  g.append(svgEl2('line', { x1: rx(25), y1: yT, x2: rx(25), y2: yB,
    stroke: 'var(--rink-blue)', 'stroke-width': 6 }));
  g.append(svgEl2('line', { x1: rx(0), y1: yT, x2: rx(0), y2: yB,
    stroke: 'var(--rink-red)', 'stroke-width': 6 }));

  // trapèze derrière le filet
  g.append(svgEl2('path', {
    d: 'M ' + rx(89) + ' ' + ry(11) + ' L ' + rx(100) + ' ' + ry(14) +
       ' M ' + rx(89) + ' ' + ry(-11) + ' L ' + rx(100) + ' ' + ry(-14),
    stroke: 'var(--rink-red)', 'stroke-width': 1.2, fill: 'none', opacity: .6
  }));

  // le demi-cercle du gardien bombe vers le centre ; le filet est derrière
  g.append(svgEl2('path', {
    d: 'M ' + rx(89) + ' ' + ry(4) + ' A ' + (6 * RINK.fx) + ' ' + (4 * RINK.fy) +
       ' 0 0 0 ' + rx(89) + ' ' + ry(-4) + ' Z',
    fill: 'var(--rink-crease)', stroke: 'var(--rink-red)', 'stroke-width': 1.2
  }));
  g.append(svgEl2('rect', { x: rx(89), y: ry(3), width: 4 * RINK.fx, height: 6 * RINK.fy,
    fill: 'var(--rink-ice2)', stroke: 'var(--rink-board)', 'stroke-width': 1.6 }));

  // cercles de mise au jeu et points de la zone neutre
  [22, -22].forEach(y => {
    g.append(svgEl2('circle', { cx: rx(69), cy: ry(y), r: 15 * RINK.fy,
      fill: 'none', stroke: 'var(--rink-red)', 'stroke-width': 1.3, opacity: .75 }));
    g.append(svgEl2('circle', { cx: rx(69), cy: ry(y), r: 3.2, fill: 'var(--rink-red)' }));
    g.append(svgEl2('circle', { cx: rx(20), cy: ry(y), r: 3.2, fill: 'var(--rink-red)', opacity: .75 }));
  });

  svg.append(g);
}

const SVGNS2 = 'http://www.w3.org/2000/svg';
function svgEl2(tag, attrs) {
  const e = document.createElementNS(SVGNS2, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

/* =========================================================================
   Rendu
   ========================================================================= */
function render() {
  const box = $('content');
  box.innerHTML = '';

  // Pas un but marque : la patinoire serait vide et les alignements aussi.
  // Le dire vaut mieux que d'afficher les buts de l'an dernier.
  if (seasonNotStarted()) {
    box.append(seasonPendingPanel(
      'Les alignements et les buts de chaque pooleur apparaîtront au fil ' +
      'de la saison. Pour revoir une saison terminée, choisissez-la sur la ' +
      '<a href="index.html">page d’accueil</a>.'));
    return;
  }

  if (!GOALS_DATA) {
    const p = el('div', 'panel');
    p.append(el('div', 'empty-state',
      'data/goals.js est absent. Lancez build-goals.ps1 pour tracer les buts sur la patinoire.'));
    box.append(p);
    return;
  }
  if (!state.poolers.length) {
    const p = el('div', 'panel');
    p.append(el('div', 'empty-state',
      'Aucun pooleur. Ajoutez-en au Repêchage, ou importez un pool.'));
    box.append(p);
    return;
  }

  if (!curPooler || !state.poolers.includes(curPooler)) {
    const v = loadView();
    curPooler = state.poolers.find(p => p.id === v.pooler) || state.poolers[0];
    if (curWeek === null) {
      curWeek = (typeof v.week === 'number' && v.week < WEEK_COUNT) ? v.week : bestWeek(curPooler);
    }
  }
  if (curWeek === null) curWeek = bestWeek(curPooler);

  box.append(buildToolbar());

  const win = curWeek < 0 ? { start: null, end: null } : weekWindow(curWeek);
  const events = collect(curPooler, win);

  box.append(buildSummary(events, win));

  const split = el('div', 'pl-split');
  split.append(buildRinkPanel(events, win));
  split.append(buildRosterPanel(events));
  box.append(split);

  box.append(buildDayStrip(events, win));
  box.append(buildNote());
}

/* La semaine d'ouverture.

   La dernière semaine jouée semble le choix évident, mais en fin de saison
   c'est souvent un moignon de trois jours : la page s'ouvre alors sur une
   patinoire presque vide, ce qui donne l'impression qu'elle est cassée. La
   MEILLEURE semaine du pooleur est à la fois pleine et flatteuse — c'est
   celle qu'il a envie de revoir. */
function bestWeek(pooler) {
  let best = -1, bestPts = -1;
  for (let i = 0; i < WEEK_COUNT; i++) {
    const p = expectedPoints(pooler, i);
    if (p === null) continue;
    if (p > bestPts) { bestPts = p; best = i; }
  }
  return best >= 0 ? best : Math.max(0, WEEK_COUNT - 1);
}

/* ---- Barre d'outils ----------------------------------------------------- */
function buildToolbar() {
  const bar = el('div', 'toolbar');

  const who = document.createElement('select');
  who.id = 'selPooler';
  state.poolers.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    if (p === curPooler) o.selected = true;
    who.append(o);
  });
  who.onchange = () => {
    curPooler = state.poolers.find(p => p.id === who.value) || state.poolers[0];
    curPlayer = null; curDay = null;
    saveView(); render();
  };
  const l1 = el('label', null, 'Pooleur ');
  l1.append(who);
  bar.append(l1);

  const wk = document.createElement('select');
  wk.id = 'selWeek';
  const oAll = document.createElement('option');
  oAll.value = '-1'; oAll.textContent = 'Toute la saison';
  if (curWeek < 0) oAll.selected = true;
  wk.append(oAll);
  const top = bestWeek(curPooler);
  WEEKS.forEach((w, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    const pts = expectedPoints(curPooler, i);
    o.textContent = 'Semaine ' + w.w + ' — ' + frDate(w.d) +
      (pts !== null ? '  (' + pts + ' pts' + (i === top ? ', sa meilleure' : '') + ')' : '');
    if (i === curWeek) o.selected = true;
    wk.append(o);
  });
  wk.onchange = () => {
    curWeek = parseInt(wk.value, 10);
    curPlayer = null; curDay = null;
    saveView(); render();
  };
  const l2 = el('label', null, 'Semaine ');
  l2.append(wk);
  bar.append(l2);

  const seg = el('span', 'pl-seg');
  [['tous', 'Buts + passes'], ['B', 'Buts'], ['P', 'Passes']].forEach(([v, t]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = t;
    if (curRole === v) b.className = 'on';
    b.onclick = () => { curRole = v; render(); };
    seg.append(b);
  });
  bar.append(seg);

  bar.append(el('span', 'grow'));

  if (curPlayer || curDay || curRole !== 'tous') {
    const clr = document.createElement('button');
    clr.textContent = 'Tout afficher';
    clr.onclick = () => { curPlayer = null; curDay = null; curRole = 'tous'; render(); };
    bar.append(clr);
  }

  // Navigation semaine par semaine — plus rapide que le menu déroulant.
  const nav = el('span', 'pl-nav');
  const prev = document.createElement('button');
  prev.textContent = '‹'; prev.title = 'Semaine précédente';
  prev.disabled = curWeek <= 0;
  prev.onclick = () => { curWeek--; curPlayer = null; curDay = null; saveView(); render(); };
  const next = document.createElement('button');
  next.textContent = '›'; next.title = 'Semaine suivante';
  next.disabled = curWeek < 0 || curWeek >= WEEK_COUNT - 1;
  next.onclick = () => { curWeek++; curPlayer = null; curDay = null; saveView(); render(); };
  nav.append(prev, next);
  bar.append(nav);

  return bar;
}

/* ---- Sommaire ----------------------------------------------------------- */
function countPoints(events) {
  let b = 0, p = 0;
  events.forEach(e => e.roles.forEach(r => {
    if (curPlayer && r.pid !== curPlayer) return;
    if (r.role === 'B') b++; else p++;
  }));
  return { b, p, total: b + p };
}

function buildSummary(events, win) {
  const wrap = el('div', 'cards');
  const shown = events.filter(passes);
  const c = countPoints(shown);
  const scorers = new Set();
  shown.forEach(e => e.roles.forEach(r => scorers.add(r.pid)));

  const card = (k, v, s) => {
    const d = el('div', 'card');
    d.append(el('div', 'k', k));
    d.append(el('div', 'v', v));
    if (s) d.append(el('div', 's', s));
    return d;
  };

  const label = curWeek < 0 ? 'saison complète'
    : 'du ' + frDate(win.start, true) + ' au ' + frDate(win.end, true);

  wrap.append(card('Points du pool', String(c.total), label));
  wrap.append(card('Buts / passes', c.b + ' B · ' + c.p + ' P',
    c.total ? Math.round(100 * c.b / c.total) + ' % de buts' : '—'));
  wrap.append(card('Buts touchés', String(shown.length),
    shown.length !== c.total ? (c.total - shown.length) + ' but(s) à deux points' : 'un point chacun'));
  wrap.append(card('Joueurs au pointage', scorers.size + ' / ' + filledCount(curPooler),
    'de l’alignement'));

  // Vérification croisée : la page recompte les buts un à un, history.js les
  // additionne autrement. Un écart veut dire qu'un fichier est en retard.
  const exp = curWeek >= 0 && !curPlayer && curRole === 'tous' && !curDay
    ? expectedPoints(curPooler, curWeek) : null;
  if (exp !== null && exp !== c.total) {
    const warn = el('div', 'banner');
    warn.textContent = 'Le classement indique ' + exp + ' points pour cette semaine, ' +
      'mais seulement ' + c.total + ' buts sont détaillés ici. ' +
      'data/goals.js est probablement moins à jour que data/history.js — relancez build-goals.ps1.';
    const holder = el('div');
    holder.append(warn, wrap);
    return holder;
  }
  return wrap;
}

/* ---- Filtres ------------------------------------------------------------ */
function passes(e) {
  if (curPlayer && !e.roles.some(r => r.pid === curPlayer)) return false;
  if (curDay && goalDate(e.g) !== curDay) return false;
  if (curRole !== 'tous') {
    const ok = e.roles.some(r => r.role === curRole &&
      (!curPlayer || r.pid === curPlayer));
    if (!ok) return false;
  }
  return true;
}

/* ---- Patinoire ---------------------------------------------------------- */
function buildRinkPanel(events, win) {
  const panel = el('div', 'panel');
  const h = el('h2', null, 'Sur la glace');
  const note = el('span', 'note', ' — un point par but touché, à l’endroit du tir');
  h.append(note);
  panel.append(h);

  const holder = el('div', 'rink-holder');
  const svg = svgEl2('svg', {
    class: 'rink', viewBox: '0 0 ' + RINK.w + ' ' + RINK.h,
    role: 'img',
    'aria-label': 'Patinoire montrant chaque but auquel l’alignement a touché'
  });
  drawRink(svg);

  const layer = svgEl2('g', {});
  const stack = new Map();
  const shown = events.filter(passes);

  if (!shown.length) {
    panel.append(holder);
    holder.append(svg);
    svg.append(layer);
    const es = el('div', 'empty-state',
      curWeek < 0 ? 'Aucun point cette saison.' : 'Aucun point cette semaine.');
    panel.append(es);
    return panel;
  }

  shown.forEach(e => {
    const g = e.g;
    const key = g.x + ',' + g.y;
    const n = stack.get(key) || 0;
    stack.set(key, n + 1);
    // Les coordonnées sont arrondies au pied : sans cet éventail, une dizaine
    // de buts se cacheraient sous une seule rondelle devant le filet.
    const ang = n * 2.39996, rad = n ? 2.4 * Math.sqrt(n) : 0;
    const cx = rx(g.x) + Math.cos(ang) * rad;
    const cy = ry(g.y) + Math.sin(ang) * rad;

    const lead = e.roles.find(r => r.role === 'B' &&
                   (!curPlayer || r.pid === curPlayer)) ||
                 e.roles.find(r => !curPlayer || r.pid === curPlayer) || e.roles[0];
    const col = playerColor(lead.pid);
    const scored = lead.role === 'B';

    const c = svgEl2('circle', {
      cx: cx, cy: cy, r: 5.2,
      fill:   scored ? col : 'var(--surface)',
      stroke: scored ? 'var(--surface)' : col,
      'stroke-width': scored ? 1.2 : 2.6,
      class: 'puck', tabindex: 0, role: 'button'
    });
    c.addEventListener('mouseenter', ev => { c.setAttribute('r', 7.6); showTip(e, ev); });
    c.addEventListener('mousemove', ev => moveTip(ev));
    c.addEventListener('mouseleave', () => { c.setAttribute('r', 5.2); hideTip(); });
    c.addEventListener('focus', () => {
      const b = c.getBoundingClientRect();
      c.setAttribute('r', 7.6);
      showTip(e, { clientX: b.right, clientY: b.top });
    });
    c.addEventListener('blur', () => { c.setAttribute('r', 5.2); hideTip(); });
    const open = () => { const u = goalClip(e.g); if (u) window.open(u, '_blank', 'noopener'); };
    c.addEventListener('click', open);
    c.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
    });
    layer.append(c);
  });
  svg.append(layer);
  holder.append(svg);
  panel.append(holder);

  const leg = el('div', 'pl-legend');
  const item = (cls, txt) => {
    const s = el('span', 'item');
    s.append(el('i', 'ring ' + cls));
    s.append(document.createTextNode(' ' + txt));
    return s;
  };
  leg.append(item('full', 'Rondelle pleine — son joueur a marqué'));
  leg.append(item('hollow', 'Rondelle vide — son joueur a obtenu une passe'));
  leg.append(item('any', 'La couleur dit lequel de ses joueurs a récolté le point'));
  panel.append(leg);
  return panel;
}

/* Couleur stable par joueur : la position dans l'alignement, pas dans la
   liste des buteurs, pour qu'un joueur garde sa teinte d'une semaine à
   l'autre. */
function playerColor(pid) {
  const i = curPooler.picks.indexOf(pid);
  return colorFor(i >= 0 ? i : 11);
}

/* ---- Alignement --------------------------------------------------------- */
function buildRosterPanel(events) {
  const panel = el('div', 'panel');
  panel.append(el('h2', null, 'L’alignement'));

  const tally = new Map();
  curPooler.picks.forEach(pid => { if (pid !== null) tally.set(pid, { b: 0, p: 0 }); });
  events.forEach(e => e.roles.forEach(r => {
    const t = tally.get(r.pid);
    if (!t) return;
    if (curDay && goalDate(e.g) !== curDay) return;
    if (r.role === 'B') t.b++; else t.p++;
  }));

  const rows = [...tally.entries()].map(([pid, t]) => ({
    pid, t, pts: t.b + t.p, p: BY_ID.get(pid) || null
  }));
  rows.sort((a, b) => b.pts - a.pts ||
    (a.p ? a.p.n : '').localeCompare(b.p ? b.p.n : ''));

  const list = el('div', 'pl-roster');
  rows.forEach(r => {
    const row = el('div', 'pl-row' + (r.pts ? '' : ' zero') +
      (curPlayer === r.pid ? ' on' : ''));
    row.style.setProperty('--pc', playerColor(r.pid));
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-pressed', curPlayer === r.pid ? 'true' : 'false');

    row.append(el('i', 'dot'));
    const nm = el('span', 'nm', r.p ? r.p.n : 'Joueur inconnu');
    row.append(nm);
    const pos = el('span', 'pos' + (r.p && r.p.p === 'D' ? ' D' : '') +
      (r.p && r.p.p === 'G' ? ' G' : ''), r.p ? r.p.p : '?');
    row.append(pos);
    row.append(el('span', 'ga', r.t.b + 'B ' + r.t.p + 'P'));
    row.append(el('span', 'pt', String(r.pts)));

    const toggle = () => {
      curPlayer = (curPlayer === r.pid) ? null : r.pid;
      render();
    };
    row.onclick = toggle;
    row.onkeydown = ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
    };
    list.append(row);
  });
  panel.append(list);
  return panel;
}

/* ---- Bande des jours ---------------------------------------------------- */
function buildDayStrip(events, win) {
  if (curWeek < 0) return el('span');   // la saison entière ferait 190 cases

  const panel = el('div', 'panel');
  const h = el('h2', null, 'Jour par jour');
  panel.append(h);

  const days = [];
  if (win.end) {
    const end = new Date(win.end + 'T00:00:00');
    const start = win.start ? new Date(win.start + 'T00:00:00') : new Date(end);
    if (!win.start) start.setDate(end.getDate() - 6);
    const d = new Date(start);
    d.setDate(d.getDate() + 1);
    while (d <= end) { days.push(isoDate(d)); d.setDate(d.getDate() + 1); }
  }

  const strip = el('div', 'pl-days');
  days.forEach(dt => {
    const pts = events.reduce((t, e) => {
      if (goalDate(e.g) !== dt) return t;
      return t + e.roles.filter(r =>
        (!curPlayer || r.pid === curPlayer) &&
        (curRole === 'tous' || r.role === curRole)).length;
    }, 0);

    const cell = el('div', 'pl-day' + (pts ? '' : ' empty') + (curDay === dt ? ' on' : ''));
    cell.tabIndex = 0;
    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-pressed', curDay === dt ? 'true' : 'false');
    const d = new Date(dt + 'T00:00:00');
    cell.append(el('div', 'dw', JOURS[d.getDay()]));
    cell.append(el('div', 'dn', String(pts)));
    cell.append(el('div', 'dd', d.getDate() + ' ' + MOIS_C[d.getMonth()]));
    const toggle = () => { curDay = (curDay === dt) ? null : dt; render(); };
    cell.onclick = toggle;
    cell.onkeydown = ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
    };
    strip.append(cell);
  });
  panel.append(strip);
  return panel;
}

function buildNote() {
  const p = el('div', 'prose pl-note');
  p.innerHTML =
    'Les tirs sont rabattus sur un seul bout de patinoire : peu importe le côté réel, ' +
    'la vue se lit toujours comme <b>la zone offensive</b>. Un but peut valoir ' +
    '<b>deux points</b> quand le buteur et le passeur appartiennent au même alignement. ' +
    'Cliquez une rondelle pour le fait saillant, un joueur ou un jour pour l’isoler.';
  return p;
}

/* ---- Infobulle ---------------------------------------------------------- */
let tipEl = null;
function theTip() {
  if (!tipEl) {
    tipEl = el('div', 'tooltip pl-tip');
    tipEl.style.display = 'none';
    document.body.append(tipEl);
  }
  return tipEl;
}
function showTip(e, ev) {
  const t = theTip();
  const g = e.g;
  const a = [g.a1, g.a2].filter(Boolean).map(id => {
    const p = BY_ID.get(id); return p ? p.n : null;
  }).filter(Boolean);
  const scorer = BY_ID.get(g.s);
  const gl = g.gl ? BY_ID.get(g.gl) : null;

  const mine = e.roles.map(r => {
    const p = BY_ID.get(r.pid);
    return '<div class="mine"><i style="background:' + playerColor(r.pid) + '"></i>' +
           '<b>' + esc(p ? p.n : '?') + '</b> — ' +
           (r.role === 'B' ? 'but' : 'passe') + ' · 1 pt</div>';
  }).join('');

  t.innerHTML =
    '<div class="t-head">' + esc(scorer ? scorer.n : 'But') + '</div>' +
    (a.length ? '<div class="t-sub">de ' + a.map(esc).join(' et ') + '</div>'
              : '<div class="t-sub">sans aide</div>') +
    mine +
    '<hr>' +
    trow('Match', goalMatchup(g)) +
    trow('Quand', perLabel(g.p) + ', ' + g.tm) +
    (g.az !== undefined ? trow('Pointage', g.az + ' – ' + g.hz) : '') +
    (g.st ? trow('Tir', SHOTS[g.st] || g.st) : '') +
    (gl ? trow('Gardien', gl.n) : '') +
    trow('Date', frDate(goalDate(g), true)) +
    (goalClip(g) ? '<div class="t-hint">Cliquez pour le fait saillant</div>' : '');
  t.style.display = '';
  moveTip(ev);
}
function trow(k, v) {
  return '<div class="t-row"><span>' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>';
}
function moveTip(ev) {
  const t = theTip();
  const b = t.getBoundingClientRect();
  let x = ev.clientX + 15, y = ev.clientY - 12;
  if (x + b.width  > innerWidth  - 10) x = ev.clientX - b.width - 15;
  if (y + b.height > innerHeight - 10) y = innerHeight - b.height - 10;
  if (y < 8) y = 8;
  t.style.position = 'fixed';
  t.style.left = x + 'px';
  t.style.top  = y + 'px';
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });

/* ---- Petits formats ----------------------------------------------------- */
const JOURS  = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const MOIS_C = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin',
                'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const SHOTS = {
  'wrist': 'du poignet', 'snap': 'snap', 'slap': 'frappé', 'backhand': 'du revers',
  'tip-in': 'dévié', 'deflected': 'dévié', 'wrap-around': 'enveloppé',
  'bat': 'au bâton', 'poke': 'poussé', 'between-legs': 'entre les jambes',
  'cradle': 'à la cuillère'
};
function perLabel(p) {
  if (p === 4) return 'prolongation';
  return p + (p === 1 ? 're' : 'e') + ' période';
}
function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}
function frDate(s, short) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (short ? JOURS[dt.getDay()] + ' ' : '') + d + ' ' + MOIS_C[m - 1] +
         (short ? '' : ' ' + y);
}

/* Le menu Données > Importer remplace le pool sous nos pieds. */
function onPoolImported() { curPooler = null; curPlayer = null; curDay = null; render(); }

/* ---- Go ---------------------------------------------------------------- */
wireImportExport();
wireDataMenu();
wireSeasonBadge();
wireThemeToggle();
wireAutoRefresh();
wirePublishedBadge();
renderStamp(GOALS_DATA ? (GOAL_LIST.length.toLocaleString('fr-CA') + ' buts localisés') : null);
render();
