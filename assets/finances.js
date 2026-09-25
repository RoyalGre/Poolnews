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
  // Une saison pas encore repechee n'a pas de classement : douze alignements
  // vides se valent tous. Le detecter ici plutot qu'en dur evite d'avoir un
  // drapeau a lever le jour du repechage -- le premier choix publie suffit.
  const jouee = pool.poolers.some(pl => (pl.picks || []).some(x => x));

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
    // Tout ce qui depend du rang attend le classement. Sans repechage, le
    // rang ne vaut rien -- il sort de l'ordre du fichier -- et verser 600 $
    // au premier de douze alignements vides serait une invention.
    r.pos    = jouee ? (pena[r.rang] || 0) : 0;
    r.bourse = jouee ? (bourse[r.rang] || 0) : 0;
    r.ballot = (jouee && r.rang <= 4) ? part : 0;
    r.utilise = base + r.trades * parTrade;
    r.remis   = verse - r.utilise;
    r.solde   = verse - r.utilise - r.pena - r.pos + r.bourse + r.ballot;
  });

  // Le detail du versement de depart. « Prepaye » en une case cachait de
  // quoi il etait fait : le pool, PoolExpert, la bouffe et les trades sont
  // quatre destinations differentes, et seule la derniere est remboursable.
  const cot = R.cotisation || {};
  return {
    saison: R.label,
    jouee: jouee,
    prepaye: verse,
    cotPool: cot.pool || 0,
    cotExpert: cot.poolexpert || 0,
    cotBouffe: cot.pizza || 0,
    // « Pizza = » sans montant dans regles.txt : la part sera percue, le
    // prix n'est pas encore fixe. La colonne parait avec un tiret, sinon on
    // oublierait qu'elle doit etre remplie avant de reclamer l'argent.
    bouffeAVenir: !!cot.pizzaAVenir,
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
/* Les tarifs de l'annee qui commence. season.js charge son regles.js sous
   NHL_REGLES_SUIV : c'est la vraie grille, pas celle de l'annee soldee.
   Les deux different -- PoolExpert est passe de 2 $ a 3 $ entre 2025-26 et
   2026-27 -- et se tromper ici fausse le montant que le pooleur doit. Sans
   ce fichier (derniere saison connue), on retombe sur la grille affichee et
   on le dit dans la note sous le tableau. */
const SUIV = (function () {
  const N = window.NHL_REGLES_SUIV, R = window.NHL_REGLES;
  const src = N || R;
  if (!src) return null;
  const c = src.cotisation || {};
  // Sans fichier pour l'annee suivante on reprend la grille affichee : c'est
  // la meilleure estimation possible. Mais il faut nommer l'annee a venir,
  // pas celle qu'on solde -- « saison 2026-27 a payer » sur la page de
  // 2026-27 ne veut rien dire.
  const suite = (window.poolSeason && poolSeason.next && poolSeason.next()) || null;
  const an = src.label.slice(0, 4);
  const devine = an && /^\d{4}$/.test(an)
    ? (+an + 1) + '-' + String((+an + 2) % 100).padStart(2, '0')
    : '';
  return {
    label: N ? src.label : (suite || devine || src.label),
    estime: !N,                       // vrai quand on a du deviner
    total: src.verse || 0,
    pool: c.pool || 0,
    expert: c.poolexpert || 0,
    bouffe: c.pizza || 0,
    bouffeAVenir: !!c.pizzaAVenir,
    // Les trades sont payes d'avance et rembourses s'ils ne servent pas.
    // Ils font partie de la cotisation : sans cette colonne, le cote droit
    // affichait 83 $ la ou le net en deduit 103 -- et le pooleur qui
    // additionne les colonnes ne retombait pas sur son propre total.
    nbTrades: (c.trades || 2),
    parTrade: (c.parTrade || 0)
  };
})();

const COTIS_SUIV = SUIV ? SUIV.total : 0;


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
  intro.append(el('h2', null, (sp.jouee ? 'Bilan de la saison ' : 'Saison ') +
                              sp.saison));
  const id = el('div', 'prose');
  // Une saison pas encore repechee n'a pas de comptes a rendre : le dire,
  // plutot que d'annoncer le bilan d'une annee qui n'a pas commence.
  id.innerHTML = sp.jouee
    ? 'Les comptes de l’année qui vient de finir, à <b>' + sp.poolers.length +
      ' pooleurs</b>. Les montants de cette page sont ceux de ' + sp.saison +
      ' — pour les tarifs de la saison en cours, voir <a href="reglements.html">' +
      'Règlements</a>.'
    : '<b>La saison ' + sp.saison + ' n’a pas encore été repêchée.</b> Les ' +
      'tarifs sont connus — ' + euro(sp.prepaye) + ' par pooleur, à <b>' +
      sp.poolers.length + ' pooleurs</b> — mais rien n’est encore dû ni gagné : ' +
      'le solde, la cotisation suivante et le montant à régler attendent le ' +
      'classement final. Voir <a href="reglements.html">Règlements</a>.';
  intro.append(id);
  box.append(intro);

  // ---- Le tableau -------------------------------------------------------
  const rappel = el('div', 'rg-callout');
  // Le detail dit ou va chaque dollar du depart. Les trois premieres parts
  // sont depensees pour de bon ; la quatrieme revient si elle ne sert pas,
  // et c'est justement ce que le tableau montre colonne par colonne.
  const parts = [euro(sp.cotPool) + ' au pot du pool',
                 euro(sp.cotExpert) + ' à PoolExpert'];
  if (sp.cotBouffe) parts.push(euro(sp.cotBouffe) + ' à la bouffe');
  parts.push(euro(sp.nbTrades * sp.parTrade) + ' pour ' + sp.nbTrades + ' trades');
  rappel.innerHTML =
    '<b>Les trades inutilisés sont remboursés.</b> Chacun a versé <b>' +
    euro(sp.prepaye) + '</b> au départ : ' +
    parts.slice(0, -1).join(', ') + ' et ' + parts[parts.length - 1] +
    '. Un trade coûte ' + euro(sp.parTrade) + " : celui qui n'en utilise " +
    'aucun récupère la somme entière.' +
    // La part du repas n'est pas dans ce total puisqu'elle n'est pas
    // chiffree : l'annoncer evite qu'on prenne 102 $ pour la note finale.
    (sp.bouffeAVenir
      ? ' <b>S’ajoutera la part du repas</b>, une fois le prix connu.'
      : '') +
    // Le tableau change d'annee en cours de route : le dire ici evite de
    // lire les colonnes de droite comme si elles soldaient l'an dernier.
    (SUIV
      ? ' <b>À droite du trait doré</b>, ce que demande la saison ' +
        SUIV.label + ' : ' + euro(SUIV.total) + ' par pooleur, déduits du solde.'
      : '');

  const tw = el('div', 'tablewrap');
  const t = el('table', 'rg-tbl');

  const thead = el('thead');
  const hr = el('tr');
  /* Le tableau raconte deux annees, et c'est ce qui le rendait confus : on y
     solde celle qui finit PUIS on annonce ce que coute celle qui commence.
     Tout ce qui suit « Solde » appartient donc a l'annee suivante -- sa
     cotisation detaillee (pool, PoolExpert, repas) et le net a regler -- et
     une separation le dit a l'oeil.

     Les trois colonnes de cotisation etaient a gauche, avec les montants de
     l'annee soldee : elles decrivaient ce qui avait ete verse, pas ce qui
     est du. Passees a droite, elles portent les tarifs de la saison qui
     commence, qui ne sont pas les memes. */
  const colBouffe = !!(SUIV && (SUIV.bouffe || SUIV.bouffeAVenir));

  const entetes = [['', ''], ['Pooleur', ''],
   ['Trades', 'num'], ['Remis', 'num'], ['Pénal.', 'num'], ['Pos.', 'num'],
   ['Bourse', 'num'], ['Ballot.', 'num'], ['Solde', 'num'],
   // --- bascule vers la saison suivante ---
   ['Pool', 'num sep'], ['POOLEXPERT', 'num']];
  if (colBouffe) entetes.push(['PIZZA', 'num']);
  const colTradesSuiv = !!(SUIV && SUIV.parTrade);
  if (colTradesSuiv) entetes.push(['Trades', 'num']);
  entetes.push(['À régler', 'num']);

  const sLabel = SUIV ? SUIV.label : '';
  entetes.forEach(([h, c]) => {
      // Deux colonnes portent un logo plutot qu'un mot : « PoolExpert » est
      // long et « Pizza » disait moins bien que le dessin. Sur treize
      // colonnes, la largeur gagnee compte.
      if (h === 'PIZZA') {
        const th = el('th', c + ' rg-th-pizza');
        th.append(pizzaSVG());
        th.title = (SUIV && SUIV.bouffe)
          ? 'Part du repas du repêchage ' + sLabel + ' — ' + euro(SUIV.bouffe) +
            ' par pooleur, ajusté à la commande'
          : 'Part du repas du repêchage ' + sLabel +
            ' — prix connu au moment de commander';
        hr.append(th);
      } else if (h === 'POOLEXPERT') {
        const th = el('th', c + ' rg-th-pe');
        const img = document.createElement('img');
        img.className = 'rg-pe-mini';
        img.src = 'assets/img/poolexpert.jpg';
        img.alt = 'PoolExpert';
        img.width = 62;
        img.height = 20;
        th.append(img);
        th.title = 'Abonnement PoolExpert ' + sLabel +
                   (SUIV ? ' — ' + euro(SUIV.expert) + ' par pooleur' : '');
        hr.append(th);
      } else {
        hr.append(el('th', c, h));
      }
    });
  thead.append(hr);

  /* Une seconde ligne d'en-tete nomme les deux moities : sans elle, la
     separation se voit mais ne se comprend pas. */
  if (SUIV) {
    const hr2 = el('tr', 'rg-eras');
    const g = el('th', 'rg-era-l');
    g.colSpan = 9;
    g.textContent = 'Saison ' + sp.saison + ' — le bilan';
    hr2.append(g);
    const d = el('th', 'rg-era-r sep');
    d.colSpan = 3 + (colBouffe ? 1 : 0) + (colTradesSuiv ? 1 : 0);
    d.textContent = 'Saison ' + sLabel + ' — à payer' +
                    (SUIV.estime ? ' (tarifs estimés)' : '');
    hr2.append(d);
    thead.append(hr2);
  }
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
    // Solde, cotisation suivante et a-regler n'existent qu'une fois la
    // saison jouee : ils soldent des comptes que personne n'a encore faits.
    // Vides plutot qu'a zero -- un zero se lit comme un montant.
    if (!sp.jouee) {
      tr.append(el('td', 'num solde rg-vide', '—'));
      tr.append(el('td', 'num sep rg-vide', '—'));
      tr.append(el('td', 'num rg-vide', '—'));
      if (colBouffe) tr.append(el('td', 'num rg-vide', '—'));
      if (colTradesSuiv) tr.append(el('td', 'num rg-vide', '—'));
      tr.append(el('td', 'num net rg-vide', '—'));
      tb.append(tr);
      return;
    }
    tr.append(el('td', 'num solde ' + (solde >= 0 ? 'gain' : 'perte'),
                 (solde >= 0 ? '+' : '') + solde.toFixed(2) + ' $'));

    /* ---- A droite : la saison qui commence -----------------------------
       Le detail de sa cotisation, puis le net. Les montants sont ceux de
       CETTE saison-la, pas de celle qu'on vient de solder. */
    tr.append(el('td', 'num sep', '−' + euro(SUIV ? SUIV.pool : 0)));
    tr.append(el('td', 'num', '−' + euro(SUIV ? SUIV.expert : 0)));
    if (colBouffe) {
      tr.append(el('td', 'num rg-pizza-cell',
                   SUIV && SUIV.bouffe ? '−' + euro(SUIV.bouffe) : '—'));
    }
    if (colTradesSuiv) {
      tr.append(el('td', 'num', '−' + euro(SUIV.nbTrades * SUIV.parTrade)));
    }
    // Les comptes se règlent une fois l'an : le solde vient en déduction de
    // la cotisation de la saison qui commence.
    const net = solde - COTIS_SUIV;
    tr.append(el('td', 'num net ' + (net >= 0 ? 'gain' : 'perte'),
                 (net >= 0 ? '+' : '') + net.toFixed(2) + ' $'));
    tb.append(tr);
  });
  t.append(tb);

  const tf = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', '', ''));
  fr.append(el('td', 'rg-nm', 'Total'));
  const n = sp.poolers.length;
  // Arrondi au cent : 2,85 $ x 12 en virgule flottante peut sortir
  // 34,199999999999996, et personne ne veut lire ca dans un total.
  const cents = v => euro(Math.round(v * 100) / 100);
  // Penalites, bourses et ballottage se decident au classement final : avant
  // le repechage un « 0 $ » se lirait comme un resultat alors qu'il n'y a
  // rien a totaliser. Les trades non employes, eux, sont bel et bien dus --
  // personne n'en a fait, donc tout le monde recupere sa mise.
  const z = v => sp.jouee ? v : '—';
  const zc = sp.jouee ? '' : ' rg-vide';
  const pieds = [
   [tot.tr + ' / ' + (sp.nbTrades * n), ''],
   ['+' + cents(tot.pre - tot.uti), ''],
   [z(euro(tot.pena)), zc], [z(euro(tot.pos)), zc], [z(euro(tot.bou)), zc],
   [z(tot.bal.toFixed(2) + ' $'), zc]];
  pieds.forEach(([v, c]) => fr.append(el('td', 'num' + c, v)));
  // Pas de total pour le solde : additionner des gains et des pertes donne un
  // nombre que personne ne verse ni ne reçoit.
  fr.append(el('td', 'num solde', '—'));

  /* A droite, les totaux de la saison qui commence : ce que le groupe verse
     au pot, ce que coute l'abonnement, ce que pese le repas. Ceux-la
     s'additionnent vraiment -- contrairement au solde. */
  fr.append(el('td', 'num sep', SUIV ? '−' + cents(SUIV.pool * n) : '—'));
  fr.append(el('td', 'num', SUIV ? '−' + cents(SUIV.expert * n) : '—'));
  if (colBouffe) {
    fr.append(el('td', 'num rg-pizza-cell',
                 SUIV && SUIV.bouffe ? '−' + cents(SUIV.bouffe * n) : '—'));
  }
  if (colTradesSuiv) {
    fr.append(el('td', 'num', '−' + cents(SUIV.nbTrades * SUIV.parTrade * n)));
  }
  fr.append(el('td', 'num net', '—'));
  tf.append(fr);
  t.append(tf);
  tw.append(t);

  // ---- Où va l'argent qui ne finit pas en bourses -----------------------
  const penaTrade = sp.poolers.reduce((t2, p) => t2 + p.pena, 0);
  const penaPos   = sp.poolers.reduce((t2, p) => t2 + p.pos, 0);

  // Avant le repechage il n'y a ni penalite ni part percue : annoncer
  // « 0 $ au menu » ferait croire a un budget vide alors qu'il n'est pas
  // encore ouvert. Le bloc attend que la saison soit jouee.
  let bouffe = null;
  if (sp.jouee) {
    bouffe = el('div', 'rg-bouffe');
    bouffe.append(pizzaSVG());
    const bt = el('div', 'rg-bouffe-txt');
    const bh = el('div', 'rg-bouffe-h');
    bh.innerHTML = 'Les pénalités paient la <b>bouffe du repêchage</b>';
    bt.append(bh);
    const bl = el('div', 'rg-bouffe-l');
    // Le repas a deux sources : les penalites et, les saisons ou elle est
    // percue, la part versee par chaque pooleur. N'en nommer qu'une donnait
    // un budget plus petit que la realite.
    const partBouffe = Math.round(sp.cotBouffe * sp.poolers.length * 100) / 100;
    let txt = 'Pénalités de position <b>' + euro(penaPos) + '</b> + pénalités ' +
              'de trade <b>' + euro(penaTrade) + '</b>';
    if (partBouffe) {
      txt += ' + la part de chacun <b>' + euro(partBouffe) + '</b> (' +
             euro(sp.cotBouffe) + ' × ' + sp.poolers.length + ')';
    }
    txt += ' = <b>' +
           euro(Math.round((penaPos + penaTrade + partBouffe) * 100) / 100) +
           '</b> au menu du prochain repêchage.';
    // Une part est prevue mais pas encore chiffree : sans le dire, le total
    // se lirait comme le budget definitif alors qu'il va monter.
    if (sp.bouffeAVenir) {
      txt += ' <b>La part de chacun s’ajoutera</b> dès que le prix du repas ' +
             'sera connu.';
    }
    bl.innerHTML = txt;
    bt.append(bl);
    bouffe.append(bt);
  }

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
  if (bouffe) duo.append(bouffe);
  duo.append(pe);

  const nbRemis = sp.poolers.filter(p => p.trades < sp.nbTrades).length;
  const totRemis = sp.poolers.reduce((t2, p) => t2 + p.remis, 0);
  // « 12 pooleurs sur 12 n'ont pas utilise leurs trades » serait vrai et
  // trompeur avant le repechage : la saison n'a pas encore eu lieu.
  const noteFin = el('p', 'hint', sp.jouee
    ? 'Colonne « Remis » : ' + nbRemis + ' pooleurs sur ' + sp.poolers.length +
      " n'ont pas utilisé leurs deux trades et se font rembourser " +
      euro(totRemis) + ' au total.'
    : 'Colonne « Remis » : aucun trade n’a encore été fait, donc les ' +
      euro(sp.nbTrades * sp.parTrade) + ' de chacun sont pour l’instant ' +
      'remboursables en entier. Chaque échange en retranchera ' +
      euro(sp.parTrade) + '.');

  // Un lien qui porte la saison : « regarde les finances de 2023-24 » doit
  // ouvrir 2023-24 chez le destinataire, pas la saison qu'il consultait.
  const lien = seasonLinkButton('ce bilan');
  const bas = [rappel, tw, duo, noteFin];
  if (lien) bas.push(lien);
  box.append(bloc(sp.jouee ? 'Qui doit quoi' : 'Ce qui est déjà versé', bas));

  const tradesBloc = blocTrades();
  if (tradesBloc) box.append(tradesBloc);
}

/* ---- Go ---------------------------------------------------------------- */
wireSeasonBadge();
wireRecordsLink();
wireThemeToggle();
render();
