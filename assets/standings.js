/* =========================================================================
   standings.js — the standings page.

   Everything on this page is derived; nothing here writes to the pool. The
   numbers come from two places:
     - data/players.js  season totals, used when there is no history
     - data/history.js  season-to-date goals/assists at the end of each week,
                        which is what makes "as of week N" and the progression
                        charts possible

   Scoring itself lives in core.js (scoreRoster), so the draft page, this page
   and the tests all apply the league rule the same way.
   ========================================================================= */

/* ---- View state --------------------------------------------------------- */
let weekIdx    = WEEK_COUNT ? WEEK_COUNT - 1 : -1;  // -1 = no history, season totals
let openPooler = null;              // pooler id whose roster is expanded
const hidden   = new Set();         // poolers toggled off in the chart legend
let hotPooler  = null;              // pooler highlighted by hovering the legend
let sortKey    = 'pts';
let sortDir    = -1;                // -1 desc, 1 asc

/* SERIES.get(poolerId)[w] = score for that pooler at the end of week w. */
let SERIES = new Map();
/* RANKS[w].get(poolerId) = 1-based rank that week (ties share a rank). */
let RANKS  = [];

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function weekLabel(w) {
  if (w < 0 || !WEEKS[w]) return DATA.statsSeason ? DATA.statsSeason + ' final' : 'season totals';
  return 'Week ' + WEEKS[w].w + ' · ' + WEEKS[w].d;
}
function shortDate(d) { return d.slice(5).replace('-', '/'); }   // 2026-01-12 -> 01/12

function statsFor(w) { return w < 0 ? statsSeason() : statsAtWeek(w); }

function poolerColor(pl) { return colorFor(state.poolers.indexOf(pl)); }

/* =========================================================================
   Derived data
   ========================================================================= */
function computeSeries() {
  SERIES = new Map();
  RANKS  = [];

  const nWeeks = WEEK_COUNT || 1;

  for (const pl of state.poolers) {
    const arr = [];
    for (let w = 0; w < nWeeks; w++) {
      arr.push(scoreRoster(pl.picks, statsFor(WEEK_COUNT ? w : -1)));
    }
    SERIES.set(pl.id, arr);
  }

  for (let w = 0; w < nWeeks; w++) {
    const sorted = state.poolers
      .map(pl => ({ id: pl.id, pts: SERIES.get(pl.id)[w].pts }))
      .sort((a, b) => b.pts - a.pts);

    const m = new Map();
    sorted.forEach((row, i) => {
      // Competition ranking: equal totals share the better rank (1,1,3...).
      const prev = i > 0 ? sorted[i - 1] : null;
      m.set(row.id, prev && prev.pts === row.pts ? m.get(prev.id) : i + 1);
    });
    RANKS.push(m);
  }
}

function scoreAt(pl, w) {
  const arr = SERIES.get(pl.id);
  if (!arr) return null;
  return arr[Math.max(0, Math.min(w, arr.length - 1))];
}

/* Points added between the previous snapshot and this one. */
function weekGain(pl, w) {
  if (w <= 0) return scoreAt(pl, w) ? scoreAt(pl, w).pts : 0;
  return scoreAt(pl, w).pts - scoreAt(pl, w - 1).pts;
}

function rankAt(pl, w) {
  const m = RANKS[Math.max(0, Math.min(w, RANKS.length - 1))];
  return m ? m.get(pl.id) : 1;
}

/* Table rows for the currently selected week, in the current sort order. */
function tableRows() {
  const w = Math.max(0, weekIdx);
  const rows = state.poolers.map(pl => {
    const sc = scoreAt(pl, w);
    return {
      pl, sc,
      rank:  rankAt(pl, w),
      prev:  weekIdx > 0 ? rankAt(pl, w - 1) : null,
      gain:  weekGain(pl, w),
      best:  sc.rows[0] || null
    };
  });

  const key = {
    rank:  r => r.rank,
    pts:   r => r.sc.pts,
    g:     r => r.sc.g,
    a:     r => r.sc.a,
    bench: r => r.sc.total12 - r.sc.pts,
    gain:  r => r.gain,
    name:  r => r.pl.name.toLowerCase()
  }[sortKey] || (r => r.sc.pts);

  rows.sort((x, y) => {
    const a = key(x), b = key(y);
    const c = typeof a === 'string' ? a.localeCompare(b) : a - b;
    // Ties fall back to name so the order never wobbles between renders.
    if (c === 0) return x.pl.name.localeCompare(y.pl.name);
    return sortDir === -1 ? -c : c;
  });
  return rows;
}

/* =========================================================================
   Render
   ========================================================================= */
function render() {
  renderStamp(WEEK_COUNT ? WEEK_COUNT + ' weeks of history' : null);

  if (!state.poolers.length) {
    $('content').innerHTML =
      '<div class="panel"><div class="empty-state">No poolers yet.<br><br>' +
      'Add them on the <a href="pool.html">Draft</a> page, or use <b>Import JSON</b> ' +
      'above to load a saved pool.</div></div>';
    $('toolbar').style.display = 'none';
    return;
  }

  computeSeries();
  $('toolbar').style.display = '';
  renderToolbar();

  $('content').innerHTML = '';
  $('content').append(cardsPanel(), tablePanel(), chartPanel(
    'Points over the season',
    'Counting-10 total after each week. Click a name to isolate it.',
    lineChart()
  ), chartPanel(
    'Position over the season',
    'Where each pooler sat in the standings, week by week. Higher is better.',
    bumpChart()
  ), chartPanel(
    'Points gained — ' + weekLabel(Math.max(0, weekIdx)),
    'What each pooler added during the selected week alone.',
    gainChart()
  ));
}

function onPoolImported() {
  openPooler = null;
  hidden.clear();
  weekIdx = WEEK_COUNT ? WEEK_COUNT - 1 : -1;
  render();
}

/* ---- Toolbar: the week selector ---------------------------------------- */
function renderToolbar() {
  const bar = $('toolbar');
  bar.innerHTML = '';

  if (!WEEK_COUNT) {
    bar.append(el('div', 'hint',
      'No weekly history loaded — showing season totals. Run build-history.ps1 to get the progression charts.'));
    return;
  }

  bar.append(el('label', null, 'As of'));

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = 0;
  slider.max = WEEK_COUNT - 1;
  slider.value = Math.max(0, weekIdx);
  slider.style.width = '260px';
  slider.oninput = () => { weekIdx = +slider.value; render(); };
  bar.append(slider);

  const lab = el('b', null, weekLabel(Math.max(0, weekIdx)));
  lab.style.minWidth = '190px';
  bar.append(lab);

  const prev = el('button', null, '‹');
  prev.title = 'Previous week';
  prev.disabled = weekIdx <= 0;
  prev.onclick = () => { weekIdx = Math.max(0, weekIdx - 1); render(); };

  const next = el('button', null, '›');
  next.title = 'Next week';
  next.disabled = weekIdx >= WEEK_COUNT - 1;
  next.onclick = () => { weekIdx = Math.min(WEEK_COUNT - 1, weekIdx + 1); render(); };

  const last = el('button', null, 'Latest');
  last.disabled = weekIdx >= WEEK_COUNT - 1;
  last.onclick = () => { weekIdx = WEEK_COUNT - 1; render(); };

  bar.append(prev, next, last);
  bar.append(el('span', 'grow'));
  bar.append(el('span', 'hint', state.poolers.length + ' poolers · best ' +
    COUNTING_SIZE + ' of ' + ROSTER_SIZE + ' count, at least one D'));
}

/* ---- Summary cards ------------------------------------------------------ */
function cardsPanel() {
  const w    = Math.max(0, weekIdx);
  const rows = state.poolers.map(pl => ({ pl, sc: scoreAt(pl, w), gain: weekGain(pl, w) }));
  const lead = rows.slice().sort((a, b) => b.sc.pts - a.sc.pts);
  const hot  = rows.slice().sort((a, b) => b.gain - a.gain)[0];

  // Best single player owned by anyone, at this point in the season.
  let star = null;
  for (const r of rows) {
    for (const p of r.sc.rows) {
      if (!star || p.pts > star.p.pts) star = { p, owner: r.pl };
    }
  }

  const box = el('div', 'cards');

  const gap = lead.length > 1 ? lead[0].sc.pts - lead[1].sc.pts : 0;
  box.append(card('Leader', lead[0].pl.name,
    lead[0].sc.pts + ' pts' + (lead.length > 1 ? ' · +' + gap + ' on ' + lead[1].pl.name : '')));

  if (WEEK_COUNT && weekIdx > 0) {
    box.append(card('Best week', hot.pl.name, '+' + hot.gain + ' pts this week'));
  }

  if (star) {
    box.append(card('Top player', star.p.name,
      star.p.pts + ' pts · ' + star.p.pos + ' ' + star.p.team + ' · ' + star.owner.name));
  }

  const spread = lead.length ? lead[0].sc.pts - lead[lead.length - 1].sc.pts : 0;
  box.append(card('Spread', spread + ' pts', 'first to last'));

  return box;
}

function card(k, v, s) {
  const c = el('div', 'card');
  c.append(el('div', 'k', k), el('div', 'v', v), el('div', 's', s));
  return c;
}

/* ---- The standings table ------------------------------------------------ */
function tablePanel() {
  const panel = el('div', 'panel');
  const h = el('h2', null, 'Standings ');
  h.append(el('span', 'note', '— ' + weekLabel(Math.max(0, weekIdx)) + ' · click a row for the roster'));
  panel.append(h);

  const table = el('table', 'standings');
  const thead = el('thead');
  const tr    = el('tr');

  const cols = [
    { k: 'rank',  t: '#',        cls: '' },
    { k: 'name',  t: 'Pooler',   cls: '' },
    { k: 'pts',   t: 'Points',   cls: 'right' },
    { k: 'g',     t: 'G',        cls: 'right' },
    { k: 'a',     t: 'A',        cls: 'right' },
    { k: 'gain',  t: 'Δ week',   cls: 'right' },
    { k: 'bench', t: 'Left off', cls: 'right' },
    { k: null,    t: 'Best player', cls: '' }
  ];

  for (const c of cols) {
    const th = el('th', c.cls + (c.k ? ' sortable' : ''), c.t + (sortKey === c.k ? (sortDir === -1 ? ' ▾' : ' ▴') : ''));
    if (c.k) th.onclick = () => {
      if (sortKey === c.k) sortDir = -sortDir;
      else { sortKey = c.k; sortDir = c.k === 'name' ? 1 : -1; }
      render();
    };
    tr.append(th);
  }
  thead.append(tr);
  table.append(thead);

  const tbody = el('tbody');
  const rows  = tableRows();
  const max   = Math.max(1, ...rows.map(r => r.sc.pts));

  for (const r of rows) {
    const tr = el('tr', openPooler === r.pl.id ? 'open' : '');
    tr.onclick = () => { openPooler = openPooler === r.pl.id ? null : r.pl.id; render(); };

    /* rank + movement */
    const tdRank = el('td');
    const rk = el('span', 'rank' + (r.rank <= 3 ? ' r' + r.rank : ''), String(r.rank));
    tdRank.append(rk);
    if (r.prev !== null) {
      const d = r.prev - r.rank;
      const mv = el('span', 'move ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat'),
        d > 0 ? ' ▲' + d : d < 0 ? ' ▼' + (-d) : ' –');
      mv.title = d === 0 ? 'No change from last week' : 'Was ' + r.prev + ' last week';
      tdRank.append(mv);
    }
    tr.append(tdRank);

    /* name */
    const tdName = el('td');
    const who = el('div', 'who-cell');
    const chip = el('span', 'chip');
    chip.style.background = poolerColor(r.pl);
    const nm = el('div');
    nm.append(el('div', 'nm', r.pl.name));
    const notes = [];
    if (!r.sc.complete) notes.push(r.sc.rows.length + '/' + ROSTER_SIZE + ' picks');
    if (!r.sc.legal)    notes.push('no defenseman — not scorable');
    else if (r.sc.forcedD) notes.push('D rule cost ' + r.sc.forcedD.cost + ' pts');
    if (notes.length) nm.append(el('div', 'sub', notes.join(' · ')));
    who.append(chip, nm);
    tdName.append(who);
    tr.append(tdName);

    /* points, with a bar showing the gap to the leader */
    const tdPts = el('td', 'right');
    const bar = el('div', 'ptsbar');
    const fill = el('div', 'fill');
    fill.style.width = Math.round((r.sc.pts / max) * 100) + '%';
    fill.style.background = poolerColor(r.pl);
    fill.style.opacity = '.30';
    bar.append(fill, el('span', 'val', String(r.sc.pts)));
    tdPts.append(bar);
    tr.append(tdPts);

    tr.append(el('td', 'right', String(r.sc.g)));
    tr.append(el('td', 'right', String(r.sc.a)));
    // "up", not "pos": .pos is the position-badge style and would paint a grey
    // chip background across the whole cell.
    tr.append(el('td', 'right delta' + (r.gain > 0 ? ' up' : ''), r.gain > 0 ? '+' + r.gain : String(r.gain)));
    tr.append(el('td', 'right', String(r.sc.total12 - r.sc.pts)));

    const bestTxt = r.best ? r.best.name + '  ' + r.best.pts : '—';
    const tdBest = el('td', null, bestTxt);
    if (r.best) tdBest.title = r.best.pos + ' · ' + r.best.team;
    tr.append(tdBest);

    tbody.append(tr);

    if (openPooler === r.pl.id) tbody.append(rosterDetail(r));
  }

  table.append(tbody);
  const wrap = el('div', 'tablewrap');
  wrap.append(table);
  panel.append(wrap);
  return panel;
}

/* The expanded roster under a clicked row. */
function rosterDetail(r) {
  const tr = el('tr', 'detail');
  const td = el('td');
  td.colSpan = 8;
  const inner = el('div', 'inner');

  const head = el('div', 'hint');
  head.style.marginBottom = '8px';
  head.textContent = 'Counting ' + r.sc.counting.length + ' · ' +
    r.sc.pts + ' pts (' + r.sc.g + 'G ' + r.sc.a + 'A) · ' +
    (r.sc.total12 - r.sc.pts) + ' pts left on the bench';
  inner.append(head);

  if (r.sc.forcedD) {
    inner.append(banner('The best 10 were all forwards, so ' + r.sc.forcedD.in.name +
      ' (D, ' + r.sc.forcedD.in.pts + ') takes the last spot from ' +
      r.sc.forcedD.out.name + ' (' + r.sc.forcedD.out.pts + '). Cost: ' +
      r.sc.forcedD.cost + ' pts.'));
  } else if (!r.sc.legal) {
    inner.append(banner('⚠ No defenseman on this roster, so it cannot be scored legally.'));
  }

  const grid = el('div', 'rosterGrid');
  const line = (p, counts) => {
    const d = el('div', 'rline ' + (counts ? 'counts' : 'benched'));
    d.append(el('span', 'pos ' + p.pos, p.pos), el('span', 'nm', p.name));
    // Only the D the rule dragged in gets the tag. A defenseman who made the
    // top 10 on points alone is there on merit and needs no explanation.
    if (counts && r.sc.forcedD && r.sc.forcedD.in.id === p.id) {
      const t = el('span', 'tag', 'D slot');
      t.title = 'In the counting 10 only because at least one D is required';
      d.append(t);
    }
    const pts = el('span', 'pts', String(p.pts));
    pts.title = p.g + 'G + ' + p.a + 'A';
    d.append(pts);
    return d;
  };
  r.sc.counting.forEach(p => grid.append(line(p, true)));
  r.sc.bench.forEach(p => grid.append(line(p, false)));
  inner.append(grid);

  const foot = el('div', 'hint');
  foot.style.marginTop = '8px';
  foot.textContent = 'Highlighted rows are the ' + COUNTING_SIZE + ' that count; faded rows are left off.';
  inner.append(foot);

  td.append(inner);
  tr.append(td);
  return tr;
}

function banner(text, ok) {
  return el('div', 'banner' + (ok ? ' ok' : ''), text);
}

/* =========================================================================
   Charts

   Hand-rolled SVG rather than a charting library: a file:// page cannot pull
   a CDN bundle, and vendoring one in would dwarf everything else here.
   ========================================================================= */
function chartPanel(title, note, body) {
  const panel = el('div', 'panel');
  const h = el('h2', null, title + ' ');
  if (note) h.append(el('span', 'note', '— ' + note));
  panel.append(h);
  if (body) panel.append(body);
  return panel;
}

/* Shared: which poolers are drawn, in table order. */
function shownPoolers() {
  return state.poolers.filter(pl => !hidden.has(pl.id));
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
      // Isolate this pooler; double-clicking the isolated one brings everyone back.
      const shown = shownPoolers();
      const alreadyAlone = shown.length === 1 && shown[0].id === pl.id;
      hidden.clear();
      if (!alreadyAlone) state.poolers.forEach(o => { if (o.id !== pl.id) hidden.add(o.id); });
      render();
    };
    item.onmouseenter = () => { hotPooler = pl.id; repaintHighlight(); };
    item.onmouseleave = () => { hotPooler = null;  repaintHighlight(); };
    box.append(item);
  }
  return box;
}

/* Dim every line except the hovered one, without rebuilding the SVG. */
function repaintHighlight() {
  document.querySelectorAll('svg.chart .line, svg.chart .dot').forEach(e => {
    const id = e.getAttribute('data-pooler');
    e.classList.toggle('dim', !!hotPooler && id !== hotPooler);
    e.classList.toggle('hot', !!hotPooler && id === hotPooler);
  });
}

/* ---- 1. Cumulative points, week by week -------------------------------- */
function lineChart() {
  if (!WEEK_COUNT) return el('div', 'hint', 'No weekly history loaded.');

  const wrap = el('div', 'chartwrap');
  const W = 920, H = 360, m = { l: 46, r: 18, t: 14, b: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const poolers = shownPoolers();
  const maxPts = Math.max(10, ...poolers.map(pl => scoreAt(pl, WEEK_COUNT - 1).pts));
  const yMax = Math.ceil(maxPts / 100) * 100;

  const x = i => m.l + (WEEK_COUNT === 1 ? iw / 2 : (i * iw) / (WEEK_COUNT - 1));
  const y = v => m.t + ih - (v / yMax) * ih;

  const svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });

  /* grid + y labels */
  for (let i = 0; i <= 5; i++) {
    const v = (yMax / 5) * i;
    svg.append(svgEl('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    const t = svgEl('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' });
    t.textContent = v;
    svg.append(t);
  }

  /* x labels: every 4th week, plus the last */
  WEEKS.forEach((w, i) => {
    if (i % 4 !== 0 && i !== WEEK_COUNT - 1) return;
    const t = svgEl('text', { x: x(i), y: H - 10, 'text-anchor': 'middle' });
    t.textContent = shortDate(w.d);
    svg.append(t);
  });

  /* one path per pooler */
  for (const pl of poolers) {
    const pts = [];
    for (let i = 0; i < WEEK_COUNT; i++) pts.push(x(i) + ',' + y(scoreAt(pl, i).pts));
    svg.append(svgEl('path', {
      class: 'line', d: 'M' + pts.join('L'),
      stroke: poolerColor(pl), 'data-pooler': pl.id
    }));
  }

  /* the selected week gets a marker line */
  if (weekIdx >= 0) {
    svg.append(svgEl('line', {
      class: 'cursor-line', x1: x(weekIdx), x2: x(weekIdx), y1: m.t, y2: m.t + ih
    }));
    for (const pl of poolers) {
      svg.append(svgEl('circle', {
        class: 'dot', cx: x(weekIdx), cy: y(scoreAt(pl, weekIdx).pts), r: 3.5,
        fill: poolerColor(pl), 'data-pooler': pl.id
      }));
    }
  }

  /* invisible bands: hovering one shows every pooler's standing that week */
  const tip = el('div', 'tooltip');
  tip.style.display = 'none';
  const bandW = iw / Math.max(1, WEEK_COUNT - 1);
  WEEKS.forEach((w, i) => {
    const band = svgEl('rect', {
      class: 'hover-band', x: x(i) - bandW / 2, y: m.t, width: bandW, height: ih
    });
    band.addEventListener('mousemove', ev => showTip(ev, i));
    band.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    band.addEventListener('click', () => { weekIdx = i; render(); });
    svg.append(band);
  });

  function showTip(ev, i) {
    const rows = shownPoolers()
      .map(pl => ({ pl, pts: scoreAt(pl, i).pts, gain: weekGain(pl, i) }))
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 12);

    tip.innerHTML = '';
    tip.append(el('div', 't-head', weekLabel(i)));
    for (const r of rows) {
      const line = el('div', 't-row');
      const chip = el('span', 'chip');
      chip.style.background = poolerColor(r.pl);
      line.append(chip, el('span', null, r.pl.name),
                  el('span', 'v', r.pts + (r.gain ? '  (+' + r.gain + ')' : '')));
      tip.append(line);
    }

    const box = wrap.getBoundingClientRect();
    tip.style.display = '';
    const left = ev.clientX - box.left + 14;
    tip.style.left = Math.min(left, box.width - 210) + 'px';
    tip.style.top  = Math.max(4, ev.clientY - box.top - 20) + 'px';
  }

  wrap.append(svg, tip);

  const holder = el('div');
  holder.append(wrap, legend());
  return holder;
}

/* ---- 2. Rank over time (bump chart) ------------------------------------ */
function bumpChart() {
  if (!WEEK_COUNT) return el('div', 'hint', 'No weekly history loaded.');

  const poolers = shownPoolers();
  const n = state.poolers.length;
  const W = 920, rowH = 24;
  const m = { l: 46, r: 120, t: 14, b: 30 };
  const H = m.t + m.b + rowH * n;
  const iw = W - m.l - m.r, ih = rowH * n;

  const x = i => m.l + (WEEK_COUNT === 1 ? iw / 2 : (i * iw) / (WEEK_COUNT - 1));
  const y = r => m.t + (r - 0.5) * rowH;      // rank 1 at the top

  const svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });

  for (let r = 1; r <= n; r++) {
    svg.append(svgEl('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(r), y2: y(r) }));
    const t = svgEl('text', { x: m.l - 8, y: y(r) + 4, 'text-anchor': 'end' });
    t.textContent = r;
    svg.append(t);
  }

  WEEKS.forEach((w, i) => {
    if (i % 4 !== 0 && i !== WEEK_COUNT - 1) return;
    const t = svgEl('text', { x: x(i), y: H - 10, 'text-anchor': 'middle' });
    t.textContent = shortDate(w.d);
    svg.append(t);
  });

  for (const pl of poolers) {
    const pts = [];
    for (let i = 0; i < WEEK_COUNT; i++) pts.push(x(i) + ',' + y(rankAt(pl, i)));
    svg.append(svgEl('path', {
      class: 'line', d: 'M' + pts.join('L'),
      stroke: poolerColor(pl), 'data-pooler': pl.id
    }));

    // Name at the right edge, at that pooler's final position.
    const last = rankAt(pl, WEEK_COUNT - 1);
    const t = svgEl('text', { class: 'lbl', x: W - m.r + 10, y: y(last) + 4, 'data-pooler': pl.id });
    t.setAttribute('fill', poolerColor(pl));
    t.textContent = pl.name;
    svg.append(t);
  }

  if (weekIdx >= 0) {
    svg.append(svgEl('line', { class: 'cursor-line', x1: x(weekIdx), x2: x(weekIdx), y1: m.t, y2: m.t + ih }));
    for (const pl of poolers) {
      svg.append(svgEl('circle', {
        class: 'dot', cx: x(weekIdx), cy: y(rankAt(pl, weekIdx)), r: 4,
        fill: poolerColor(pl), 'data-pooler': pl.id
      }));
    }
  }

  const wrap = el('div', 'chartwrap');
  wrap.append(svg);
  return wrap;
}

/* ---- 3. Points gained in the selected week ----------------------------- */
function gainChart() {
  const w = Math.max(0, weekIdx);
  if (!WEEK_COUNT) return el('div', 'hint', 'No weekly history loaded.');
  if (w === 0) return el('div', 'hint', 'Week 1 is the first snapshot — there is no previous week to compare against.');

  const rows = state.poolers
    .map(pl => ({ pl, gain: weekGain(pl, w) }))
    .sort((a, b) => b.gain - a.gain);

  const rowH = 26, W = 920, m = { l: 110, r: 40, t: 8, b: 8 };
  const H = m.t + m.b + rows.length * rowH;
  const iw = W - m.l - m.r;
  const max = Math.max(1, ...rows.map(r => r.gain));

  const svg = svgEl('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });

  rows.forEach((r, i) => {
    const yy = m.t + i * rowH;
    const nameT = svgEl('text', { x: m.l - 10, y: yy + rowH / 2 + 4, 'text-anchor': 'end', class: 'lbl' });
    nameT.textContent = r.pl.name;
    svg.append(nameT);

    const bw = Math.max(1, (r.gain / max) * iw);
    svg.append(svgEl('rect', {
      class: 'bar', x: m.l, y: yy + 4, width: bw, height: rowH - 10,
      fill: poolerColor(r.pl), opacity: .8, 'data-pooler': r.pl.id
    }));

    const v = svgEl('text', { x: m.l + bw + 8, y: yy + rowH / 2 + 4 });
    v.textContent = '+' + r.gain;
    svg.append(v);
  });

  const wrap = el('div', 'chartwrap');
  wrap.append(svg);
  return wrap;
}

/* ---- Go ---------------------------------------------------------------- */
wireImportExport();
wireAutoRefresh();
wirePublishedBadge();
render();
