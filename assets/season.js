/* =========================================================================
   season.js — which season the reader is looking at, and loading its data.

   Runs in <head>, BEFORE core.js, on every page that shows season data.

   Why document.write and not fetch(): core.js reads window.NHL_DATA at its
   very first lines (const DATA = ..., then it indexes every player). The data
   globals therefore have to exist before core.js executes. A fetch() would
   resolve after, leaving DATA permanently empty, and rewriting core.js to
   defer indexing would mean touching every page and the whole self-test.
   A synchronous document.write keeps the exact load order the pages already
   depend on, and it works from file:// where fetch() of a local file does not.

   The choice lives in localStorage next to the theme, so it follows the
   reader from tab to tab. An unknown or missing choice falls back to the
   current season in data/seasons.js.
   ========================================================================= */
(function () {
  var KEY = 'hockeyPool.season';
  var idx = window.NHL_SEASONS || { current: null, seasons: [] };
  var all = idx.seasons || [];

  function known(label) {
    for (var i = 0; i < all.length; i++) if (all[i].label === label) return all[i];
    return null;
  }

  var chosen = null;
  try { chosen = localStorage.getItem(KEY); } catch (e) { }
  // A season the reader picked once but that no longer exists must not strand
  // them on a blank page.
  if (!known(chosen)) chosen = null;

  var label = chosen || idx.current || (all[0] && all[0].label) || null;
  var rec   = known(label);

  window.poolSeason = {
    KEY: KEY,
    /* The season on screen. */
    label: label,
    /* Every season the site holds, newest first. */
    all: all,
    /* The season update.ps1 is currently refreshing. */
    current: idx.current,
    /* Which data files that season actually has. */
    has: function (name) { return !!rec && rec.files.indexOf(name) >= 0; },
    /* Switch seasons. Reloads, because the data is loaded at parse time. */
    set: function (l) {
      try {
        if (l && l !== idx.current) localStorage.setItem(KEY, l);
        else localStorage.removeItem(KEY);   // back to following "current"
      } catch (e) { }
      location.reload();
    },
    /* True when the reader is on something other than the live season. */
    isPast: function () { return !!idx.current && label !== idx.current; }
  };

  /* Which season actually holds a given file.

     The chosen season is not guaranteed to have everything. Right now 2026-27
     has only the schedule -- the season has not started, so there are no
     players, no history, no goals yet. A page asking for 'players' while
     sitting on 2026-27 would otherwise load nothing at all and render empty.
     So: prefer the chosen season, and fall back to the newest season that
     does have the file. Genuinely absent everywhere -> skip it, because the
     pages already cope with a missing global ("run build-goals.ps1"). */
  function holds(lbl, name) {
    for (var i = 0; i < all.length; i++) {
      if (all[i].label === lbl) return all[i].files.indexOf(name) >= 0;
    }
    return false;
  }

  /* Stats files only make sense together. players.js carries the points,
     advanced.js the ice time, history.js the weekly totals, goals.js the
     coordinates -- mixing seasons gives nonsense like 2025-26 ice time
     divided by 2026-27 points (all zero before the first game), so P/60
     reads 0 and the page looks broken rather than not-yet-started.

     So: if the chosen season has no history of its own, the whole stats
     family follows whichever season does, and the pool with it. Only the
     schedule stays on the chosen season -- that one is about games to come,
     not results. */
  /* La famille des stats. « pool » n'en fait plus partie : la liste des
     pooleurs appartient a la saison choisie, pas a celle qui a les chiffres.
     Tant qu'elle en faisait partie, ouvrir 2026-27 affichait les onze
     pooleurs de 2025-26 sous le titre de 2026-27 -- Antoine D., le douzieme,
     n'apparaissait nulle part. Les pages qui n'ont rien a montrer disent
     maintenant que la saison n'a pas commence (voir seasonNotStarted dans
     core.js) plutot que d'emprunter un classement. */
  var STATS = ['players', 'history', 'advanced', 'goals'];

  /* Ou vivent les chiffres. Une saison qui a ses propres joueurs les garde :
     emprunter les points de l'an dernier pour les afficher sous le nom de
     cette annee est precisement ce qu'on veut eviter. Les pages constatent
     alors zero point partout et annoncent que la saison n'a pas commence. */
  function statsHome() {
    if (holds(label, 'players')) return label;
    if (holds(label, 'history')) return label;
    for (var i = 0; i < all.length; i++) {
      if (all[i].files.indexOf('history') >= 0) return all[i].label;
    }
    return label;
  }

  function folderFor(name) {
    if (STATS.indexOf(name) >= 0) {
      var home = statsHome();
      return holds(home, name) ? home : (holds(label, name) ? label : null);
    }
    if (holds(label, name)) return label;
    for (var i = 0; i < all.length; i++) {
      if (all[i].files.indexOf(name) >= 0) return all[i].label;
    }
    return null;
  }

  /* Which files came from a season other than the one on screen. The pages
     use this to say so rather than quietly showing last year's numbers. */
  window.poolSeason.borrowed = {};

  /* Pages that SHOW results want a coherent set of stats, even if that means
     last season's. The draft page wants the opposite: this season's roster
     and this season's (empty) pool, because that is what you are drafting
     into. Passing { own: true } asks for the chosen season wherever it has
     the file, with no family rule. */
  window.poolSeason.load = function (names, opts) {
    if (!label) return;
    var own = !!(opts && opts.own);
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var from = own ? (holds(label, n) ? label : folderFor(n)) : folderFor(n);
      if (!from) continue;
      if (from !== label) window.poolSeason.borrowed[n] = from;
      document.write('<scr' + 'ipt src="data/' + from + '/' + n + '.js"></scr' + 'ipt>');
    }
  };
})();
