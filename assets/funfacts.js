/* =========================================================================
   funfacts.js — efficiency and odds-and-ends.

   The standings page answers "who won". This one answers "how" — whether a
   pooler's points came from talent or from ice time.

   The central number is P/60: points per 60 minutes on the ice.

       P/60 = points ÷ time on ice (seconds) × 3600

   It is the honest way to compare a first-liner with 22 minutes a night
   against a third-liner with 12. Two points in 20 minutes beats three points
   in 60. Only each pooler's COUNTING 10 are included — the same 10 that score.

   Ice time comes from data/advanced.js (build-advanced.ps1); everything about
   who owns whom comes from core.js.
   ========================================================================= */

const ADV     = window.NHL_ADVANCED || null;
const ADV_COL = new Map();
if (ADV) ADV.ids.forEach((id, i) => ADV_COL.set(id, i));

/* Per-player season detail, or null if the player never dressed. */
function adv(id) {
  const i = ADV_COL.get(id);
  if (i === undefined) return null;
  return {
    gp: ADV.gp[i], toi: ADV.toi[i], pts: ADV.pts[i], sh: ADV.sh[i],
    pim: ADV.pim[i], ppp: ADV.ppp[i], gwg: ADV.gwg[i],
    hPts: ADV.hPts[i], hToi: ADV.hToi[i], rPts: ADV.rPts[i], rToi: ADV.rToi[i],
    bestPts: ADV.bestPts[i], bestDate: ADV.bestDate[i], bestOpp: ADV.bestOpp[i],
    streak: ADV.streak[i], drought: ADV.drought[i]
  };
}

function p60(pts, toiSec) { return toiSec > 0 ? (pts * 3600) / toiSec : 0; }
function mins(toiSec)     { return Math.round(toiSec / 60); }
function fmt(n, d)        { return n.toFixed(d === undefined ? 2 : d); }

/* ---- View state --------------------------------------------------------- */
const hidden  = new Set();     // poolers switched off in the legend
let sortKey   = 'p60';
let sortDir   = -1;
let showAll   = false;         // player leaderboard: top 25 or everyone

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function poolerColor(pl) { return colorFor(state.poolers.indexOf(pl)); }

/* =========================================================================
   Derived data — one pass, reused by every section
   ========================================================================= */
let PLAYER_ROWS = [];   // one per counting player, across all poolers
let POOLER_ROWS = [];   // one per pooler

function computeRows() {
  PLAYER_ROWS = [];
  POOLER_ROWS = [];

  for (const pl of state.poolers) {
    const sc = scoreRoster(pl.picks, statsSeason());
    const rows = [];

    for (const r of sc.counting) {
      const a = adv(r.id);
      if (!a || a.toi === 0) continue;      // never played: no rate to compute
      rows.push({
        pooler: pl, name: r.name, pos: r.pos, team: r.team, id: r.id,
        pts: r.pts, toi: a.toi, gp: a.gp, sh: a.sh, pim: a.pim, ppp: a.ppp,
        gwg: a.gwg, streak: a.streak, drought: a.drought,
        bestPts: a.bestPts, bestDate: a.bestDate, bestOpp: a.bestOpp,
        hPts: a.hPts, hToi: a.hToi, rPts: a.rPts, rToi: a.rToi,
        p60: p60(r.pts, a.toi)
      });
    }

    PLAYER_ROWS = PLAYER_ROWS.concat(rows);

    const sum = f => rows.reduce((t, r) => t + f(r), 0);
    const toi = sum(r => r.toi);
    const pts = sum(r => r.pts);

    POOLER_ROWS.push({
      pl, rows,
      pts, toi,
      p60:    p60(pts, toi),                                   // roster-wide rate
      avgP60: rows.length ? rows.reduce((t, r) => t + r.p60, 0) / rows.length : 0,
      sh:     sum(r => r.sh),
      pim:    sum(r => r.pim),
      ppp:    sum(r => r.ppp),
      gwg:    sum(r => r.gwg),
      scorePts: sc.pts,                                        // what the standings show
      missing: sc.counting.length - rows.length
    });
  }

  PLAYER_ROWS.sort((a, b) => b.p60 - a.p60);
  POOLER_ROWS.sort((a, b) => b.p60 - a.p60);
}

function shown() { return POOLER_ROWS.filter(r => !hidden.has(r.pl.id)); }

/* =========================================================================
   Render
   ========================================================================= */
function render() {
  renderStamp(ADV ? 'temps de jeu ' + ADV.label : null);
  const box = $('content');
  box.innerHTML = '';

  if (!state.poolers.length) {
    box.innerHTML = '<div class="panel"><div class="empty-state">Aucun pooler.<br><br>' +
      'Ajoutez-les dans l’onglet <a href="pool.html">Repêchage</a>, ou utilisez <b>Données ▸ Importer JSON</b> ci-dessus.</div></div>';
    return;
  }
  if (!ADV) {
    box.innerHTML = '<div class="panel"><div class="empty-state">' +
      'Aucune donnée de temps de jeu.<br><br>Exécutez <code>build-advanced.ps1</code> pour créer ' +
      '<code>data/advanced.js</code>.</div></div>';
    return;
  }

  computeRows();

  box.append(
    cards(),
    explainer(),
    chartPanel('Les joueurs les plus efficaces', 'Points par 60 minutes de jeu, seulement les 10 qui comptent.',
               playerChart(), legend()),
    chartPanel('Les poolers les plus efficaces', 'Points par 60 minutes sur le temps de jeu combiné de chaque alignement.',
               poolerChart()),
    chartPanel('Temps de jeu contre efficacité', 'Vers la droite = plus de minutes. Vers le haut = plus fait avec. Taille = points.',
               bubbleChart()),
    tablePanel(),
    oddsAndEnds()
  );
}

function onPoolImported() { hidden.clear(); render(); }

/* ---- Cards -------------------------------------------------------------- */
function cards() {
  const box = el('div', 'cards');
  const best = PLAYER_ROWS[0];
  const eff  = POOLER_ROWS[0];
  const most = POOLER_ROWS.slice().sort((a, b) => b.toi - a.toi)[0];
  const game = PLAYER_ROWS.slice().sort((a, b) => b.bestPts - a.bestPts ||
                                                  a.bestDate.localeCompare(b.bestDate))[0];

  if (eff)  box.append(card('Pooler le plus efficace', eff.pl.name, fmt(eff.p60) + ' P/60'));
  if (best) box.append(card('Joueur le plus efficace', best.name,
                            fmt(best.p60) + ' P/60 · ' + best.pooler.name));
  if (most) box.append(card('Plus de temps de jeu', most.pl.name,
                            mins(most.toi).toLocaleString() + ' minutes'));
  if (game) box.append(card('Meilleur match', game.name,
                            game.bestPts + ' pts contre ' + game.bestOpp + ' · ' + game.bestDate));
  return box;
}

function card(k, v, s) {
  const c = el('div', 'card');
  c.append(el('div', 'k', k), el('div', 'v', v), el('div', 's', s));
  return c;
}

function explainer() {
  const p = el('div', 'panel');
  p.innerHTML =
    '<h2>Ce que signifie le P/60</h2>' +
    '<div class="prose"><b>Les points par 60 minutes</b> mesurent ce qu’un joueur fait avec le temps de ' +
    'jeu qu’on lui donne, au lieu de récompenser celui qui joue simplement le plus. Un joueur avec ' +
    '2 points en 20 minutes passe devant un joueur avec 3 points en 60.<br><br>' +
    'Formule : <code>points ÷ secondes de jeu × 3600</code>. Seuls les ' +
    '<b>10 qui comptent</b> de chaque pooler sont inclus — les mêmes 10 que le classement pointe, ' +
    'les meilleurs par points avec au moins un défenseur.<br><br>' +
    'Les défenseurs sont bas dans cette liste par nature : beaucoup de minutes, moins de points. ' +
    'C’est la mesure qui fonctionne, pas qui échoue.</div>';
  return p;
}

/* ---- Charts ------------------------------------------------------------- */
function chartPanel(title, note, body, extra) {
  const panel = el('div', 'panel');
  const h = el('h2', null, title + ' ');
  if (note) h.append(el('span', 'note', '— ' + note));
  panel.append(h);
  if (body)  panel.append(body);
  if (extra) panel.append(extra);
  return panel;
}

function legend() {
  const box = el('div', 'legend');
  for (const pl of state.poolers) {
    const item = el('div', 'item' + (hidden.has(pl.id) ? ' off' : ''));
    const chip = el('span', 'chip');
    chip.style.background = poolerColor(pl);
    item.append(chip, el('span', null, pl.name));
    item.title = 'Click to show/hide · double-click to isolate';
    item.onclick = () => {
      if (hidden.has(pl.id)) hidden.delete(pl.id); else hidden.add(pl.id);
      render();
    };
    item.ondblclick = () => {
      const vis = shown();
      const alone = vis.length === 1 && vis[0].pl.id === pl.id;
      hidden.clear();
      if (!alone) state.poolers.forEach(o => { if (o.id !== pl.id) hidden.add(o.id); });
      render();
    };
    box.append(item);
  }
  return box;
}

/* Horizontal bars, one per player, tallest rate first. */
function playerChart() {
  const all  = PLAYER_ROWS.filter(r => !hidden.has(r.pooler.id));
  const rows = showAll ? all : all.slice(0, 25);
  if (!rows.length) return el('div', 'hint', 'Rien à afficher — tous les poolers sont masqués.');

  const rowH = 22, W = 920, m = { l: 190, r: 56, t: 6, b: 6 };
  const H = m.t + m.b + rows.length * rowH;
  const iw = W - m.l - m.r;
  const max = Math.max(...rows.map(r => r.p60));

  const svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H,
                             preserveAspectRatio: 'xMidYMid meet' });

  rows.forEach((r, i) => {
    const y = m.t + i * rowH;

    const nm = svgEl('text', { x: m.l - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'lbl' });
    nm.textContent = r.name;
    svg.append(nm);

    const bw = Math.max(1, (r.p60 / max) * iw);
    const bar = svgEl('rect', { class: 'bar', x: m.l, y: y + 3, width: bw, height: rowH - 8,
                                fill: poolerColor(r.pooler), opacity: .82 });
    const tip = svgEl('title', {});
    tip.textContent = r.name + ' — ' + r.pooler.name + '\n' + r.pts + ' pts en ' + mins(r.toi) +
                      ' min en ' + r.gp + ' matchs\n' + fmt(r.p60) + ' P/60';
    bar.append(tip);
    svg.append(bar);

    const v = svgEl('text', { x: m.l + bw + 8, y: y + rowH / 2 + 4 });
    v.textContent = fmt(r.p60);
    svg.append(v);
  });

  const wrap = el('div', 'chartwrap');
  wrap.append(svg);

  const holder = el('div');
  holder.append(wrap);

  if (all.length > 25) {
    const btn = el('button', null, showAll ? 'Afficher le top 25' : 'Afficher les ' + all.length + ' joueurs');
    btn.style.marginTop = '10px';
    btn.onclick = () => { showAll = !showAll; render(); };
    holder.append(btn);
  }
  return holder;
}

/* Bars, one per pooler. */
function poolerChart() {
  const rows = shown();
  if (!rows.length) return el('div', 'hint', 'Rien à afficher.');

  const rowH = 28, W = 920, m = { l: 190, r: 90, t: 6, b: 6 };
  const H = m.t + m.b + rows.length * rowH;
  const iw = W - m.l - m.r;
  const max = Math.max(...rows.map(r => r.p60));

  const svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H,
                             preserveAspectRatio: 'xMidYMid meet' });

  rows.forEach((r, i) => {
    const y = m.t + i * rowH;
    const nm = svgEl('text', { x: m.l - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'lbl' });
    nm.textContent = r.pl.name;
    svg.append(nm);

    const bw = Math.max(1, (r.p60 / max) * iw);
    svg.append(svgEl('rect', { class: 'bar', x: m.l, y: y + 4, width: bw, height: rowH - 11,
                               fill: poolerColor(r.pl), opacity: .82 }));

    const v = svgEl('text', { x: m.l + bw + 8, y: y + rowH / 2 + 4 });
    v.textContent = fmt(r.p60) + '  (' + mins(r.toi).toLocaleString() + ' min)';
    svg.append(v);
  });

  const wrap = el('div', 'chartwrap');
  wrap.append(svg);
  return wrap;
}

/* Ice time on x, efficiency on y, points as the bubble. */
function bubbleChart() {
  const rows = shown();
  if (rows.length < 2) return el('div', 'hint', 'Il faut au moins deux poolers.');

  const W = 920, H = 420, m = { l: 60, r: 24, t: 18, b: 46 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const xs = rows.map(r => mins(r.toi)), ys = rows.map(r => r.p60);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  // Pad the ranges so bubbles never sit on the frame.
  const xPad = Math.max(200, (xMax - xMin) * 0.18), yPad = Math.max(0.08, (yMax - yMin) * 0.22);
  const x0 = xMin - xPad, x1 = xMax + xPad, y0 = yMin - yPad, y1 = yMax + yPad;

  const X = v => m.l + ((v - x0) / (x1 - x0)) * iw;
  const Y = v => m.t + ih - ((v - y0) / (y1 - y0)) * ih;

  const svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H,
                             preserveAspectRatio: 'xMidYMid meet' });

  for (let i = 0; i <= 4; i++) {
    const v = y0 + ((y1 - y0) / 4) * i;
    svg.append(svgEl('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }));
    const t = svgEl('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' });
    t.textContent = fmt(v);
    svg.append(t);
  }
  for (let i = 0; i <= 4; i++) {
    const v = x0 + ((x1 - x0) / 4) * i;
    const t = svgEl('text', { x: X(v), y: H - 24, 'text-anchor': 'middle' });
    t.textContent = Math.round(v).toLocaleString();
    svg.append(t);
  }

  const ax = svgEl('text', { x: m.l + iw / 2, y: H - 6, 'text-anchor': 'middle' });
  ax.textContent = 'Temps de jeu total des 10 qui comptent (minutes)';
  svg.append(ax);

  const ay = svgEl('text', { x: 14, y: m.t + ih / 2, 'text-anchor': 'middle',
                             transform: 'rotate(-90 14 ' + (m.t + ih / 2) + ')' });
  ay.textContent = 'P/60';
  svg.append(ay);

  const maxPts = Math.max(...rows.map(r => r.pts));
  const placed = [];

  // Bubbles first, labels second: interleaving them lets a later circle paint
  // over an earlier name.
  for (const r of rows) {
    const rad = 9 + (r.pts / maxPts) * 20;
    r._x = X(mins(r.toi)); r._y = Y(r.p60); r._r = rad;

    const c = svgEl('circle', { cx: r._x, cy: r._y, r: rad,
                                fill: poolerColor(r.pl), 'fill-opacity': .30,
                                stroke: poolerColor(r.pl), 'stroke-width': 2 });
    const tip = svgEl('title', {});
    tip.textContent = r.pl.name + '\n' + r.pts + ' pts · ' +
                      mins(r.toi).toLocaleString() + ' min · ' + fmt(r.p60) + ' P/60';
    c.append(tip);
    svg.append(c);

    // Every bubble is an obstacle for every label, not just the labels
    // already placed — otherwise a name lands squarely on someone's circle.
    placed.push({ x0: r._x - rad, x1: r._x + rad, y0: r._y - rad, y1: r._y + rad });
  }

  for (const r of rows) {
    // Try above the bubble, then below, then the sides and diagonals, and take
    // the first spot clear of every bubble and every name already placed.
    const w = r.pl.name.length * 6.5 + 8;
    const spots = [
      { x: r._x, y: r._y - r._r - 7,  anchor: 'middle' },
      { x: r._x, y: r._y + r._r + 15, anchor: 'middle' },
      { x: r._x + r._r + 7, y: r._y + 4, anchor: 'start' },
      { x: r._x - r._r - 7, y: r._y + 4, anchor: 'end' },
      { x: r._x + r._r + 4, y: r._y - r._r - 2, anchor: 'start' },
      { x: r._x - r._r - 4, y: r._y - r._r - 2, anchor: 'end' },
      { x: r._x + r._r + 4, y: r._y + r._r + 12, anchor: 'start' },
      { x: r._x - r._r - 4, y: r._y + r._r + 12, anchor: 'end' }
    ];
    let pick = spots[0];
    for (const s of spots) {
      const x0 = s.anchor === 'middle' ? s.x - w / 2 : s.anchor === 'start' ? s.x : s.x - w;
      const box = { x0, x1: x0 + w, y0: s.y - 11, y1: s.y + 4 };
      const clash = placed.some(p => !(box.x1 < p.x0 || box.x0 > p.x1 || box.y1 < p.y0 || box.y0 > p.y1));
      if (!clash) { pick = s; placed.push(box); break; }
    }

    const t = svgEl('text', { x: pick.x, y: pick.y, 'text-anchor': pick.anchor, class: 'lbl' });
    t.setAttribute('fill', poolerColor(r.pl));
    t.textContent = r.pl.name;
    svg.append(t);
  }

  const wrap = el('div', 'chartwrap');
  wrap.append(svg);
  return wrap;
}

/* ---- The table: points rank vs efficiency rank -------------------------- */
function tablePanel() {
  const panel = el('div', 'panel');
  const h = el('h2', null, 'Points contre minutes ');
  h.append(el('span', 'note', '— qui a tiré le plus de son temps de jeu'));
  panel.append(h);

  // Rank by each measure before sorting for display, so the ranks stay fixed.
  const byPts = POOLER_ROWS.slice().sort((a, b) => b.scorePts - a.scorePts);
  const byEff = POOLER_ROWS.slice().sort((a, b) => b.p60 - a.p60);
  const ptsRank = new Map(byPts.map((r, i) => [r.pl.id, i + 1]));
  const effRank = new Map(byEff.map((r, i) => [r.pl.id, i + 1]));

  const cols = [
    { k: 'name',   t: 'Pooler' },
    { k: 'pts',    t: 'Points',  cls: 'right' },
    { k: 'toi',    t: 'Minutes', cls: 'right' },
    { k: 'p60',    t: 'P/60',    cls: 'right' },
    { k: 'swing',  t: 'Rang pts → rang P/60', cls: 'right' },
    { k: 'sh',     t: 'Tirs',    cls: 'right' },
    { k: 'ppShare',t: 'Part AN', cls: 'right' },
    { k: 'pim',    t: 'Min. pén.', cls: 'right' }
  ];

  const key = {
    name:    r => r.pl.name.toLowerCase(),
    pts:     r => r.scorePts,
    toi:     r => r.toi,
    p60:     r => r.p60,
    swing:   r => ptsRank.get(r.pl.id) - effRank.get(r.pl.id),
    sh:      r => r.sh,
    ppShare: r => r.pts ? r.ppp / r.pts : 0,
    pim:     r => r.pim
  };

  const table = el('table', 'standings');
  const tr = el('tr');
  for (const c of cols) {
    const th = el('th', (c.cls || '') + ' sortable',
                  c.t + (sortKey === c.k ? (sortDir === -1 ? ' ▾' : ' ▴') : ''));
    th.onclick = () => {
      if (sortKey === c.k) sortDir = -sortDir;
      else { sortKey = c.k; sortDir = c.k === 'name' ? 1 : -1; }
      render();
    };
    tr.append(th);
  }
  const thead = el('thead'); thead.append(tr); table.append(thead);

  const rows = POOLER_ROWS.slice();
  const f = key[sortKey] || key.p60;
  rows.sort((a, b) => {
    const x = f(a), y = f(b);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    if (c === 0) return a.pl.name.localeCompare(b.pl.name);
    return sortDir === -1 ? -c : c;
  });

  const tbody = el('tbody');
  for (const r of rows) {
    const tr = el('tr');

    const tdName = el('td');
    const who = el('div', 'who-cell');
    const chip = el('span', 'chip');
    chip.style.background = poolerColor(r.pl);
    who.append(chip, el('span', 'nm', r.pl.name));
    tdName.append(who);
    tr.append(tdName);

    tr.append(el('td', 'right', String(r.scorePts)));
    tr.append(el('td', 'right', mins(r.toi).toLocaleString()));
    tr.append(el('td', 'right', fmt(r.p60)));

    const pr = ptsRank.get(r.pl.id), er = effRank.get(r.pl.id);
    const swing = pr - er;
    const td = el('td', 'right');
    td.append(el('span', null, pr + ' → ' + er + ' '));
    const badge = el('span', 'move ' + (swing > 0 ? 'up' : swing < 0 ? 'down' : 'flat'),
      swing > 0 ? '▲' + swing : swing < 0 ? '▼' + (-swing) : '–');
    badge.title = swing > 0 ? 'Mieux classé en efficacité qu’en points'
                : swing < 0 ? 'Moins bien classé en efficacité qu’en points'
                : 'Même rang des deux façons';
    td.append(badge);
    tr.append(td);

    tr.append(el('td', 'right', r.sh.toLocaleString()));
    tr.append(el('td', 'right', r.pts ? Math.round((r.ppp / r.pts) * 100) + '%' : '—'));
    tr.append(el('td', 'right', String(r.pim)));

    tbody.append(tr);
  }
  table.append(tbody);
  const wrap = el('div', 'tablewrap');
  wrap.append(table);
  panel.append(wrap);

  const note = el('div', 'hint',
    'Les points sont le total du classement (les 10 qui comptent). Minutes, tirs, part AN et minutes ' +
    'de pénalité couvrent ces mêmes 10 joueurs. La part AN est la portion des points obtenue en avantage numérique.');
  panel.append(note);
  return panel;
}

/* ---- Odds and ends ------------------------------------------------------ */
function oddsAndEnds() {
  const panel = el('div', 'panel');
  const h = el('h2', null, 'En vrac ');
  h.append(el('span', 'note', '— seulement les 10 qui comptent'));
  panel.append(h);

  const list = el('div', 'facts');
  const best = (arr, f) => arr.slice().sort((a, b) => f(b) - f(a))[0];

  const fact = (label, text) => {
    const d = el('div', 'fact');
    d.append(el('div', 'fl', label), el('div', 'ft', text));
    list.append(d);
  };

  const P = PLAYER_ROWS;
  if (!P.length) return panel;

  const streak  = best(P, r => r.streak);
  const drought = best(P, r => r.drought);
  const gunner  = best(P, r => r.sh);
  const goon    = best(P, r => r.pim);
  const clutch  = best(P, r => r.gwg);
  const ppMan   = best(P.filter(r => r.pts >= 20), r => r.ppp / r.pts);
  const evenMan = P.filter(r => r.pts >= 20).sort((a, b) => (a.ppp / a.pts) - (b.ppp / b.pts))[0];
  const homer   = best(P.filter(r => r.hToi > 0 && r.rToi > 0),
                       r => p60(r.hPts, r.hToi) - p60(r.rPts, r.rToi));
  const roadie  = P.filter(r => r.hToi > 0 && r.rToi > 0)
                   .sort((a, b) => (p60(b.rPts, b.rToi) - p60(b.hPts, b.hToi)) -
                                   (p60(a.rPts, a.rToi) - p60(a.hPts, a.hToi)))[0];
  const workhorse = best(P, r => r.toi / Math.max(1, r.gp));

  fact('Plus longue séquence de points',
       streak.streak + ' matchs — ' + streak.name + ' (' + streak.pooler.name + ')');
  fact('Plus longue disette',
       drought.drought + ' matchs sans point — ' + drought.name + ' (' + drought.pooler.name + ')');
  fact('Plus de tirs',
       gunner.sh + ' tirs, ' + gunner.pts + ' pts — ' + gunner.name + ' (' + gunner.pooler.name + ')');
  fact('Plus de temps de jeu par match',
       fmt(workhorse.toi / Math.max(1, workhorse.gp) / 60, 1) + ' min par soir — ' +
       workhorse.name + ' (' + workhorse.pooler.name + ')');
  if (clutch.gwg > 0) {
    fact('Plus de buts gagnants', clutch.gwg + ' — ' + clutch.name + ' (' + clutch.pooler.name + ')');
  }
  fact('Plus de minutes de pénalité',
       goon.pim + ' min — ' + goon.name + ' (' + goon.pooler.name + ')');
  if (ppMan) {
    fact('Le plus dépendant de l’avantage numérique',
         Math.round((ppMan.ppp / ppMan.pts) * 100) + ' % de ses points en AN — ' +
         ppMan.name + ' (' + ppMan.pooler.name + ')');
  }
  if (evenMan) {
    fact('Le moins dépendant de l’avantage numérique',
         Math.round((evenMan.ppp / evenMan.pts) * 100) + ' % en AN — ' +
         evenMan.name + ' (' + evenMan.pooler.name + ')');
  }
  if (homer) {
    fact('Meilleur à domicile',
         fmt(p60(homer.hPts, homer.hToi)) + ' P/60 à domicile contre ' +
         fmt(p60(homer.rPts, homer.rToi)) + ' à l’étranger — ' + homer.name);
  }
  if (roadie) {
    fact('Meilleur à l’étranger',
         fmt(p60(roadie.rPts, roadie.rToi)) + ' P/60 à l’étranger contre ' +
         fmt(p60(roadie.hPts, roadie.hToi)) + ' à domicile — ' + roadie.name);
  }

  panel.append(list);
  return panel;
}

/* ---- Go ---------------------------------------------------------------- */
wireImportExport();   /* the hidden file input behind Data > Import */
wireDataMenu();
wireSeasonBadge();
wireThemeToggle();
wireAutoRefresh();
wirePublishedBadge();
render();
