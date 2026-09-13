/* Les prédictions du Défi de la semaine.

   Pour l'instant ce fichier est écrit à la main, comme data/pool.js l'était
   avant publish-pool.ps1. Quand Firestore sera branché, defi.js ira les lire
   en ligne et ce fichier ne servira plus que de secours hors ligne.

   Une clé par fin de semaine : la date du JEUDI qui l'ouvre. Les trois
   pourcentages doivent totaliser 100.
       g = enclave gauche, d = enclave droite, a = partout ailleurs
*/
window.DEFI_PICKS = {
  weekends: {
    "2026-04-16": [
      { name: "Yanick M.",     g: 37, d: 44, a: 19 },
      { name: "Steve T.",      g: 30, d: 50, a: 20 },
      { name: "Frédérick D.",  g: 40, d: 40, a: 20 },
      { name: "Martin Pr.",    g: 33, d: 48, a: 19 }
    ]
  }
};
