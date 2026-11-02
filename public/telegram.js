// telegram.js — lecture des messages reçus par VOTRE bot Telegram (logique pure, sans réseau ni DOM).
// Le navigateur appelle l'API Telegram (getUpdates), puis enregistre chaque message dans Firestore (social_inbox).
import { MOTS_IMPORTANTS } from "./core.js";

/** Un jeton de bot ressemble à 123456789:AAH... (donné par @BotFather). */
export const FORMAT_JETON = /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/;

export function jetonValide(jeton) {
  return FORMAT_JETON.test(String(jeton || "").trim());
}

/** Adresse d'une méthode de l'API Telegram. Le jeton ne doit jamais être affiché ni journalisé. */
export function urlTelegram(jeton, methode, params = {}) {
  const requete = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `https://api.telegram.org/bot${jeton}/${methode}${requete ? "?" + requete : ""}`;
}

/** Message d'erreur lisible pour une réponse { ok: false, error_code, description } de Telegram. */
export function expliquerErreurTelegram(reponse) {
  const code = reponse?.error_code;
  const detail = String(reponse?.description || "");
  if (code === 401) return "Telegram refuse ce jeton. Vérifiez-le avec @BotFather (commande /token) puis reconnectez le bot.";
  if (code === 409) return "Un autre programme lit déjà ce bot (ou un webhook est actif). Retirez le webhook ou utilisez un autre bot.";
  if (code === 429) return "Telegram demande de ralentir. Réessayez dans une minute.";
  return `Telegram a répondu une erreur${code ? " " + code : ""}${detail ? " : " + detail : ""}.`;
}

const nettoyer = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Nom lisible de l'expéditeur : personne, sinon titre du groupe ou du canal. */
export function nomExpediteur(msg) {
  const de = msg.from || {};
  const personne = nettoyer([de.first_name, de.last_name].filter(Boolean).join(" "));
  if (personne) return personne;
  if (de.username) return `@${de.username}`;
  const chat = msg.chat || {};
  return nettoyer(chat.title) || (chat.username ? `@${chat.username}` : "Inconnu");
}

/** Texte à afficher : le texte, la légende, ou une étiquette pour les photos, vocaux, etc. Null si rien d'exploitable. */
export function texteDuMessage(msg) {
  const texte = nettoyer(msg.text);
  if (texte) return texte;
  const legende = nettoyer(msg.caption);
  const etiquettes = [
    ["photo", "Photo"], ["video", "Vidéo"], ["voice", "Message vocal"], ["audio", "Audio"],
    ["video_note", "Message vidéo"], ["animation", "GIF"],
  ];
  for (const [champ, nom] of etiquettes) {
    if (msg[champ]) return legende ? `[${nom}] ${legende}` : `[${nom}]`;
  }
  if (msg.document) return `[Document] ${nettoyer(msg.document.file_name) || legende}`.trim();
  if (msg.sticker) return `[Sticker] ${nettoyer(msg.sticker.emoji)}`.trim();
  if (msg.location) return "[Position]";
  if (msg.contact) return `[Contact] ${nettoyer(msg.contact.first_name)}`.trim();
  if (msg.poll) return `[Sondage] ${nettoyer(msg.poll.question)}`.trim();
  return null; // message de service (arrivée dans un groupe, épinglage…) : ignoré
}

/** Vrai si le texte contient un des mots importants (sans tenir compte des majuscules). */
export function texteImportant(texte, mots = MOTS_IMPORTANTS) {
  const t = String(texte || "").toLowerCase();
  return mots.some((m) => t.includes(String(m).toLowerCase()));
}

/**
 * Transforme une mise à jour Telegram en message simple, ou null si elle est à ignorer.
 * Seuls les messages reçus (message, channel_post) sont gardés ; les modifications sont ignorées.
 */
export function extraireMessage(update, motsImportants = MOTS_IMPORTANTS) {
  const msg = update?.message || update?.channel_post;
  if (!msg || !msg.chat || msg.message_id === undefined) return null;
  const texte = texteDuMessage(msg);
  if (!texte) return null;
  const chat = msg.chat;
  return {
    updateId: update.update_id,
    chatId: String(chat.id),
    messageId: Number(msg.message_id),
    de: nomExpediteur(msg),
    groupe: chat.type === "private" ? "" : nettoyer(chat.title),
    texte: texte.slice(0, 1000),
    date: new Date((Number(msg.date) || 0) * 1000),
    important: texteImportant(texte, motsImportants),
  };
}

/** Identifiant stable du document : enregistrer deux fois le même message ne crée pas de doublon. */
export function idDocument(m) {
  return `telegram-${m.chatId.replace(/[^0-9a-zA-Z-]/g, "_")}-${m.messageId}`;
}

/** Champs au format de l'API REST Firestore. */
export function champsFirestore(m) {
  return {
    source: { stringValue: "telegram" },
    de: { stringValue: m.groupe ? `${m.de} (${m.groupe})` : m.de },
    texte: { stringValue: m.texte },
    date: { timestampValue: m.date.toISOString() },
    important: { booleanValue: !!m.important },
    chatId: { stringValue: m.chatId },
    messageId: { integerValue: String(m.messageId) },
  };
}

/** Plus grand update_id d'une liste (ou null) : sert à confirmer les messages déjà lus. */
export function dernierUpdateId(updates) {
  const ids = (updates || []).map((u) => u.update_id).filter((n) => Number.isInteger(n));
  return ids.length ? Math.max(...ids) : null;
}
