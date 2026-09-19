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
  function folderFor(name) {
    if (rec && rec.files.indexOf(name) >= 0) return label;
    for (var i = 0; i < all.length; i++) {
      if (all[i].files.indexOf(name) >= 0) return all[i].label;
    }
    return null;
  }

  /* Which files came from a season other than the one on screen. The pages
     use this to say so rather than quietly showing last year's numbers. */
  window.poolSeason.borrowed = {};

  window.poolSeason.load = function (names) {
    if (!label) return;
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var from = folderFor(n);
      if (!from) continue;
      if (from !== label) window.poolSeason.borrowed[n] = from;
      document.write('<scr' + 'ipt src="data/' + from + '/' + n + '.js"></scr' + 'ipt>');
    }
  };
})();
