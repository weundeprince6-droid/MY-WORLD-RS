import assert from "node:assert/strict";
import {
  jetonValide, urlTelegram, expliquerErreurTelegram, nomExpediteur, texteDuMessage, texteImportant,
  extraireMessage, idDocument, champsFirestore, dernierUpdateId,
} from "../public/telegram.js";

// Jeton
assert.equal(jetonValide("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"), true);
assert.equal(jetonValide(" 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw "), true);
assert.equal(jetonValide("pas-un-jeton"), false);
assert.equal(jetonValide(""), false);

// Adresse
const u = urlTelegram("1:ABC", "getUpdates", { offset: 42, limit: 100, vide: "", rien: undefined, allowed_updates: '["message"]' });
assert.ok(u.startsWith("https://api.telegram.org/bot1:ABC/getUpdates?"));
assert.ok(u.includes("offset=42") && u.includes("limit=100") && !u.includes("vide") && !u.includes("rien"));
assert.ok(u.includes("allowed_updates=%5B%22message%22%5D"));
assert.equal(urlTelegram("1:ABC", "getMe"), "https://api.telegram.org/bot1:ABC/getMe");

// Erreurs
assert.match(expliquerErreurTelegram({ error_code: 401 }), /jeton/);
assert.match(expliquerErreurTelegram({ error_code: 409 }), /webhook/);
assert.match(expliquerErreurTelegram({ error_code: 429 }), /ralentir/);
assert.match(expliquerErreurTelegram({ error_code: 400, description: "Bad Request" }), /400.*Bad Request/);

// Expéditeur
assert.equal(nomExpediteur({ from: { first_name: "Marie", last_name: "Dupont" } }), "Marie Dupont");
assert.equal(nomExpediteur({ from: { username: "marie" } }), "@marie");
assert.equal(nomExpediteur({ chat: { title: "Comité AVEC" } }), "Comité AVEC");
assert.equal(nomExpediteur({}), "Inconnu");

// Texte
assert.equal(texteDuMessage({ text: "  Bonjour   tout le monde " }), "Bonjour tout le monde");
assert.equal(texteDuMessage({ photo: [{}], caption: "Reçu" }), "[Photo] Reçu");
assert.equal(texteDuMessage({ photo: [{}] }), "[Photo]");
assert.equal(texteDuMessage({ voice: {} }), "[Message vocal]");
assert.equal(texteDuMessage({ document: { file_name: "facture.pdf" } }), "[Document] facture.pdf");
assert.equal(texteDuMessage({ sticker: { emoji: "👍" } }), "[Sticker] 👍");
assert.equal(texteDuMessage({ new_chat_members: [{}] }), null);

// Importance
assert.equal(texteImportant("Rappel : FACTURE à payer"), true);
assert.equal(texteImportant("Bonne journée !"), false);
assert.equal(texteImportant("salut", ["salut"]), true);

// Mise à jour -> message
const maj = {
  update_id: 900,
  message: { message_id: 7, date: 1793000000, chat: { id: -100123, type: "supergroup", title: "Comité AVEC" },
    from: { first_name: "Marie" }, text: "Urgent : crédit en retard" },
};
const m = extraireMessage(maj);
assert.equal(m.de, "Marie");
assert.equal(m.groupe, "Comité AVEC");
assert.equal(m.important, true);
assert.equal(m.messageId, 7);
assert.equal(m.date.getTime(), 1793000000 * 1000);
assert.equal(idDocument(m), "telegram--100123-7");
const prive = extraireMessage({ update_id: 1, message: { message_id: 2, date: 1, chat: { id: 55, type: "private" }, from: { first_name: "Jean" }, text: "Salut" } });
assert.equal(prive.groupe, "");
assert.equal(prive.important, false);
assert.equal(idDocument(prive), "telegram-55-2");
const canal = extraireMessage({ update_id: 3, channel_post: { message_id: 9, date: 5, chat: { id: -1009, type: "channel", title: "Annonces" }, text: "Réunion demain" } });
assert.equal(canal.de, "Annonces");
assert.equal(extraireMessage({ update_id: 4, edited_message: { message_id: 1, chat: { id: 1 }, text: "x" } }), null);
assert.equal(extraireMessage({ update_id: 5, message: { message_id: 1, date: 1, chat: { id: 1 }, new_chat_members: [] } }), null);
assert.equal(extraireMessage(null), null);
assert.equal(extraireMessage({ update_id: 6, message: { message_id: 1, date: 1, chat: { id: 1, type: "private" }, from: { first_name: "A" }, text: "x".repeat(5000) } }).texte.length, 1000);

// Format Firestore
const c = champsFirestore(m);
assert.deepEqual(c.source, { stringValue: "telegram" });
assert.deepEqual(c.de, { stringValue: "Marie (Comité AVEC)" });
assert.deepEqual(c.important, { booleanValue: true });
assert.equal(c.date.timestampValue, new Date(1793000000 * 1000).toISOString());
assert.deepEqual(c.messageId, { integerValue: "7" });

// Confirmation
assert.equal(dernierUpdateId([{ update_id: 5 }, { update_id: 9 }, { update_id: 7 }]), 9);
assert.equal(dernierUpdateId([]), null);
assert.equal(dernierUpdateId(undefined), null);

console.log("Telegram : OK");
