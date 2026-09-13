/* Filet hors ligne du Défi de la semaine.

   Les vraies prédictions vivent maintenant dans Firestore
   (defi/{fin de semaine}/picks/{pooleur}) et c'est defi.js qui va les y
   chercher. Ce fichier ne sert plus qu'à deux choses :

     1. afficher quelque chose quand le réseau ne répond pas ;
     2. ouvrir la page depuis le disque sans rien casser.

   Dès que Firestore répond, ce qu'il renvoie REMPLACE ce qui est ici — même
   une collection vide. C'est voulu : une fois en ligne, la base est la vérité,
   et montrer de vieilles prédictions à côté d'une base vide tromperait.

   Une clé par fin de semaine : la date du JEUDI qui l'ouvre. Les trois
   pourcentages doivent totaliser 100.
       g = enclave gauche, d = enclave droite, a = partout ailleurs
*/
window.DEFI_PICKS = {
  weekends: {}
};
