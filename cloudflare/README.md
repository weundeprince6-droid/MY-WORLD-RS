# MY WORLD RS — passerelle Google (Cloudflare Worker)

Ce Worker remplace les routes Google OAuth qui étaient en Cloud Functions Firebase. Il ne remplace pas Firebase Authentication, Firestore ni GitHub Pages. Le site l'utilise déjà (`URL_FONCTIONS_GOOGLE` dans `public/app.js`).

## Valeurs de référence (ne pas changer)
- Nom du Worker : `calm-flower-2f83`
- URL : `https://calm-flower-2f83.weundeprince6.workers.dev`
- Routes : `/googleOAuthStart`, `/googleOAuthCallback` (GET), `/googleAccessToken`, `/googleRevoke` (POST)
- Binding KV : `GOOGLE_TOKENS` (créé automatiquement au déploiement)
- Variables (dans `wrangler.toml`) : `FIREBASE_API_KEY`, `GOOGLE_REDIRECT_URI` = `https://calm-flower-2f83.weundeprince6.workers.dev/googleOAuthCallback`
- Secrets (uniquement dans Cloudflare, jamais dans GitHub ni dans le code) :
  - `GOOGLE_CLIENT_ID` : identifiant du client OAuth Web Google
  - `GOOGLE_CLIENT_SECRET` : secret de ce client
  - `GOOGLE_STATE_SECRET` : chaîne aléatoire d'au moins 32 caractères

## Déploiement
Automatique : `.github/workflows/deployer-cloudflare.yml` déploie à chaque modification de `cloudflare/**` (ou à la main via Actions > Run workflow). Il demande un secret GitHub `CLOUDFLARE_API_TOKEN` (jeton Cloudflare avec le modèle « Edit Cloudflare Workers »).

Les secrets du Worker se règlent dans Cloudflare > Workers & Pages > calm-flower-2f83 > Settings > Variables and Secrets. Après un déploiement, vérifier que les variables et secrets sont toujours là.

## Google Cloud Console
Identifiants > client OAuth Web > URI de redirection autorisés : ajouter exactement
`https://calm-flower-2f83.weundeprince6.workers.dev/googleOAuthCallback`

## Important
- Le Worker garde le jeton de renouvellement Google par UID Firebase dans le KV et vérifie le jeton Firebase auprès de Firebase Identity Toolkit avant toute opération.
- Les autorisations (scopes) du Worker doivent rester identiques à `SCOPES` de `public/app.js`. YouTube est volontairement absent : il a sa propre autorisation.
- Ne jamais écrire le secret OAuth Google ni le jeton Cloudflare dans le code ou un message.
