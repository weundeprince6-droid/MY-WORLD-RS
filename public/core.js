// core.js — logique pure (sans DOM, sans réseau) : tri des messages, agenda, alertes.
// Utilisée par le navigateur (app.js) et par les tests (test/core.test.mjs).

export const MOTS_IMPORTANTS = [
  "urgent", "urgence", "important", "rappel", "facture", "paiement", "échéance", "echeance",
  "retard", "contrat", "rendez-vous", "reunion", "réunion", "convocation", "réclamation",
  "reclamation", "crédit", "credit", "retrait", "demande", "confirmation", "avant le",
];

export const MOTS_BRUYANTS = [
  "newsletter", "promotion", "promo", "désabonner", "desabonner", "unsubscribe", "offre spéciale",
  "no-reply", "noreply", "ne-pas-repondre",
];

function norm(s) {
  return String(s || "").toLowerCase();
}

/** Lit un en-tête (From, Subject, Date) dans un message Gmail au format "metadata". */
export function entete(message, nom) {
  const h = (message.payload?.headers || []).find((x) => norm(x.name) === norm(nom));
  return h ? h.value : "";
}

/** Extrait "Nom" d'un en-tête From du type: Nom <adresse@exemple.com>. */
export function expediteurLisible(from) {
  const m = String(from || "").match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (m) return m[1].trim();
  return String(from || "").trim() || "Inconnu";
}

/**
 * Note d'importance d'un message Gmail (plus c'est haut, plus c'est important).
 * Signaux : non lu, étoilé, marqué important par Gmail, mots-clés, bruit marketing.
 */
export function scoreMessage(message, options = {}) {
  const labels = message.labelIds || [];
  const sujet = norm(entete(message, "Subject"));
  const de = norm(entete(message, "From"));
  const extrait = norm(message.snippet);
  const texte = `${sujet} ${extrait}`;
  const motsPlus = (options.motsImportants || MOTS_IMPORTANTS).map(norm);
  const contactsVip = (options.contactsVip || []).map(norm);

  let score = 0;
  if (labels.includes("UNREAD")) score += 2;
  if (labels.includes("STARRED")) score += 3;
  if (labels.includes("IMPORTANT")) score += 2;
  if (labels.includes("CATEGORY_PROMOTIONS") || labels.includes("CATEGORY_SOCIAL")) score -= 3;
  if (motsPlus.some((m) => texte.includes(m))) score += 3;
  if (MOTS_BRUYANTS.some((m) => de.includes(m) || texte.includes(m))) score -= 3;
  if (contactsVip.some((c) => c && de.includes(c))) score += 4;
  return score;
}

/** Garde les messages au-dessus du seuil, triés du plus important au plus récent. */
export function messagesImportants(messages, options = {}) {
  const seuil = options.seuil ?? 3;
  const max = options.max ?? 8;
  return messages
    .map((m) => ({ message: m, score: scoreMessage(m, options) }))
    .filter((x) => x.score >= seuil)
    .sort((a, b) => b.score - a.score || Number(b.message.internalDate || 0) - Number(a.message.internalDate || 0))
    .slice(0, max)
    .map((x) => ({
      id: x.message.id,
      threadId: x.message.threadId,
      de: expediteurLisible(entete(x.message, "From")),
      deBrut: entete(x.message, "From"),
      sujet: entete(x.message, "Subject") || "(sans objet)",
      extrait: x.message.snippet || "",
      date: Number(x.message.internalDate || 0),
      nonLu: (x.message.labelIds || []).includes("UNREAD"),
      score: x.score,
    }));
}

/** Début de journée locale (00:00) pour une date donnée. */
export function debutJournee(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function memeJour(a, b) {
  return debutJournee(a).getTime() === debutJournee(b).getTime();
}

/** Normalise un événement Google Agenda (dateTime ou journée entière). */
export function normaliserEvenement(ev) {
  const toutLeJour = !!ev.start?.date && !ev.start?.dateTime;
  const debut = new Date(ev.start?.dateTime || `${ev.start?.date}T00:00:00`);
  const fin = new Date(ev.end?.dateTime || `${ev.end?.date}T00:00:00`);
  return {
    id: ev.id,
    titre: ev.summary || "(sans titre)",
    lieu: ev.location || "",
    lien: ev.htmlLink || "",
    debut,
    fin,
    toutLeJour,
  };
}

/** Sépare les événements en « aujourd'hui » et « à venir » (dans la fenêtre fournie). */
export function repartirAgenda(evenements, maintenant = new Date()) {
  const liste = evenements.map(normaliserEvenement).sort((a, b) => a.debut - b.debut);
  const aujourdhui = liste.filter((e) => memeJour(e.debut, maintenant) || (e.debut <= maintenant && e.fin > maintenant));
  const aVenir = liste.filter((e) => !aujourdhui.includes(e));
  return { aujourdhui, aVenir };
}

/** Minutes avant le début d'un événement (négatif si déjà commencé). */
export function minutesAvant(evenement, maintenant = new Date()) {
  return Math.round((evenement.debut - maintenant) / 60000);
}

/**
 * Évalue un indicateur par rapport à son seuil de configuration.
 * regle: { min?: nombre, max?: nombre }
 */
export function evaluerSeuil(valeur, regle = {}) {
  if (regle.min !== undefined && valeur < regle.min) return "bas";
  if (regle.max !== undefined && valeur > regle.max) return "haut";
  return "ok";
}

/**
 * Fabrique la liste d'alertes unifiée à partir de toutes les sources.
 * entrées: { messages, agenda, kpis, social, maintenant }
 */
export function construireAlertes({ messages = [], agenda = { aujourdhui: [], aVenir: [] }, kpis = [], social = [], maintenant = new Date() }) {
  const alertes = [];

  for (const e of agenda.aujourdhui) {
    if (e.toutLeJour) continue;
    const m = minutesAvant(e, maintenant);
    if (m >= 0 && m <= 60) {
      alertes.push({ niveau: "haute", source: "agenda", texte: `« ${e.titre} » commence dans ${m} min` });
    }
  }

  const nonLusImportants = messages.filter((m) => m.nonLu && m.score >= 5);
  if (nonLusImportants.length) {
    alertes.push({
      niveau: "haute",
      source: "gmail",
      texte: `${nonLusImportants.length} message(s) très important(s) non lu(s)`,
    });
  }

  for (const k of kpis) {
    if (k.etat === "bas") alertes.push({ niveau: "moyenne", source: "données", texte: `${k.label} est sous le seuil (${k.valeur})` });
    if (k.etat === "haut") alertes.push({ niveau: "moyenne", source: "données", texte: `${k.label} dépasse le seuil (${k.valeur})` });
    if (k.erreur) alertes.push({ niveau: "basse", source: "données", texte: `${k.label} : lecture impossible` });
  }

  const socialImportant = social.filter((s) => s.important);
  if (socialImportant.length) {
    alertes.push({ niveau: "moyenne", source: "réseaux", texte: `${socialImportant.length} message(s) important(s) sur Telegram/WhatsApp/Facebook` });
  }

  const ordre = { haute: 0, moyenne: 1, basse: 2 };
  return alertes.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
}

/** Phrase de synthèse affichée en haut du tableau de bord. */
export function resumeDuJour({ messages = [], agenda = { aujourdhui: [] }, alertes = [] }) {
  const rdv = agenda.aujourdhui.length;
  const msg = messages.length;
  const hautes = alertes.filter((a) => a.niveau === "haute").length;
  const morceaux = [];
  morceaux.push(rdv === 0 ? "Aucun rendez-vous aujourd'hui" : `${rdv} rendez-vous aujourd'hui`);
  morceaux.push(msg === 0 ? "aucun message important" : `${msg} message(s) important(s)`);
  morceaux.push(hautes === 0 ? "aucune alerte urgente" : `${hautes} alerte(s) urgente(s)`);
  return morceaux.join(" · ");
}

/** Remplace {{nom}}, {{sujet}}, {{date}} dans un modèle de réponse. */
export function remplirModele(modele, valeurs) {
  return String(modele).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, cle) => (valeurs[cle] !== undefined ? valeurs[cle] : ""));
}

function base64urlUtf8(texte) {
  const octets = new TextEncoder().encode(texte);
  let bin = "";
  for (const o of octets) bin += String.fromCharCode(o);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sujetEncode(sujet) {
  const octets = new TextEncoder().encode(sujet);
  let bin = "";
  for (const o of octets) bin += String.fromCharCode(o);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/** Construit le message brut (RFC 2822, base64url) attendu par l'API Gmail pour un brouillon. */
export function construireBrouillonBrut({ a, sujet, corps }) {
  const lignes = [
    `To: ${a}`,
    `Subject: ${sujetEncode(sujet)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    corps,
  ];
  return base64urlUtf8(lignes.join("\r\n"));
}
