# WEBS- Class room — mise en route

Onglet « WEBS- Class room » de MY WORLD RS, et page autonome pour les élèves :
`https://weundeprince6-droid.github.io/MY-WORLD-RS/public/webs-classroom.html`
(bouton « Copier le lien pour les élèves » dans l'onglet). Les élèves n'ont pas besoin de MY WORLD RS.

## À faire une seule fois dans la console Firebase (projet my-world-rs)

1. **Authentication → Sign-in method** : activer **Adresse e-mail/Mot de passe** (Google est déjà actif).
2. **Firestore → Règles** : ajouter le contenu de `firestore.rules.webs-classroom.example`
   dans `match /databases/{database}/documents { … }`, sans effacer vos règles existantes, puis **Publier**.
   Sans cette étape, aucune donnée ne s'enregistre (message « Accès refusé »).
3. **Authentication → Settings → Domaines autorisés** : vérifier que `weundeprince6-droid.github.io` y figure.

## Rôles

| Rôle | Peut faire |
|---|---|
| Direction (vous, `weundeprince6@gmail.com`, connexion Google) | Tout, y compris créer tous les comptes |
| Enseignant | Cours, devoirs + notation, quiz, notes, planning, annonces, présences |
| Secrétaire | Créer les comptes élèves, annonces, planning, présences |
| Comptable | Frais dus et paiements |
| Élève | Consulter, rendre ses devoirs, passer les quiz, voir ses notes, présences et son solde |

## Créer un compte
Onglet « Élèves & personnel » → nom, email, rôle, classe, mot de passe provisoire. La personne se connecte
avec cet email ; « Mot de passe oublié » lui envoie un lien de réinitialisation.

## Limites à connaître
- Les réponses d'un quiz sont stockées avec le quiz : un élève technique pourrait les lire. Utilisez les quiz
  pour l'entraînement ; les notes officielles viennent des devoirs corrigés et des notes saisies.
- Le filtre par classe est appliqué par l'interface ; les règles protègent les données personnelles
  (notes, rendus, frais, présences) mais pas le cloisonnement entre classes pour les cours et annonces.
- Les fichiers ne sont pas hébergés : on colle des liens (Drive, YouTube, GitHub…).
- Désactiver un compte bloque l'accès ; la suppression définitive se fait dans Authentication.

## Formulaire d'inscription en ligne
Lien à envoyer : `https://weundeprince6-droid.github.io/MY-WORLD-RS/public/webs-inscription.html`
(bouton « Copier le lien » dans la section « Inscriptions »). Les demandes arrivent dans
« Inscriptions » (direction et secrétariat) : ouvrir une fiche, puis « Accepter et créer le compte » ou « Refuser ».
Les filières proposées se modifient dans la liste `FILIERES` en haut du script de `webs-inscription.html`.
Les règles Firestore (bloc `ecole_inscriptions`) doivent être republiées : elles autorisent n'importe qui à envoyer
une demande (champs limités en taille), mais seuls la direction et le secrétariat peuvent la lire.
