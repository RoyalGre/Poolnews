/* =========================================================================
   finances.js — le bilan financier de la saison AFFICHÉE.

   Séparé des Règlements pour une raison de fond : cette page fait les
   comptes d'une saison jouée, l'autre annonce les tarifs de celle qui
   commence. Les mélanger rendait chaque montant ambigu — 540 $ était-il ce
   que Steve T. a touché, ou ce que le prochain gagnant touchera ?

   Tout se calcule : les pooleurs et leurs choix viennent de pool.js, les
   points de players.js, les échanges de trades.js, les montants de
   regles.js. Choisir 2024-25 donne donc le bilan de 2024-25.
   ========================================================================= */

/* Le bilan se calcule depuis les donnees de la saison AFFICHEE plutot que
   d'etre recopie a la main : les pooleurs et leurs choix viennent de pool.js,
   les points de players.js, les echanges de trades.js et les montants de
   regles.js. Choisir 2024-25 donne donc le bilan de 2024-25.

   Ce qui reste hors de portee du calcul -- le cout du repas, qui a paye --
   attend dans regles.txt et s'affiche quand il y sera. */
function bilanSaison() {
  const R = window.NHL_REGLES;
  const pool = window.POOL_DATA;
  if (!R || !pool || !pool.poolers || !pool.poolers.length) return null;

  const bourse = {};
  (R.bourses || []).forEach(b => { bourse[b.rang] = b.montant; });
  const pena = {};
  (R.penalites || []).forEach(p => { pena[p.rang] = p.montant; });

  const parTrade = (R.cotisation && R.cotisation.parTrade) || 0;
  const nbTrades = (R.cotisation && R.cotisation.trades) || 2;
  const verse    = R.verse || 0;
  // Ce qui etait du sans les trades : le reste depend du nombre employe.
  const base = verse - nbTrades * parTrade;

  // Les echanges de la saison, par pooleur.
  const T = window.NHL_TRADES;
  const parPooleur = {}, penaTrade = {};
  if (T && T.trades) {
    T.trades.forEach(x => {
      parPooleur[x.pooler] = (parPooleur[x.pooler] || 0) + 1;
      if (x.counted === false) penaTrade[x.pooler] = (penaTrade[x.pooler] || 0) + parTrade;
    });
  }

  // Le classement, avec la regle du pool.
  const rows = pool.poolers.map(pl => {
    const sc = scoreRoster(pl.picks, statsSeason());
    return { nom: pl.name, pts: sc.pts, p11: sc.p11, p12: sc.p12 };
  }).sort((a, b) => b.pts - a.pts || b.p11 - a.p11 || b.p12 - a.p12);
  rows.forEach((r, i) => { r.rang = i + 1; });

  // La bourse du ballottage : un quart pour chacune des quatre premieres.
  const totTrades = Object.keys(parPooleur).reduce((t, k) => t + parPooleur[k], 0);
  const potBallot = totTrades * ((R.ballottage && R.ballottage.cout) || 0);
  const part = potBallot / 4;

  rows.forEach(r => {
    r.trades = parPooleur[r.nom] || 0;
    r.pena   = penaTrade[r.nom] || 0;
    r.pos    = pena[r.rang] || 0;
    r.bourse = bourse[r.rang] || 0;
    r.ballot = r.rang <= 4 ? part : 0;
    r.utilise = base + r.trades * parTrade;
    r.remis   = verse - r.utilise;
    r.solde   = verse - r.utilise - r.pena - r.pos + r.bourse + r.ballot;
  });

  return {
    saison: R.label,
    prepaye: verse,
    nbTrades: nbTrades,
    parTrade: parTrade,
    poolExpert: (R.cotisation && R.cotisation.poolexpert) || 0,
    repas: R.repas || {},
    poolers: rows
  };
}

const SAISON_PRECEDENTE = bilanSaison();

/* Les comptes se règlent au début de la saison suivante : le solde vient en
   déduction de sa cotisation. On la cherche dans l'index des saisons ; si la
   suivante n'existe pas encore, on retombe sur celle de l'année affichée. */
const COTIS_SUIV = (function () {
  const idx = window.NHL_SEASONS;
  const R = window.NHL_REGLES;
  if (!R) return 0;
  if (idx && idx.seasons && idx.seasons.length) {
    const i = idx.seasons.findIndex(x => x.label === R.label);
    // seasons est trié du plus récent au plus ancien : la suivante est avant.
    if (i > 0) return R.verse;   // la valeur exacte demanderait son regles.js
  }
  return R.verse || 0;
})();


/* ---- Les transactions de la saison -------------------------------------
   data/<saison>/trades.js, produit par build-trades.ps1 à partir du
   trades.txt écrit à la main pendant l'année. Le script a déjà déterminé si
   le joueur acquis a fini dans les dix qui comptent ; la page ne fait que
   l'afficher. */
function blocTrades() {
  const T = window.NHL_TRADES;
  if (!T || !T.trades || !T.trades.length) return null;

  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
                'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const jour = iso => {
    if (!iso) return '';
    const p = iso.split('-');
    return (+p[2]) + ' ' + MOIS[(+p[1]) - 1];
  };

  const wrap = el('div', 'tablewrap');
  const t = el('table', 'rg-tbl tr-tbl');
  const thead = el('thead');
  const hr = el('tr');
  [['Date', ''], ['Pooleur', ''], ['Sort', ''], ['Entre', ''],
   ['Pts', 'num'], ['', '']].forEach(([h, c]) => hr.append(el('th', c, h)));
  thead.append(hr);
  t.append(thead);

  const tb = el('tbody');
  T.trades.forEach(x => {
    const tr = el('tr', x.counted === false ? 'pena' : '');
    tr.append(el('td', 'tr-date', jour(x.date)));
    tr.append(el('td', 'tr-who', x.pooler));
    tr.append(el('td', 'tr-out', x.out));
    tr.append(el('td', 'tr-in', x.player || x.joueur));
    tr.append(el('td', 'num', x.pts === undefined ? '—' : String(x.pts)));
    // La colonne muette porte le verdict : compte, ou pénalité de 10 $.
    if (x.counted === false) {
      const b = el('td', 'tr-flag');
      b.append(el('span', 'tr-pena', '10 $'));
      b.title = 'Ce joueur n’a pas fini dans les dix qui comptent';
      tr.append(b);
    } else if (x.counted === true) {
      tr.append(el('td', 'tr-flag ok', '✓'));
    } else {
      tr.append(el('td', 'tr-flag', ''));
    }
    tb.append(tr);
  });
  t.append(tb);
  wrap.append(t);

  const nPena = T.trades.filter(x => x.counted === false).length;
  const note = el('p', 'hint');
  note.innerHTML = T.trades.length + ' transactions. Un joueur acquis qui ne ' +
    'finit pas dans les dix qui comptent vaut <b>10 $</b> de pénalité : ' +
    'c’est arrivé <b>' + nPena + ' fois</b>, et cet argent paie la bouffe ' +
    'du repêchage.';

  return bloc('Transactions ' + T.label, [wrap, note]);
}

function render() {
  const box = $('content');
  box.innerHTML = '';
  const sp = SAISON_PRECEDENTE;

  // Une saison sans règles ou sans pool : on le dit plutôt que de planter.
  if (!sp) {
    const p = el('div', 'panel');
    p.append(el('div', 'empty-state',
      'Pas assez de données pour faire les comptes de cette saison. Il faut ' +
      'data/<saison>/regles.txt et un pool publié.'));
    box.append(p);
    return;
  }

  const intro = el('div', 'panel');
  intro.append(el('h2', null, 'Bilan de la saison ' + sp.saison));
  const id = el('div', 'prose');
  id.innerHTML =
    'Les comptes de l’année qui vient de finir, à <b>' + sp.poolers.length +
    ' pooleurs</b>. Les montants de cette page sont ceux de ' + sp.saison +
    ' — pour les tarifs de la saison en cours, voir <a href="reglements.html">' +
    'Règlements</a>.';
  intro.append(id);
  box.append(intro);

  // ---- Le tableau -------------------------------------------------------
  const rappel = el('div', 'rg-callout');
  rappel.innerHTML =
    '<b>Les trades inutilisés sont remboursés.</b> Chacun a versé <b>' +
    euro(sp.prepaye) + '</b> au départ, dont ' +
    euro(sp.nbTrades * sp.parTrade) + ' pour <b>' + sp.nbTrades +
    '</b> trades. Un trade coûte ' + euro(sp.parTrade) + " : celui qui n'en " +
    'utilise aucun récupère la somme entière.';

  const tw = el('div', 'tablewrap');
  const t = el('table', 'rg-tbl');

  const thead = el('thead');
  const hr = el('tr');
  [['', ''], ['Pooleur', ''], ['Prépayé', 'num'], ['Trades', 'num'],
   ['Remis', 'num'], ['Pénal.', 'num'], ['Pos.', 'num'],
   ['Bourse', 'num'], ['Ballot.', 'num'], ['Solde', 'num'],
   ['Cotis. suiv.', 'num'], ['PIZZA', 'num'], ['À régler', 'num']]
    .forEach(([h, c]) => {
      // La colonne du repas n'a pas de titre écrit : une pizza dit la même
      // chose en moins large, et la largeur compte sur treize colonnes.
      if (h === 'PIZZA') {
        const th = el('th', c + ' rg-th-pizza');
        th.append(pizzaSVG());
        th.title = 'Part du repas du repêchage — montant à venir';
        hr.append(th);
      } else {
        hr.append(el('th', c, h));
      }
    });
  thead.append(hr);
  t.append(thead);

  const tb = el('tbody');
  let tot = { pre: 0, uti: 0, tr: 0, pena: 0, pos: 0, bou: 0, bal: 0, solde: 0 };

  // bilanSaison() a deja tout calcule : on affiche, on ne recalcule pas.
  sp.poolers.forEach(p => {
    const utilise = p.utilise;
    const solde = p.solde;
    tot.pre += sp.prepaye; tot.uti += utilise; tot.tr += p.trades;
    tot.pena += p.pena; tot.pos += p.pos; tot.bou += p.bourse;
    tot.bal += p.ballot; tot.solde += solde;

    const tr = el('tr', p.rang <= 3 ? 'top' : '');
    tr.append(el('td', 'rank' + (p.rang <= 3 ? ' r' + p.rang : ''), String(p.rang)));
    tr.append(el('td', 'rg-nm', p.nom));
    tr.append(el('td', 'num', euro(sp.prepaye)));
    // Les trades employés d'abord : c'est eux qui expliquent le remboursement.
    tr.append(el('td', 'num' + (p.trades < sp.nbTrades ? ' gain' : ''),
                 p.trades + ' / ' + sp.nbTrades));
    const remis = p.remis;
    tr.append(el('td', 'num' + (remis ? ' gain' : ''),
                 remis ? '+' + euro(remis) : '—'));
    tr.append(el('td', 'num' + (p.pena ? ' perte' : ''), p.pena ? euro(p.pena) : '—'));
    tr.append(el('td', 'num' + (p.pos ? ' perte' : ''), p.pos ? euro(p.pos) : '—'));
    tr.append(el('td', 'num' + (p.bourse ? ' gain' : ''), p.bourse ? euro(p.bourse) : '—'));
    tr.append(el('td', 'num' + (p.ballot ? ' gain' : ''),
                 p.ballot ? p.ballot.toFixed(2) + ' $' : '—'));
    tr.append(el('td', 'num solde ' + (solde >= 0 ? 'gain' : 'perte'),
                 (solde >= 0 ? '+' : '') + solde.toFixed(2) + ' $'));
    // Les comptes se règlent une fois l'an : le solde vient en déduction de
    // la cotisation de la saison qui commence.
    const net = solde - COTIS_SUIV;
    tr.append(el('td', 'num', '−' + euro(COTIS_SUIV)));
    tr.append(el('td', 'num rg-pizza-cell', '?'));
    tr.append(el('td', 'num net ' + (net >= 0 ? 'gain' : 'perte'),
                 (net >= 0 ? '+' : '') + net.toFixed(2) + ' $'));
    tb.append(tr);
  });
  t.append(tb);

  const tf = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', '', ''));
  fr.append(el('td', 'rg-nm', 'Total'));
  [euro(tot.pre), tot.tr + ' / ' + (sp.nbTrades * sp.poolers.length),
   '+' + euro(tot.pre - tot.uti),
   euro(tot.pena), euro(tot.pos), euro(tot.bou), tot.bal.toFixed(2) + ' $']
    .forEach(v => fr.append(el('td', 'num', v)));
  // Pas de total pour le solde : additionner des gains et des pertes donne un
  // nombre que personne ne verse ni ne reçoit.
  fr.append(el('td', 'num solde', '—'));
  fr.append(el('td', 'num', '−' + euro(COTIS_SUIV * sp.poolers.length)));
  fr.append(el('td', 'num rg-pizza-cell', '?'));
  fr.append(el('td', 'num net', '—'));
  tf.append(fr);
  t.append(tf);
  tw.append(t);

  // ---- Où va l'argent qui ne finit pas en bourses -----------------------
  const penaTrade = sp.poolers.reduce((t2, p) => t2 + p.pena, 0);
  const penaPos   = sp.poolers.reduce((t2, p) => t2 + p.pos, 0);

  const bouffe = el('div', 'rg-bouffe');
  bouffe.append(pizzaSVG());
  const bt = el('div', 'rg-bouffe-txt');
  const bh = el('div', 'rg-bouffe-h');
  bh.innerHTML = 'Les pénalités paient la <b>bouffe du repêchage</b>';
  bt.append(bh);
  const bl = el('div', 'rg-bouffe-l');
  bl.innerHTML =
    'Pénalités de position <b>' + euro(penaPos) + '</b> + pénalités de trade ' +
    '<b>' + euro(penaTrade) + '</b> = <b>' + euro(penaPos + penaTrade) + '</b> ' +
    'au menu du prochain repêchage.';
  bt.append(bl);
  bouffe.append(bt);

  const pe = el('div', 'rg-service');
  const peImg = document.createElement('img');
  peImg.className = 'rg-pe-logo';
  peImg.src = 'assets/img/poolexpert.jpg';
  peImg.alt = 'PoolExpert';
  peImg.width = 126;
  peImg.height = 41;
  pe.append(peImg);
  const pt = el('div', 'rg-bouffe-txt');
  const ph = el('div', 'rg-bouffe-h');
  ph.innerHTML = euro(sp.poolExpert) + ' par pooleur en ' + sp.saison;
  pt.append(ph);
  const plx = el('div', 'rg-bouffe-l');
  plx.innerHTML = 'Le site qui compile les pointages tout au long de la saison.';
  pt.append(plx);
  pe.append(pt);

  const duo = el('div', 'rg-duo');
  duo.append(bouffe, pe);

  const nbRemis = sp.poolers.filter(p => p.trades < sp.nbTrades).length;
  const totRemis = sp.poolers.reduce((t2, p) => t2 + p.remis, 0);
  const noteFin = el('p', 'hint',
    'Colonne « Remis » : ' + nbRemis + ' pooleurs sur ' + sp.poolers.length +
    " n'ont pas utilisé leurs deux trades et se font rembourser " +
    euro(totRemis) + ' au total.');

  box.append(bloc('Qui doit quoi', [rappel, tw, duo, noteFin]));

  const tradesBloc = blocTrades();
  if (tradesBloc) box.append(tradesBloc);
}

/* ---- Go ---------------------------------------------------------------- */
wireSeasonBadge();
wireThemeToggle();
render();
