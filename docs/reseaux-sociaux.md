# Réseaux sociaux : Telegram, WhatsApp, Facebook

La page lit la collection Firestore `social_inbox`. Chaque réseau doit y déposer ses messages
dans ce format :

```json
{
  "source": "telegram",        // telegram | whatsapp | facebook
  "de": "Nom de l'expéditeur",
  "texte": "Contenu du message",
  "date": "<Timestamp Firestore>",
  "important": false           // true pour faire remonter une alerte
}
```

Le navigateur ne peut **pas** appeler ces réseaux directement (cela exposerait vos clés secrètes).
Il faut un petit programme côté serveur qui reçoit les messages et les écrit dans Firestore.

## Ce qui est réellement possible

| Réseau | Ce qu'on peut lire | Limite à connaître |
|---|---|---|
| **Telegram** | Messages envoyés à votre **bot** ou aux groupes où il est ajouté | Un bot ne voit pas vos conversations privées personnelles |
| **WhatsApp** | Messages reçus sur un numéro **WhatsApp Business** (API officielle) | Impossible de lire un compte WhatsApp personnel avec l'API officielle |
| **Facebook** | Messages et commentaires de vos **Pages** (Graph API) | Pas d'accès à votre Messenger personnel |

## Prérequis serveur

Recevoir des messages demande un point d'entrée permanent (webhook). Sur Firebase, cela passe par
**Cloud Functions**, qui exige le plan **Blaze** (carte bancaire). Si ce plan n'est pas possible,
des alternatives gratuites existent : un petit service sur un hébergeur gratuit (Render, Railway
ou une machine personnelle) qui écrit dans Firestore avec un compte de service.

## Ordre conseillé

1. **Telegram** (le plus simple : créer un bot avec @BotFather, brancher un webhook).
2. **Facebook Pages** (si vous gérez une Page).
3. **WhatsApp Business** (demande un compte Meta Business vérifié).

## Sécurité

- N'écrivez jamais les clés (jeton du bot, jeton Meta) dans `public/` ni dans GitHub.
- Gardez la règle `allow write: if false` pour `social_inbox` : seul le serveur écrit, avec un
  compte de service. Voir `firestore.rules.example`.
