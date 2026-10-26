// firestore.js — lecture de Firestore par l'API REST avec votre compte Google (sans SDK),
// et calcul des indicateurs. Fonctions pures : testées dans test/core.test.mjs.

/** Convertit une valeur Firestore REST en valeur JavaScript. */
export function decoderValeur(v) {
  if (v === null || v === undefined) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return new Date(v.timestampValue);
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decoderValeur);
  if ("mapValue" in v) return decoderChamps(v.mapValue.fields || {});
  return null;
}

export function decoderChamps(champs = {}) {
  const out = {};
  for (const [cle, val] of Object.entries(champs)) out[cle] = decoderValeur(val);
  return out;
}

/** Document REST -> objet simple { id, ...champs }. */
export function decoderDocument(doc) {
  const id = String(doc.name || "").split("/").pop();
  return { id, ...decoderChamps(doc.fields || {}) };
}

function valeurFirestore(x) {
  if (typeof x === "string") return { stringValue: x };
  if (typeof x === "boolean") return { booleanValue: x };
  if (Number.isInteger(x)) return { integerValue: String(x) };
  return { doubleValue: x };
}

function filtreFirestore(filtre) {
  if (!filtre) return undefined;
  return {
    fieldFilter: {
      field: { fieldPath: filtre.champ },
      op: filtre.op || "EQUAL", // EQUAL, NOT_EQUAL, GREATER_THAN, LESS_THAN…
      value: valeurFirestore(filtre.valeur),
    },
  };
}

/** Corps de requête pour un comptage ou une somme côté serveur Firestore. */
export function corpsAgregation({ collection, op, champ, filtre }) {
  const requete = { from: [{ collectionId: collection }] };
  const where = filtreFirestore(filtre);
  if (where) requete.where = where;
  const agregat = op === "sum" ? { sum: { field: { fieldPath: champ } } } : { count: {} };
  return { structuredAggregationQuery: { structuredQuery: requete, aggregations: [{ alias: "v", ...agregat }] } };
}

/** Lit le résultat d'une agrégation (réponse REST = tableau). */
export function lireAgregat(reponse) {
  const lignes = Array.isArray(reponse) ? reponse : [reponse];
  const champ = lignes.map((l) => l?.result?.aggregateFields?.v).find(Boolean);
  const n = champ ? decoderValeur(champ) : 0;
  return typeof n === "number" ? n : 0;
}

/** Corps pour lister les documents les plus récents d'une collection. */
export function corpsListe({ collection, tri, max = 15 }) {
  const requete = { from: [{ collectionId: collection }], limit: max };
  if (tri) requete.orderBy = [{ field: { fieldPath: tri }, direction: "DESCENDING" }];
  return { structuredQuery: requete };
}

export function lireListe(reponse) {
  return (Array.isArray(reponse) ? reponse : []).filter((l) => l.document).map((l) => decoderDocument(l.document));
}

const arrondi = (n) => Math.round(n * 100) / 100;
const devise = (c) => (c && c.devise === "FC" ? "FC" : "USD");

/**
 * Indicateurs de crédit pour la base AVEC LA SAGESSE (crédits rangés dans la fiche de chaque membre).
 * Règle reprise de l'application : reste = montant − remboursé ; en retard = reste > 0 et échéance dépassée.
 */
export function calculerCreditsAvec(membres, aujourdhuiISO) {
  const r = { resteUSD: 0, resteFC: 0, nbEnCours: 0, nbRetard: 0, membresAvecCredit: 0, epargneUSD: 0, epargneFC: 0 };
  for (const m of membres) {
    r.epargneUSD += Number(m.epargne) || 0;
    r.epargneFC += Number(m.epargneFC) || 0;
    let aCredit = false;
    for (const c of m.credits || []) {
      const reste = Math.max(0, arrondi((Number(c.amount) || 0) - (Number(c.repaid) || 0)));
      if (reste <= 0) continue;
      aCredit = true;
      r.nbEnCours += 1;
      if (devise(c) === "FC") r.resteFC += reste; else r.resteUSD += reste;
      if (c.dueDate && String(c.dueDate) < aujourdhuiISO) r.nbRetard += 1;
    }
    if (aCredit) r.membresAvecCredit += 1;
  }
  r.resteUSD = arrondi(r.resteUSD);
  r.resteFC = arrondi(r.resteFC);
  r.epargneUSD = arrondi(r.epargneUSD);
  r.epargneFC = arrondi(r.epargneFC);
  return r;
}

export const MESURES_CREDITS_AVEC = {
  epargne_usd: (r) => r.epargneUSD,
  epargne_fc: (r) => r.epargneFC,
  reste_usd: (r) => r.resteUSD,
  reste_fc: (r) => r.resteFC,
  nb_en_cours: (r) => r.nbEnCours,
  nb_retard: (r) => r.nbRetard,
  membres_avec_credit: (r) => r.membresAvecCredit,
};
