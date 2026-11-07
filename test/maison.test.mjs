import assert from "node:assert/strict";
import { calculerMaison, normaliserEntreeMaison } from "../public/maison.js";
const E = [
  { section: "depense", category: "Loyer", amount: 100000, currency: "FC", date: "2026-11-02" },
  { section: "depense", category: "Courses", amount: 30000, currency: "FC", date: "2026-11-05" },
  { section: "depense", category: "Courses", amount: 20, currency: "USD", date: "2026-11-06" },
  { section: "depense", category: "Loyer", amount: 999, currency: "FC", date: "2026-10-30" },
  { section: "revenu", category: "Salaire", amount: 250000, currency: "FC", date: "2026-11-01" },
  { section: "chantier", category: "Matériaux", amount: 400000, currency: "FC", date: "2026-10-01" },
  { section: "chantier", category: "Main-d'œuvre", amount: 100, currency: "USD", date: "2026-11-03" },
];
const m = calculerMaison(E, { budgetFC: 200000, chantierFC: 1000000, avancement: 35 }, "2026-11");
assert.equal(m.depensesMois.FC, 130000); assert.equal(m.depensesMois.USD, 20);
assert.equal(m.revenusMois.FC, 250000); assert.equal(m.soldeMois.FC, 120000);
assert.equal(m.budgetUtilise.FC, 65); assert.equal(m.budgetRestant.FC, 70000); assert.equal(m.budgetUtilise.USD, null);
assert.equal(m.depensesTotales.FC, 130999);
assert.equal(m.parCategorie[0].nom, "Loyer");
assert.equal(m.chantier.depense.FC, 400000); assert.equal(m.chantier.depense.USD, 100);
assert.equal(m.chantier.reste.FC, 600000); assert.equal(m.chantier.utilise.FC, 40); assert.equal(m.chantier.avancement, 35);
assert.equal(calculerMaison([], null).depensesMois.FC, 0);
assert.ok(normaliserEntreeMaison({ section: "depense", amount: "1 500,5", date: "2026-11-07", currency: "USD" }).entree.amount === 1500.5);
assert.ok(normaliserEntreeMaison({ section: "depense", amount: "0", date: "2026-11-07" }).erreur);
assert.ok(normaliserEntreeMaison({ section: "x", amount: "5", date: "2026-11-07" }).erreur);
assert.ok(normaliserEntreeMaison({ section: "depense", amount: "5", date: "" }).erreur);
console.log("maison OK");
