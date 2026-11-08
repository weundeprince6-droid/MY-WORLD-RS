// horsligne.js — mode sans internet : mémoire des dernières réponses de Google et file des modifications
// à envoyer au retour de la connexion. Fonctions pures (testées) + petit stockage IndexedDB.

const RE_FIRESTORE = /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/([^/]+)\/databases\/\(default\)\/documents\/(users\/[^?]+)(\?.*)?$/;

// Une réponse peut être gardée pour le mode hors ligne : lectures simples et requêtes Firestore (lecture seule)
export function estLectureMemorisable(url, options = {}) {
  const m = String(options.method || "GET").toUpperCase();
  if (m === "GET") return true;
  return m === "POST" && /:run(Aggregation)?Query(\?|$)/.test(url);
}

function empreinte(texte) {
  let h = 5381;
  for (let i = 0; i < texte.length; i++) h = ((h * 33) ^ texte.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
export function cleCache(url, options = {}) {
  const m = String(options.method || "GET").toUpperCase();
  const corps = options.body ? empreinte(String(options.body)) : "";
  return `${m} ${url}${corps ? " #" + corps : ""}`;
}

// Écriture dans les données privées de l'utilisateur (users/...) : seule catégorie mise en attente hors ligne.
export function analyserEcriture(url, options = {}) {
  const methode = String(options.method || "GET").toUpperCase();
  if (!["POST", "PATCH", "DELETE"].includes(methode)) return null;
  const m = RE_FIRESTORE.exec(url);
  if (!m) return null;
  const [, projet, chemin, requete] = m;
  const morceaux = chemin.split("/").map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  let corps = null;
  try { corps = options.body ? JSON.parse(options.body) : null; } catch { /* corps illisible */ }
  if (methode === "POST") {
    const id = new URLSearchParams(requete || "").get("documentId");
    if (!id || morceaux.length !== 3) return null;
    return { type: "create", methode, url, body: options.body || null, projet, col: morceaux.join("/"), id, fields: corps?.fields || {} };
  }
  if (morceaux.length !== 4) return null;
  const col = morceaux.slice(0, 3).join("/");
  const id = morceaux[3];
  return { type: methode === "DELETE" ? "delete" : "patch", methode, url, body: options.body || null, projet, col, id, fields: corps?.fields || {} };
}

export function reponseSimulee(op) {
  if (op.type === "delete") return {};
  return { name: `projects/${op.projet}/databases/(default)/documents/${op.col}/${op.id}`, fields: op.fields };
}

const nomDoc = (op) => `projects/${op.projet}/databases/(default)/documents/${op.col}/${op.id}`;

// Applique la file d'attente à une réponse de lecture (liste d'une collection ou document seul).
export function superposerFile(url, reponse, file) {
  if (!file || !file.length || !reponse || typeof reponse !== "object") return reponse;
  const m = RE_FIRESTORE.exec(url);
  if (!m) return reponse;
  const morceaux = m[2].split("/").map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  if (morceaux.length === 3 && Array.isArray(reponse.documents) || (morceaux.length === 3 && reponse.documents === undefined && !reponse.name)) {
    const col = morceaux.join("/");
    let docs = (reponse.documents || []).map((d) => ({ ...d }));
    for (const op of file.filter((o) => o.col === col)) {
      const i = docs.findIndex((d) => d.name === nomDoc(op));
      if (op.type === "delete") { if (i >= 0) docs.splice(i, 1); continue; }
      if (i >= 0) docs[i] = { ...docs[i], fields: { ...(docs[i].fields || {}), ...op.fields } };
      else docs.push({ name: nomDoc(op), fields: { ...op.fields } });
    }
    return { ...reponse, documents: docs };
  }
  if (morceaux.length === 4 && reponse.name) {
    let doc = reponse; 
    for (const op of file.filter((o) => o.col + "/" + o.id === morceaux.join("/"))) {
      if (op.type === "delete") doc = null;
      else doc = { ...(doc || { name: nomDoc(op) }), fields: { ...((doc && doc.fields) || {}), ...op.fields } };
    }
    return doc;
  }
  return reponse;
}

// ----- File d'attente (tableau d'opérations) -----
export function ajouterALaFile(file, op) {
  const suite = (file.reduce((n, o) => Math.max(n, o.n || 0), 0)) + 1;
  return [...file, { ...op, n: suite }];
}
export function retirerDeLaFile(file, n) { return file.filter((o) => o.n !== n); }

// Résultat d'un renvoi : "ok", "abandon" (déjà fait ou refusé définitivement) ou "reseau" (réessayer plus tard)
export function verdictRenvoi(op, statut) {
  if (statut >= 200 && statut < 300) return "ok";
  if (statut === 409 && op.type === "create") return "abandon";
  if (statut === 404 && op.type === "delete") return "abandon";
  if (statut === 401 || statut === 429 || statut >= 500) return "reseau";
  return "abandon";
}

// Mémoire des réponses : IndexedDB, avec repli sur la mémoire vive
export function ouvrirMemoire() {
  const vive = new Map();
  let base = null;
  const ouvrir = () => base || (base = new Promise((ok, ko) => {
    try {
      const r = indexedDB.open("mwrs-hors-ligne", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("reponses");
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    } catch (e) { ko(e); }
  }));
  const tx = async (mode, f) => { const db = await ouvrir(); return new Promise((ok, ko) => { const t = db.transaction("reponses", mode); const rq = f(t.objectStore("reponses")); t.oncomplete = () => ok(rq?.result); t.onerror = () => ko(t.error); }); };
  return {
    async lire(cle) { try { const v = await tx("readonly", (s) => s.get(cle)); return v === undefined ? vive.get(cle) : v; } catch { return vive.get(cle); } },
    async ecrire(cle, valeur) { vive.set(cle, valeur); try { await tx("readwrite", (s) => s.put(valeur, cle)); } catch { /* stockage plein ou indisponible */ } },
    async vider() { vive.clear(); try { await tx("readwrite", (s) => s.clear()); } catch { /* ignoré */ } },
  };
}
