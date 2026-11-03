# Rester connecté sans serveur (gratuit)

Google donne un accès valable **1 heure**. My World RS le garde dans votre navigateur : recharger ou rouvrir la page dans l'heure ne redemande rien.
Pour ne plus jamais vous reconnecter toutes les heures, renseignez un identifiant client OAuth : l'appli renouvelle alors l'accès **en silence**.

1. Console Firebase > Authentication > Méthode de connexion > Google > « Configuration du SDK Web » : copiez l'**ID client Web**
   (ou Google Cloud Console > API et services > Identifiants > « Client Web (créé automatiquement par Google Service) »).
2. Dans Google Cloud Console > Identifiants > ce client > **Origines JavaScript autorisées**, ajoutez `https://weundeprince6-droid.github.io` (et l'adresse Firebase Hosting si vous en avez une), puis enregistrez.
3. Collez l'ID dans `public/config.js` : `googleClientId: "123…apps.googleusercontent.com"` (ce n'est pas un secret).
4. Rechargez la page avec Ctrl+F5 et connectez-vous une dernière fois.

Limites : le renouvellement silencieux marche tant que vous êtes connecté à Google dans ce navigateur. Si le navigateur bloque la fenêtre ou les cookies tiers, l'appli vous demandera simplement de cliquer sur « Se connecter avec Google ».
Autre option, plus robuste mais avec le plan Firebase Blaze : déployer les fonctions du dossier `functions/` (renouvellement côté serveur).
