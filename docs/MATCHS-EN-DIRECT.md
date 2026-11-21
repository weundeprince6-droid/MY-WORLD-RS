# Matchs en direct (Lecteur Pro)

Onglet « ⚽ Matchs en direct » de `public/television.html`.

- Le Worker `cloudflare-matchs/worker.js` (`https://lecteur-pro-matchs.weundeprince6.workers.dev/`) lit la liste publique de Kooralive
  (`/matches?day=yesterday|today|tomorrow`) et trouve l'adresse du lecteur vidéo seul d'un match (`/player?u=<page du match>`).
- Le lecteur affiche la liste des matchs ; un clic ouvre **seulement le lecteur vidéo** (sans menus ni bandeaux du site), avec choix du serveur
  et plein écran réel. « 🌐 Site complet » ouvre l'ancien affichage du site Kooralive en secours.
- Si Kooralive change l'apparence de ses pages ou ses domaines (`pinkshooters.com`), adapter `parseMatches`, `parsePlayer` et `PAGE_HOSTS`.
