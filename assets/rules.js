/* =========================================================================
   rules.js — les règles et les tarifs de la saison qui commence.

   Cette page regarde en AVANT : 12 pooleurs, cotisation 2026-27, bourses
   recalculées sur le nouveau nombre de participants. Le bilan de l'année
   écoulée vit dans finances.js, parce que ses montants sont différents et
   que les mélanger rendait chaque chiffre ambigu.

   Les montants sont regroupés ici en tête pour qu'une nouvelle saison se
   mette à jour à un seul endroit.
   ========================================================================= */

const REGLES = {
  saison: '2026-27',
  poolers: 12,
  cotisation: { base: 80, poolexpert: 3, trades: 2, parTrade: 10 },
  // Le pot suit le nombre de participants : 12 x 80 = 960 $. À 11 pooleurs
  // il était de 880 $ et les bourses se lisaient 540/220/120.
  bourses: [
    { rang: '1re position', montant: 600 },
    { rang: '2e position',  montant: 240 },
    { rang: '3e position',  montant: 120 },
    { rang: '4e position',  montant: 0 }
  ],
  // Le bas du classement paie : c'est ce qui garde la fin de saison vivante.
  // À 12 pooleurs, cinq positions sont à l'abri au lieu de quatre.
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

function render() {
  const box = $('content');
  box.innerHTML = '';
  const C = REGLES.cotisation;
  const verse = C.base + C.poolexpert + C.trades * C.parTrade;

  const split = el('div', 'rg-split');

  /* ---- Colonne de gauche : l'argent ---- */
  const gauche = el('div');

  const cot = [];
  cot.push(ligne('Pool', euro(C.base)));
  cot.push(ligne('PoolExpert', euro(C.poolexpert)));
  cot.push(ligne(C.trades + ' trades (' + euro(C.parTrade) + ' chacun)',
                 euro(C.trades * C.parTrade)));
  cot.push(ligne('Versé au départ', euro(verse), 'rg-total'));
  // Dit ici parce que c'est la première section qu'on lit, et que la question
  // « pourquoi 103 $ alors que le pool coûte 80 $ » se pose tout de suite.
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
