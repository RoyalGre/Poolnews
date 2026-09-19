/* =========================================================================
   rules.js — Règlements, bourses et ballottage.

   Le texte vient de Pool_25-26.xlsx (feuille « Résultats », lignes 59-93),
   la source de vérité du pool. Il est recopié ici plutôt que lu du fichier :
   un .xlsx ne se lit pas depuis une page file://, et ces règles changent une
   fois par année, pas une fois par semaine.

   Les montants et la date limite sont regroupés en haut pour qu'une saison
   suivante se mette à jour en un seul endroit.
   ========================================================================= */

const REGLES = {
  saison: '2025-26',
  cotisation: { base: 80, poolexpert: 2 },
  bourses: [
    { rang: '1re position', montant: 540 },
    { rang: '2e position',  montant: 220 },
    { rang: '3e position',  montant: 120 },
    { rang: '4e position',  montant: 0 }
  ],
  // Le bas du classement paie : c'est ce qui garde la fin de saison vivante.
  penalites: [
    { rang: '5e',  montant: 0 },
    { rang: '6e',  montant: 10 },
    { rang: '7e',  montant: 15 },
    { rang: '8e',  montant: 20 },
    { rang: '9e',  montant: 25 },
    { rang: '10e', montant: 30 },
    { rang: '11e', montant: 35 }
  ],
  ballottage: {
    maxJoueurs: 2,
    limite: '6 mars 2026 à 23 h 59',
    cout: 10,
    penaliteNonComptant: 10
  }
};

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

  const cot = [];
  cot.push(ligne('Par participant', euro(REGLES.cotisation.base)));
  cot.push(ligne('PoolExpert', euro(REGLES.cotisation.poolexpert)));
  cot.push(ligne('Total', euro(REGLES.cotisation.base + REGLES.cotisation.poolexpert), 'rg-total'));
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
    'garde la fin de saison intéressante même loin du sommet.'));
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

  split.append(droite);
  box.append(split);

  const note = el('p', 'hint');
  note.textContent = 'Règlements de la saison ' + REGLES.saison +
    ' — source : Pool_25-26.xlsx, feuille Résultats.';
  box.append(note);
}

/* ---- Go ---------------------------------------------------------------- */
wireSeasonBadge();
wireThemeToggle();
render();
