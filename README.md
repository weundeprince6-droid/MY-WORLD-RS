# My World RS

Un seul tableau de bord pour votre essentiel : **messages importants**, **agenda du jour**,
**chiffres clés de vos bases de données**, **alertes** et **réseaux sociaux**.

## Ce que fait la version 1

| Bloc | Source | État |
|---|---|---|
| Messages importants | Gmail (lecture + brouillons) | Fonctionnel |
| Agenda du jour et à venir | Google Agenda | Fonctionnel |
| Documents et dossiers | Google Drive (lecture seule) | Fonctionnel après activation de l'API Drive |
| Listes et tâches | Google Tasks (lecture seule) | Fonctionnel après activation de l'API Google Tasks |
| Chiffres clés | Firebase **AVEC LA SAGESSE** et **ESE DB (WEB SERVICE)** | Fonctionnel (voir ci-dessous) |
| Alertes et rappels | Calculées à partir des blocs ci-dessus | Fonctionnel |
| Réponses automatiques | Brouillons Gmail à partir de modèles, **validés par vous** | Fonctionnel |
| Telegram | Votre bot Telegram, lu depuis la page (sans serveur) | Fonctionnel : voir `docs/reseaux-sociaux.md` |
| WhatsApp, Facebook | Collection Firestore `social_inbox` | Affichage prêt, connecteurs à brancher (voir `docs/reseaux-sociaux.md`) |

L'application tourne entièrement dans le navigateur : **aucun serveur, plan Firebase gratuit (Spark) suffisant**.

## Chiffres clés affichés

**AVEC LA SAGESSE** (projet `avec-la-sagesse`) : membres, épargne totale (USD et FC), crédits en cours,
reste à rembourser (USD et FC), crédits en retard, réclamations ouvertes, demandes en attente, inscriptions en attente.

**ESE DB · WEB SERVICE** (projet `ese-db-b63de`, suivi des ventes) : ventes d'aujourd'hui et du mois, dépenses du mois,
dettes à payer (salaires, loyers, dettes), crédits clients à recouvrer (FC et USD) et nombre de produits sous le seuil d'alerte du stock.
La deuxième devise (USD) ne s'affiche que si elle n'est pas à zéro.

Les alertes se déclenchent pour les crédits en retard, les réclamations ouvertes, les demandes en attente et les produits en stock bas.
Pour ajouter ou retirer un chiffre, modifiez la liste `kpis` de `public/config.js`.

### Comment les bases sont lues

Le tableau de bord lit Firestore avec **les droits de votre compte Google** (celui qui est propriétaire des projets
Firebase). Les règles de sécurité des applications ne sont donc **pas modifiées** et personne d'autre ne peut lire ces chiffres.
Si un chiffre reste grisé avec un trait pointillé, votre compte n'a pas accès à ce projet : passez la souris dessus pour voir l'erreur.

## Mise en route

1. **Connexion Google** : Console Firebase du projet `avec-la-sagesse` > Authentication > Méthode de connexion > activez **Google**.
2. **APIs Google** : dans Google Cloud Console (projet `avec-la-sagesse`), activez **Gmail API**, **Google Calendar API** et **Google Drive API** et **Google Tasks API**.
3. **Écran de consentement OAuth** : mode « Test », ajoutez votre adresse Gmail comme utilisateur test.
   Google affiche « application non vérifiée » : c'est normal pour un usage personnel. Acceptez les autorisations
   (Gmail, Agenda, Firestore, lecture des métadonnées Drive et consultation des tâches Google Tasks). Après l'ajout de Drive, déconnectez-vous puis reconnectez-vous pour accorder cette nouvelle autorisation.
4. **Essai en local** : `npm run serve`, ouvrez l'adresse affichée (ajoutez `localhost` dans Authentication > Paramètres > Domaines autorisés).
5. Mettez en ligne (section suivante).

## Déployer sur Firebase

Le site est hébergé sur Firebase Hosting, dans le projet `avec-la-sagesse`, sur un site séparé nommé `my-world-rs`
(adresse : `https://my-world-rs.web.app`). Cela ne touche ni à votre application AVEC ni à ses règles ni à ses fonctions.

**Option A : depuis votre ordinateur** (4 commandes)

```
npm install -g firebase-tools
firebase login
firebase hosting:sites:create my-world-rs
firebase deploy --only hosting
```

Si le nom `my-world-rs` est déjà pris, choisissez-en un autre (par exemple `my-world-rs-rs`) et remplacez-le dans
`.firebaserc`, puis relancez le déploiement. Ajoutez aussi l'adresse du site dans Authentication > Paramètres > Domaines autorisés.

**Option B : depuis GitHub** (en un clic, après une préparation unique)

1. Console Firebase > Paramètres du projet > Comptes de service > Générer une nouvelle clé privée (fichier JSON).
2. GitHub > votre dépôt > Settings > Secrets and variables > Actions > New secret :
   nom `FIREBASE_SERVICE_ACCOUNT`, valeur = tout le contenu du fichier JSON. Ne partagez jamais ce fichier.
3. GitHub > onglet Actions > « Déployer sur Firebase » > Run workflow.

## Comment « l'essentiel » est choisi

- **Google Drive** : affiche les fichiers et dossiers du compte connecté, permet la recherche par nom et ouvre chaque élément dans Google Drive. L'application demande uniquement l'autorisation de lecture des métadonnées (`drive.metadata.readonly`) ; elle ne modifie ni ne supprime vos fichiers.
- **Google Tasks** : affiche les listes et les tâches du compte connecté, avec leur état et leur échéance. L'application demande uniquement l'autorisation `tasks.readonly` ; elle ne crée, ne modifie ni ne supprime aucune tâche.
- **Messages** : un message monte s'il est non lu, étoilé, marqué important par Gmail, s'il contient des mots comme
  *urgent, facture, échéance, crédit, retrait…*, ou s'il vient d'un contact VIP de `config.js`.
  Les promotions et notifications de réseaux sont écartées.
- **Alertes** : rendez-vous dans l'heure, messages très importants non lus, crédits en retard,
  réclamations et demandes à traiter, messages importants de vos réseaux.

## Le plus simple pour tester : GitHub Pages (sans rien installer)

1. GitHub > votre dépôt MY-WORLD-RS > Settings > Pages > **Source : GitHub Actions**.
2. Onglet Actions > « Publier sur GitHub Pages » > Re-run (ou Run workflow). Au bout d'une minute, le site est sur
   `https://weundeprince6-droid.github.io/MY-WORLD-RS/`.
3. Console Firebase > Authentication > Paramètres > Domaines autorisés > ajoutez `weundeprince6-droid.github.io`.
4. Ouvrez l'adresse dans un onglet normal (pas dans l'aperçu d'un chat).

## Si la connexion ne marche pas

La page affiche un message rouge en haut qui dit quoi faire. Les cas fréquents :

- **Aperçu intégré (dans un chat, un éditeur…)** : Google y bloque la connexion. Ouvrez la page dans un vrai onglet.
- **Page ouverte comme un fichier (file://)** : ouvrez-la avec une adresse web (`npm run serve`, ou le site Firebase).
- **Domaine non autorisé** : ajoutez-le dans Firebase > Authentication > Paramètres > Domaines autorisés.
- **Connexion Google désactivée** : Firebase > Authentication > Méthode de connexion > Google.
- **Fenêtre bloquée** : autorisez les fenêtres surgissantes pour la page.
- **« Accès bloqué » dans la fenêtre Google** : écran de consentement OAuth en mode Test, avec votre adresse en utilisateur test.

## Limites connues

- La session Google dure **1 heure** : au-delà, reconnectez-vous.
- Gmail limite le nombre de requêtes par minute : la page lit les messages 4 par 4, ne demande que les mails non lus, étoilés ou
  importants des 7 derniers jours, et réessaie une fois toute seule. En cas de quota dépassé, attendez une minute puis cliquez sur Actualiser.
- Les messages ne sont **jamais envoyés automatiquement** : l'application crée des brouillons Gmail.
- WhatsApp personnel et Messenger personnel ne peuvent pas être lus par une API officielle.
- Telegram : seuls les messages reçus par votre bot sont lus (transférez-lui une conversation pour la faire remonter), et seulement quand la page est ouverte.
- Les chiffres d'AVEC reprennent les règles de l'application (reste = montant − remboursé, retard = échéance dépassée).
  Si ces règles changent dans AVEC, mettez à jour `calculerCreditsAvec` dans `public/firestore.js`.

## Tests

```
npm test
```

## Structure

```
public/        interface web (index.html, app.js, core.js, firestore.js, telegram.js, style.css, config.js)
docs/          guides (réseaux sociaux)
test/          tests de la logique et de la configuration
.github/       déploiement Firebase en un clic
firebase.json, .firebaserc   hébergement Firebase
```
