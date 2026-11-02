import assert from "node:assert/strict";
import {
  decoderValeur, decoderDocument, corpsAgregation, lireAgregat, corpsListe, lireListe,
  calculerCreditsAvec, MESURES_CREDITS_AVEC, calculerEse, MESURES_ESE,
} from "../public/firestore.js";
import { construireAlertes } from "../public/core.js";
import { bases, reglages } from "../public/config.js";

// Décodage des valeurs Firestore REST
assert.equal(decoderValeur({ stringValue: "a" }), "a");
assert.equal(decoderValeur({ integerValue: "42" }), 42);
assert.equal(decoderValeur({ doubleValue: 1.5 }), 1.5);
assert.deepEqual(decoderValeur({ arrayValue: { values: [{ integerValue: "1" }, { stringValue: "x" }] } }), [1, "x"]);
assert.deepEqual(decoderValeur({ arrayValue: {} }), []);
assert.deepEqual(decoderValeur({ mapValue: { fields: { n: { integerValue: "2" } } } }), { n: 2 });
const doc = decoderDocument({
  name: "projects/p/databases/(default)/documents/members/MBR-001",
  fields: { name: { stringValue: "Grace" }, epargne: { doubleValue: 300 } },
});
assert.deepEqual(doc, { id: "MBR-001", name: "Grace", epargne: 300 });

// Corps de requêtes
const c = corpsAgregation({ collection: "claims", op: "count", filtre: { champ: "status", op: "NOT_EQUAL", valeur: "traitée" } });
const sq = c.structuredAggregationQuery;
assert.equal(sq.structuredQuery.from[0].collectionId, "claims");
assert.equal(sq.structuredQuery.where.fieldFilter.op, "NOT_EQUAL");
assert.deepEqual(sq.structuredQuery.where.fieldFilter.value, { stringValue: "traitée" });
assert.deepEqual(sq.aggregations[0], { alias: "v", count: {} });
const s = corpsAgregation({ collection: "members", op: "sum", champ: "epargne" });
assert.deepEqual(s.structuredAggregationQuery.aggregations[0].sum, { field: { fieldPath: "epargne" } });
assert.equal(s.structuredAggregationQuery.structuredQuery.where, undefined);
assert.equal(corpsListe({ collection: "social_inbox", tri: "date", max: 5 }).structuredQuery.limit, 5);

// Lecture des réponses
assert.equal(lireAgregat([{ result: { aggregateFields: { v: { integerValue: "12" } } } }]), 12);
assert.equal(lireAgregat([{ result: { aggregateFields: { v: { doubleValue: 99.5 } } } }]), 99.5);
assert.equal(lireAgregat([{ readTime: "x" }]), 0);
const liste = lireListe([
  { document: { name: "x/y/a1", fields: { de: { stringValue: "Marie" } } } },
  { readTime: "t" },
]);
assert.deepEqual(liste, [{ id: "a1", de: "Marie" }]);

// Crédits AVEC : reste = montant - remboursé ; retard = reste > 0 et échéance passée
const membres = [
  { epargne: 100, epargneFC: 5000, credits: [{ amount: 200, repaid: 50, dueDate: "2026-09-01" }, { amount: 100, repaid: 100, dueDate: "2026-01-01" }] },
  { epargne: 50.5, credits: [{ amount: 100000, repaid: 20000, devise: "FC", dueDate: "2027-01-01" }] },
  { epargne: 0, credits: [] },
];
const r = calculerCreditsAvec(membres, "2026-10-26");
assert.equal(r.resteUSD, 150);
assert.equal(r.resteFC, 80000);
assert.equal(r.nbEnCours, 2);
assert.equal(r.nbRetard, 1);
assert.equal(r.membresAvecCredit, 2);
assert.equal(r.epargneUSD, 150.5);
assert.equal(r.epargneFC, 5000);
assert.equal(MESURES_CREDITS_AVEC.nb_retard(r), 1);

// Alertes avec message personnalisé
const al = construireAlertes({
  kpis: [{ label: "Crédits en retard", valeur: 3, etat: "haut", messageAlerte: "{{valeur}} crédit(s) en retard", niveauAlerte: "haute", base: "AVEC LA SAGESSE" }],
});
assert.equal(al[0].texte, "3 crédit(s) en retard");
assert.equal(al[0].niveau, "haute");
assert.match(al[0].source, /AVEC LA SAGESSE/);

// Configuration livrée : cohérente
assert.equal(bases.avec.projectId, "avec-la-sagesse");
assert.equal(bases.ese.projectId, "ese-db-b63de");
assert.equal(bases.webservices, undefined);
for (const k of reglages.kpis) {
  assert.ok(bases[k.base], `base inconnue pour « ${k.label} »`);
  assert.ok(["count", "sum", "avec_credits", "ese"].includes(k.op), `op inconnue pour « ${k.label} »`);
  if (k.op === "sum") assert.ok(k.champ, `champ manquant pour « ${k.label} »`);
  if (k.op === "avec_credits") assert.ok(MESURES_CREDITS_AVEC[k.mesure], `mesure inconnue pour « ${k.label} »`);
  if (k.op === "ese") assert.ok(MESURES_ESE[k.mesure], `mesure inconnue pour « ${k.label} »`);
}

console.log("Tests Firestore et configuration : OK");

// Pannes regroupées : une alerte par base et par cause
const pannes = construireAlertes({
  kpis: [
    { label: "Membres", base: "WEB SERVICES", erreur: "Google a répondu 403 : refusé" },
    { label: "Épargne", base: "WEB SERVICES", erreur: "Google a répondu 403 : refusé" },
    { label: "Autre", base: "AVEC", erreur: "Autre cause" },
  ],
});
assert.equal(pannes.length, 2);
assert.match(pannes[0].texte, /Membres, Épargne/);
assert.match(pannes[0].texte, /403/);
console.log("Pannes regroupées : OK");

// ESE DB : ventes, dépenses, dettes, crédits clients, stock
const jours = [
  { id: "2026-11-02", items: {
    a: { k: "s", name: "Riz", q: 3, p: 1000, c: "FC" },
    b: { k: "s", name: "Savon", q: 2, p: 5, c: "USD" },
    c: { k: "e", a: 500, c: "FC", t: "Transport" },
    d: { k: "m", a: 99999, c: "FC" },
  } },
  { id: "2026-11-01", items: { e: { k: "s", name: "riz ", q: 10, p: 1000, c: "FC" }, f: { k: "e", a: 2, c: "USD" } } },
  { id: "2026-10-30", items: { g: { k: "s", name: "Riz", q: 100, p: 1000, c: "FC" } } },
];
const cfg = {
  debts: {
    d1: { k: "a", who: "Marie", amt: 1000, c: "FC", pay: { p1: { a: 400 } } },
    d2: { k: "l", who: "Bailleur", amt: 50, c: "USD", pay: {} },
    d3: null,
  },
  credits: { c1: { who: "Jean", amt: 800, c: "FC", pname: "Savon", qty: 1, pay: { x: { a: 300 } } } },
  stock: {
    s1: { name: "Riz", start: 120, min: 5, ins: { i1: { q: 10 } } },     // 130 - 113 vendus = 17 : ok
    s2: { name: "Savon", start: 5, min: 2, ins: {} },                    // 5 - 2 - 1 = 2 : sous le seuil
    s3: { name: "Sucre", start: 4, min: 1, ins: { i2: 3 } },             // 7 : ok
  },
};
const e = calculerEse(jours, cfg, "2026-11-02");
assert.equal(e.venteJourFC, 3000);
assert.equal(e.venteJourUSD, 10);
assert.equal(e.venteMoisFC, 13000);   // 3000 + 10000 ; le 30 octobre est exclu
assert.equal(e.venteMoisUSD, 10);
assert.equal(e.depMoisFC, 500);
assert.equal(e.depMoisUSD, 2);
assert.equal(e.detteFC, 600);
assert.equal(e.detteUSD, 50);
assert.equal(e.creditFC, 500);
assert.equal(e.creditUSD, 0);
assert.equal(e.stockBas, 1);
assert.equal(MESURES_ESE.stock_bas(e), 1);
const vide = calculerEse([], {}, "2026-11-02");
assert.equal(vide.stockBas, 0);
assert.equal(vide.venteMoisFC, 0);
console.log("ESE DB : OK");
