import assert from "node:assert/strict";
import { construireContexteFinances, preparerRequeteAssistant, extraireReponseAssistant, messageErreurAssistant, iaTotauxParMois, IA_MODELE } from "../public/assistant.js";
const mv = [
  { kind: "expense", amount: 30000, currency: "FC", date: "2026-11-02", accountName: "Caisse", category: "Courses", description: "riz" },
  { kind: "income", amount: 100000, currency: "FC", date: "2026-11-01", accountName: "Caisse" },
  { kind: "expense", amount: 5, currency: "USD", date: "2026-10-15" }, { kind: "expense", amount: 9, currency: "FC", date: "2026-05-01" } ];
const t = iaTotauxParMois(mv, "2026-11");
assert.equal(t["2026-11"].FC.depenses, 30000); assert.equal(t["2026-11"].FC.revenus, 100000); assert.equal(t["2026-10"].USD.depenses, 5); assert.equal(Object.keys(t).length, 3);
const ctx = construireContexteFinances({ comptes: [{ name: "Caisse", type: "professional", currency: "FC", balance: 70000 }], mouvements: mv, caisse: { total: 18.04, cur: "USD", FC: 72100, USD: -12 }, aujourdhui: "2026-11-07",
  espaces: [{ nom: "Ma maison", calc: { mois: "2026-11", depensesMois: { FC: 1, USD: 0 }, chantier: { budget: {}, depense: {}, reste: {}, avancement: 10 }, parCategorie: [] }, entrees: [{ section: "depense", amount: 5, currency: "FC", date: "2026-11-01" }], materiel: {}, articles: [{ kind: "ravitailler", name: "Lampe", qty: 1, price: 3, currency: "FC" }] }] });
const j = JSON.parse(ctx);
assert.equal(j.comptes_porte_monnaie[0].solde, 70000); assert.equal(j.caisse_ese_db.somme_restante, 18.04); assert.equal(j.espaces[0].materiel.a_acquerir[0].nom, "Lampe");
const r = preparerRequeteAssistant({ cle: "sk-test", contexte: ctx, rubrique: "Ma maison", historique: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], question: "Combien ?" });
const corps = JSON.parse(r.options.body);
assert.equal(r.url, "https://api.anthropic.com/v1/messages"); assert.equal(r.options.headers["x-api-key"], "sk-test"); assert.equal(r.options.headers["anthropic-dangerous-direct-browser-access"], "true");
assert.equal(corps.model, IA_MODELE); assert.equal(corps.messages.at(-1).content, "Combien ?"); assert.ok(corps.system.includes("70000") && corps.system.includes("Ma maison"));
assert.equal(extraireReponseAssistant({ content: [{ type: "text", text: "Bonjour" }, { type: "tool_use" }, { type: "text", text: "!" }] }), "Bonjour\n!");
assert.equal(extraireReponseAssistant(null), "");
assert.ok(messageErreurAssistant(401, {}).includes("Clé refusée")); assert.ok(messageErreurAssistant(429, {}).includes("Trop de demandes")); assert.ok(messageErreurAssistant(500, { error: { message: "x" } }).includes("indisponible"));
const gros = construireContexteFinances({ mouvements: Array.from({ length: 300 }, (_, i) => ({ kind: "expense", amount: i, currency: "FC", date: "2026-11-01", description: "x".repeat(60), category: "y".repeat(40), accountName: "z".repeat(30) })), aujourdhui: "2026-11-07" });
assert.ok(gros.length < 16000);
console.log("assistant OK");
