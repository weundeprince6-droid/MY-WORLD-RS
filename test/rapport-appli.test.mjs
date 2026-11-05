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
