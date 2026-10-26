// Copiez ce fichier en « config.js » puis remplissez-le avec VOS valeurs.
// config.js est ignoré par Git (voir .gitignore) : il ne sera jamais envoyé sur GitHub.

// 1) Configuration Firebase (Console Firebase > Paramètres du projet > Vos applications > Web)
export const firebaseConfig = {
  apiKey: "VOTRE_API_KEY",
  authDomain: "VOTRE_PROJET.firebaseapp.com",
  projectId: "VOTRE_PROJET",
  appId: "VOTRE_APP_ID",
};

// 2) Réglages du tableau de bord
export const reglages = {
  // Messages : fenêtre de lecture et critères d'importance
  gmail: {
    requete: "newer_than:7d -category:promotions -category:social",
    maxMessages: 40,
    seuilImportance: 3,
    contactsVip: [], // ex. ["bureau@exemple.com", "Nom du président"]
    motsImportants: undefined, // laissez vide pour utiliser la liste par défaut
  },

  // Agenda : nombre de jours à venir affichés
  agenda: { joursAVenir: 7 },

  // Chiffres clés lus dans Firestore (mettez ici les collections de vos bases)
  // op: "count" (nombre de documents) ou "sum" (somme d'un champ numérique)
  // seuil: { min, max } déclenche une alerte si la valeur sort de la plage
  kpis: [
    { label: "Membres", collection: "membres", op: "count" },
    // { label: "Épargne totale", collection: "membres", op: "sum", champ: "epargne", unite: "FC" },
    // { label: "Crédits en cours", collection: "credits", op: "count", filtre: { champ: "statut", valeur: "en_cours" } },
  ],

  // Réseaux sociaux (Telegram, WhatsApp, Facebook) : collection Firestore alimentée par vos connecteurs
  // Document attendu : { source, de, texte, date (Timestamp), important (booléen) }
  social: { collection: "social_inbox", max: 15 },

  // Modèles de réponse (créés en brouillon Gmail, jamais envoyés automatiquement)
  modeles: [
    {
      nom: "Accusé de réception",
      sujetPrefixe: "Re: ",
      corps: "Bonjour {{nom}},\n\nJ'ai bien reçu votre message concernant « {{sujet}} ». Je reviens vers vous très bientôt.\n\nCordialement",
    },
    {
      nom: "Besoin de plus de temps",
      sujetPrefixe: "Re: ",
      corps: "Bonjour {{nom}},\n\nMerci pour votre message. Je suis actuellement pris(e) et vous répondrai d'ici deux jours.\n\nCordialement",
    },
  ],
};
