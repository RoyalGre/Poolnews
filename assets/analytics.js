/* =========================================================================
   analytics.js — Google Analytics 4 (page views only).

   Loaded in <head> on every page, right after theme.js, including the record
   book (via pool-records.template.html — never edit pool-records.html).

   Runs ONLY on the published site. Opened from disk (file://) or in the
   headless Chrome of run-selftest.ps1, it does nothing: the nightly task
   runs the self-test every morning at 04:30 and would otherwise log a
   burst of fake visits each night.

   The gtag.js library is fetched async, so a blocked or slow Google never
   delays the page. GA4 does not store visitors' IP addresses.
   ========================================================================= */
(function () {
  var ID = 'G-NMNFQW90W1';
  var HOST = 'royalgre.github.io';

  if (location.hostname !== HOST) return;
  if (navigator.webdriver) return;   // automated browsers

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ID);

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(s);
})();
