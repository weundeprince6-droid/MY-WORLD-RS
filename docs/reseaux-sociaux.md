# Réseaux sociaux : Telegram, WhatsApp, Facebook

La page affiche les messages de la collection Firestore `social_inbox` (onglet **Réseaux sociaux**).
Chaque réseau y dépose ses messages dans ce format :

```json
{
  "source": "telegram",        // telegram | whatsapp | facebook
  "de": "Nom de l'expéditeur",
  "texte": "Contenu du message",
  "date": "<Timestamp Firestore>",
  "important": false           // true pour faire remonter une alerte
}
```

## Telegram : fonctionne déjà, sans serveur ni carte bancaire

La page lit elle-même les messages reçus par **votre bot** Telegram, puis les enregistre dans `social_inbox`.
Elle les relit à chaque actualisation, et toutes les minutes tant que la page reste ouverte.

**Connexion (2 minutes)**
1. Sur Telegram, ouvrez **@BotFather** et envoyez `/newbot`. Choisissez un nom, puis un identifiant qui finit par `bot`.
2. BotFather vous donne un **jeton** (`123456789:AAH…`). Copiez-le.
3. Tableau de bord > **Réseaux sociaux** > carte Telegram : collez le jeton, cliquez sur **Connecter**.
4. Écrivez un message à votre bot sur Telegram : il apparaît dans la liste.

**Ce que le bot peut lire**
- les messages qu'on lui écrit, y compris ceux que vous lui **transférez** (c'est le moyen de faire remonter une conversation privée) ;
- les messages d'un **groupe** où vous l'ajoutez : envoyez `/setprivacy` à @BotFather, choisissez le bot, puis **Disable** ;
- les publications d'un **canal** dont le bot est administrateur.

Il ne peut **pas** lire vos conversations personnelles ni les groupes où il n'est pas.

**Un message est marqué « important »** s'il contient un mot comme *urgent, facture, échéance, crédit, retrait…*
(liste dans `public/core.js`, ou `reglages.telegram.motsImportants` dans `public/config.js`).

**Limites à connaître**
- Les messages ne sont récupérés que **lorsque la page est ouverte** (avec votre session Google active, 1 h). Telegram garde les
  messages non lus **24 heures** : ouvrez le tableau de bord au moins une fois par jour.
- Un bot ne peut être lu que par **un seul programme** à la fois. Si vous avez déjà un programme qui lit ce bot, créez-en un autre.
- Le jeton reste **uniquement dans le navigateur** (stockage local de cet appareil). Il n'est ni dans GitHub, ni dans Firestore.
  Sur un autre appareil, il faut le saisir de nouveau. Bouton « Retirer le bot » pour l'effacer.
- Si le jeton a fuité, envoyez `/revoke` à @BotFather pour en obtenir un nouveau.

**Pour une lecture en continu, même page fermée** : il faudrait un petit programme toujours actif (Cloud Functions, plan Blaze,
ou un hébergeur gratuit). Ce n'est pas nécessaire pour l'instant.

## WhatsApp et Facebook : pas encore branchés

| Réseau | Ce qu'on peut lire | Limite à connaître |
|---|---|---|
| **WhatsApp** | Messages reçus sur un numéro **WhatsApp Business** (API officielle) | Impossible de lire un compte WhatsApp personnel |
| **Facebook** | Messages et commentaires de vos **Pages** (Graph API) | Pas d'accès à votre Messenger personnel |

Ils demandent un programme toujours actif qui reçoit les messages (webhook) puis les écrit dans `social_inbox`.
Sur Firebase, cela passe par Cloud Functions (plan Blaze). Alternative gratuite : un petit service sur un hébergeur gratuit,
avec un compte de service pour écrire dans Firestore.

## Sécurité

- Ne mettez jamais un jeton ou une clé dans `public/` ni dans GitHub.
- `social_inbox` n'est lisible que par votre compte Google propriétaire du projet : les règles Firestore d'AVEC LA SAGESSE (fichier `firestore.rules` de son dépôt, à vérifier si vous les avez modifiées)
  refusent toute collection qu'elles ne mentionnent pas.
