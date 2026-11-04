import assert from "node:assert/strict";
import zlib from "node:zlib";
import { normaliserNoteKeep, lireZipKeep, lireFichiersKeep } from "../public/notes.js";

const texte = { title: "Courses", textContent: "Lait et pain", color: "DEFAULT", isTrashed: false, isPinned: true, isArchived: false,
  labels: [{ name: "Maison" }], createdTimestampUsec: 1700000000000000, userEditedTimestampUsec: 1700000500000000 };
const n = normaliserNoteKeep(texte, "a.json");
assert.equal(n.title, "Courses"); assert.equal(n.body, "Lait et pain"); assert.equal(n.category, "Maison");
assert.equal(n.pinned, true); assert.equal(n.source, "keep"); assert.equal(n.type, "note");
assert.equal(n.createdAt, "2023-11-14T22:13:20.000Z"); assert.equal(n.updatedAt, "2023-11-14T22:21:40.000Z");
assert.equal(normaliserNoteKeep(texte, "a.json").id, n.id); // identifiant stable : pas de doublon

const liste = normaliserNoteKeep({ title: "", listContent: [{ text: "Riz", isChecked: true }, { text: "Huile", isChecked: false }, { text: " ", isChecked: false }], isArchived: true }, "b.json");
assert.equal(liste.body, "☑ Riz\n☐ Huile"); assert.equal(liste.title, "☑ Riz"); assert.equal(liste.category, "Google Keep (archivée)");

assert.equal(normaliserNoteKeep({ title: "X", isTrashed: true }), null);
assert.equal(normaliserNoteKeep([{ name: "Maison" }]), null);
assert.equal(normaliserNoteKeep({ name: "étiquette" }), null);

// archive ZIP (une entrée « deflate », une entrée « stockée »)
function zip(entrees) {
  const loc = [], cen = []; let off = 0;
  for (const [nom, data, methode] of entrees) {
    const nomB = Buffer.from(nom), brut = Buffer.from(data), comp = methode === 8 ? zlib.deflateRawSync(brut) : brut;
    const lh = Buffer.alloc(30 + nomB.length); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(methode, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(brut.length, 22); lh.writeUInt16LE(nomB.length, 26); nomB.copy(lh, 30);
    const ch = Buffer.alloc(46 + nomB.length); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(methode, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(brut.length, 24); ch.writeUInt16LE(nomB.length, 28); ch.writeUInt32LE(off, 42); nomB.copy(ch, 46);
    loc.push(lh, comp); cen.push(ch); off += lh.length + comp.length;
  }
  const c = Buffer.concat(cen), fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entrees.length, 8); fin.writeUInt16LE(entrees.length, 10); fin.writeUInt32LE(c.length, 12); fin.writeUInt32LE(off, 16);
  const tout = Buffer.concat([...loc, c, fin]); return tout.buffer.slice(tout.byteOffset, tout.byteOffset + tout.length);
}
const archive = zip([["Takeout/Keep/Courses.json", JSON.stringify(texte), 8], ["Takeout/Keep/Idee.json", JSON.stringify({ title: "Idée", textContent: "é à ç" }), 0], ["Takeout/Keep/Labels.txt", "x", 0]]);
const lus = await lireZipKeep(archive);
assert.equal(lus.length, 2); assert.equal(JSON.parse(lus[0].texte).title, "Courses"); assert.equal(JSON.parse(lus[1].texte).textContent, "é à ç");

const fichier = (name, contenu) => ({ name, text: async () => contenu, arrayBuffer: async () => contenu });
const r = await lireFichiersKeep([fichier("t.zip", archive), fichier("Courses.json", JSON.stringify(texte)), fichier("mauvais.json", "{pas json"), fichier("x.txt", "")]);
assert.equal(r.notes.length, 2); assert.equal(r.ignorees, 1); // la note déjà dans le ZIP n'est pas comptée deux fois ; 1 JSON invalide
console.log("notes.test.mjs OK");
