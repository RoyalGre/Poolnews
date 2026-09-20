/* =========================================================================
   rules.js — les règles et les tarifs de la saison AFFICHÉE.

   Rien n'est codé en dur : tout vient de data/<saison>/regles.js, produit
   par build-rules.ps1 à partir du regles.txt écrit à la main. Choisir
   2024-25 sur la page d'accueil montre donc les règles de 2024-25 — 10
   pooleurs, bourses 500/200/100 — et non celles de cette année.

   Le bilan financier de l'année écoulée vit dans finances.js.
   ========================================================================= */

/* Les tarifs viennent de data/<saison>/regles.js, produit par build-rules.ps1
   a partir du regles.txt que Yanick entretient. La page suit donc la saison
   choisie au lieu d'en coder une en dur : choisir 2024-25 montre les regles
   de 2024-25, pas celles de cette annee. */
const R = window.NHL_REGLES || null;

const REGLES = R ? {
  saison: R.label,
  poolers: R.poolers,
  cotisation: {
    base: R.cotisation.pool || 0,
    poolexpert: R.cotisation.poolexpert || 0,
    trades: R.cotisation.trades || 2,
    parTrade: R.cotisation.parTrade || 0,
    pizza: R.cotisation.pizza || 0
  },
  verse: R.verse,
  bourses: R.bourses.map(b => ({
    rang: b.rang + (b.rang === 1 ? 're' : 'e') + ' position',
    montant: b.montant,
    ballottage: b.ballottage
  })),
  penalites: R.penalites.map(p => ({
    rang: p.rang + (p.rang === 1 ? 're' : 'e'),
    montant: p.montant
  })),
  ballottage: {
    maxJoueurs: R.ballottage.max,
    limite: R.ballottage.limite,
    cout: R.ballottage.cout,
    penaliteNonComptant: 10
  }
} : null;


function render() {
  const box = $('content');
  box.innerHTML = '';

  // Une saison sans regles.txt : on le dit plutôt que de planter.
  if (!REGLES) {
    const p = el('div', 'panel');
    p.append(el('div', 'empty-state',
      'Aucun règlement pour cette saison. Ajoutez data/<saison>/regles.txt ' +
      'puis lancez build-rules.ps1.'));
    box.append(p);
    return;
  }

  const C = REGLES.cotisation;
  // verse vient du fichier : il inclut la pizza quand la saison en avait une.
  const verse = REGLES.verse || (C.base + C.poolexpert + C.trades * C.parTrade);

  const split = el('div', 'rg-split');

  /* ---- Colonne de gauche : l'argent ---- */
  const gauche = el('div');

  const cot = [];
  cot.push(ligne('Pool', euro(C.base)));
  cot.push(ligne('PoolExpert', euro(C.poolexpert)));
  cot.push(ligne(C.trades + ' trades (' + euro(C.parTrade) + ' chacun)',
                 euro(C.trades * C.parTrade)));
  if (C.pizza) cot.push(ligne('Pizza', euro(C.pizza)));
  cot.push(ligne('Versé au départ', euro(verse), 'rg-total'));
  // Dit ici parce que c'est la première section qu'on lit, et que l'écart
  // entre le prix du pool et le total versé se remarque tout de suite.
  const remb = el('p', 'hint rg-remb');
  remb.innerHTML = '↩ Les trades non utilisés sont <b>remboursés</b> en fin de ' +
    "saison : " + euro(C.parTrade) + " par trade que vous n'avez pas fait.";
  cot.push(remb);
  gauche.append(bloc('Cotisation ' + REGLES.saison, cot));

  const bou = REGLES.bourses.map(b =>
    ligne(b.rang, (b.montant ? euro(b.montant) + ' ' : '') + '+ ¼ ballottage'));
  const potNote = el('p', 'hint');
  potNote.innerHTML = 'Le pot suit le nombre de participants : <b>' +
    REGLES.poolers + ' × ' + euro(C.base) + ' = ' +
    euro(REGLES.poolers * C.base) + '</b>. La bourse du ballottage s’ajoute, ' +
    'divisée en quatre parts égales entre les quatre premières positions.';
  bou.push(potNote);
  gauche.append(bloc('Bourses', bou));

  const pen = REGLES.penalites.map(p =>
    ligne(p.rang + ' position',
          p.montant ? euro(p.montant) + ' à payer' : 'rien à payer',
          p.montant ? 'rg-pay' : ''));
  pen.push(el('p', 'hint',
    'Au classement final : la moitié inférieure remet de l’argent, ce qui ' +
    'garde la fin de saison intéressante même loin du sommet. Cet argent ne ' +
    'va pas aux gagnants — il paie la bouffe du repêchage suivant.'));
  gauche.append(bloc('À payer au classement final', pen));

  split.append(gauche);

  /* ---- Colonne de droite : les règles ---- */
  const droite = el('div');

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

  /* ---- Les participants de la saison ---- */
  const poolers = (window.POOL_DATA && window.POOL_DATA.poolers) || [];
  if (poolers.length) {
    const lst = el('div', 'rg-poolers');
    poolers.forEach((p, i) => {
      const row = el('div', 'rg-pooler');
      row.append(el('span', 'rg-pooler-n', String(i + 1)));
      row.append(el('span', 'rg-pooler-nm', p.name));
      lst.append(row);
    });
    const n = el('p', 'hint',
      poolers.length + ' participants. Le barème des pénalités et le montant ' +
      'des bourses en dépendent directement.');
    droite.append(bloc('Participants ' + REGLES.saison, [lst, n]));
  }

  split.append(droite);
  box.append(split);
}

/* ---- Go ---------------------------------------------------------------- */
wireSeasonBadge();
wireThemeToggle();
render();
