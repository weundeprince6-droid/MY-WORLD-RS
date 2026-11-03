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

// ---------- ESE DB (application « WEB SERVICE — Suivi des ventes », projet ese-db-b63de) ----------
// Structure lue dans l'application :
//  - collection « days » : un document par jour (identifiant AAAA-MM-JJ) avec « items » = { id: { k, ... } }
//      k = "s" vente (name, q, p, c) ; k = "e" dépense (a, c, t) ; les autres types sont ignorés ici
//  - document « cfg/main » : stock, debts, credits (chacun une table d'enregistrements avec « pay » = paiements)
const nombre = (x) => Number(x) || 0;
// ESE DB note la devise dans le champ « c » ("FC" par défaut, "USD" sinon)
const deviseEse = (x) => (x && x.c === "USD" ? "USD" : "FC");
const cleProduit = (s) => String(s || "").trim().toLowerCase();
const payeTotal = (v) => Object.values((v && v.pay) || {}).reduce((t, p) => t + nombre(p && p.a), 0);

export function calculerEse(jours, cfg, aujourdhuiISO) {
  const r = {
    venteJourFC: 0, venteJourUSD: 0, venteMoisFC: 0, venteMoisUSD: 0,
    depMoisFC: 0, depMoisUSD: 0, detteFC: 0, detteUSD: 0, creditFC: 0, creditUSD: 0, stockBas: 0,
  };
  const mois = String(aujourdhuiISO).slice(0, 7);
  const vendu = new Map();

  for (const j of jours) {
    for (const it of Object.values(j.items || {})) {
      if (!it) continue;
      const c = deviseEse(it);
      if (it.k === "s") {
        const montant = nombre(it.q) * nombre(it.p);
        if (j.id === aujourdhuiISO) r[`venteJour${c}`] += montant;
        if (String(j.id).startsWith(mois)) r[`venteMois${c}`] += montant;
        const cle = cleProduit(it.name);
        vendu.set(cle, (vendu.get(cle) || 0) + nombre(it.q));
      } else if (it.k === "e" && String(j.id).startsWith(mois)) {
        r[`depMois${c}`] += nombre(it.a);
      }
    }
  }

  const reste = (v) => Math.max(0, nombre(v.amt) - payeTotal(v));
  for (const v of Object.values((cfg && cfg.debts) || {})) {
    if (v) r[`dette${deviseEse(v)}`] += reste(v);
  }
  const creditParProduit = new Map();
  for (const v of Object.values((cfg && cfg.credits) || {})) {
    if (!v) continue;
    r[`credit${deviseEse(v)}`] += reste(v);
    if (v.pname) {
      const cle = cleProduit(v.pname);
      creditParProduit.set(cle, (creditParProduit.get(cle) || 0) + nombre(v.qty));
    }
  }
  // Stock : niveau = départ + entrées − ventes − quantités données à crédit ; alerte si niveau <= seuil
  for (const p of Object.values((cfg && cfg.stock) || {})) {
    if (!p) continue;
    const entrees = Object.values(p.ins || {}).reduce((t, e) => t + nombre(e && typeof e === "object" ? e.q : e), 0);
    const cle = cleProduit(p.name);
    const niveau = nombre(p.start) + entrees - (vendu.get(cle) || 0) - (creditParProduit.get(cle) || 0);
    if (niveau <= nombre(p.min)) r.stockBas += 1;
  }

  for (const cle of Object.keys(r)) r[cle] = arrondi(r[cle]);
  return r;
}

/**
 * Ristournes ESE DB : dépôts et retraits par groupe (éléments k:"r" des jours), crédits de ristourne (cfg.ristLoans)
 * et groupes (cfg.ristGroups). Comme dans l'application ESE : solde = dépôts − intérêts dus − retraits, par devise.
 * Aucune conversion de devise : le FC et l'USD restent séparés.
 */
export function calculerRistourne(jours, cfg) {
  const vide = () => ({ FC: 0, USD: 0 });
  const total = { depots: vide(), retraits: vide(), interets: vide(), solde: vide(), emprunte: vide(), rembourse: vide(), reste: vide() };
  const groupes = new Map();
  const groupe = (id) => {
    const cle = id || "";
    if (!groupes.has(cle)) groupes.set(cle, { id: cle, depots: vide(), retraits: vide(), interets: vide(), solde: vide(), reste: vide() });
    return groupes.get(cle);
  };
  let mouvements = 0;
  for (const j of jours || []) {
    for (const it of Object.values((j && j.items) || {})) {
      if (!it || it.k !== "r") continue;
      mouvements += 1;
      const c = deviseEse(it);
      const g = groupe(it.g);
      const cible = it.type === "out" ? "retraits" : "depots";
      g[cible][c] += nombre(it.a);
      total[cible][c] += nombre(it.a);
    }
  }
  let credits = 0;
  for (const v of Object.values((cfg && cfg.ristLoans) || {})) {
    if (!v) continue;
    const c = deviseEse(v);
    const g = groupe(v.g);
    const principal = v.principal != null ? nombre(v.principal) : nombre(v.amount);
    const interet = (principal * nombre(v.rate)) / 100;
    const paye = payeTotal(v);
    const reste = Math.max(0, nombre(v.amount) - paye);
    g.interets[c] += interet; total.interets[c] += interet;
    total.emprunte[c] += nombre(v.amount); total.rembourse[c] += paye;
    if (reste > 0) { g.reste[c] += reste; total.reste[c] += reste; credits += 1; }
  }
  const noms = (cfg && cfg.ristGroups) || {};
  const sortie = [];
  for (const g of groupes.values()) {
    for (const c of ["FC", "USD"]) g.solde[c] = g.depots[c] - g.interets[c] - g.retraits[c];
    sortie.push({ ...g, nom: g.id ? (noms[g.id] && noms[g.id].name) || "Groupe supprimé" : "Général" });
  }
  for (const c of ["FC", "USD"]) total.solde[c] = total.depots[c] - total.interets[c] - total.retraits[c];
  sortie.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const arrondiPaire = (o) => ({ FC: arrondi(o.FC), USD: arrondi(o.USD) });
  const net = (o) => { for (const k of Object.keys(o)) if (o[k] && typeof o[k] === "object") o[k] = arrondiPaire(o[k]); return o; };
  return { total: net(total), groupes: sortie.map(net), mouvements, credits, nbGroupes: Object.keys(noms).length };
}

export const MESURES_ESE = {
  ventes_jour_fc: (r) => r.venteJourFC,
  ventes_jour_usd: (r) => r.venteJourUSD,
  ventes_mois_fc: (r) => r.venteMoisFC,
  ventes_mois_usd: (r) => r.venteMoisUSD,
  depenses_mois_fc: (r) => r.depMoisFC,
  depenses_mois_usd: (r) => r.depMoisUSD,
  dettes_fc: (r) => r.detteFC,
  dettes_usd: (r) => r.detteUSD,
  credits_clients_fc: (r) => r.creditFC,
  credits_clients_usd: (r) => r.creditUSD,
  stock_bas: (r) => r.stockBas,
};
