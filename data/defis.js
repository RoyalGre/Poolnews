/* Filet hors ligne du défi « Qui va gagner ? ».

   Les vraies prédictions vivent dans Firestore
   (defis/{fin de semaine}/picks/{pooleur}) et c'est defis.js qui va les y
   chercher. Ce fichier ne sert qu'à deux choses :

     1. afficher quelque chose quand le réseau ne répond pas ;
     2. ouvrir la page depuis le disque sans rien casser.

   Dès que Firestore répond, ce qu'il renvoie REMPLACE ce qui est ici — même
   une collection vide.

   Une clé par fin de semaine : la date du JEUDI qui l'ouvre. Les choix sont
   rangés par identifiant de match :
       { name: "Yanick M.", picks: { "2026020009": "NJD", ... } }
*/
window.DEFIS_PICKS = {
  weekends: {}
};
