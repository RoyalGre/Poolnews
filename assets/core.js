/* =========================================================================
   core.js — everything shared by every page of the pool site.

   Loaded as a classic <script>, so all of this is global on purpose: the
   pages, and the self-test harness, reach in and call these directly.

   Load order matters: data/players.js and data/history.js define the
   window.NHL_* globals this file indexes, so they come first.
   ========================================================================= */

/* ---- Pool rules --------------------------------------------------------- */
const ROSTER_SIZE   = 12;   // players drafted per pooler
const COUNTING_SIZE = 10;   // of those, how many count toward the total
const STORAGE_KEY   = 'hockeyPool.v1';

/* ---- Player index ------------------------------------------------------- */
const DATA    = window.NHL_DATA || { players: [], updated: 'jamais' };
const PLAYERS = DATA.players || [];
const BY_ID   = new Map(PLAYERS.map(p => [p.i, p]));

function fold(s) {
  // Strip combining accent marks so "Bedard" finds "Bédard".
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Precompute lowercase / accent-stripped search keys once, not on every keystroke.
PLAYERS.forEach(p => {
  p._n  = fold(p.n);                        // "connor mcdavid"
  p._sq = p._n.replace(/[^a-z0-9]/g, '');   // "connormcdavid"
  const sp = p._n.lastIndexOf(' ');
  p._last  = sp >= 0 ? p._n.slice(sp + 1) : p._n;
  p._first = sp >= 0 ? p._n.slice(0, sp)  : '';
  p._pts = (p.g || 0) + (p.a || 0);         // goals + assists, per the pool's rule
});

/* =========================================================================
   Search
   Tiered so the most likely match lands on top:
     0 last name starts with query   1 first name starts with query
     2 full name contains query      3 squashed name contains query
   Within a tier, higher scorers first — at a draft table that's the order
   you actually want.
   ========================================================================= */
function search(qRaw, limit = 40) {
  const q = fold(qRaw.trim());
  if (q.length < 2) return [];
  const qsq = q.replace(/[^a-z0-9]/g, '');
  const hits = [];

  for (const p of PLAYERS) {
    let tier = -1;
    if (p._last.startsWith(q))       tier = 0;
    else if (p._first.startsWith(q)) tier = 1;
    else if (p._n.includes(q))       tier = 2;
    else if (qsq && p._sq.includes(qsq)) tier = 3;
    if (tier >= 0) hits.push({ p, tier });
  }

  hits.sort((x, y) => x.tier - y.tier || y.p._pts - x.p._pts || x.p._n.localeCompare(y.p._n));
  return hits.slice(0, limit).map(h => h.p);
}

/* =========================================================================
   Pool state — localStorage, shared across pages.

   Every page in this site is a file:// page, and Chrome gives them all the
   same "file://" origin, so the draft page and the standings page read and
   write the very same localStorage entry. That is what makes a multi-page
   site work here at all.

   localStorage is per-browser, though, which is useless for sharing: a pooler
   opening the published site would find an empty pool. So the pool can also
   ship as data/pool.js (see publish-pool.ps1), and a browser with nothing
   saved shows that instead. Publishing again re-stamps it, and every browser
   picks the new version up on its next load.
   ========================================================================= */
const PUBLISHED = window.POOL_DATA || null;

let state = load();

function blankState() {
  return { version: 2, rosterSize: ROSTER_SIZE, poolers: [] };
}

/* Bring any loaded pool up to the current shape: fixed-length pick arrays. */
function migrate(s) {
  s.version    = 2;
  s.rosterSize = ROSTER_SIZE;
  s.poolers    = s.poolers.map(p => ({
    id:    p.id,
    name:  p.name,
    picks: normalizePicks(p.picks)
  }));
  return s;
}

function load() {
  let local = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.poolers)) local = migrate(s);
    }
  } catch (e) {
    console.warn('Pool sauvegardé illisible, on repart à neuf.', e);
  }

  // Take the published pool when this browser has nothing saved, or when the
  // pool has been republished since this browser last copied it. Without that
  // second case, anyone who once clicked around the draft page would be stuck
  // on their own stale copy for good.
  if (PUBLISHED && Array.isArray(PUBLISHED.poolers)) {
    if (!local || local.publishedAt !== PUBLISHED.published) {
      const s = migrate(JSON.parse(JSON.stringify(PUBLISHED)));
      s.publishedAt = PUBLISHED.published;
      return s;
    }
  }

  return local || blankState();
}

/* Throw away local changes and go back to what was published. */
function resetToPublished() {
  if (!PUBLISHED) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
  location.reload();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Impossible de sauvegarder dans ce navigateur. Utilisez Données ▸ Exporter JSON pour conserver vos choix.');
  }
}

/* =========================================================================
   Roster slots

   picks is ALWAYS a fixed ROSTER_SIZE-long array, with null for an empty slot.
   It is deliberately not a dense list: slot 3 must stay slot 3 when you change
   the pick in it, otherwise clearing a player shuffles everyone below him up
   and the roster you're reading changes under you mid-draft.
   ========================================================================= */
function emptyPicks() {
  return new Array(ROSTER_SIZE).fill(null);
}

/* Accepts both the old dense format ([id, id, id]) and the current fixed
   format, so pools saved before slots existed still load. */
function normalizePicks(arr) {
  const out = emptyPicks();
  if (Array.isArray(arr)) {
    const n = Math.min(arr.length, ROSTER_SIZE);
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      out[i] = (typeof v === 'number' && isFinite(v)) ? v : null;
    }
  }
  return out;
}

function filledIds(pl)      { return pl.picks.filter(id => id !== null); }
function filledCount(pl)    { return filledIds(pl).length; }
function firstEmptySlot(pl) { return pl.picks.indexOf(null); }   // -1 when full

/* ---- Ownership lookup: playerId -> pooler that owns them ----------------
   exceptPooler/exceptSlot lets the slot currently being edited be treated as
   already vacated, so the player sitting in it doesn't show up as "owned" (and
   re-picking the same player is a harmless no-op rather than a rejection). */
function ownerMap(exceptPooler, exceptSlot) {
  const m = new Map();
  for (const pl of state.poolers) {
    pl.picks.forEach((id, i) => {
      if (id === null) return;
      if (pl === exceptPooler && i === exceptSlot) return;
      m.set(id, pl);
    });
  }
  return m;
}

/* Unique pooler id.
   Date.now() alone is NOT enough: two poolers created inside the same
   millisecond (a double-click on Add, or a fast paste-and-enter run) would
   share an id, and since lookups go through .find(), every pick for the second
   pooler would silently land on the first one. */
function newPoolerId() {
  const used = new Set(state.poolers.map(p => p.id));
  let id;
  do {
    id = 'p' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  } while (used.has(id));
  return id;
}

/* =========================================================================
   Scoring

   The league rule, exactly: a pooler's 12 players are ranked by goals +
   assists; the best COUNTING_SIZE (10) count; at least one of those 10 must be
   a defenseman. When the natural top 10 is all forwards, the cheapest legal
   fix is to drop the 10th-best and promote the best defenseman still on the
   bench — that gives up the fewest points of any legal combination, because
   every other swap either drops someone worth more or promotes a D worth less.

   statOf(id) -> {g, a}. Passing it in is what lets the same function score
   "right now" and "as of week 9" without knowing where the numbers came from.
   ========================================================================= */
function scoreRoster(ids, statOf) {
  const rows = ids
    .filter(id => id !== null && id !== undefined)
    .map(id => {
      const p = BY_ID.get(id) || null;
      const s = statOf(id) || { g: 0, a: 0 };
      const g = s.g | 0, a = s.a | 0;
      return { id, p, name: p ? p.n : 'Joueur inconnu', pos: p ? p.p : '?', team: p ? p.t : '', g, a, pts: g + a };
    });

  const byPts = (x, y) => y.pts - x.pts || x.name.localeCompare(y.name);
  rows.sort(byPts);

  let counting = rows.slice(0, COUNTING_SIZE);
  let bench    = rows.slice(COUNTING_SIZE);
  let forcedD  = null;      // {in, out, cost} when the D rule changed the answer

  const isD = r => r.pos === 'D';

  if (!counting.some(isD) && counting.length === COUNTING_SIZE) {
    // bench is already sorted, so its first D is the best one available.
    const k = bench.findIndex(isD);
    if (k >= 0) {
      const promoted = bench[k];
      const dropped  = counting[counting.length - 1];
      counting = counting.slice(0, -1).concat([promoted]);
      bench    = bench.slice(0, k).concat(bench.slice(k + 1), [dropped]);
      counting.sort(byPts);
      bench.sort(byPts);
      forcedD = { in: promoted, out: dropped, cost: dropped.pts - promoted.pts };
    }
  }

  const sum = (arr, f) => arr.reduce((t, r) => t + f(r), 0);

  return {
    rows,                                    // all 12, best first
    counting,                                // the ones that score
    bench,                                   // the ones left off
    pts:     sum(counting, r => r.pts),
    g:       sum(counting, r => r.g),
    a:       sum(counting, r => r.a),
    total12: sum(rows, r => r.pts),
    dCount:  rows.filter(isD).length,
    gCount:  rows.filter(r => r.pos === 'G').length,
    forcedD,
    legal:   counting.some(isD),             // false only when the roster has no D at all
    complete: rows.length >= ROSTER_SIZE
  };
}

/* =========================================================================
   Weekly history — window.NHL_HISTORY, built by build-history.ps1.

   Stored as one shared id list plus parallel goal/assist arrays per week
   (about a third of the bytes of a dictionary per week). Index it once here
   so lookups are O(1) everywhere else.
   ========================================================================= */
const HISTORY   = window.NHL_HISTORY || null;
const HIST_COL  = new Map();
if (HISTORY) HISTORY.ids.forEach((id, i) => HIST_COL.set(id, i));

const WEEKS      = HISTORY ? HISTORY.weeks : [];
const WEEK_COUNT = WEEKS.length;

/* stats as of the end of week wi (0-based). */
function statsAtWeek(wi) {
  const w = WEEKS[wi];
  if (!w) return () => ({ g: 0, a: 0 });
  return id => {
    const j = HIST_COL.get(id);
    return j === undefined ? { g: 0, a: 0 } : { g: w.g[j], a: w.a[j] };
  };
}

/* Season totals as baked into players.js — what the draft page shows. */
function statsSeason() {
  return id => {
    const p = BY_ID.get(id);
    return p ? { g: p.g || 0, a: p.a || 0 } : { g: 0, a: 0 };
  };
}

/* =========================================================================
   Shared display helpers
   ========================================================================= */

/* Twelve hues far enough apart to tell one pooler's line from another's, in
   two sets: the bright ones need a dark ground behind them, and would wash out
   on white, so the light skin gets deeper versions of the same hues. Assigned
   by position in the pool, so a pooler keeps the same colour in the table, the
   legend and every chart. */
const POOLER_COLORS_DARK = [
  '#4a9eff', '#3fb950', '#e3b341', '#f85149', '#d2a8ff', '#ffa657',
  '#2fd6c8', '#ff7eb6', '#9fd356', '#b287ff', '#7a8cff', '#9aa7b8'
];
const POOLER_COLORS_LIGHT = [
  '#1B4FA0', '#1E7A46', '#9A6B12', '#C8202E', '#6B3FA0', '#B4560F',
  '#0F7C74', '#B02A6B', '#5A7A15', '#5A3FA8', '#33479E', '#5C6E7F'
];

function poolerColors() {
  const dark = window.poolTheme ? window.poolTheme.effective() === 'dark' : true;
  return dark ? POOLER_COLORS_DARK : POOLER_COLORS_LIGHT;
}

function colorFor(i) {
  const set = poolerColors();
  return set[i % set.length];
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const $ = id => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

/* The "1,271 NHL players · pts = 2025-26 G+A · updated ..." line in the header. */
function renderStamp(extra) {
  const box = $('dataStamp');
  if (!box) return;
  const bits = [];
  if (PLAYERS.length) bits.push(PLAYERS.length + ' joueurs LNH');
  if (DATA.statsSeason) bits.push('pts = ' + DATA.statsSeason + ' B+A');
  if (extra) bits.push(extra);
  bits.push('mis à jour ' + (DATA.updated || 'never'));
  box.textContent = bits.join(' · ');
}

/* Auto-refresh.
   The pages read their data at load time, so a window left open all evening
   keeps showing whatever was on disk when it was opened. This reloads it on a
   timer, which is what makes a scheduled update.ps1 actually visible on a
   screen nobody is touching. Off by default; the choice is remembered across
   pages and sessions. */
const REFRESH_KEY = 'hockeyPool.refreshMin';

function wireAutoRefresh() {
  const header = document.querySelector('header');
  if (!header) return;

  const sel = document.createElement('select');
  sel.id = 'autoRefresh';
  sel.title = 'Recharger la page périodiquement pour voir les données fraîches';
  [[0, 'Rafraîchir : jamais'], [5, 'Rafraîchir : 5 min'], [15, 'Rafraîchir : 15 min'], [60, 'Rafraîchir : 1 h']]
    .forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = t;
      sel.append(o);
    });

  let mins = 0;
  try { mins = parseInt(localStorage.getItem(REFRESH_KEY), 10) || 0; } catch (e) { }
  sel.value = String(mins);

  let timer = null;
  function arm() {
    if (timer) { clearTimeout(timer); timer = null; }
    const m = parseInt(sel.value, 10);
    if (m > 0) timer = setTimeout(() => location.reload(), m * 60000);
  }

  sel.onchange = () => {
    try { localStorage.setItem(REFRESH_KEY, sel.value); } catch (e) { }
    arm();
  };

  barSlot().append(sel);
  arm();
}

/* Light/dark control. theme.js has already applied the stored choice before
   paint; this only puts the switch on screen and repaints the charts, whose
   colours are picked in JS and so cannot follow a CSS variable. */
function wireThemeToggle() {
  const header = document.querySelector('header');
  if (!header || !window.poolTheme) return;

  const sel = document.createElement('select');
  sel.id = 'themePick';
  sel.title = 'Clair ou sombre';
  [['auto', 'Thème : auto'], ['light', 'Thème : clair'], ['dark', 'Thème : sombre']]
    .forEach(([v, t]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      sel.append(o);
    });
  sel.value = window.poolTheme.get();

  sel.onchange = () => {
    window.poolTheme.set(sel.value);
    if (typeof render === 'function') render();   // re-colour the SVG charts
  };

  barSlot().append(sel);

  // Following the OS means reacting when the OS changes under us.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (window.poolTheme.get() === 'auto' && typeof render === 'function') render();
    });
  }
}

/* When the site carries a published pool, say so in the header and offer a way
   back to it — a visitor who edited something locally otherwise has no clue why
   their standings disagree with everyone else's. */
function wirePublishedBadge() {
  const box = $('publishedBadge');
  if (!box || !PUBLISHED) return;

  // Small print on the second line. The way retour au pool publié lives
  // in the Data menu, so this is text only.
  box.textContent = state.publishedAt !== PUBLISHED.published
    ? 'modifications propres à ce navigateur — Données ▸ Recharger le pool publié pour annuler'
    : 'pool publié ' + (PUBLISHED.published || '');
}

/* Every header control goes in the same slot, in the order the page wires
   them, so the bar looks the same on all four tabs. */
function barSlot() {
  return $('barControls') || document.querySelector('header');
}

/* A menu, not two buttons: export, import and "retour au pool publié" are
   all the same kind of rare, deliberate action, and three dropdowns in a row
   read better than dropdowns plus loose buttons. */
function wireDataMenu() {
  const slot = barSlot(), fi = $('fileInput');
  if (!slot) return;

  const sel = document.createElement('select');
  sel.id = 'dataMenu';
  sel.title = 'Sauvegarder ou charger le pool';

  const opts = [['', 'Données…'], ['export', 'Exporter JSON'], ['import', 'Importer JSON']];
  if (PUBLISHED) opts.push(['published', 'Recharger le pool publié']);
  opts.forEach(([v, t]) => {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    sel.append(o);
  });

  sel.onchange = () => {
    const action = sel.value;
    sel.value = '';               // it is a menu, not a setting: snap back
    if (action === 'export') exportPool();
    else if (action === 'import' && fi) fi.click();
    else if (action === 'published') {
      const edited = state.publishedAt !== PUBLISHED.published;
      if (edited && !confirm('Abandonner les modifications faites dans ce navigateur et recharger le pool publié ?')) return;
      resetToPublished();
    }
  };

  slot.append(sel);
}

function exportPool() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'hockey-pool-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* Kept for the file-input side of importing. */
function wireImportExport() {
  const be = $('btnExport'), bi = $('btnImport'), fi = $('fileInput');
  if (be) be.onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hockey-pool-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  if (bi && fi) {
    bi.onclick = () => fi.click();
    fi.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const s = JSON.parse(reader.result);
          if (!s || !Array.isArray(s.poolers)) throw new Error('Ce fichier n’est pas un pool');
          if (!confirm('Remplacer le pool actuel par le contenu de ce fichier ?')) return;
          state = migrate(s);   // accepts exports from before slots existed
          save();
          if (typeof onPoolImported === 'function') onPoolImported();
        } catch (err) {
          alert('Impossible de lire ce fichier : ' + err.message);
        }
      };
      reader.readAsText(file);
      e.target.value = '';   // let the same file be re-imported later
    });
  }
}
