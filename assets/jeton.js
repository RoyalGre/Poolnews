/* =========================================================================
   jeton.js — prouver qui envoie une prédiction.

   LE PROBLÈME. Les deux mini-jeux écrivent dans Firestore sans que rien ne
   vérifie l'identité : le nom vient d'un menu déroulant, et n'importe qui
   pouvait envoyer sous le nom d'un autre — ou écrire directement dans la
   base sans même ouvrir la page.

   COMMENT ÇA MARCHE. Chaque pooleur a un jeton personnel. Il l'entre une
   fois ; le navigateur s'en souvient ensuite. À l'envoi, la page calcule
   sha256(jeton + nom) et joint cette empreinte à la prédiction. Les règles
   Firestore la comparent à celle rangée dans /secrets/<nom>.

   CE QUI LIE LE NOM AU JETON. Le document écrit s'appelle picks/<nom>, donc
   la règle va lire secrets/<ce même nom>. L'empreinte de Pascal ne peut pas
   autoriser une écriture sous le nom de Steve : la règle vérifie le secret
   du document qu'on écrit, pas celui qu'on prétend être. Ce n'est pas une
   vérification que la page fait — la page ne garantit rien — c'est la
   structure de la règle.

   POURQUOI UNE EMPREINTE ET NON LE JETON. Firestore n'offre aucun moyen
   d'envoyer une donnée que les règles voient sans qu'elle soit écrite : un
   champ absent de l'updateMask est ignoré avant même les règles — vérifié
   sur la vraie base. Le jeton finirait donc stocké, et /picks est lisible
   par tous : il suffirait de le lire pour usurper son propriétaire.
   L'empreinte ne se remonte pas jusqu'au jeton.

   ┌─ CE QUE ÇA N'ARRÊTE PAS ────────────────────────────────────────────┐
   │ Un pooleur peut lire l'empreinte d'un autre dans la base et la      │
   │ renvoyer pour écraser ses choix. On ne peut pas écrire sous un nom  │
   │ dont on n'a pas l'empreinte, mais rien n'empêche de rejouer une     │
   │ empreinte vue. Seule une vraie authentification — Firebase Auth,    │
   │ « se connecter avec Google » — fermerait ça.                        │
   │                                                                     │
   │ Ce dispositif arrête un inconnu qui trouverait l'adresse du projet, │
   │ et un pooleur qui choisirait simplement le nom d'un autre dans le   │
   │ menu. C'est ce qui a été demandé en connaissance de cause.          │
   └─────────────────────────────────────────────────────────────────────┘
   ========================================================================= */

const JETON_KEY = 'hockeyPool.jeton';

/* ---- L'empreinte ---------------------------------------------------------
   Le jeton lui-meme ne part jamais tel quel. On envoie sha256(jeton + nom),
   et les regles comparent a l'empreinte rangee dans /secrets/<nom>.

   POURQUOI UNE EMPREINTE ET NON LE JETON. Firestore n'offre aucun moyen
   d'envoyer une donnee que les regles voient sans qu'elle soit ecrite : un
   champ absent de l'updateMask est ignore avant meme les regles (verifie
   sur la vraie base). Le jeton serait donc stocke, et /picks est lisible
   par tous -- il suffirait de le lire pour usurper son proprietaire.
   L'empreinte, elle, ne se remonte pas jusqu'au jeton.

   CE QUE CA N'ARRETE PAS, et il faut le savoir : un pooleur peut lire
   l'empreinte d'un autre dans la base et la renvoyer pour ecraser ses
   choix. Le nom est lie au jeton -- on ne peut pas ecrire sous un nom dont
   on n'a pas l'empreinte -- mais rien n'empeche de rejouer une empreinte
   vue. Seule une vraie authentification (Firebase Auth) fermerait ca.

   Le sel inclut le nom : l'empreinte de Steve ne vaut pas pour Pascal, meme
   si par malheur les deux choisissaient le meme jeton. */
function empreinteJeton(jeton, nom) {
  const texte = String(jeton) + '|' + String(nom);
  const bytes = new TextEncoder().encode(texte);
  return crypto.subtle.digest('SHA-256', bytes).then(buf => {
    const o = [];
    new Uint8Array(buf).forEach(b => o.push(b.toString(16).padStart(2, '0')));
    return o.join('');
  });
}

/* Ce que le navigateur a retenu : { "Steve T.": "quartz-4417", ... }
   Un jeton par nom, parce qu'un appareil peut servir à deux personnes — le
   portable de la cuisine, un pooleur qui dépanne un autre. */
function jetonsConnus() {
  try {
    const raw = localStorage.getItem(JETON_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}

function jetonDe(nom) {
  return jetonsConnus()[nom] || '';
}

function retenirJeton(nom, jeton) {
  try {
    const o = jetonsConnus();
    o[nom] = jeton;
    localStorage.setItem(JETON_KEY, JSON.stringify(o));
  } catch (e) { /* navigation privée : il le retapera, rien de casse */ }
}

function oublierJeton(nom) {
  try {
    const o = jetonsConnus();
    delete o[nom];
    localStorage.setItem(JETON_KEY, JSON.stringify(o));
  } catch (e) { }
}

/* ---- Le champ dans le formulaire ---------------------------------------
   Il ne paraît que si ce navigateur ne connaît pas encore le jeton du nom
   choisi. Le demander à chaque fois ferait abandonner : un pooleur remplit
   trente matchs, il ne va pas retaper un code chaque semaine.

   Rendu par les deux jeux au même endroit : juste sous le menu des noms,
   avant le bouton d'envoi. */
function champJeton(onChange) {
  const box = el('div', 'df-field jeton-field');
  box.hidden = true;

  const lab = el('label', null, 'Jeton');
  lab.htmlFor = 'jetonInput';
  box.append(lab);

  const inp = document.createElement('input');
  inp.type = 'password';
  inp.id = 'jetonInput';
  inp.className = 'jeton-input';
  inp.autocomplete = 'off';
  inp.placeholder = 'votre code personnel';
  inp.oninput = () => { if (onChange) onChange(); };
  box.append(inp);

  const aide = el('span', 'jeton-aide', 'demandé une seule fois');
  box.append(aide);

  box._input = inp;
  box._aide = aide;
  return box;
}

/* Montrer ou cacher le champ selon le pooleur choisi, et dire à l'envoi quel
   jeton employer. Retourne '' quand on n'en a pas — l'appelant refuse alors
   de partir. */
function jetonPour(champ, nom) {
  if (!champ) return '';
  const connu = nom ? jetonDe(nom) : '';
  if (connu) {
    // Déjà mémorisé : on n'embête personne.
    champ.hidden = true;
    champ._input.value = '';
    return connu;
  }
  champ.hidden = !nom;          // pas de nom choisi : rien à demander encore
  return champ._input.value.trim();
}

/* Après un envoi refusé par les règles, le jeton est faux : on le jette pour
   que le champ réapparaisse au lieu de réessayer indéfiniment le mauvais. */
function jetonRejete(champ, nom) {
  if (nom) oublierJeton(nom);
  if (champ) {
    champ.hidden = false;
    champ._input.value = '';
    champ._input.focus();
  }
}

/* ---- Le petit lien « changer de jeton » --------------------------------
   Sur l'appareil où le jeton est mémorisé, rien ne le rappelle. Ce lien
   permet d'en changer — nouveau jeton distribué, ou appareil prêté. */
function lienOublierJeton(champ, nomFn, onChange) {
  const a = el('button', 'linkbtn jeton-reset', 'changer de jeton');
  a.type = 'button';
  a.onclick = () => {
    const nom = nomFn();
    if (!nom) return;
    oublierJeton(nom);
    champ.hidden = false;
    champ._input.value = '';
    champ._input.focus();
    if (onChange) onChange();
  };
  return a;
}
