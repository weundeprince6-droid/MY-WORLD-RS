import assert from "node:assert/strict";
import {
  scoreMessage, messagesImportants, repartirAgenda, evaluerSeuil, construireAlertes,
  resumeDuJour, remplirModele, construireBrouillonBrut, construireMessageBrut, lireMessageComplet, expediteurLisible, enLots,
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
// Cc et protection contre l'injection d'en-têtes
const b64d = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const avecCc = b64d(construireBrouillonBrut({ a: "a@ex.com", cc: "b@ex.com, c@ex.com", sujet: "S", corps: "C" }));
assert.ok(avecCc.includes("\r\nCc: b@ex.com, c@ex.com\r\n"));
const piege = b64d(construireBrouillonBrut({ a: "a@ex.com\r\nBcc: pirate@ex.com", cc: "x@ex.com\nBcc: z@ex.com", sujet: "S", corps: "C" }));
assert.ok(!/\r\nBcc:/.test(piege) && !/\nBcc:/.test(piege.replace(/\r\n/g, "\n").split("\n\n")[0].replace(/^To:.*$/m, "").replace(/^Cc:.*$/m, "")));
assert.ok(!piege.includes("Cc: x@ex.com\n"));

// Pièces jointes : message multipart
const contenuPj = Buffer.from("Bonjour pièce jointe é").toString("base64");
const mp = b64d(construireMessageBrut({ a: "a@ex.com", sujet: "Avec PJ", corps: "Texte", pieces: [{ nom: 'rapport "final".pdf', type: "application/pdf", base64: contenuPj }] }));
assert.ok(/Content-Type: multipart\/mixed; boundary="(mwrs_[a-z0-9]+)"/.test(mp));
const front = mp.match(/boundary="([^"]+)"/)[1];
assert.ok(mp.includes("--" + front + "--"));
assert.ok(mp.includes("Content-Type: application/pdf; name=\"=?UTF-8?B?"));
assert.ok(mp.includes("Content-Disposition: attachment; filename=\"=?UTF-8?B?"));
assert.ok(!mp.includes('rapport "final"'));
assert.ok(mp.includes(contenuPj));
assert.ok(mp.includes("Content-Transfer-Encoding: base64"));
assert.ok(!/^Content-Type: multipart/m.test(b64d(construireMessageBrut({ a: "a@ex.com", sujet: "S", corps: "C" }))));
// gros fichier (3 Mo) sans dépassement de pile
const gros = Buffer.alloc(3 * 1024 * 1024, 7).toString("base64");
assert.ok(construireMessageBrut({ a: "a@ex.com", sujet: "S", corps: "C", pieces: [{ nom: "gros.bin", type: "application/octet-stream", base64: gros }] }).length > 4000000);

// Lecture d'un message complet
const enc = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const lu = lireMessageComplet({ id: "m9", threadId: "t9", internalDate: "1700000000000", payload: { headers: [{ name: "From", value: "Moi <moi@ex.com>" }, { name: "To", value: "marie@ex.com" }, { name: "Subject", value: "Sujet é" }],
  mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: enc("Bonjour é\nLigne 2") } }, { mimeType: "text/html", body: { data: enc("<p>HTML</p>") } }] },
  { mimeType: "application/pdf", filename: "facture.pdf", body: { attachmentId: "att1", size: 2048 } }] } });
assert.equal(lu.corps, "Bonjour é\nLigne 2"); assert.equal(lu.pieces.length, 1); assert.equal(lu.pieces[0].nom, "facture.pdf"); assert.equal(lu.pieces[0].idPiece, "att1"); assert.equal(lu.a, "marie@ex.com");
const luHtml = lireMessageComplet({ id: "m", payload: { headers: [], mimeType: "text/html", body: { data: enc("<style>x{}</style><div>Salut&nbsp;toi</div><p>Ligne&amp;2</p>") } } });
assert.equal(luHtml.corps, "Salut toi\nLigne&2");

// Exécution par lots : ordre conservé, jamais plus de 4 appels en même temps
let actifs = 0, maxActifs = 0;
const sortie = await enLots([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
  actifs += 1; maxActifs = Math.max(maxActifs, actifs);
  await new Promise((ok) => setTimeout(ok, 5));
  actifs -= 1; return n * 10;
});
assert.deepEqual(sortie, [10, 20, 30, 40, 50, 60, 70, 80, 90]);
assert.equal(maxActifs, 4);

console.log("Tous les tests passent.");

// Corps d'un événement Google Agenda
{
  const { corpsEvenement } = await import("../public/core.js");
  const e = corpsEvenement({ titre: " Réunion ", date: "2026-11-05", debut: "14:00", fin: "15:30", lieu: "Bureau", description: "" }, "Africa/Lubumbashi");
  assert.equal(e.summary, "Réunion");
  assert.equal(e.start.dateTime, "2026-11-05T14:00:00");
  assert.equal(e.end.dateTime, "2026-11-05T15:30:00");
  assert.equal(e.start.timeZone, "Africa/Lubumbashi");
  assert.equal(e.location, "Bureau");
  assert.equal(e.description, undefined);
  assert.equal(corpsEvenement({ titre: "x", date: "2026-11-05", debut: "09:15" }).end.dateTime, "2026-11-05T10:15:00");
  const j = corpsEvenement({ titre: "Férié", date: "2026-12-31", toutLeJour: true });
  assert.deepEqual(j.start, { date: "2026-12-31" });
  assert.deepEqual(j.end, { date: "2027-01-01" });
  assert.throws(() => corpsEvenement({ titre: "", date: "2026-11-05", debut: "09:00" }), /titre/);
  assert.throws(() => corpsEvenement({ titre: "a", date: "", debut: "09:00" }), /date/);
  assert.throws(() => corpsEvenement({ titre: "a", date: "2026-11-05" }), /début/);
  assert.throws(() => corpsEvenement({ titre: "a", date: "2026-11-05", debut: "10:00", fin: "09:00" }), /après/);
  console.log("Corps d'événement Agenda : OK");
}
