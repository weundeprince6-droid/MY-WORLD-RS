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

const FOURNISSEURS_PERSONNELS = [
  "gmail.com", "googlemail.com", "yahoo.", "ymail.com", "outlook.", "hotmail.", "live.", "msn.com", "icloud.com", "me.com", "mac.com",
  "proton.me", "protonmail.com", "pm.me", "aol.com", "gmx.", "mail.com", "yandex.", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr",
  "laposte.net", "bbox.fr", "neuf.fr", "zoho.com", "tutanota.com", "tuta.io", "qq.com", "163.com",
];
/**
 * Type de compte d'une adresse : "personnel" (messagerie grand public : Gmail, Yahoo, Outlook…) ou "professionnel" (domaine d'entreprise
 * ou d'organisation). `extras` : domaines supplémentaires à considérer comme personnels.
 */
export function typeCompte(adresse, extras = []) {
  const brut = String(adresse || "");
  const m = brut.match(/<([^>]+)>/);
  const mail = (m ? m[1] : brut.split(",")[0]).trim().toLowerCase();
  const domaine = mail.split("@")[1] || "";
  if (!domaine) return "professionnel";
  const liste = [...FOURNISSEURS_PERSONNELS, ...extras.map((d) => String(d).toLowerCase())];
  return liste.some((d) => (d.endsWith(".") ? domaine.startsWith(d) || domaine.includes("." + d) : domaine === d || domaine.endsWith("." + d))) ? "personnel" : "professionnel";
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
      etoile: (x.message.labelIds || []).includes("STARRED"),
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
    description: ev.description || "",
    lien: ev.htmlLink || "",
    debut,
    fin,
    toutLeJour,
  };
}

/**
 * Corps d'un événement Google Agenda à partir du formulaire.
 * saisie: { titre, date "AAAA-MM-JJ", debut "HH:MM", fin "HH:MM", toutLeJour, lieu, description }
 * Lève une Error au message lisible si la saisie est incomplète ou incohérente.
 */
export function corpsEvenement(saisie, fuseau = "UTC") {
  const titre = String(saisie.titre || "").trim();
  if (!titre) throw new Error("Donnez un titre au rendez-vous.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saisie.date || "")) throw new Error("Choisissez la date du rendez-vous.");
  const corps = { summary: titre };
  if (saisie.lieu && String(saisie.lieu).trim()) corps.location = String(saisie.lieu).trim();
  if (saisie.description && String(saisie.description).trim()) corps.description = String(saisie.description).trim();
  if (saisie.toutLeJour) {
    const suivant = new Date(`${saisie.date}T12:00:00Z`);
    suivant.setUTCDate(suivant.getUTCDate() + 1);
    corps.start = { date: saisie.date };
    corps.end = { date: suivant.toISOString().slice(0, 10) };
    return corps;
  }
  const heureOk = (h) => /^\d{2}:\d{2}$/.test(h || "");
  if (!heureOk(saisie.debut)) throw new Error("Indiquez l'heure de début.");
  const fin = heureOk(saisie.fin) ? saisie.fin : null;
  if (fin && fin <= saisie.debut) throw new Error("L'heure de fin doit être après l'heure de début.");
  let finTexte = fin;
  if (!finTexte) { // durée par défaut : 1 heure
    const [h, m] = saisie.debut.split(":").map(Number);
    finTexte = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(h + 1 > 23 ? 59 : m).padStart(2, "0")}`;
  }
  corps.start = { dateTime: `${saisie.date}T${saisie.debut}:00`, timeZone: fuseau };
  corps.end = { dateTime: `${saisie.date}T${finTexte}:00`, timeZone: fuseau };
  return corps;
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
    const origine = k.base ? `${k.base} · données` : "données";
    const personnalise = k.messageAlerte ? remplirModele(k.messageAlerte, { valeur: k.valeur }) : null;
    if (k.etat === "bas") alertes.push({ niveau: "moyenne", source: origine, texte: personnalise || `${k.label} est sous le seuil (${k.valeur})` });
    if (k.etat === "haut") alertes.push({ niveau: k.niveauAlerte || "moyenne", source: origine, texte: personnalise || `${k.label} dépasse le seuil (${k.valeur})` });
  }

  // Une seule alerte par base et par cause, pour ne pas répéter la même panne
  const pannes = new Map();
  for (const k of kpis) {
    if (!k.erreur) continue;
    const origine = k.base ? `${k.base} · données` : "données";
    const cle = `${origine}|${k.erreur}`;
    if (!pannes.has(cle)) pannes.set(cle, { origine, erreur: String(k.erreur).slice(0, 260), labels: [] });
    pannes.get(cle).labels.push(k.label);
  }
  for (const p of pannes.values()) {
    alertes.push({ niveau: "basse", source: p.origine, texte: `Lecture impossible (${p.labels.join(", ")}) : ${p.erreur}` });
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
  for (let i = 0; i < octets.length; i += 0x8000) bin += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
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
const adresseSure = (v) => String(v || "").replace(/[\r\n]+/g, " ").trim(); // jamais de saut de ligne dans un en-tête (injection d'en-têtes)
const nomFichierSur = (v) => String(v || "fichier").replace(/[\r\n"\\/]+/g, "_").trim() || "fichier";
const base64Lignes = (b64) => (b64.match(/.{1,76}/g) || []).join("\r\n");

/**
 * Construit le message brut (RFC 2822, base64url) attendu par l'API Gmail, pour un envoi ou un brouillon.
 * pieces : [{ nom, type, base64 }] (base64 standard du contenu du fichier) -> message multipart/mixed.
 */
export function construireMessageBrut({ a, cc, sujet, corps, pieces = [], enReponseA = "" }) {
  const entetes = [
    `To: ${adresseSure(a)}`,
    ...(adresseSure(cc) ? [`Cc: ${adresseSure(cc)}`] : []),
    `Subject: ${sujetEncode(sujet)}`,
    ...(adresseSure(enReponseA) ? [`In-Reply-To: ${adresseSure(enReponseA)}`, `References: ${adresseSure(enReponseA)}`] : []),
    "MIME-Version: 1.0",
  ];
  if (!pieces.length) {
    return base64urlUtf8([...entetes, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", corps].join("\r\n"));
  }
  const frontiere = "mwrs_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const parties = [
    `--${frontiere}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", corps,
  ];
  for (const f of pieces) {
    const nom = nomFichierSur(f.nom), nomEnc = sujetEncode(nom);
    parties.push(
      `--${frontiere}`,
      `Content-Type: ${String(f.type || "application/octet-stream").replace(/[\r\n;]+/g, "")}; name="${nomEnc}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${nomEnc}"`,
      "",
      base64Lignes(f.base64 || ""),
    );
  }
  parties.push(`--${frontiere}--`, "");
  return base64urlUtf8([...entetes, `Content-Type: multipart/mixed; boundary="${frontiere}"`, "", ...parties].join("\r\n"));
}
export const construireBrouillonBrut = construireMessageBrut;

function decoderBase64Url(donnees) {
  const b64 = String(donnees || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const octets = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(octets);
}
function htmlEnTexte(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n").trim();
}
/** Lit un message Gmail complet (format=full) : en-têtes, texte lisible et liste des pièces jointes. */
export function lireMessageComplet(msg) {
  const enTetes = msg?.payload?.headers || [];
  const h = (nom) => enTetes.find((x) => String(x.name).toLowerCase() === nom.toLowerCase())?.value || "";
  let texte = "", html = "";
  const pieces = [];
  const parcourir = (part) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      pieces.push({ nom: part.filename, type: part.mimeType || "", taille: Number(part.body.size || 0), idPiece: part.body.attachmentId });
    } else if (part.mimeType === "text/plain" && part.body?.data && !texte) texte = decoderBase64Url(part.body.data);
    else if (part.mimeType === "text/html" && part.body?.data && !html) html = decoderBase64Url(part.body.data);
    (part.parts || []).forEach(parcourir);
  };
  parcourir(msg?.payload);
  return {
    id: msg?.id, threadId: msg?.threadId, etoile: (msg?.labelIds || []).includes("STARRED"), messageId: h("Message-ID") || h("Message-Id"), repondreA: h("Reply-To"), de: h("From"), a: h("To"), cc: h("Cc"), sujet: h("Subject") || "(sans objet)",
    date: Number(msg?.internalDate || 0), corps: texte.trim() || htmlEnTexte(html) || msg?.snippet || "", pieces,
  };
}

/** Exécute f sur chaque élément, `taille` à la fois (ordre conservé) : évite de dépasser les quotas de Google. */
export async function enLots(elements, taille, f) {
  const resultats = [];
  for (let i = 0; i < elements.length; i += taille) {
    resultats.push(...(await Promise.all(elements.slice(i, i + taille).map(f))));
  }
  return resultats;
}
