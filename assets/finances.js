/* =========================================================================
   finances.js — le bilan de la saison qui vient de finir.

   Séparé des Règlements pour une raison de fond : cette page regarde en
   ARRIÈRE. Elle décrit 11 pooleurs, une cotisation de 102 $ et des bourses
   de 540/220/120 — les chiffres de 2025-26. La page Règlements, elle,
   décrit la saison qui commence : 12 pooleurs, 103 $, 600/240/120.

   Mélanger les deux sur une seule page rendait chaque montant ambigu : on ne
   savait plus si 540 $ était ce que Steve T. a touché ou ce que le prochain
   gagnant touchera.

   Les montants viennent de ReglementsPool2025_2026.txt ; les points et les
   rangs sont recalculés depuis data/2025-26/.
   ========================================================================= */

const SAISON_PRECEDENTE = {
  saison: '2025-26',
  // Ce qui a RÉELLEMENT été versé en 2025-26 : 80 + 2 + 20. PoolExpert est
  // passé à 3 $ pour 2026-27, mais un historique ne se réécrit pas.
  prepaye: 102,
  // La cotisation de la saison SUIVANTE, celle qu'on déduit du solde au
  // moment de régler les comptes. Elle suit les tarifs 2026-27.
  cotisSuivante: 103,
  poolers: [
    { rang: 1,  nom: 'Steve T.',     pts: 778, trades: 1, pena: 0,  pos: 0,  bourse: 540, ballot: 42.5 },
    { rang: 2,  nom: 'Frédérick D.', pts: 756, trades: 2, pena: 0,  pos: 0,  bourse: 220, ballot: 42.5 },
    { rang: 3,  nom: 'Martin M.',    pts: 752, trades: 1, pena: 0,  pos: 0,  bourse: 120, ballot: 42.5 },
    { rang: 4,  nom: 'Martin Pr.',   pts: 734, trades: 2, pena: 10, pos: 0,  bourse: 0,   ballot: 42.5 },
    { rang: 5,  nom: 'Yanick M.',    pts: 712, trades: 0, pena: 0,  pos: 0,  bourse: 0,   ballot: 0 },
    { rang: 6,  nom: 'Eric C.',      pts: 709, trades: 2, pena: 10, pos: 10, bourse: 0,   ballot: 0 },
    { rang: 7,  nom: 'Pascal R.',    pts: 699, trades: 2, pena: 0,  pos: 15, bourse: 0,   ballot: 0 },
    { rang: 8,  nom: 'François C.',  pts: 696, trades: 2, pena: 0,  pos: 20, bourse: 0,   ballot: 0 },
    { rang: 9,  nom: 'Dany P.',      pts: 692, trades: 1, pena: 0,  pos: 25, bourse: 0,   ballot: 0 },
    { rang: 10, nom: 'Manuel T.',    pts: 681, trades: 2, pena: 10, pos: 30, bourse: 0,   ballot: 0 },
    { rang: 11, nom: 'Patrick C.',   pts: 634, trades: 2, pena: 0,  pos: 35, bourse: 0,   ballot: 0 }
  ]
};

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
    '<b>Les trades inutilisés sont remboursés.</b> Chacun a versé ' +
    euro(sp.prepaye) + ' au départ — 80 $ de pool, 2 $ de PoolExpert et ' +
    "20 $ pour <b>deux</b> trades. Un trade coûte 10 $ : celui qui n'en fait " +
    "qu'un récupère 10 $, celui qui n'en fait aucun récupère ses 20 $.";

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

  sp.poolers.forEach(p => {
    const utilise = 82 + p.trades * 10;
    const solde = sp.prepaye - utilise - p.pena - p.pos + p.bourse + p.ballot;
    tot.pre += sp.prepaye; tot.uti += utilise; tot.tr += p.trades;
    tot.pena += p.pena; tot.pos += p.pos; tot.bou += p.bourse;
    tot.bal += p.ballot; tot.solde += solde;

    const tr = el('tr', p.rang <= 3 ? 'top' : '');
    tr.append(el('td', 'rank' + (p.rang <= 3 ? ' r' + p.rang : ''), String(p.rang)));
    tr.append(el('td', 'rg-nm', p.nom));
    tr.append(el('td', 'num', euro(sp.prepaye)));
    // Les trades employés d'abord : c'est eux qui expliquent le remboursement.
    tr.append(el('td', 'num' + (p.trades < 2 ? ' gain' : ''), p.trades + ' / 2'));
    const remis = sp.prepaye - utilise;
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
    const net = solde - sp.cotisSuivante;
    tr.append(el('td', 'num', '−' + euro(sp.cotisSuivante)));
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
  [euro(tot.pre), tot.tr + ' / 22', '+' + euro(tot.pre - tot.uti),
   euro(tot.pena), euro(tot.pos), euro(tot.bou), tot.bal.toFixed(2) + ' $']
    .forEach(v => fr.append(el('td', 'num', v)));
  // Pas de total pour le solde : additionner des gains et des pertes donne un
  // nombre que personne ne verse ni ne reçoit.
  fr.append(el('td', 'num solde', '—'));
  fr.append(el('td', 'num', '−' + euro(sp.cotisSuivante * sp.poolers.length)));
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
  ph.innerHTML = '2 $ par pooleur en ' + sp.saison;
  pt.append(ph);
  const plx = el('div', 'rg-bouffe-l');
  plx.innerHTML = 'Le site qui compile les pointages tout au long de la saison.';
  pt.append(plx);
  pe.append(pt);

  const duo = el('div', 'rg-duo');
  duo.append(bouffe, pe);

  const nbRemis = sp.poolers.filter(p => p.trades < 2).length;
  const totRemis = sp.poolers.reduce((t2, p) => t2 + (2 - p.trades) * 10, 0);
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
