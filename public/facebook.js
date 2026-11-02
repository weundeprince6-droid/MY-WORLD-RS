// facebook.js — lecture des messages Messenger de VOS Pages Facebook (logique pure, sans réseau ni DOM).
// Le navigateur appelle l'API Graph avec un jeton que vous collez, puis enregistre chaque message dans Firestore (social_inbox).
// Limites de Facebook : seules les Pages sont lisibles (jamais votre Messenger ou profil personnel),
// et seuls les 20 derniers messages d'une conversation.
import { texteImportant } from "./telegram.js";

export const VERSION_API_PAR_DEFAUT = "v24.0";
export const CHAMPS_CONVERSATIONS = "updated_time,messages.limit(5){id,message,from,created_time}";
export const PERMISSIONS_FACEBOOK = ["pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_messaging"];

/** Un jeton Facebook est une longue suite de lettres et chiffres (il commence en général par EAA). */
export function jetonFacebookValide(jeton) {
  return /^[A-Za-z0-9_.-]{50,}$/.test(String(jeton || "").trim());
}

/** Adresse d'une requête Graph. Le jeton ne doit jamais être affiché ni journalisé. */
export function urlGraph(version, chemin, params, jeton) {
  const requete = Object.entries({ ...params, access_token: jeton })
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `https://graph.facebook.com/${version || VERSION_API_PAR_DEFAUT}${chemin}?${requete}`;
}

/** Message lisible pour une réponse { error: { message, code } } de l'API Graph. */
export function expliquerErreurFacebook(reponse) {
  const e = reponse?.error || {};
  const code = e.code;
  const detail = String(e.message || "").slice(0, 200);
  if (code === 190) return "Facebook refuse le jeton (expiré ou invalide). Générez-en un nouveau dans Graph API Explorer, puis reconnectez Facebook.";
  if ([10, 200, 230, 299, 3].includes(code)) {
    return `Autorisation manquante. Le jeton doit inclure ${PERMISSIONS_FACEBOOK.join(", ")}, et vous devez être administrateur de la Page et de l'application Meta. (${detail})`;
  }
  if ([4, 17, 32, 341, 613].includes(code)) return "Facebook limite temporairement les requêtes. Réessayez dans quelques minutes.";
  if (code === 368) return "Facebook a bloqué temporairement cette action. Réessayez plus tard.";
  if (code === 2500 || code === 2635 || /unknown path|unsupported (get|post) request|version/i.test(detail)) {
    return `Version de l'API Facebook refusée. Changez reglages.facebook.versionApi dans public/config.js (par exemple « v24.0 »). (${detail})`;
  }
  return `Facebook a répondu une erreur${code ? " " + code : ""}${detail ? " : " + detail : ""}.`;
}

/** Pages utilisables d'après /me/accounts : celles qui fournissent un jeton de Page. */
export function choisirPages(reponse) {
  return (reponse?.data || [])
    .filter((p) => p && p.id && p.access_token)
    .map((p) => ({ id: String(p.id), nom: String(p.name || p.id), jeton: p.access_token }));
}

const nettoyerFb = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Date de l'API Graph ("2026-11-02T09:30:00+0000") lisible par tous les navigateurs. */
export function dateGraph(texte) {
  return new Date(String(texte || "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

/**
 * Messages reçus (jamais ceux envoyés par la Page elle-même), plus récents que `depuisMs`.
 * `reponse` = réponse de /{page-id}/conversations avec CHAMPS_CONVERSATIONS.
 */
export function extraireMessagesConversations(reponse, page, depuisMs = 0, motsImportants) {
  const sortie = [];
  for (const conversation of reponse?.data || []) {
    for (const m of conversation.messages?.data || []) {
      if (!m || !m.id) continue;
      const expediteur = m.from || {};
      if (String(expediteur.id) === String(page.id)) continue;
      const date = dateGraph(m.created_time);
      if (Number.isNaN(date.getTime()) || date.getTime() <= depuisMs) continue;
      const texte = nettoyerFb(m.message) || "[Pièce jointe ou autocollant]";
      sortie.push({
        id: String(m.id),
        pageId: page.id,
        pageNom: page.nom,
        conversation: String(conversation.id || ""),
        de: nettoyerFb(expediteur.name) || "Inconnu",
        texte: texte.slice(0, 1000),
        date,
        important: texteImportant(texte, motsImportants),
      });
    }
  }
  return sortie;
}

/** Plus récente date (ms) d'une liste de messages, ou `repli` s'il n'y en a pas. */
export function dateLaPlusRecente(messages, repli = 0) {
  return messages.reduce((max, m) => Math.max(max, m.date.getTime()), repli);
}

/** Identifiant stable du document : enregistrer deux fois le même message ne crée pas de doublon. */
export function idDocumentFacebook(m) {
  return `facebook-${String(m.id).replace(/[^0-9a-zA-Z_-]/g, "_").slice(0, 140)}`;
}

/** Champs au format de l'API REST Firestore. */
export function champsFirestoreFacebook(m) {
  return {
    source: { stringValue: "facebook" },
    de: { stringValue: m.pageNom ? `${m.de} (${m.pageNom})` : m.de },
    texte: { stringValue: m.texte },
    date: { timestampValue: m.date.toISOString() },
    important: { booleanValue: !!m.important },
    pageId: { stringValue: m.pageId },
    messageId: { stringValue: m.id },
  };
}
