# MY WORLD RS — passerelle Google sans Cloud Functions Firebase

Cette passerelle remplace uniquement les quatre routes Google OAuth actuellement hébergées en Cloud Functions. Elle ne remplace pas Firebase Authentication, Firestore ni GitHub Pages.

## Pourquoi cette alternative
Cloudflare Workers propose une offre gratuite avec quotas. Workers Free inclut actuellement jusqu'à 100 000 requêtes par jour et KV Free inclut des quotas gratuits de lecture/écriture. Vérifier les limites officielles avant mise en production :
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/kv/platform/limits/

## Préparation Cloudflare
1. Créer un compte Cloudflare gratuit : https://dash.cloudflare.com/sign-up
2. Dans Workers & Pages, créer un Worker nommé `my-world-rs-google`.
3. Créer un namespace Workers KV nommé `MY_WORLD_RS_GOOGLE_TOKENS` et le lier au Worker sous le binding `GOOGLE_TOKENS`.
4. Déployer le contenu de `cloudflare/worker.js` dans le Worker.
5. Ajouter les secrets/variables suivants dans Settings > Variables and Secrets :
   - Secret `GOOGLE_CLIENT_ID` : identifiant OAuth du client Web Google existant.
   - Secret `GOOGLE_CLIENT_SECRET` : secret de ce même client OAuth.
   - Secret `GOOGLE_STATE_SECRET` : chaîne aléatoire longue (au moins 32 caractères).
   - Variable `FIREBASE_API_KEY` : clé API publique de Firebase du projet `my-world-rs`.
   - Variable `GOOGLE_REDIRECT_URI` : `https://my-world-rs-google.<TON_COMPTE>.workers.dev/googleOAuthCallback`.
6. Dans Google Cloud Console > Identifiants > le client OAuth Web utilisé par MY WORLD RS, ajouter exactement cette URL dans URI de redirection autorisés. Ne pas supprimer l'ancienne URL tant que le basculement n'a pas été testé.

## Important
- Le Worker utilise le KV pour conserver le jeton Google de renouvellement par UID Firebase.
- Le code vérifie le jeton Firebase auprès de Firebase Identity Toolkit avant toute opération protégée.
- Ne jamais mettre le secret OAuth Google ou le jeton Cloudflare dans GitHub, dans le code du site ou dans un message.
- La page de connexion et les règles Firebase Authentication ne doivent pas être modifiées.
- Le site n'est pas encore basculé vers ce Worker : il faut d'abord créer le Worker, configurer les secrets et valider son URL. Ensuite seulement, mettre à jour l'URL des fonctions dans le frontend et tester les quatre routes.
