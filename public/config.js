// Configuration Firebase indépendante de MY WORLD RS.
// Les bases AVEC LA SAGESSE et ESE restent des sources de données distinctes du tableau de bord.

export const firebaseConfig = {
  apiKey: "AIzaSyCmTqeg6EByQCns7HpVi9PV0EdVObRR4ck",
  authDomain: "my-world-rs.firebaseapp.com",
  projectId: "my-world-rs",
  storageBucket: "my-world-rs.firebasestorage.app",
  messagingSenderId: "90992521092",
  appId: "1:90992521092:web:be60f591a332c114a5f7d1",
  measurementId: "G-JM5GSRF838",
};

// Bases externes consultées par le tableau de bord.
// Elles restent séparées : changer le Firebase principal ne les déplace pas.
export const bases = {
  avec: { nom: "AVEC LA SAGESSE", projectId: "avec-la-sagesse" },
  ese: { nom: "ESE DB · WEB SERVICE", projectId: "ese-db-b63de" },
};

// Réglages du tableau de bord
export const reglages = {
  // Identifiant client OAuth (type « Application Web ») : active le renouvellement silencieux de l'accès Google,
  // pour ne plus se reconnecter toutes les heures. Voir docs/connexion-persistante.md. Laissez vide sinon.
  googleClientId: "",

  gmail: {
    requete: "in:inbox newer_than:14d -category:promotions -category:social",
    maxMessages: 40,
    seuilImportance: 3,
    contactsVip: [],
    motsImportants: undefined,
  },

  agenda: { joursAVenir: 7 },

  // Chiffres clés.
  // op: "count", "sum", "avec_credits" ou "ese"
  // masquerSiZero: true cache le chiffre quand il vaut 0
  // filtre: { champ, op: "EQUAL" | "NOT_EQUAL", valeur }
  // seuil: { min, max } ; messageAlerte : {{valeur}} est remplacé
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

    // --- ESE DB · WEB SERVICE ---
    { base: "ese", label: "Ventes aujourd'hui", op: "ese", mesure: "ventes_jour_fc", unite: "FC" },
    { base: "ese", label: "Ventes aujourd'hui", op: "ese", mesure: "ventes_jour_usd", unite: "USD", masquerSiZero: true },
    { base: "ese", label: "Ventes du mois", op: "ese", mesure: "ventes_mois_fc", unite: "FC" },
    { base: "ese", label: "Ventes du mois", op: "ese", mesure: "ventes_mois_usd", unite: "USD", masquerSiZero: true },
    { base: "ese", label: "Dépenses du mois", op: "ese", mesure: "depenses_mois_fc", unite: "FC" },
    { base: "ese", label: "Dépenses du mois", op: "ese", mesure: "depenses_mois_usd", unite: "USD", masquerSiZero: true },
    { base: "ese", label: "Dettes à payer", op: "ese", mesure: "dettes_fc", unite: "FC" },
    { base: "ese", label: "Dettes à payer", op: "ese", mesure: "dettes_usd", unite: "USD", masquerSiZero: true },
    { base: "ese", label: "Crédits clients à recouvrer", op: "ese", mesure: "credits_clients_fc", unite: "FC" },
    { base: "ese", label: "Crédits clients à recouvrer", op: "ese", mesure: "credits_clients_usd", unite: "USD", masquerSiZero: true },
    {
      base: "ese", label: "Produits sous le seuil d'alerte", op: "ese", mesure: "stock_bas",
      seuil: { max: 0 }, messageAlerte: "{{valeur}} produit(s) en stock bas : à réapprovisionner",
    },
  ],

  social: { base: "avec", collection: "social_inbox", max: 15 },

  // Facebook (Pages) : version de l'API Graph, nombre de conversations lues, jours relus à la première connexion
  facebook: { versionApi: "v24.0", maxConversations: 10, joursInitiaux: 7, motsImportants: undefined },

  modeles: [
    {
      nom: "Accusé de réception",
      sujetPrefixe: "Re: ",
      corps: "Bonjour {{nom}},\\n\\nJ'ai bien reçu votre message concernant « {{sujet}} ». Je reviens vers vous très bientôt.\\n\\nCordialement",
    },
    {
      nom: "Besoin de plus de temps",
      sujetPrefixe: "Re: ",
      corps: "Bonjour {{nom}},\\n\\nMerci pour votre message. Je suis actuellement pris(e) et vous répondrai d'ici deux jours.\\n\\nCordialement",
    },
  ],
};
