import assert from "node:assert/strict";
import { RAPPORT_APPLI, dessinerRapportAppli } from "../public/rapport-appli.js";
const appels = { texte: 0, pages: 1 };
const doc = { setFont(){}, setFontSize(){}, setTextColor(){}, setDrawColor(){}, line(){}, setPage(){},
  splitTextToSize: (t, w) => String(t).match(new RegExp(".{1," + Math.floor(w * 0.5) + "}(\\s|$)", "g")) || [""],
  text(){ appels.texte++; }, addPage(){ appels.pages++; }, getNumberOfPages: () => appels.pages };
dessinerRapportAppli(doc, { utilisateur: "test" });
assert.ok(RAPPORT_APPLI.length >= 8);
assert.ok(appels.texte > 20);
console.log("rapport-appli OK");
import { sectionsDonnees } from "../public/rapport-appli.js";
const sec = sectionsDonnees({ profil: { nom: "X", email: "a@b.c" }, messages: { recents: 3, nonLus: 1, importants: [{ date: 0, de: "A", sujet: "S" }] },
  agenda: { aujourdhui: [], aVenir: [{ debut: new Date(), titre: "RDV" }] }, taches: [{ title: "T", list: "L" }], indicateurs: [{ base: "B", nom: "N", valeur: 5 }],
  ristourne: { total: { solde: { FC: 10, USD: 2 } }, mouvements: 4 }, wallet: { comptes: [{ name: "C", balance: 5, currency: "USD" }], nbMouvements: 1, totaux: { USD: { revenus: 1, depenses: 0, solde: 5 } }, derniers: [] },
  notes: [{ title: "n" }], social: [] });
assert.equal(sec.length, 9);
assert.ok(sec.find((s) => s.titre === "Tâches (Google Tasks)").puces.some((p) => p.includes("T")));
assert.ok(sectionsDonnees({}).every((s) => s.puces.length));
dessinerRapportAppli(doc, { donnees: { profil: {}, messages: null } });
console.log("rapport-appli données OK");
