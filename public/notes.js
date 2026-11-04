// Import Google Keep (export Google Takeout) : fichiers .json ou archive .zip

function keepHashCourt(texte) {
  let h = 5381;
  for (let i = 0; i < texte.length; i++) h = ((h << 5) + h + texte.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const keepIso = (usec) => {
  const ms = Math.round(Number(usec || 0) / 1000);
  return ms > 0 ? new Date(ms).toISOString() : "";
};

// Convertit une note Keep (JSON Takeout) en note My World RS. Retourne null si ce n'est pas une note (ou si elle est dans la corbeille).
export function normaliserNoteKeep(json, nomFichier = "") {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  if (!("textContent" in json) && !("listContent" in json) && !("title" in json)) return null;
  if (json.isTrashed) return null;
  const lignes = Array.isArray(json.listContent)
    ? json.listContent.map((l) => `${l.isChecked ? "☑" : "☐"} ${String(l.text || "").trim()}`).filter((l) => l.length > 2)
    : [];
  const corps = [String(json.textContent || "").trim(), lignes.join("\n")].filter(Boolean).join("\n\n");
  const titre = String(json.title || "").trim() || corps.split("\n")[0].slice(0, 80) || "Note Keep";
  const etiquettes = Array.isArray(json.labels) ? json.labels.map((e) => String(e.name || "").trim()).filter(Boolean) : [];
  const creeLe = keepIso(json.createdTimestampUsec);
  const modifieLe = keepIso(json.userEditedTimestampUsec) || creeLe;
  const categorie = (etiquettes.length ? etiquettes.join(", ") : "Google Keep") + (json.isArchived ? " (archivée)" : "");
  return {
    id: "keep-" + keepHashCourt([creeLe, titre, corps].join("|")),
    type: "note",
    title: titre.slice(0, 160),
    category: categorie.slice(0, 80),
    body: corps.slice(0, 20000),
    source: "keep",
    pinned: !!json.isPinned,
    createdAt: creeLe || new Date().toISOString(),
    updatedAt: modifieLe || new Date().toISOString(),
  };
}

const keepU16 = (v, o) => v.getUint16(o, true);
const keepU32 = (v, o) => v.getUint32(o, true);

// Lecture minimale d'une archive ZIP (méthodes « stockée » et « deflate »), sans bibliothèque externe
export async function lireZipKeep(buffer) {
  const vue = new DataView(buffer), octets = new Uint8Array(buffer);
  let fin = -1;
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65557); i--) {
    if (keepU32(vue, i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("Archive ZIP illisible.");
  const nb = keepU16(vue, fin + 10);
  let p = keepU32(vue, fin + 16);
  const sortie = [], dec = new TextDecoder();
  for (let n = 0; n < nb; n++) {
    if (keepU32(vue, p) !== 0x02014b50) break;
    const methode = keepU16(vue, p + 10), tailleComp = keepU32(vue, p + 20);
    const lNom = keepU16(vue, p + 28), lExtra = keepU16(vue, p + 30), lCom = keepU16(vue, p + 32), debut = keepU32(vue, p + 42);
    const nom = dec.decode(octets.subarray(p + 46, p + 46 + lNom));
    p += 46 + lNom + lExtra + lCom;
    if (!/\.json$/i.test(nom) || nom.endsWith("/")) continue;
    const donnees = debut + 30 + keepU16(vue, debut + 26) + keepU16(vue, debut + 28);
    const brut = octets.subarray(donnees, donnees + tailleComp);
    let contenu;
    if (methode === 0) contenu = brut;
    else if (methode === 8) {
      const flux = new Blob([brut]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      contenu = new Uint8Array(await new Response(flux).arrayBuffer());
    } else continue;
    sortie.push({ nom, texte: dec.decode(contenu) });
  }
  return sortie;
}

// Fichiers choisis (JSON et/ou ZIP) -> notes prêtes à enregistrer, sans doublon
export async function lireFichiersKeep(fichiers) {
  const textes = [];
  for (const f of fichiers) {
    if (/\.zip$/i.test(f.name)) textes.push(...await lireZipKeep(await f.arrayBuffer()));
    else if (/\.json$/i.test(f.name)) textes.push({ nom: f.name, texte: await f.text() });
  }
  const vues = new Set(), notes = [];
  let ignorees = 0;
  for (const { nom, texte } of textes) {
    let json;
    try { json = JSON.parse(texte); } catch { ignorees++; continue; }
    const note = normaliserNoteKeep(json, nom);
    if (!note) { ignorees++; continue; }
    if (vues.has(note.id)) continue;
    vues.add(note.id); notes.push(note);
  }
  return { notes, ignorees };
}
