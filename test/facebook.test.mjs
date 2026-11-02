import assert from "node:assert/strict";
import {
  jetonFacebookValide, urlGraph, expliquerErreurFacebook, choisirPages, dateGraph,
  extraireMessagesConversations, dateLaPlusRecente, idDocumentFacebook, champsFirestoreFacebook,
  CHAMPS_CONVERSATIONS,
} from "../public/facebook.js";

const JETON = "EAAG" + "x".repeat(60);

// Jeton
assert.equal(jetonFacebookValide(JETON), true);
assert.equal(jetonFacebookValide("  " + JETON + " "), true);
assert.equal(jetonFacebookValide("court"), false);
assert.equal(jetonFacebookValide("EAAG avec des espaces " + "x".repeat(60)), false);
assert.equal(jetonFacebookValide(""), false);

// Adresse
const u = urlGraph("v24.0", "/me/accounts", { fields: "id,name,access_token", limit: 25, vide: "" }, "TOK");
assert.ok(u.startsWith("https://graph.facebook.com/v24.0/me/accounts?"));
assert.ok(u.includes("fields=id%2Cname%2Caccess_token") && u.includes("limit=25") && u.endsWith("access_token=TOK") && !u.includes("vide"));
assert.ok(urlGraph(undefined, "/x", {}, "T").startsWith("https://graph.facebook.com/v24.0/x?"));
assert.ok(urlGraph("v24.0", "/1/conversations", { fields: CHAMPS_CONVERSATIONS }, "T").includes("messages.limit(5)".replace(/[(){}]/g, (c) => encodeURIComponent(c))));

// Erreurs
assert.match(expliquerErreurFacebook({ error: { code: 190, message: "expired" } }), /jeton/);
assert.match(expliquerErreurFacebook({ error: { code: 200, message: "perm" } }), /pages_messaging/);
assert.match(expliquerErreurFacebook({ error: { code: 613 } }), /limite/);
assert.match(expliquerErreurFacebook({ error: { code: 2635, message: "Unsupported get request" } }), /versionApi/);
assert.match(expliquerErreurFacebook({ error: { code: 100, message: "Invalid parameter" } }), /100.*Invalid parameter/);
assert.match(expliquerErreurFacebook({}), /erreur/);

// Pages
const pages = choisirPages({ data: [
  { id: "111", name: "WEUNDE BUSINESS", access_token: "PT1" },
  { id: "222", name: "Sans jeton" },
  { name: "Sans id", access_token: "x" },
] });
assert.deepEqual(pages, [{ id: "111", nom: "WEUNDE BUSINESS", jeton: "PT1" }]);
assert.deepEqual(choisirPages(undefined), []);

// Dates Graph
assert.equal(dateGraph("2026-11-02T09:30:00+0000").toISOString(), "2026-11-02T09:30:00.000Z");
assert.equal(dateGraph("2026-11-02T11:30:00+0200").toISOString(), "2026-11-02T09:30:00.000Z");
assert.ok(Number.isNaN(dateGraph("pas une date").getTime()));

// Messages
const page = { id: "111", nom: "WEUNDE BUSINESS" };
const reponse = { data: [
  { id: "t_1", updated_time: "2026-11-02T10:00:00+0000", messages: { data: [
    { id: "m_3", message: "Merci, c'est noté", from: { id: "111", name: "WEUNDE BUSINESS" }, created_time: "2026-11-02T10:00:00+0000" },
    { id: "m_2", message: "Bonjour, ma FACTURE n'est pas arrivée", from: { id: "777", name: "Paul Kabuo" }, created_time: "2026-11-02T09:30:00+0000" },
    { id: "m_1", message: "", from: { id: "777", name: "Paul Kabuo" }, created_time: "2026-11-01T08:00:00+0000" },
  ] } },
  { id: "t_2", updated_time: "2026-10-01T10:00:00+0000", messages: { data: [
    { id: "m_0", message: "Ancien", from: { id: "888", name: "Ancien" }, created_time: "2026-10-01T10:00:00+0000" },
  ] } },
  { id: "t_3" },
] };
const tous = extraireMessagesConversations(reponse, page, 0);
assert.deepEqual(tous.map((m) => m.id).sort(), ["m_0", "m_1", "m_2"]);   // la réponse de la Page (m_3) est ignorée
const recents = extraireMessagesConversations(reponse, page, Date.parse("2026-11-01T12:00:00Z"));
assert.deepEqual(recents.map((m) => m.id), ["m_2"]);
assert.equal(recents[0].de, "Paul Kabuo");
assert.equal(recents[0].important, true);
assert.equal(tous.find((m) => m.id === "m_1").texte, "[Pièce jointe ou autocollant]");
assert.equal(tous.find((m) => m.id === "m_1").important, false);
assert.equal(dateLaPlusRecente(recents), Date.parse("2026-11-02T09:30:00Z"));
assert.equal(dateLaPlusRecente([], 42), 42);
assert.deepEqual(extraireMessagesConversations(undefined, page), []);

// Format Firestore
assert.equal(idDocumentFacebook({ id: "m_AbC/12=" }), "facebook-m_AbC_12_");
const c = champsFirestoreFacebook(recents[0]);
assert.deepEqual(c.source, { stringValue: "facebook" });
assert.deepEqual(c.de, { stringValue: "Paul Kabuo (WEUNDE BUSINESS)" });
assert.deepEqual(c.important, { booleanValue: true });
assert.equal(c.date.timestampValue, "2026-11-02T09:30:00.000Z");

console.log("Facebook : OK");
