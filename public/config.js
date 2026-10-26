// Configuration de My World RS.
// Ces identifiants Firebase ne sont pas secrets (ils sont déjà publics dans le dépôt AVEC-LA-SAGESSE) :
// la protection vient de la connexion Google et des droits de VOTRE compte sur chaque projet.

// 1) Projet Firebase qui héberge le tableau de bord et gère la connexion Google
export const firebaseConfig = {
  apiKey: "AIzaSyD_gv8JSw8qeybIVC78Q1ZcorKZLy646RA",
  authDomain: "avec-la-sagesse.firebaseapp.com",
  projectId: "avec-la-sagesse",
  appId: "1:760546829214:web:62f06f0ed3da99c77dac8f",
};

// 2) Bases de données à lire (une par projet Firebase)
export const bases = {
  avec: { nom: "AVEC LA SAGESSE", projectId: "avec-la-sagesse" },
  webservices: { nom: "WEB SERVICES", projectId: "base-de-donnee-avec" },
};

// 3) Réglages du tableau de bord
export const reglages = {
  gmail: {
    requete: "newer_than:7d -category:promotions -category:social",
    maxMessages: 40,
    seuilImportance: 3,
    contactsVip: [], // ex. ["bureau@exemple.com"]
    motsImportants: undefined, // laissez vide pour la liste par défaut
  },

  agenda: { joursAVenir: 7 },

  // Chiffres clés.
  //  op: "count" (nombre de documents), "sum" (somme d'un champ) ou "avec_credits" (calcul sur les crédits d'AVEC)
  //  filtre: { champ, op: "EQUAL" | "NOT_EQUAL", valeur }
  //  seuil: { min, max } ; messageAlerte : texte de l'alerte, {{valeur}} est remplacé
  kpis: [
    // --- AVEC LA SAGESSE ---
    { base: "avec", label: "Membres", op: "count", collection: "members" },
    { base: "avec", label: "Épargne totale", op: "sum", collection: "members", champ: "epargne", unite: "USD" },
    { base: "avec", label: "Épargne totale", op: "sum", collection: "members", champ: "epargneFC", unite: "FC" },
    { base: "avec", label: "Crédits en cours", op: "avec_credits", mesure: "nb_en_cours" },
    { base: "avec", label: "Reste à rembourser", op: "avec_credits", mesure: "reste_usd", unite: "USD" },
    { base: "avec", label: "Reste à rembourser", op: "avec_credits", mesure: "reste_fc", unite: "FC" },
    {
      base: "avec", label: "Crédits en retard", op: "avec_credits", mesure: "nb_retard",
      seuil: { max: 0 }, niveauAlerte: "haute", messageAlerte: "{{valeur}} crédit(s) en retard de remboursement",
    },
    {
      base: "avec", label: "Réclamations ouvertes", op: "count", collection: "claims",
      filtre: { champ: "status", op: "NOT_EQUAL", valeur: "traitée" },
      seuil: { max: 0 }, messageAlerte: "{{valeur}} réclamation(s) de membres à traiter",
    },
    {
      base: "avec", label: "Demandes en attente", op: "count", collection: "requests",
      filtre: { champ: "status", valeur: "en attente" },
      seuil: { max: 0 }, messageAlerte: "{{valeur}} demande(s) de crédit ou de retrait à traiter",
    },
    {
      base: "avec", label: "Inscriptions en attente", op: "count", collection: "registrations",
      filtre: { champ: "status", valeur: "pending" },
    },

    // --- WEB SERVICES ---
    { base: "webservices", label: "Membres", op: "count", collection: "members" },
    { base: "webservices", label: "Épargne totale", op: "sum", collection: "members", champ: "epargne" },
    { base: "webservices", label: "Crédit restant", op: "sum", collection: "members", champ: "creditRestant" },
  ],

  // Réseaux sociaux (Telegram, WhatsApp, Facebook) : collection alimentée par vos connecteurs
  social: { base: "avec", collection: "social_inbox", max: 15 },

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
