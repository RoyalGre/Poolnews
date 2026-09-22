/* =========================================================================
   landing.js — la page d'accueil.

   Rien ici n'invente de chiffres. Le classement affiché vient de
   scoreRoster() dans core.js, exactement comme la page Classement : meilleurs
   10 des 12, avec au moins un défenseur. Réimplémenter la règle ici aurait
   donné deux vérités possibles pour la même question.

   La page doit rester lisible même sans données — un visiteur qui ouvre le
   site depuis une copie incomplète doit voir le menu, pas une page blanche.
   Chaque bloc de chiffres s'efface tout seul si sa source manque.
   ========================================================================= */

/* statsFor() vit dans standings.js, pas dans core.js. C'est le même choix en
   une ligne : l'historique quand il existe, les totaux de la saison sinon. */
function landingStats() {
  return WEEK_COUNT ? statsAtWeek(WEEK_COUNT - 1) : statsSeason();
}

/* Le classement courant, une entrée par pooleur, meilleur en premier. */
function landingStandings() {
  if (!state.poolers.length) return [];
  const statOf = landingStats();
  return state.poolers
    .map((pl, i) => ({
      name:  pl.name,
      color: colorFor(i),
      pts:   scoreRoster(pl.picks, statOf).pts
    }))
    .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
}

/* ---- Le classement ------------------------------------------------------
   La colonne de droite a la hauteur pour tout le monde, alors tout le monde y
   est. Les trois premiers gardent la couleur de leur rang ; les autres
   passent en gris pour que le trio de tête se lise d'un coup d'œil. */
function renderPodium() {
  const box = $('podium');
  if (!box) return;

  const rows = landingStandings();
  if (!rows.length) { box.closest('.panel').hidden = true; return; }

  box.textContent = '';
  rows.forEach((r, i) => {
    const line = el('a', 'lp-rank' + (i < 3 ? '' : ' lp-back'));
    line.href = 'standings.html';

    const rk = el('span', 'rank' + (i < 3 ? ' r' + (i + 1) : ''), String(i + 1));
    const chip = el('span', 'chip');
    chip.style.background = r.color;

    line.append(rk, chip, el('span', 'nm', r.name), el('span', 'pts', r.pts + ' pts'));
    box.append(line);
  });
}

/* ---- La ligne de contexte sous le titre --------------------------------- */
function renderLede() {
  const box = $('lede');
  if (!box) return;

  const bits = [];
  if (state.poolers.length) bits.push(state.poolers.length + ' pooleurs');
  if (WEEK_COUNT) {
    const w = WEEKS[WEEK_COUNT - 1];
    bits.push('semaine ' + w.w);
  }
  if (DATA.statsSeason) bits.push('saison ' + DATA.statsSeason);

  if (!bits.length) { box.hidden = true; return; }
  box.textContent = bits.join(' · ');
}

/* Le sélecteur de thème repeint les couleurs des pooleurs, choisies en JS et
   donc insensibles aux variables CSS. wireThemeToggle() appelle render() s'il
   existe : c'est ce crochet-là. */
function render() {
  renderPodium();
}

/* ---- Le choix de la saison ---------------------------------------------
   Une pastille par saison, la courante en premier. Construite à partir de
   data/seasons.js : ajouter une saison ne demande de toucher ni cette
   fonction ni index.html.

   Une saison qui n'a encore aucune donnée propre — 2026-27 avant le premier
   match — le dit plutôt que de faire croire à une page vide. */
function renderSeasons() {
  const box = $('seasonPick');
  if (!box || !window.poolSeason) return;

  const all = poolSeason.all || [];
  // Une seule saison : le choix n'en est pas un, on n'affiche rien.
  if (all.length < 2) { box.hidden = true; return; }

  box.textContent = '';
  box.append(el('span', 'lp-seasons-lbl', 'Saison'));

  all.forEach(sn => {
    const on  = sn.label === poolSeason.label;
    const b   = el('button', 'lp-season' + (on ? ' on' : ''));
    b.append(el('span', 'lp-season-yr', sn.label));

    if (sn.label === poolSeason.current) {
      b.append(el('span', 'lp-season-tag', 'en cours'));
    } else if (!sn.files.length) {
      b.append(el('span', 'lp-season-tag', 'à venir'));
    }

    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? 'Saison affichée' : 'Afficher la saison ' + sn.label;
    if (!on) b.onclick = () => poolSeason.set(sn.label);
    box.append(b);
  });
}

renderLede();
renderSeasons();
renderPodium();
wireSeasonBadge();
wireRecordsLink();
wireThemeToggle();
wirePublishedBadge();
renderStamp();
