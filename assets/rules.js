/* =========================================================================
   rules.js — Finances et règlements : cotisation, bourses, bilan de la
   saison précédente et ballottage.

   Le texte vient de Pool_25-26.xlsx (feuille « Résultats », lignes 59-93),
   la source de vérité du pool. Il est recopié ici plutôt que lu du fichier :
   un .xlsx ne se lit pas depuis une page file://, et ces règles changent une
   fois par année, pas une fois par semaine.

   Les montants et la date limite sont regroupés en haut pour qu'une saison
   suivante se mette à jour en un seul endroit.
   ========================================================================= */

const REGLES = {
  saison: '2026-27',
  cotisation: { base: 80, poolexpert: 2 },
  bourses: [
    { rang: '1re position', montant: 540 },
    { rang: '2e position',  montant: 220 },
    { rang: '3e position',  montant: 120 },
    { rang: '4e position',  montant: 0 }
  ],
  // Le bas du classement paie : c'est ce qui garde la fin de saison vivante.
  // 12 pooleurs en 2026-27 au lieu de 11 : la 6e position ne paie plus rien
  // et le barème glisse d'un rang, jusqu'à la 12e.
  penalites: [
    { rang: '5e',  montant: 0 },
    { rang: '6e',  montant: 0 },
    { rang: '7e',  montant: 10 },
    { rang: '8e',  montant: 15 },
    { rang: '9e',  montant: 20 },
    { rang: '10e', montant: 25 },
    { rang: '11e', montant: 30 },
    { rang: '12e', montant: 35 }
  ],
  ballottage: {
    maxJoueurs: 2,
    limite: '1er mars 2027 à 23 h 59',
    cout: 10,
    penaliteNonComptant: 10
  }
};

/* Le classement final de la saison précédente, avec ce que chacun a touché
   ou remis. Les points viennent de data/2025-26/, recalculés avec la règle
   du pool ; les montants suivent le barème de CETTE saison-là, à 11
   pooleurs, pas celui de 2026-27. */
/* Le bilan financier complet de la saison précédente.

   prepaye : tout le monde a versé 102 $ au départ (80 pool + 2 PoolExpert
             + 20 pour deux trades), peu importe le nombre de trades utilisés.
   utilise : ce qui était réellement dû, soit 82 $ + 10 $ par trade employé.
   Un pooleur qui trade moins récupère donc la différence.

   Les montants viennent de ReglementsPool2025_2026.txt ; les points et les
   rangs sont recalculés depuis data/2025-26/. */
const SAISON_PRECEDENTE = {
  saison: '2025-26',
  prepaye: 102,
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

/* La pizza du repêchage, dessinée plutôt que chargée : nette à toute taille,
   elle suit le thème et ne coûte aucune requête. Vue de dessus, une pointe
   légèrement détachée — c'est ce qui la rend lisible en petit. */
function pizzaSVG() {
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (t, a) => { const e = document.createElementNS(NS, t);
                         for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = sv('svg', { class: 'rg-pizza', viewBox: '0 0 64 64',
                          role: 'img', 'aria-label': 'Pizza du repêchage' });
  // La croûte, puis la sauce.
  svg.append(sv('circle', { cx: 32, cy: 32, r: 30, class: 'pz-croute' }));
  svg.append(sv('circle', { cx: 32, cy: 32, r: 24, class: 'pz-sauce' }));
  // Une pointe découpée, légèrement écartée.
  svg.append(sv('path', { d: 'M 34 4 A 28 28 0 0 1 60 26 L 36 32 Z',
                          class: 'pz-pointe' }));
  // Les pepperonis.
  [[22,22],[42,24],[26,42],[44,42],[32,32],[18,33]].forEach(([x, y]) => {
    svg.append(sv('circle', { cx: x, cy: y, r: 4, class: 'pz-pep' }));
  });
  return svg;
}
function euro(n) { return n + ' $'; }

function bloc(titre, noeuds) {
  const p = el('div', 'panel');
  p.append(el('h2', null, titre));
  noeuds.forEach(n => p.append(n));
  return p;
}

function ligne(gauche, droite, cls) {
  const r = el('div', 'rg-row' + (cls ? ' ' + cls : ''));
  r.append(el('span', 'rg-k', gauche));
  r.append(el('span', 'rg-v', droite));
  return r;
}

function render() {
  const box = $('content');
  box.innerHTML = '';

  const split = el('div', 'rg-split');

  /* ---- Colonne de gauche : l'argent ---- */
  const gauche = el('div');

  const sp0 = SAISON_PRECEDENTE.poolers;

  const cot = [];
  cot.push(ligne('Pool', euro(REGLES.cotisation.base)));
  cot.push(ligne('PoolExpert', euro(REGLES.cotisation.poolexpert)));
  cot.push(ligne('2 trades (10 $ chacun)', euro(20)));
  cot.push(ligne('Versé au départ', euro(REGLES.cotisation.base +
                 REGLES.cotisation.poolexpert + 20), 'rg-total'));
  // Dit ici aussi : c'est la première section qu'on lit, et la question
  // « pourquoi 102 $ alors que le pool coûte 80 $ » se pose tout de suite.
  const remb = el('p', 'hint rg-remb');
  remb.innerHTML = '↩ Les trades non utilisés sont <b>remboursés</b> en fin de ' +
    "saison : 10 $ par trade que vous n'avez pas fait.";
  cot.push(remb);
  gauche.append(bloc('Cotisation', cot));

  const bou = REGLES.bourses.map(b =>
    ligne(b.rang, (b.montant ? euro(b.montant) + ' ' : '') + '+ ¼ ballottage'));
  bou.push(el('p', 'hint',
    'La bourse du ballottage est divisée en quatre parts égales entre les ' +
    'quatre premières positions.'));
  gauche.append(bloc('Bourses', bou));

  const pen = REGLES.penalites.map(p =>
    ligne(p.rang + ' position',
          p.montant ? euro(p.montant) + ' à payer' : 'rien à payer',
          p.montant ? 'rg-pay' : ''));
  pen.push(el('p', 'hint',
    'Au classement final : la moitié inférieure remet de l’argent, ce qui ' +
    'garde la fin de saison intéressante même loin du sommet. Cet argent ne va ' +
    'pas aux gagnants — il paie la bouffe du repêchage suivant.'));
  gauche.append(bloc('À payer au classement final', pen));

  // Ou va l'argent des penalites : c'est la question que le tableau laissait
  // sans reponse, et la reponse est sympathique.
  const penaTrade = sp0.reduce((t, p) => t + p.pena, 0);
  const penaPos   = sp0.reduce((t, p) => t + p.pos, 0);
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
    'au menu du repêchage ' + REGLES.saison + '.';
  bt.append(bl);
  bouffe.append(bt);
  gauche.append(bouffe);

  split.append(gauche);

  /* ---- Colonne de droite : la saison précédente, puis les règles ---- */
  const droite = el('div');

  // Ce que le barème a réellement donné l'an dernier. Le vert et le rouge
  // portent l'information — qui a encaissé, qui a remis — pour qu'on lise le
  // bilan sans additionner soi-même. Les colonnes suivent le calcul :
  // prépayé − utilisé − pénalités − position + bourse + ballottage.
  const sp = SAISON_PRECEDENTE;
  const tw = el('div', 'tablewrap');
  const t = el('table', 'rg-tbl');

  const thead = el('thead');
  const hr = el('tr');
  [['', ''], ['Pooleur', ''], ['Prépayé', 'num'], ['Trades', 'num'],
   ['Remis', 'num'], ['Pénal.', 'num'], ['Pos.', 'num'],
   ['Bourse', 'num'], ['Ballot.', 'num'], ['Solde', 'num'],
   ['Cotis. ' + REGLES.saison, 'num'], ['À régler', 'num']]
    .forEach(([h, c]) => hr.append(el('th', c, h)));
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
    // Les trades employés d'abord : c'est eux qui expliquent le coût réel,
    // et le remboursement qui suit.
    tr.append(el('td', 'num' + (p.trades < 2 ? ' gain' : ''),
                 p.trades + ' / 2'));
    // La colonne qui manquait : ce que le pooleur récupère pour les trades
    // qu'il n'a pas utilisés. Auparavant il fallait soustraire deux colonnes
    // de tête pour s'en apercevoir.
    const remis = sp.prepaye - utilise;
    tr.append(el('td', 'num' + (remis ? ' gain' : ''),
                 remis ? '+' + euro(remis) : '—'));
    tr.append(el('td', 'num' + (p.pena ? ' perte' : ''), p.pena ? euro(p.pena) : '—'));
    tr.append(el('td', 'num' + (p.pos ? ' perte' : ''), p.pos ? euro(p.pos) : '—'));
    tr.append(el('td', 'num' + (p.bourse ? ' gain' : ''), p.bourse ? euro(p.bourse) : '—'));
    tr.append(el('td', 'num' + (p.ballot ? ' gain' : ''), p.ballot ? p.ballot.toFixed(2) + ' $' : '—'));
    tr.append(el('td', 'num solde ' + (solde >= 0 ? 'gain' : 'perte'),
                 (solde >= 0 ? '+' : '') + solde.toFixed(2) + ' $'));
    // Les comptes se reglent une fois l'an, au debut de la saison
    // suivante : le solde vient donc en deduction de la cotisation.
    const cotis = REGLES.cotisation.base + REGLES.cotisation.poolexpert + 20;
    const net = solde - cotis;
    tr.append(el('td', 'num', '−' + euro(cotis)));
    tr.append(el('td', 'num net ' + (net >= 0 ? 'gain' : 'perte'),
                 (net >= 0 ? '+' : '') + net.toFixed(2) + ' $'));
    tb.append(tr);
  });
  t.append(tb);

  const tf = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', '', ''));
  fr.append(el('td', 'rg-nm', 'Total'));
  [euro(tot.pre), tot.tr + ' / 22',
   '+' + euro(tot.pre - tot.uti), euro(tot.pena), euro(tot.pos),
   euro(tot.bou), tot.bal.toFixed(2) + ' $'].forEach(v => fr.append(el('td', 'num', v)));
  // Pas de total pour le solde : additionner des gains et des pertes donne un
  // nombre que personne ne verse ni ne recoit. Les deux flux reels sont
  // affiches sous le tableau, ou ils veulent dire quelque chose.
  fr.append(el('td', 'num solde', '—'));
  const cotisTot = (REGLES.cotisation.base + REGLES.cotisation.poolexpert + 20) *
                   sp.poolers.length;
  fr.append(el('td', 'num', '−' + euro(cotisTot)));
  fr.append(el('td', 'num net', '—'));
  tf.append(fr);
  t.append(tf);

  tw.append(t);
  // L'encadré passe AVANT le tableau : la règle du remboursement explique la
  // moitié des colonnes, et personne ne la devinait en lisant les chiffres.
  const rappel = el('div', 'rg-callout');
  rappel.innerHTML =
    '<b>Les trades inutilisés sont remboursés.</b> Chacun verse ' +
    euro(sp.prepaye) + ' au départ — 80 $ de pool, 2 $ de PoolExpert et ' +
    "20 $ pour <b>deux</b> trades. Un trade coûte 10 $ : celui qui n'en fait " +
    "qu'un récupère 10 $, celui qui n'en fait aucun récupère ses 20 $.";

  // Les deux mouvements que la direction doit reellement faire.
  const flux = sp.poolers.map(p => {
    const u = 82 + p.trades * 10;
    return sp.prepaye - u - p.pena - p.pos + p.bourse + p.ballot;
  });
  // Ce qui change vraiment de mains : le solde APRES deduction de la
  // cotisation de la saison qui commence, puisque tout se regle d'un coup.
  const cotisAn = REGLES.cotisation.base + REGLES.cotisation.poolexpert + 20;
  const nets    = flux.map(v => v - cotisAn);
  const aVerser  = nets.filter(v => v > 0).reduce((t, v) => t + v, 0);
  const aPercev  = nets.filter(v => v < 0).reduce((t, v) => t - v, 0);
  const nbVerser = nets.filter(v => v > 0).length;
  const nbPercev = nets.filter(v => v < 0).length;

  const bilan = el('div', 'rg-flux');
  const fg = el('div', 'rg-flux-item gain');
  fg.append(el('span', 'rg-flux-lbl', 'À verser aux pooleurs'));
  fg.append(el('span', 'rg-flux-val', aVerser.toFixed(2) + ' $'));
  fg.append(el('span', 'rg-flux-sub', nbVerser + ' pooleurs'));
  const fp = el('div', 'rg-flux-item perte');
  fp.append(el('span', 'rg-flux-lbl', 'À percevoir'));
  fp.append(el('span', 'rg-flux-val', aPercev.toFixed(2) + ' $'));
  fp.append(el('span', 'rg-flux-sub', nbPercev + ' pooleurs'));
  bilan.append(fg, fp);

  const nbRemis = sp.poolers.filter(p => p.trades < 2).length;
  const totRemis = sp.poolers.reduce((t, p) => t + (2 - p.trades) * 10, 0);
  const noteFlux = el('p', 'hint');
  noteFlux.innerHTML = 'Montants nets, cotisation ' + REGLES.saison +
    ' de ' + euro(cotisAn) + ' déjà déduite — c’est ce qui change de mains ' +
    'au moment de lancer la saison.';

  const noteFin = el('p', 'hint',
    "Colonne « Remis » : " + nbRemis + " pooleurs sur " + sp.poolers.length +
    " n'ont pas utilisé leurs deux trades et se font rembourser " +
    euro(totRemis) + " au total. Barème de " + sp.saison + ", à 11 pooleurs.");
  droite.append(bloc('Bilan financier ' + sp.saison, [rappel, tw, bilan, noteFlux, noteFin]));

  const reg = el('div', 'prose');
  reg.innerHTML =
    '<p><b>12 choix</b> par participant. On cumule le total des points (LNH) ' +
    'des <b>10 meilleurs choix</b> à la fin de la saison, dont obligatoirement ' +
    '<b>au moins 1 défenseur</b>, même s’il ne fait pas partie des 10 ' +
    'meilleurs pointeurs.</p>' +
    '<p>Si un participant n’a <b>aucun défenseur</b> dans son alignement, ' +
    'il devra se contenter du total de ses <b>9 meilleurs</b> pointeurs.</p>' +
    '<p>En cas d’égalité, c’est le <b>11<sup>e</sup> choix</b> qui ' +
    'détermine l’avance ; si l’égalité persiste, c’est le ' +
    '<b>12<sup>e</sup> choix</b>.</p>';
  droite.append(bloc('Règlements', [reg]));

  const bal = el('div', 'prose');
  bal.innerHTML =
    '<p>Chaque participant peut soumettre au ballottage un maximum de ' +
    '<b>' + REGLES.ballottage.maxJoueurs + ' joueurs</b>, jusqu’au ' +
    '<b>' + REGLES.ballottage.limite + '</b>.</p>' +
    '<p>Chaque joueur rejeté devient éligible au repêchage par un autre ' +
    'participant. Tout changement doit être <b>annoncé sur Facebook</b> aux ' +
    'autres participants : la date et l’heure de réception du message ' +
    'déterminent la priorité lorsque deux participants veulent le même joueur.</p>' +
    '<p>Chaque joueur repêché par ballottage coûte <b>' +
    euro(REGLES.ballottage.cout) + '</b> au participant. Cet argent sert à ' +
    '<b>augmenter la bourse des gagnants</b>.</p>' +
    '<p>Si un joueur réclamé ne compte pas dans le total du participant, ' +
    'celui-ci remet <b>' + euro(REGLES.ballottage.penaliteNonComptant) +
    '</b> dans la bourse de la bouffe de la saison suivante.</p>';
  droite.append(bloc('Ballottage', [bal]));

  split.append(droite);
  box.append(split);

  const note = el('p', 'hint');
  note.textContent = 'Finances et règlements de la saison ' + REGLES.saison +
    ' — source : Pool_25-26.xlsx, feuille Résultats.';
  box.append(note);
}

/* ---- Go ---------------------------------------------------------------- */
wireSeasonBadge();
wireThemeToggle();
render();
