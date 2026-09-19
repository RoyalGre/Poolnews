/* =========================================================================
   defis.js — « Qui va gagner ? », le défi des vainqueurs.

   Chaque semaine, les pooleurs choisissent l'équipe gagnante de chaque match
   du jeudi au dimanche. Le plus grand nombre de bonnes réponses l'emporte.
   Les égalités partagent le même rang, comme au classement : avec une
   trentaine de matchs, elles sont fréquentes et un bris d'égalité artificiel
   récompenserait autre chose que le pronostic.

   Le samedi a d'abord été exclu — c'est le gros soir de hockey et il double
   presque le formulaire, 18 matchs par fin de semaine sans lui contre 31 avec
   — mais c'est justement le soir que les pooleurs regardent. D'où les boutons
   réduits à un écusson et trois lettres : trente rangées doivent tenir sans
   noyer la page.

   Même limite que le défi des zones : mercredi 23 h 59. Un pooleur remplit
   les deux formulaires dans la même visite.

   Les matchs viennent de data/schedule.js (build-schedule.ps1), qui porte
   déjà le vainqueur de chaque match joué. La page ne calcule donc rien de
   plus qu'un décompte : elle compare un choix à un vainqueur connu.
   ========================================================================= */

const SCHED    = window.NHL_SCHEDULE || null;
const SCH_GAMES = SCHED ? SCHED.games : [];
const SCH_TEAMS = SCHED ? (SCHED.teams || {}) : {};
const LOGO_PRE  = SCHED ? (SCHED.logoPrefix || '') : '';

/* ---- Les équipes --------------------------------------------------------
   build-schedule.ps1 range le nom de ville et le surnom de chaque équipe
   dans le fichier, déjà en français quand la LNH le fournit (Montréal,
   Philadelphie, Caroline). Si une équipe manquait à la table — une nouvelle
   concession, par exemple — on retombe sur l'abréviation plutôt que sur du
   vide. */
function teamName(ab) {
  const t = SCH_TEAMS[ab];
  return t && t.p ? t.p : ab;
}
function teamFull(ab) {
  const t = SCH_TEAMS[ab];
  return t && t.p && t.c ? t.p + ' ' + t.c : ab;
}

/* L'écusson vient du CDN de la LNH. Deux variantes existent, claire et
   sombre : la sombre est dessinée POUR un fond sombre, alors on la sert
   quand le thème est sombre. Le <img> est décoratif — le nom de l'équipe est
   juste à côté en toutes lettres — donc alt vide, et il se retire tout seul
   s'il ne charge pas plutôt que d'afficher une icône brisée. */
function teamLogo(ab) {
  const img = document.createElement('img');
  img.className = 'sc-logo';
  img.alt = '';
  img.loading = 'lazy';
  img.width = 22;
  img.height = 22;
  const dark = window.poolTheme && window.poolTheme.effective() === 'dark';
  img.src = LOGO_PRE + ab + (dark ? '_dark.svg' : '_light.svg');
  img.onerror = () => { img.remove(); };
  return img;
}

/* ---- Les fins de semaine -----------------------------------------------
   Même découpage que le défi des zones : une fin de semaine est identifiée
   par la date de son jeudi, et on y recule depuis n'importe quel jour. */
function schWeekendKey(iso) {
  const p = iso.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 4 + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/* Toutes les fins de semaine du calendrier, de la plus récente à la plus
   ancienne — comme le défi des zones, pour que les deux onglets se feuillettent
   pareil. */
function schWeekends() {
  const m = new Map();
  for (const g of SCH_GAMES) {
    const k = schWeekendKey(g.d);
    let e = m.get(k);
    if (!e) { e = { key: k, games: [], days: new Set() }; m.set(k, e); }
    e.games.push(g);
    e.days.add(g.d);
  }
  for (const e of m.values()) {
    e.games.sort((a, b) => a.d.localeCompare(b.d) || a.id - b.id);
    e.played = e.games.filter(g => g.w).length;
  }
  return [...m.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/* La fin de semaine à ouvrir par défaut : la première qui n'est pas finie,
   sinon la plus récente. En septembre, avant le premier match, c'est la
   semaine d'ouverture — ce que le pooleur veut remplir. */
function schDefaultKey(list) {
  const open = [...list].reverse().find(w => w.played < w.games.length);
  return open ? open.key : (list[0] ? list[0].key : null);
}

/* La limite : mercredi 23 h 59, la veille des premiers matchs. Identique au
   défi des zones ; le texte vit dans une seule constante. */
function schLockOf(key) {
  const p = key.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10) + ' 23:59';
}
const SCH_LOCK_TXT = 'le mercredi à 23 h 59';

/* ---- Pointage ----------------------------------------------------------
   Une bonne réponse par match joué. Les matchs à venir ne comptent pas
   encore : le score affiché est donc « sur ce qui a été joué », ce qui
   permet de suivre la semaine en direct plutôt que d'attendre le dimanche. */
function scoreEntry(picks, games) {
  let right = 0, decided = 0;
  for (const g of games) {
    if (!g.w) continue;
    decided++;
    if (picks && picks[g.id] === g.w) right++;
  }
  return { right, decided };
}

/* =========================================================================
   Les prédictions — Firestore, même schéma que le défi des zones.

   defis/{fin de semaine}/picks/{pooleur}, un document par pooleur pour que
   deux envois simultanés ne s'écrasent pas. La collection est « defis » (au
   pluriel) pour ne pas se mêler à « defi », celle des zones.
   ========================================================================= */
const SCH_FB_BASE = 'https://firestore.googleapis.com/v1/projects/poolnews-846e0' +
                    '/databases/(default)/documents/defis';
const SCH_FB_KEY  = 'AIzaSyAJo3rezXijZ6JAnbMBzPMnF5-cDqMINL8';

const SCH_LOCAL = window.DEFIS_PICKS || null;
const SCH_PICKS = new Map();       // clé -> [{ name, picks:{gameId: 'MTL'} }]
let schNet = 'chargement';         // chargement | en ligne | hors ligne

if (SCH_LOCAL && SCH_LOCAL.weekends) {
  for (const k in SCH_LOCAL.weekends) {
    const v = SCH_LOCAL.weekends[k];
    if (Array.isArray(v)) SCH_PICKS.set(k, v);
  }
}

function schPicksFor(key) { return SCH_PICKS.get(key) || []; }

/* Firestore type chaque champ. Les choix sont rangés dans une mapValue :
   { "2026020009": "NJD", ... }. */
function schFromFields(f) {
  const out = { name: f.name ? String(f.name.stringValue || '') : '', picks: {} };
  const mv = f.picks && f.picks.mapValue && f.picks.mapValue.fields;
  if (mv) for (const gid in mv) out.picks[gid] = String(mv[gid].stringValue || '');
  return out;
}
function schToFields(p) {
  const fields = {};
  for (const gid in p.picks) fields[gid] = { stringValue: p.picks[gid] };
  return { fields: { name: { stringValue: p.name }, picks: { mapValue: { fields: fields } } } };
}

function schLoadPicks(key) {
  return fetch(SCH_FB_BASE + '/' + key + '/picks?key=' + SCH_FB_KEY)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => {
      const rows = (j.documents || []).map(d => schFromFields(d.fields || {}))
        .filter(p => p.name);
      SCH_PICKS.set(key, rows);
      schNet = 'en ligne';
      return rows;
    })
    .catch(() => { schNet = 'hors ligne'; return null; });
}

function schSavePick(key, p) {
  const id = encodeURIComponent(p.name);
  return fetch(SCH_FB_BASE + '/' + key + '/picks/' + id + '?key=' + SCH_FB_KEY, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(schToFields(p))
  }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
}

/* =========================================================================
   Rendu
   ========================================================================= */
let schKey = null;

function render() {
  const box = $('content');
  box.innerHTML = '';

  if (!SCHED) {
    const p = el('div', 'panel');
    p.append(el('div', 'empty-state',
      'data/schedule.js est absent. Lancez build-schedule.ps1 pour charger le calendrier.'));
    box.append(p);
    return;
  }

  const list = schWeekends();
  if (!list.length) {
    const p = el('div', 'panel');
    p.append(el('div', 'empty-state', 'Aucun match du jeudi au dimanche au calendrier.'));
    box.append(p);
    return;
  }

  if (!schKey || !list.some(w => w.key === schKey)) schKey = schDefaultKey(list);
  const cur = list.find(w => w.key === schKey);

  box.append(schToolbar(list, cur));
  box.append(schRules(cur));

  // sc-split, pas df-split : ici la colonne étroite est à GAUCHE (la liste des
  // matchs, réduite à des écussons) et la large à droite, pour les résultats
  // et le cumul des semaines.
  const split = el('div', 'sc-split');
  split.append(schForm(cur));
  split.append(schBoard(cur));
  box.append(split);
}

function schToolbar(list, cur) {
  const bar = el('div', 'toolbar');
  const i = list.findIndex(w => w.key === cur.key);
  const goTo = k => { schKey = k; render(); schRefresh(k); };

  const nav = el('span', 'pl-nav');
  const prev = el('button', null, '‹');
  prev.title = 'Fin de semaine précédente';
  prev.disabled = i >= list.length - 1;
  prev.onclick = () => goTo(list[i + 1].key);
  const next = el('button', null, '›');
  next.title = 'Fin de semaine suivante';
  next.disabled = i <= 0;
  next.onclick = () => goTo(list[i - 1].key);
  nav.append(prev, next);

  const sel = el('select');
  list.forEach(w => {
    const p = w.key.split('-');
    const o = el('option', null, 'Fin de semaine du ' + p[2] + '/' + p[1]);
    o.value = w.key;
    sel.append(o);
  });
  sel.value = cur.key;
  sel.onchange = () => goTo(sel.value);

  bar.append(nav, sel, el('span', 'grow'));
  bar.append(el('span', 'hint',
    cur.games.length + ' matchs · ' + cur.played + ' joué' + (cur.played > 1 ? 's' : '')));
  bar.append(el('span', 'df-net' + (schNet === 'hors ligne' ? ' off' : ''),
    'prédictions : ' + schNet));
  return bar;
}

function schRules(cur) {
  const p = el('div', 'panel');
  p.append(el('h2', null, 'La règle'));
  const d = el('div', 'prose');
  d.innerHTML =
    'Choisissez l\'équipe gagnante de <b>chaque match</b> du jeudi au ' +
    'dimanche. Une bonne réponse vaut un point, et <b>le plus grand ' +
    'total gagne</b>. Une victoire en prolongation ou en tirs de barrage ' +
    'compte comme n\'importe quelle autre. Les égalités partagent le même ' +
    'rang. Les prédictions ferment <b>' + SCH_LOCK_TXT + '</b>, la veille des ' +
    'premiers matchs.';
  p.append(d);
  return p;
}

/* ---- Le formulaire : un match par ligne, deux boutons ------------------- */
function schForm(w) {
  const p = el('div', 'panel');
  p.append(el('h2', null, 'Vos choix'));

  const who = el('div', 'df-form');
  const f = el('div', 'df-field');
  f.append(el('label', null, 'Pooleur'));
  const sel = el('select');
  sel.append(el('option', null, '— choisir —'));
  state.poolers.forEach(pl => {
    const o = el('option', null, pl.name);
    o.value = pl.name;
    sel.append(o);
  });
  f.append(sel);
  who.append(f);
  p.append(who);

  const chosen = {};
  const msg = el('div', 'df-msg');

  // Charger les choix déjà envoyés quand on se reconnaît dans la liste.
  sel.onchange = () => {
    const mine = schPicksFor(w.key).find(x => x.name === sel.value);
    for (const gid in chosen) delete chosen[gid];
    if (mine) Object.assign(chosen, mine.picks);
    paint();
  };

  const rows = el('div', 'sc-games');
  const byDay = new Map();
  w.games.forEach(g => {
    if (!byDay.has(g.d)) byDay.set(g.d, []);
    byDay.get(g.d).push(g);
  });

  const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const buttons = [];

  byDay.forEach((games, d) => {
    const pr = d.split('-');
    const dt = new Date(Date.UTC(+pr[0], +pr[1] - 1, +pr[2]));
    rows.append(el('div', 'sc-day', JOURS[dt.getUTCDay()] + ' ' + pr[2] + '/' + pr[1]));

    games.forEach(g => {
      // L'écusson et l'abréviation suffisent : avec le samedi, une fin de
      // semaine compte une trentaine de matchs, et trois lignes de « New
      // Jersey » par rangée noieraient la liste. Le nom de ville complet
      // reste dans l'infobulle, et la colonne de droite récupère la place.
      const line = el('div', 'sc-game');
      const mk = (team, cls) => {
        const b = el('button', 'sc-team ' + cls);
        b.append(teamLogo(team), el('span', 'sc-ab', team));
        b.title = teamFull(team);
        b.onclick = () => { chosen[g.id] = team; paint(); };
        buttons.push({ btn: b, gid: g.id, team: team });
        return b;
      };
      line.append(mk(g.a, 'away'));
      line.append(el('span', 'sc-at', '@'));
      line.append(mk(g.h, 'home'));

      if (g.w) {
        const res = el('span', 'sc-res', g.as + '–' + g.hs + (g.r && g.r !== 'REG' ? ' ' + g.r : ''));
        line.append(res);
      }
      rows.append(line);
    });
  });

  p.append(rows);

  const foot = el('div', 'df-form sc-foot');
  const count = el('span', 'df-total', '0 / ' + w.games.length);
  foot.append(count);
  const send = el('button', 'primary', 'Envoyer');
  foot.append(send);
  p.append(foot);
  p.append(msg);

  function paint() {
    buttons.forEach(b => {
      b.btn.classList.toggle('on', chosen[b.gid] === b.team);
    });
    const n = Object.keys(chosen).length;
    count.textContent = n + ' / ' + w.games.length;
    count.className = 'df-total ' + (n === w.games.length ? 'ok' : 'bad');
  }
  paint();

  send.onclick = () => {
    msg.className = 'df-msg';
    if (!sel.value || sel.selectedIndex === 0) {
      msg.className = 'df-msg bad'; msg.textContent = 'Choisissez votre nom.'; return;
    }
    const n = Object.keys(chosen).length;
    if (n !== w.games.length) {
      msg.className = 'df-msg bad';
      msg.textContent = 'Il reste ' + (w.games.length - n) + ' match' +
                        (w.games.length - n > 1 ? 's' : '') + ' à choisir.';
      return;
    }
    send.disabled = true;
    msg.textContent = 'Envoi…';
    schSavePick(w.key, { name: sel.value, picks: chosen })
      .then(() => schLoadPicks(w.key))
      .then(() => { schKey = w.key; render(); })
      .catch(() => {
        send.disabled = false;
        msg.className = 'df-msg bad';
        msg.textContent = 'Envoi impossible — vérifiez votre connexion.';
      });
  };

  p.append(el('p', 'hint',
    'Renvoyer vos choix remplace les précédents. Les prédictions ferment ' +
    SCH_LOCK_TXT + '.'));
  return p;
}

/* ---- Le tableau ---------------------------------------------------------
   Même forme compacte que le défi des zones : rien qui déborde, même dans
   une colonne étroite. */
function schBoard(w) {
  const p = el('div', 'panel df-podium');
  p.append(el('h2', null, 'Le classement'));

  const rows = schPicksFor(w.key).map(pk => {
    const s = scoreEntry(pk.picks, w.games);
    return { name: pk.name, right: s.right, decided: s.decided };
  }).sort((a, b) => b.right - a.right || a.name.localeCompare(b.name));

  if (!rows.length) {
    p.append(el('div', 'empty-state',
      'Aucune prédiction pour cette fin de semaine. Les prédictions ferment ' +
      SCH_LOCK_TXT + '.'));
    return p;
  }

  // Les égalités partagent le rang, comme au classement.
  let rank = 0, prevRight = null, shown = 0;
  const board = el('div', 'df-board');
  rows.forEach(r => {
    shown++;
    if (r.right !== prevRight) { rank = shown; prevRight = r.right; }

    const row = el('div', 'df-row' + (rank <= 3 ? ' top' : ''));
    const head = el('div', 'df-rh');
    head.append(el('span', 'rank' + (rank <= 3 ? ' r' + rank : ''), String(rank)));
    head.append(el('span', 'df-nm', r.name));
    head.append(el('span', 'df-sc', r.right + '/' + r.decided));
    row.append(head);

    const track = el('div', 'df-bar2');
    const fill = el('span');
    fill.style.width = (r.decided ? 100 * r.right / r.decided : 0).toFixed(1) + '%';
    track.append(fill);
    row.append(track);

    board.append(row);
  });

  p.append(board);
  p.append(el('p', 'hint',
    w.played < w.games.length
      ? 'Sur les ' + w.played + ' match' + (w.played > 1 ? 's' : '') + ' déjà joué' +
        (w.played > 1 ? 's' : '') + ' — le reste s\'ajoutera au fil de la fin de semaine.'
      : 'Fin de semaine terminée.'));
  return p;
}

/* Va chercher les prédictions puis redessine. La page est déjà à l'écran :
   le réseau ne retarde jamais l'affichage du calendrier ni du formulaire. */
function schRefresh(key) {
  schLoadPicks(key).then(() => { if (schKey === key) render(); });
}

/* ---- Go ---------------------------------------------------------------- */
wireThemeToggle();
wirePublishedBadge();
renderStamp(SCHED ? (SCH_GAMES.length + ' matchs jeu/ven/dim') : null);
render();
if (schKey) schRefresh(schKey);
