# Lecteur Pro — licences et activation

## État de cette première version
Le module serveur de licences est isolé dans `functions/lecteur-pro.js` et chargé par `functions/index.js`. Il utilise le projet Firebase `my-world-rs`, sans modifier les fonctions Google OAuth existantes ni les écrans de connexion de MY WORLD RS.

## Formules configurées
- `monthly` : 3 000 CDF, validité de 30 jours.
- `annual` : 30 000 CDF, validité de 365 jours.
- `lifetime` : 60 000 CDF, sans date d'expiration.

Ces tarifs sont des paramètres de lancement à confirmer avant toute vente publique.

## Pages
- Offres : `/lecteur-pro-offres.html`
- Activation client : `/lecteur-pro-activation.html`
- Administration : `/lecteur-pro-admin.html`

## Sécurité et flux
- Toutes les opérations serveur exigent un jeton Firebase Authentication valide.
- Les opérations administrateur vérifient côté serveur l'adresse e-mail vérifiée `weundeprince6@gmail.com`.
- Les codes sont générés avec un aléa cryptographique. Seul leur hash SHA-256 est conservé dans Firestore.
- Une licence est liée à l'adresse e-mail d'achat et au premier compte Firebase qui l'active.
- L'administrateur doit vérifier le paiement puis saisir une référence avant d'émettre le code.
- Les clients ne peuvent pas déclarer eux-mêmes un paiement effectué.
- Une révocation désactive également le droit Premium associé.
- Les collections sont `lecteurProLicenses` et `lecteurProEntitlements`; elles sont gérées par les Cloud Functions avec Firebase Admin SDK.

## Endpoints Cloud Functions (POST)
- `lecteurProCreateLicense` — administrateur uniquement, émission après vérification manuelle du paiement.
- `lecteurProListLicenses` — administrateur uniquement.
- `lecteurProRevokeLicense` — administrateur uniquement.
- `lecteurProActivateLicense` — client connecté.
- `lecteurProGetEntitlement` — client connecté.

Région : `us-central1`.

## Limites à connaître avant l'ouverture commerciale
1. Aucun prestataire Mobile Money n'est encore connecté. Les fonctions d'émission nécessitent une vérification manuelle effective du paiement.
2. Les pages de gestion et d'activation nécessitent que Firebase Authentication et le fournisseur Google soient activés pour le domaine GitHub Pages.
3. Le droit Premium est enregistré côté serveur, mais il n'est pas encore branché sur les fonctionnalités Premium de `television.html`. Ne pas annoncer que les fonctionnalités payantes sont verrouillées/déverrouillées automatiquement dans le lecteur avant cette intégration et les tests.
4. Ne pas saisir de vraies transactions ou vendre des codes avant d'avoir testé l'environnement Firebase de bout en bout.
5. Avant le lancement, ajouter une limitation des tentatives d'activation, un journal d'audit plus complet et une politique de remboursement.

## Déploiement
Le workflow GitHub Actions `.github/workflows/deploy-firebase-functions.yml` déploie les Cloud Functions après les changements dans `functions/**`. Il nécessite le secret GitHub `FIREBASE_SERVICE_ACCOUNT_MY_WORLD_RS`. Le statut du workflow doit être vérifié dans l'onglet Actions du dépôt avant de considérer les endpoints disponibles.

## Hébergement actuel : Worker Cloudflare (sans plan Blaze)

Les licences tournent sur un Worker Cloudflare indépendant : `cloudflare-licences/worker.js`
(adresse : `https://lecteur-pro-licences.weundeprince6.workers.dev/`), avec stockage KV.
Mêmes routes, formules (3 000 / 30 000 / 60 000 FC) et messages que `functions/lecteur-pro.js`.
Déploiement automatique à chaque changement dans `cloudflare-licences/` (secret `CLOUDFLARE_API_TOKEN`).
Le déploiement automatique des Cloud Functions Firebase est désactivé (plan Blaze requis).
Limite connue : KV est « éventuellement cohérent » ; deux activations simultanées du même code
peuvent, très rarement, passer ensemble. Acceptable pour les premières ventes.
