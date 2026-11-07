import assert from "node:assert/strict";
import { construireContexteGlobal, construireContexteFinances, preparerRequeteAssistant, extraireReponseAssistant, messageErreurAssistant, iaTotauxParMois, IA_MODELE } from "../public/assistant.js";
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

{
  const g = JSON.parse(construireContexteGlobal(["messages", "agenda", "bases", "social", "notes", "drive"], {
    messages: { importants: [{ de: "A", sujet: "Facture", date: 1730000000000, extrait: "x".repeat(400), etoile: true }], recents: [] },
    agenda: { aujourdhui: [{ titre: "RDV", debut: new Date("2026-11-07T10:00:00Z"), fin: new Date("2026-11-07T11:00:00Z"), lieu: "Bureau" }], aVenir: [] },
    bases: [{ base: "ESE DB", nom: "Ventes", valeur: 12, unite: "$" }, { nom: "X", erreur: true }],
    social: [{ date: 0, de: "Paul", texte: "Salut" }], notes: [{ title: "Idée", body: "b".repeat(500), pinned: true }], drive: [{ name: "Budget.xlsx", mimeType: "application/vnd.ms-excel", modifiedTime: "2026-11-01" }],
    finances: { comptes: [{ name: "Caisse", currency: "FC", balance: 1 }] } }, "2026-11-07"));
  assert.equal(g.messages.importants[0].extrait.length, 150); assert.equal(g.messages.importants[0].important_etoile, true);
  assert.equal(g.agenda.aujourdhui[0].titre, "RDV"); assert.equal(g.bases_de_donnees[1].valeur, "indisponible"); assert.equal(g.reseaux_sociaux[0].de, "Paul");
  assert.equal(g.notes_et_projets[0].contenu.length, 200); assert.equal(g.fichiers_drive[0].nom, "Budget.xlsx");
  assert.ok(!("comptes_porte_monnaie" in g)); // finances hors portée : non envoyées
  const f = JSON.parse(construireContexteGlobal(["finances"], { finances: { comptes: [{ name: "Caisse", currency: "FC", balance: 5 }] }, messages: { importants: [{ sujet: "secret" }] } }, "2026-11-07"));
  assert.equal(f.comptes_porte_monnaie[0].solde, 5); assert.ok(!("messages" in f));
  console.log("assistant global OK");
}
