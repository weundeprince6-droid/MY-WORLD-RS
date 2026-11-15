# Protection de la connexion Google — MY WORLD RS

## Fichiers sensibles à préserver
- `public/app.js` : tableau `SCOPES`, connexion Firebase/Google et renouvellement des jetons.
- `cloudflare/worker.js` : tableau `GOOGLE_SCOPES`, démarrage OAuth et échange/renouvellement des jetons.
- `public/config.js` : configuration Firebase et identifiant client OAuth (aucun secret ici).
- `public/index.html` : interface de connexion.

Ne pas modifier ces éléments pour une tâche sans rapport avec l'authentification. Ne jamais changer les scopes ou le flux OAuth sans demande explicite, analyse des autorisations Google, test dédié et validation du résultat.

## Règle anti-erreur 400
YouTube doit conserver son autorisation indépendante. Ne pas ajouter `https://www.googleapis.com/auth/youtube.readonly` à la demande OAuth principale qui contient les autorisations Drive. Cette combinaison a déjà provoqué une erreur Google OAuth 400.

Les scopes Google API de `public/app.js` et `cloudflare/worker.js` doivent rester identiques. Le test `test/oauth-guard.test.mjs` contrôle ces règles et sera exécuté par `npm test` avant la publication GitHub Pages.

## Procédure obligatoire
1. Identifier les fichiers strictement nécessaires à chaque tâche.
2. Éviter les fichiers sensibles ci-dessus si la tâche peut être réalisée ailleurs.
3. Si une modification de l'authentification est indispensable, la traiter séparément et obtenir une autorisation explicite.
4. Exécuter `npm test` et vérifier le contrôle OAuth avant tout déploiement.
5. Vérifier les journaux GitHub Actions. Ne jamais annoncer un déploiement réussi avant sa fin effective.

## Limite
Ces tests bloquent les régressions ciblées. Ils ne peuvent pas empêcher Google de modifier ses règles ni remplacer les réglages OAuth de Google Cloud Console. Une protection de branche GitHub avec approbation obligatoire peut renforcer cette règle si elle est activée dans les paramètres du dépôt.
