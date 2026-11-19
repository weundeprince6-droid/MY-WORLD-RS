# WEBSERVICES ACADEMY — application mobile

Application multiplateforme Android et iOS basée sur Capacitor 8. Elle réutilise la page pédagogique existante et se connecte au projet Firebase `my-world-rs`.

## Choix techniques

- Une seule application pour les cinq rôles : Direction, Enseignant, Élève, Secrétaire et Comptable.
- Même authentification et mêmes collections Firestore que le site WEBSERVICES ACADEMY.
- Source de l'interface : `../public/webs-classroom.html`.
- Configuration Firebase copiée depuis `../public/config.js`.
- Les règles Firestore restent la frontière de sécurité : l'interface mobile ne remplace jamais les contrôles côté serveur.

## Pré-requis

- Node.js 22 ou supérieur.
- Android : Android Studio et Android SDK.
- iOS : macOS, Xcode 26 ou supérieur et CocoaPods.
- Pour publier sur l'App Store, un compte Apple Developer est également nécessaire.

Le PC Windows 8.1 déjà utilisé pour le site ne répond pas aux prérequis actuels de Capacitor 8. La compilation Android devra être réalisée sur une machine compatible ou dans un environnement distant. La compilation iOS nécessite macOS/Xcode, localement ou via un service de build macOS.

## Préparer les fichiers web

Depuis ce dossier :

```bash
npm install
npm run prepare:web
```

Cette commande copie la page Academy actuelle et sa configuration Firebase dans `www/`. Ne modifiez pas directement `www/` : ce dossier est régénéré.

## Ajouter les plateformes natives

```bash
npm run android:add
npm run ios:add
```

Ces commandes génèrent les projets natifs. Elles sont à exécuter dans un environnement disposant des outils de la plateforme concernée.

Après toute évolution de la page Academy :

```bash
npm run cap:sync
```

Pour ouvrir les projets :

```bash
npm run android:open
npm run ios:open
```

## Sécurité et points à valider avant diffusion

1. Tester la connexion email/mot de passe pour chacun des cinq rôles.
2. Vérifier les permissions Firestore pour chaque rôle, y compris les lectures et écritures réellement utilisées par l'application.
3. Tester la réinitialisation du mot de passe.
4. Vérifier les photos/fichiers, téléchargements, impressions et génération de brevet dans les WebViews Android et iOS.
5. Vérifier la persistance de session et la déconnexion sur appareil partagé.
6. Traiter séparément la connexion Google : les fenêtres popup web ne sont pas garanties dans une WebView native. Si ce parcours est requis, intégrer un flux OAuth natif adapté sans modifier le parcours de connexion du site.
7. Ajouter et tester les notifications push seulement après définition des événements et des destinataires.

## État actuel

Le dossier prépare le conteneur Capacitor et synchronise la page existante. Les projets natifs Android/iOS, les tests sur appareils, les certificats de signature et les publications sur Google Play / App Store restent à générer et valider. Aucune règle Firestore ni aucun compte existant n'est modifié par ce scaffold.
