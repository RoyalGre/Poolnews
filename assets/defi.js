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

   TOUTE lecture et écriture des prédictions passe par ici. Le reste de la page
   ne sait pas d'où elles viennent et n'a pas à le savoir.

   Deux sources, dans cet ordre :
     1. Firestore, quand le réseau répond — c'est la source vivante ;
     2. data/defi.js, sinon — le filet hors ligne.

   On parle à Firestore par son API REST plutôt que par le SDK : un fetch()
   suffit, alors que le SDK exigerait un import de module depuis un CDN. Ce
   site charge ses scripts par <script src> et s'ouvre depuis le disque ; une
   dépendance de plus pour trois requêtes ne se justifiait pas.

   La clé d'API n'est pas un secret : elle identifie le projet, elle n'autorise
   rien. Ce sont les règles Firestore (firestore.rules) qui décident de tout.
   ========================================================================= */
const FB = {
  projectId: 'poolnews-846e0',
  apiKey:    'AIzaSyAJo3rezXijZ6JAnbMBzPMnF5-cDqMINL8'
};
const FB_BASE = 'https://firestore.googleapis.com/v1/projects/' + FB.projectId +
                '/databases/(default)/documents/defi';

/* Le filet hors ligne, chargé par <script src> comme toutes les données. */
const PICKS_LOCAL = window.DEFI_PICKS || null;

/* Ce que la page affiche : clé de fin de semaine -> [{ name, g, d, a }].
   Rempli par le fichier local au démarrage, puis écrasé par Firestore dès que
   le réseau répond. La lecture reste synchrone pour que render() n'attende
   jamais : la page s'affiche tout de suite, les prédictions arrivent après. */
const PICKS = new Map();
let netState = 'chargement';    // chargement | en ligne | hors ligne

if (PICKS_LOCAL && PICKS_LOCAL.weekends) {
  for (const k in PICKS_LOCAL.weekends) {
    const v = PICKS_LOCAL.weekends[k];
    if (Array.isArray(v)) PICKS.set(k, v);
  }
}

function picksFor(key) { return PICKS.get(key) || []; }

/* Firestore encode chaque champ avec son type. Deux petits traducteurs
   évitent de répandre cette forme dans le reste du fichier. */
function fromFields(f) {
  const num = v => v ? Number(v.integerValue !== undefined ? v.integerValue : v.doubleValue) : 0;
  return {
    name: f.name ? String(f.name.stringValue || '') : '',
    g: num(f.g), d: num(f.d), a: num(f.a)
  };
}
function toFields(p) {
  const f = {
    name: { stringValue: p.name },
    g: { integerValue: String(p.g) },
    d: { integerValue: String(p.d) },
    a: { integerValue: String(p.a) }
  };
  // L'empreinte du jeton : les regles la comparent a /secrets/<nom>.
  if (p.preuve) f.preuve = { stringValue: p.preuve };
  return { fields: f };
}

/* Un document par fin de semaine : defi/2026-04-16, avec une sous-collection
   « picks » d'un document par pooleur. Un document par pooleur plutôt qu'un
   tableau dans un seul : deux pooleurs qui répondent en même temps ne
   s'écrasent pas l'un l'autre. */
function loadPicks(key) {
  return fetch(FB_BASE + '/' + key + '/picks?key=' + FB.apiKey)
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(j => {
      const rows = (j.documents || []).map(d => fromFields(d.fields || {}))
        .filter(p => p.name);
      PICKS.set(key, rows);
      netState = 'en ligne';
      return rows;
    })
    .catch(() => { netState = 'hors ligne'; return null; });
}

function savePick(key, p) {
  // Le nom du pooleur sert d'identifiant : renvoyer sa prédiction remplace la
  // précédente au lieu d'en ajouter une deuxième.
  const id = encodeURIComponent(p.name);
  return fetch(FB_BASE + '/' + key + '/picks/' + id + '?key=' + FB.apiKey, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toFields(p))
  }).then(r => {
    // 403 : les regles ont refuse -- l'empreinte ne correspond pas au nom.
    if (r.status === 403 || r.status === 401) { const e = new Error('jeton'); e.jeton = true; throw e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

/* La date limite : le mercredi soir à 23 h 59, la veille des premiers matchs.
   La clé d'une fin de semaine EST son jeudi, alors la limite tombe la veille :
   on recule d'un jour. Calculé en UTC comme weekendKey(), sinon un fuseau
   déplacerait la limite d'une journée.

   Pour l'instant c'est une politesse affichée à l'écran : les règles Firestore
   sont ouvertes, alors rien ne l'impose côté serveur. */
function lockOf(key) {
  const p = key.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10) + ' 23:59';
}

/* « mercredi 23 h 59 », pour l'afficher partout de la même façon. */
const LOCK_TXT = 'le mercredi à 23 h 59';

/* =========================================================================
   Rendu
   ========================================================================= */
let curKey = null;      // la fin de semaine affichée

function render() {
  const box = $('content');
  box.innerHTML = '';

  // Ce defi se joue sur les buts reellement marques : sans un seul match
  // joue, il n'y a ni zone a deviner ni resultat a comparer. Le message
  // technique sur build-goals.ps1 s'adresse a Yanick, pas aux pooleurs.
  if (seasonNotStarted()) {
    box.append(seasonPendingPanel(
      'Le défi des zones se joue sur les buts marqués pendant la fin de ' +
      'semaine : il ouvrira dès les premiers matchs. Pour revoir une saison ' +
      'terminée, choisissez-la sur la <a href="index.html">page d’accueil</a>.'));
    return;
  }

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
  box.append(buildForm(cur));

  const split = el('div', 'df-split');
  split.append(buildRink(cur, sp));
  split.append(buildBoard(cur, sp));
  box.append(split);
}

/* ---- Le formulaire ------------------------------------------------------
   Trois pourcentages qui doivent totaliser 100. Le total se recalcule à
   chaque frappe : la seule règle du jeu se vérifie à l'œil, sans avoir à
   soumettre pour se faire dire non. */
function buildForm(w) {
  const p = el('div', 'panel');
  p.append(el('h2', null, 'Votre prédiction'));

  const form = el('div', 'df-form');

  // Le nom vient du pool publié : pas de champ libre, donc pas de « Yanick »
  // et « yanick m. » qui deviennent deux pooleurs.
  const who = el('div', 'df-field');
  who.append(el('label', null, 'Pooleur'));
  const sel = el('select');
  // value vide explicite : sans elle, sel.value rend le TEXTE de l'option
  // (« — choisir — »), qui est verite -- et le champ du jeton paraissait
  // avant meme qu'un nom soit choisi.
  const vide = el('option', null, '— choisir —');
  vide.value = '';
  sel.append(vide);
  state.poolers.forEach(pl => {
    const o = el('option', null, pl.name);
    o.value = pl.name;
    sel.append(o);
  });
  who.append(sel);
  form.append(who);

  const inputs = {};
  // Le champ du jeton, renseigne plus bas quand msg existe.
  let champ = null;
  ZONES.forEach(z => {
    const f = el('div', 'df-field');
    f.append(el('label', null, z.court));
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = 0; inp.max = 100; inp.step = 1;
    inp.placeholder = '0';
    f.append(inp);
    form.append(f);
    inputs[z.k] = inp;
  });

  const total = el('span', 'df-total', 'Total 0 %');
  form.append(total);

  const send = el('button', 'primary', 'Envoyer');
  form.append(send);
  p.append(form);

  const msg = el('div', 'df-msg');
  p.append(msg);

  // Le jeton, demande seulement quand ce navigateur ne connait pas encore
  // celui du nom choisi. Place apres le menu des noms, avant les zones.
  champ = champJeton(() => { msg.className = 'df-msg'; msg.textContent = ''; });
  who.after(champ);
  jetonPour(champ, sel.value);   // etat initial : cache tant qu'aucun nom
  sel.onchange = () => {
    jetonPour(champ, sel.value);
    msg.className = 'df-msg';
    msg.textContent = '';
  };

  const read = () => ZONES.reduce((o, z) => {
    o[z.k] = Math.max(0, Math.min(100, parseInt(inputs[z.k].value, 10) || 0));
    return o;
  }, {});

  const refresh = () => {
    const v = read();
    const t = v.g + v.d + v.a;
    total.textContent = 'Total ' + t + ' %';
    total.className = 'df-total ' + (t === 100 ? 'ok' : 'bad');
    return t;
  };
  ZONES.forEach(z => inputs[z.k].addEventListener('input', refresh));
  refresh();

  send.onclick = () => {
    const v = read();
    const t = v.g + v.d + v.a;
    msg.className = 'df-msg';
    if (!sel.value || sel.selectedIndex === 0) {
      msg.className = 'df-msg bad'; msg.textContent = 'Choisissez votre nom.'; return;
    }
    if (t !== 100) {
      msg.className = 'df-msg bad';
      msg.textContent = 'Les trois pourcentages doivent totaliser 100 — le vôtre fait ' + t + '.';
      return;
    }

    const jeton = jetonPour(champ, sel.value);
    if (!jeton) {
      champ.hidden = false;
      champ._input.focus();
      msg.className = 'df-msg bad';
      msg.textContent = 'Entrez votre jeton pour confirmer que c’est bien vous.';
      return;
    }

    send.disabled = true;
    msg.textContent = 'Envoi…';

    empreinteJeton(jeton, sel.value)
      .then(preuve => savePick(w.key,
              { name: sel.value, g: v.g, d: v.d, a: v.a, preuve: preuve }))
      .then(() => { retenirJeton(sel.value, jeton); return loadPicks(w.key); })
      .then(() => { curKey = w.key; render(); })
      .catch(err => {
        send.disabled = false;
        msg.className = 'df-msg bad';
        if (err && err.jeton) {
          jetonRejete(champ, sel.value);
          msg.textContent = 'Jeton refusé pour ' + sel.value + '. Vérifiez le code reçu.';
        } else {
          msg.textContent = 'Envoi impossible — vérifiez votre connexion.';
        }
      });
  };

  p.append(el('p', 'hint',
    'Renvoyer une prédiction remplace la précédente. Les prédictions ferment ' +
    LOCK_TXT + ', la veille des premiers matchs.'));
  return p;
}

/* ---- La barre d'outils : quelle fin de semaine ------------------------- */
function buildToolbar(list, cur) {
  const bar = el('div', 'toolbar');

  const nav = el('span', 'pl-nav');
  const i = list.findIndex(w => w.key === cur.key);

  // Changer de fin de semaine redessine tout de suite avec ce qu'on a en
  // mémoire, puis va chercher les prédictions de celle-là.
  const goTo = k => { curKey = k; render(); refreshPicks(k); };

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
    const o = el('option', null, labelOf(w));
    o.value = w.key;
    sel.append(o);
  });
  sel.value = cur.key;
  sel.onchange = () => goTo(sel.value);

  bar.append(nav, sel, el('span', 'grow'));
  const nj = cur.days.size;
  bar.append(el('span', 'hint',
    cur.goals.length + ' buts · ' + nj + (nj > 1 ? ' jours' : ' jour')));
  bar.append(el('span', 'df-net' + (netState === 'hors ligne' ? ' off' : ''),
    'prédictions : ' + netState));
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
    'mais rarement gagnant. Les prédictions ferment <b>' + LOCK_TXT + '</b>, ' +
    'soit la veille des premiers matchs.';
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

  // L'étiquette de chaque zone, posée sur la glace. Le nombre de buts vient
  // avec : « 54,1 % » seul ne dit pas si c'est 20 buts ou 2.
  // dy() dessine +y vers le HAUT, et zoneOf() range y > 0 dans « gauche » :
  // l'enclave gauche est donc la bande du haut, comme la zone bleue peinte
  // plus haut. Inverser ces deux lignes miroiterait la patinoire.
  svg.append(lbl(dx(72), dy(11),  sp.pct.g, 'Gauche',   sp.counts.g));
  svg.append(lbl(dx(72), dy(-11), sp.pct.d, 'Droite',   sp.counts.d));
  svg.append(lbl(dx(34), dy(30),  sp.pct.a, 'Ailleurs', sp.counts.a));

  holder.append(svg);
  p.append(holder);
  return p;
}

/* Trois lignes empilées : le pourcentage, la zone, le compte. Le nom de la
   zone est ce qui explique le chiffre — sans lui, « 54,1 % » ressemble à un
   numéro de semaine. */
function lbl(x, y, pct, nom, n) {
  const g = sv('g', {});

  const t = sv('text', { x: x, y: y, class: 'df-lbl', 'text-anchor': 'middle' });
  t.textContent = pct.toFixed(1).replace('.', ',') + ' %';

  const s = sv('text', { x: x, y: y + 17, class: 'df-lbl-s', 'text-anchor': 'middle' });
  s.textContent = nom + ' · ' + n + (n > 1 ? ' buts' : ' but');

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
      'Aucune prédiction pour cette fin de semaine. Les prédictions ferment ' +
      LOCK_TXT + '.'));
    return p;
  }

  // Pas de tableau ici. La colonne fait 360 px et table.standings impose un
  // min-width de 620 : six colonnes dans cette largeur forçaient un
  // défilement horizontal. Une ligne par pooleur, le nom et l'écart sur la
  // première, les trois pourcentages dessous, tient sans jamais déborder.
  const list = el('div', 'df-board');

  // L'écart le plus grand sert d'échelle aux barres : tout est relatif au
  // pire de la semaine, ce qui rend le peloton lisible même si personne n'a
  // été très proche.
  const worst = Math.max(...rows.map(r => r.score), 1);

  rows.forEach((r, i) => {
    const row = el('div', 'df-row' + (i < 3 ? ' top' : ''));

    const head = el('div', 'df-rh');
    head.append(el('span', 'rank' + (i < 3 ? ' r' + (i + 1) : ''), String(i + 1)));
    head.append(el('span', 'df-nm', r.name));
    head.append(el('span', 'df-sc', r.score.toFixed(1)));
    row.append(head);

    // Les trois devinettes, et sous chacune l'écart réel de cette zone.
    const guess = el('div', 'df-guess');
    ZONES.forEach(z => {
      const cell = el('span', 'df-gz');
      cell.append(el('span', 'df-gk', z.court.slice(0, 1)));
      cell.append(el('span', 'df-gv', r.pick[z.k] + '%'));
      const d = Math.abs(r.pick[z.k] - sp.pct[z.k]);
      const off = el('span', 'df-go', (d < 0.05 ? '0' : d.toFixed(0)));
      off.title = 'écart de ' + d.toFixed(1) + ' point sur ' + z.nom.toLowerCase();
      cell.append(off);
      guess.append(cell);
    });
    row.append(guess);

    // Une barre : plus elle est courte, plus la prédiction était proche.
    const track = el('div', 'df-bar2');
    const fill = el('span');
    fill.style.width = Math.max(2, 100 * r.score / worst).toFixed(1) + '%';
    track.append(fill);
    row.append(track);

    list.append(row);
  });

  p.append(list);
  p.append(el('p', 'hint',
    'Écart = somme des trois différences avec le partage réel. Le plus petit gagne ; ' +
    'le petit chiffre sous chaque pourcentage est l\'écart de cette zone.'));
  return p;
}

/* Va chercher les prédictions d'une fin de semaine, puis redessine. La page
   est déjà à l'écran quand cet appel part : le réseau ne retarde jamais
   l'affichage de la règle, de la patinoire ni du partage réel. */
function refreshPicks(key) {
  loadPicks(key).then(() => { if (curKey === key) render(); });
}

/* ---- Go ---------------------------------------------------------------- */
wireSeasonBadge();
wireRecordsLink();
wireThemeToggle();
wirePublishedBadge();
renderStamp(G_DATA ? (G_LIST.length.toLocaleString('fr-CA') + ' buts localisés') : null);
render();
if (curKey) refreshPicks(curKey);
