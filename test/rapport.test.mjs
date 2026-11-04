import assert from "node:assert/strict";
import { formaterMontant, effetMouvement, graduation, etiquetteAxe, pourcentages, calculerRapport } from "../public/rapport.js";

assert.equal(formaterMontant(1234567, "FC"), "1 234 567 FC");
assert.equal(formaterMontant(-398800), "-398 800");
assert.equal(formaterMontant(120.5, "USD"), "120,50 USD");
assert.equal(formaterMontant(0), "0");

assert.equal(effetMouvement({ kind: "income", amount: 10 }), 10);
assert.equal(effetMouvement({ kind: "expense", amount: 10 }), -10);
assert.equal(effetMouvement({ kind: "transfer", direction: "in", amount: 10 }), 10);
assert.equal(effetMouvement({ kind: "transfer", direction: "out", amount: 10 }), -10);

const g = graduation(3500000);
assert.equal(g.max, g.pas * 4);
assert.ok(g.max >= 3500000);
assert.equal(etiquetteAxe(2000000), "2M");
assert.equal(etiquetteAxe(-10000000), "-10M");

const p = pourcentages([1, 1, 1]);
assert.equal(Math.round(p.reduce((s, v) => s + v, 0) * 10) / 10, 100);
assert.deepEqual(pourcentages([0, 0]), [0, 0]);

const r = calculerRapport({
  devise: "FC",
  comptes: [{ id: "a", name: "Caisse", currency: "FC", balance: 70 }],
  transactions: [
    { id: "1", kind: "income", accountId: "a", accountName: "Caisse", currency: "FC", amount: 100, date: "2026-10-01", category: "Vente", paymentMethod: "Espèces" },
    { id: "2", kind: "expense", accountId: "a", accountName: "Caisse", currency: "FC", amount: 30, date: "2026-10-02", category: "Transport" },
  ],
  maintenant: new Date("2026-11-04T10:00:00"),
});
assert.ok(r && typeof r === "object");
console.log("rapport.test.mjs OK");
