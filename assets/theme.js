/* =========================================================================
   theme.js — applies the reader's light/dark choice before the page paints.

   Loaded synchronously in <head> on every page, including the record book.
   It must run before first paint, otherwise a reader who chose light gets a
   flash of dark (or the reverse) on every navigation.

   Three states: 'auto' follows the OS (nothing stamped), 'light' and 'dark'
   stamp data-theme on <html>. The choice is shared by all four tabs because
   they are one origin and one localStorage key.
   ========================================================================= */
(function () {
  var KEY = 'hockeyPool.theme';
  var mode;
  try { mode = localStorage.getItem(KEY); } catch (e) { }
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.setAttribute('data-theme', mode);
  }

  // Exposed so the header control (and the record book) can set it without
  // duplicating the storage key or the stamping rules.
  window.poolTheme = {
    KEY: KEY,
    get: function () {
      try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; }
    },
    set: function (m) {
      try {
        if (m === 'auto') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, m);
      } catch (e) { }
      if (m === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', m);
      if (typeof window.onPoolThemeChange === 'function') window.onPoolThemeChange();
    },
    /* What is actually on screen right now, after OS preference is resolved. */
    effective: function () {
      var m = this.get();
      if (m !== 'auto') return m;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
  };
})();
