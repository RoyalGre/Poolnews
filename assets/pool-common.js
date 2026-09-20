/* =========================================================================
   pool-common.js — les quelques briques partagées par les pages Règlements
   et Finances.

   Les deux pages parlent d'argent et de règles, mais de deux saisons
   différentes : Règlements décrit la saison qui commence, Finances fait le
   bilan de celle qui vient de finir. Elles n'ont donc presque rien en commun
   sauf ces helpers de mise en page — d'où ce fichier plutôt qu'un gros
   module partagé.

   Chargé avant rules.js ou finances.js, après core.js (qui fournit el()).
   ========================================================================= */

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

/* La pizza du repêchage, dessinée plutôt que chargée : nette à toute taille,
   elle suit le thème et ne coûte aucune requête. Vue de dessus, une pointe
   légèrement détachée — c'est ce qui la rend lisible en petit. */
function pizzaSVG() {
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (t, a) => { const e = document.createElementNS(NS, t);
                         for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = sv('svg', { class: 'rg-pizza', viewBox: '0 0 64 64',
                          role: 'img', 'aria-label': 'Pizza du repêchage' });
  svg.append(sv('circle', { cx: 32, cy: 32, r: 30, class: 'pz-croute' }));
  svg.append(sv('circle', { cx: 32, cy: 32, r: 24, class: 'pz-sauce' }));
  svg.append(sv('path', { d: 'M 34 4 A 28 28 0 0 1 60 26 L 36 32 Z',
                          class: 'pz-pointe' }));
  [[22,22],[42,24],[26,42],[44,42],[32,32],[18,33]].forEach(([x, y]) => {
    svg.append(sv('circle', { cx: x, cy: y, r: 4, class: 'pz-pep' }));
  });
  return svg;
}
