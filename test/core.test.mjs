import assert from "node:assert/strict";
import {
  scoreMessage, messagesImportants, repartirAgenda, evaluerSeuil, construireAlertes,
  resumeDuJour, remplirModele, construireBrouillonBrut, expediteurLisible,
} from "../public/core.js";

const msg = (id, from, subject, labels = [], snippet = "") => ({
  id, threadId: "t" + id, labelIds: labels, snippet, internalDate: String(1000 + Number(id.replace(/\D/g, "") || 0)),
  payload: { headers: [{ name: "From", value: from }, { name: "Subject", value: subject }] },
});

// Messages
const urgent = msg("1", "Marie <marie@ex.com>", "Rappel facture", ["UNREAD", "IMPORTANT"]);
const promo = msg("2", "Boutique <no-reply@shop.com>", "Promotion -50%", ["UNREAD", "CATEGORY_PROMOTIONS"]);
const banal = msg("3", "Paul <paul@ex.com>", "Salut", []);
assert.ok(scoreMessage(urgent) >= 5);
assert.ok(scoreMessage(promo) < 0);
const res = messagesImportants([promo, banal, urgent]);
assert.equal(res.length, 1);
assert.equal(res[0].de, "Marie");
assert.equal(expediteurLisible("jean@ex.com"), "jean@ex.com");
const vip = messagesImportants([banal], { contactsVip: ["paul@ex.com"], seuil: 3 });
assert.equal(vip.length, 1);

// Agenda
const maintenant = new Date("2026-10-26T10:00:00");
const evs = [
  { id: "a", summary: "Réunion", start: { dateTime: "2026-10-26T10:30:00" }, end: { dateTime: "2026-10-26T11:30:00" } },
  { id: "b", summary: "Fête", start: { date: "2026-10-26" }, end: { date: "2026-10-27" } },
  { id: "c", summary: "Demain", start: { dateTime: "2026-10-27T09:00:00" }, end: { dateTime: "2026-10-27T10:00:00" } },
];
const ag = repartirAgenda(evs, maintenant);
assert.equal(ag.aujourdhui.length, 2);
assert.equal(ag.aVenir.length, 1);

// Seuils et alertes
assert.equal(evaluerSeuil(5, { min: 10 }), "bas");
assert.equal(evaluerSeuil(50, { max: 10 }), "haut");
assert.equal(evaluerSeuil(5, {}), "ok");
const alertes = construireAlertes({
  messages: res, agenda: ag, maintenant,
  kpis: [{ label: "Épargne", valeur: 5, etat: "bas" }],
  social: [{ important: true }],
});
assert.ok(alertes.some((a) => a.source === "agenda" && a.niveau === "haute"));
assert.ok(alertes.some((a) => a.source === "données"));
assert.ok(alertes.some((a) => a.source === "réseaux"));
assert.equal(alertes[0].niveau, "haute");
assert.match(resumeDuJour({ messages: res, agenda: ag, alertes }), /2 rendez-vous/);

// Brouillon
assert.equal(remplirModele("Bonjour {{nom}} ({{sujet}})", { nom: "Marie", sujet: "X" }), "Bonjour Marie (X)");
const brut = construireBrouillonBrut({ a: "marie@ex.com", sujet: "Re: Rappel facture é", corps: "Bonjour é" });
assert.ok(/^[A-Za-z0-9_-]+$/.test(brut));
const decode = Buffer.from(brut.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
assert.ok(decode.startsWith("To: marie@ex.com\r\nSubject: =?UTF-8?B?"));
assert.ok(decode.endsWith("Bonjour é"));

console.log("Tous les tests passent.");
