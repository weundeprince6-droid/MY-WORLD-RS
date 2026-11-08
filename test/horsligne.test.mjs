import assert from "node:assert/strict";
import { estLectureMemorisable, cleCache, analyserEcriture, reponseSimulee, superposerFile, ajouterALaFile, retirerDeLaFile, verdictRenvoi } from "../public/horsligne.js";
const B = "https://firestore.googleapis.com/v1/projects/my-world-rs/databases/(default)/documents";
assert.ok(estLectureMemorisable("https://x/y")); assert.ok(estLectureMemorisable(B + ":runQuery", { method: "POST" }));
assert.ok(!estLectureMemorisable("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST" }));
assert.notEqual(cleCache("u", { method: "POST", body: "a" }), cleCache("u", { method: "POST", body: "b" }));
const S = (v) => ({ stringValue: v });
const c = analyserEcriture(B + "/users/U%201/houseEntries?documentId=e1", { method: "POST", body: JSON.stringify({ fields: { a: S("1") } }) });
assert.equal(c.type, "create"); assert.equal(c.col, "users/U 1/houseEntries"); assert.equal(c.id, "e1");
const p = analyserEcriture(B + "/users/U/walletAccounts/a1?updateMask.fieldPaths=balance", { method: "PATCH", body: JSON.stringify({ fields: { balance: { doubleValue: 5 } } }) });
assert.equal(p.type, "patch"); assert.equal(p.id, "a1");
const d = analyserEcriture(B + "/users/U/walletTransactions/t1", { method: "DELETE" });
assert.equal(d.type, "delete");
assert.equal(analyserEcriture(B + "/days/2026-01-01", { method: "PATCH", body: "{}" }), null); // pas dans users/
assert.equal(analyserEcriture("https://www.googleapis.com/calendar/v3/x", { method: "POST" }), null);
assert.equal(analyserEcriture(B + "/users/U/houseEntries", { method: "POST" }), null); // sans documentId
assert.equal(reponseSimulee(c).fields.a.stringValue, "1");
const nom = (col, id) => `projects/my-world-rs/databases/(default)/documents/users/U/${col}/${id}`;
const liste = { documents: [{ name: nom("walletAccounts", "a1"), fields: { balance: { doubleValue: 70 }, name: S("Caisse") } }, { name: nom("walletAccounts", "a2"), fields: { name: S("Autre") } }] };
let f = [];
f = ajouterALaFile(f, p); f = ajouterALaFile(f, d); f = ajouterALaFile(f, analyserEcriture(B + "/users/U/walletAccounts/a2", { method: "DELETE" }));
f = ajouterALaFile(f, analyserEcriture(B + "/users/U/walletAccounts?documentId=a3", { method: "POST", body: JSON.stringify({ fields: { name: S("Neuf") } }) }));
assert.deepEqual(f.map((o) => o.n), [1, 2, 3, 4]);
const r = superposerFile(B + "/users/U/walletAccounts?pageSize=300", liste, f);
assert.equal(r.documents.length, 2);
assert.equal(r.documents[0].fields.balance.doubleValue, 5); assert.equal(r.documents[0].fields.name.stringValue, "Caisse");
assert.equal(r.documents[1].fields.name.stringValue, "Neuf");
assert.equal(liste.documents.length, 2); assert.equal(liste.documents[0].fields.balance.doubleValue, 70); // pas de modification de l'original
assert.equal(superposerFile(B + "/users/U/walletAccounts?pageSize=300", {}, [f[3]]).documents.length, 1); // collection vide en cache
assert.equal(superposerFile(B + "/users/U/walletAccounts/a1", liste.documents[0], [f[0]]).fields.balance.doubleValue, 5);
assert.equal(superposerFile(B + "/users/U/walletAccounts/a2", liste.documents[1], [f[2]]), null);
assert.deepEqual(superposerFile("https://x/y", { a: 1 }, f), { a: 1 });
assert.deepEqual(retirerDeLaFile(f, 2).map((o) => o.n), [1, 3, 4]);
assert.equal(verdictRenvoi(c, 200), "ok"); assert.equal(verdictRenvoi(c, 409), "abandon"); assert.equal(verdictRenvoi(d, 404), "abandon");
assert.equal(verdictRenvoi(p, 404), "abandon"); assert.equal(verdictRenvoi(p, 503), "reseau"); assert.equal(verdictRenvoi(p, 401), "reseau"); assert.equal(verdictRenvoi(p, 429), "reseau");
console.log("horsligne OK");
