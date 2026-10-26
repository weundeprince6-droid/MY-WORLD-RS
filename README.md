# My World RS

Un seul tableau de bord pour votre essentiel : **messages importants**, **agenda du jour**,
**chiffres clés de vos bases de données**, **alertes** et **réseaux sociaux**.

## Ce que fait la version 1

| Bloc | Source | État |
|---|---|---|
| Messages importants | Gmail (lecture + brouillons) | Fonctionnel |
| Agenda du jour et à venir | Google Agenda | Fonctionnel |
| Chiffres clés | Firestore (comptes et sommes) | Fonctionnel, à configurer |
| Alertes et rappels | Calculées à partir des blocs ci-dessus | Fonctionnel |
| Réponses automatiques | Brouillons Gmail à partir de modèles, **validés par vous** | Fonctionnel |
| Telegram, WhatsApp, Facebook | Collection Firestore `social_inbox` | Affichage prêt, connecteurs à brancher (voir `docs/reseaux-sociaux.md`) |

L'application tourne entièrement dans le navigateur : **aucun serveur, plan Firebase gratuit (Spark) suffisant**.

## Mise en route (15 minutes)

1. **Projet Firebase** : créez-en un nouveau (recommandé) ou réutilisez un projet existant.
   Si vous réutilisez celui d'AVEC LA SAGESSE, ne déployez pas de règles Firestore (voir `firestore.rules.example`).
2. **Connexion Google** : Console Firebase > Authentication > Méthode de connexion > activez **Google**.
3. **APIs Google** : dans Google Cloud Console (même projet), activez **Gmail API** et **Google Calendar API**.
4. **Écran de consentement OAuth** : mode « Test », ajoutez votre adresse Gmail comme utilisateur test.
   Google affichera un avertissement « application non vérifiée » : c'est normal pour un usage personnel.
5. **Configuration** : copiez `public/config.example.js` en `public/config.js` et renseignez vos valeurs Firebase
   et vos indicateurs (collections de vos bases). Ce fichier n'est jamais envoyé sur GitHub.
6. **Domaine autorisé** : Authentication > Paramètres > Domaines autorisés, ajoutez votre domaine Firebase Hosting.
7. **Essai en local** : `npm run serve` puis ouvrez l'adresse affichée (ajoutez `localhost` aux domaines autorisés).
8. **Mise en ligne** : `npm run deploy` (nécessite `firebase login` et `firebase use VOTRE_PROJET`).

## Comment « l'essentiel » est choisi

- **Messages** : un message monte s'il est non lu, étoilé, marqué important par Gmail, s'il contient des mots comme
  *urgent, facture, échéance, crédit, retrait…*, ou s'il vient d'un contact VIP de `config.js`.
  Les promotions et notifications de réseaux sont écartées.
- **Alertes** : rendez-vous dans l'heure, messages très importants non lus, indicateurs hors seuil,
  messages importants de vos réseaux.

Tout se règle dans `public/config.js` (requête Gmail, mots-clés, seuils, modèles de réponse).

## Limites connues

- La session Google dure **1 heure** : au-delà, cliquez sur Actualiser puis reconnectez-vous.
- Les messages ne sont **jamais envoyés automatiquement** : l'application crée des brouillons.
  L'envoi automatique pourra venir plus tard, pour des cas simples et sûrs.
- WhatsApp personnel et Messenger personnel ne peuvent pas être lus par une API officielle.

## Tests

```
npm test
```

Vérifie le tri des messages, l'agenda, les alertes et la création des brouillons.

## Structure

```
public/        interface web (index.html, app.js, core.js, style.css, config.example.js)
docs/          guides (réseaux sociaux)
test/          tests de la logique
firebase.json  hébergement Firebase
```
