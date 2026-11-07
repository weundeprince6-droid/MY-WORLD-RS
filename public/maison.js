// « Ma maison » : dépenses du foyer, budget familial et projet de construction (calculs purs, sans réseau)
export const CATEGORIES_MAISON = ["Loyer", "Eau", "Électricité", "Internet et téléphone", "Courses", "Transport", "Santé", "Éducation", "Entretien", "Autre"];
export const CATEGORIES_REVENU = ["Salaire", "Activité", "Aide familiale", "Autre"];
export const CATEGORIES_PRO = ["Loyer du local", "Salaires et main-d'œuvre", "Transport et déplacements", "Fournitures", "Marketing et publicité", "Internet et téléphone", "Impôts et taxes", "Entretien", "Autre"];
export const CATEGORIES_REVENU_PRO = ["Ventes", "Prestations de services", "Subvention ou financement", "Autre"];
export const CATEGORIES_PROJET_PRO = ["Équipements", "Stock de départ", "Aménagement du local", "Frais administratifs", "Logiciels et outils", "Autre"];
export const CATEGORIES_CHANTIER = ["Matériaux", "Main-d'œuvre", "Transport", "Terrain et papiers", "Outils", "Autre"];

const mmNb = (n) => Number(n || 0);
const mmArr = (n) => Math.round(mmNb(n) * 100) / 100;
const mmDev = (e) => (e && e.currency === "USD" ? "USD" : "FC");
const mmVide = () => ({ FC: 0, USD: 0 });
const mmMois = (d) => String(d || "").slice(0, 7);

/** Mois courant « AAAA-MM » à partir d'une date (jour local). */
export function moisDe(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

/**
 * entrees : [{section:'depense'|'revenu'|'chantier', category, amount, currency, date, note}]
 * reglages : {budgetFC, budgetUSD, chantierFC, chantierUSD, avancement}
 */
export function calculerMaison(entrees = [], reglages = {}, moisCourant = moisDe()) {
  const r = reglages || {};
  const depMois = mmVide(), revMois = mmVide(), depTotal = mmVide(), chantierTotal = mmVide();
  const parCategorie = {}, chantierCat = {}, parMois = {};
  for (const e of entrees) {
    const d = mmDev(e), m = mmNb(e.amount);
    if (!(m > 0)) continue;
    if (e.section === "depense") {
      depTotal[d] += m;
      if (mmMois(e.date) === moisCourant) { depMois[d] += m; const c = e.category || "Autre"; (parCategorie[c] ||= mmVide())[d] += m; }
      (parMois[mmMois(e.date)] ||= mmVide())[d] += m;
    } else if (e.section === "revenu") {
      if (mmMois(e.date) === moisCourant) revMois[d] += m;
    } else if (e.section === "chantier") {
      chantierTotal[d] += m; const c = e.category || "Autre"; (chantierCat[c] ||= mmVide())[d] += m;
    }
  }
  const budget = { FC: mmNb(r.budgetFC), USD: mmNb(r.budgetUSD) };
  const chantierBudget = { FC: mmNb(r.chantierFC), USD: mmNb(r.chantierUSD) };
  const pct = (a, b) => (b > 0 ? Math.min(999, Math.round((a / b) * 100)) : null);
  const par = (f) => ({ FC: f("FC"), USD: f("USD") });
  return {
    mois: moisCourant,
    depensesMois: par((d) => mmArr(depMois[d])),
    revenusMois: par((d) => mmArr(revMois[d])),
    soldeMois: par((d) => mmArr(revMois[d] - depMois[d])),
    budgetMensuel: budget,
    budgetUtilise: par((d) => pct(depMois[d], budget[d])),
    budgetRestant: par((d) => (budget[d] > 0 ? mmArr(budget[d] - depMois[d]) : null)),
    depensesTotales: par((d) => mmArr(depTotal[d])),
    parCategorie: Object.entries(parCategorie).map(([nom, v]) => ({ nom, FC: mmArr(v.FC), USD: mmArr(v.USD) })).sort((a, b) => b.FC + b.USD - (a.FC + a.USD)),
    chantier: {
      budget: chantierBudget,
      depense: par((d) => mmArr(chantierTotal[d])),
      reste: par((d) => (chantierBudget[d] > 0 ? mmArr(chantierBudget[d] - chantierTotal[d]) : null)),
      utilise: par((d) => pct(chantierTotal[d], chantierBudget[d])),
      avancement: Math.max(0, Math.min(100, Math.round(mmNb(r.avancement)))),
      parCategorie: Object.entries(chantierCat).map(([nom, v]) => ({ nom, FC: mmArr(v.FC), USD: mmArr(v.USD) })).sort((a, b) => b.FC + b.USD - (a.FC + a.USD)),
    },
  };
}

/** Valide et normalise une saisie du formulaire. Renvoie {erreur} ou {entree}. */
export function normaliserEntreeMaison(s) {
  const section = ["depense", "revenu", "chantier"].includes(s?.section) ? s.section : "";
  if (!section) return { erreur: "Type d'opération inconnu." };
  const montant = Number(String(s.amount ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(montant) || montant <= 0) return { erreur: "Saisissez un montant supérieur à zéro." };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(s.date || "") ? s.date : "";
  if (!date) return { erreur: "Choisissez une date." };
  return { entree: { section, category: String(s.category || "Autre").slice(0, 60), amount: Math.round(montant * 100) / 100, currency: s.currency === "USD" ? "USD" : "FC", date, note: String(s.note || "").trim().slice(0, 200) } };
}

// ---------- Matériel de la maison (répertorié) et matériel à ravitailler ----------
export const PIECES_MAISON = ["Salon", "Cuisine", "Chambre", "Salle de bain", "Extérieur", "Autre"];
export const ETATS_MATERIEL = ["Neuf", "Bon", "Usé", "À réparer"];
export const PRIORITES_MATERIEL = ["Urgent", "Normal", "Plus tard"];

/** items : [{kind:'stock'|'ravitailler', name, qty, price, currency, place, state, priority}] */
export function calculerMateriel(items = []) {
  const stock = { FC: 0, USD: 0 }, achat = { FC: 0, USD: 0 };
  let nbStock = 0, nbAchat = 0, urgents = 0;
  for (const it of items) {
    const q = Number(it.qty) > 0 ? Number(it.qty) : 1, p = Number(it.price) > 0 ? Number(it.price) : 0, d = it.currency === "USD" ? "USD" : "FC";
    if (it.kind === "stock") { stock[d] += q * p; nbStock += q; }
    else if (it.kind === "ravitailler") { achat[d] += q * p; nbAchat++; if (it.priority === "Urgent") urgents++; }
  }
  const r2 = (n) => Math.round(n * 100) / 100;
  return { valeurStock: { FC: r2(stock.FC), USD: r2(stock.USD) }, nbArticlesStock: nbStock, coutAchats: { FC: r2(achat.FC), USD: r2(achat.USD) }, nbAchats: nbAchat, urgents };
}

/** Valide la saisie d'un matériel. Renvoie {erreur} ou {item}. */
export function normaliserMateriel(s) {
  const kind = s?.kind === "ravitailler" ? "ravitailler" : s?.kind === "stock" ? "stock" : "";
  if (!kind) return { erreur: "Type de matériel inconnu." };
  const name = String(s.name || "").trim().slice(0, 80);
  if (!name) return { erreur: "Indiquez le nom du matériel." };
  const nombre = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  const qty = s.qty === "" || s.qty == null ? 1 : nombre(s.qty);
  if (!Number.isFinite(qty) || qty <= 0) return { erreur: "La quantité doit être supérieure à zéro." };
  const price = s.price === "" || s.price == null ? 0 : nombre(s.price);
  if (!Number.isFinite(price) || price < 0) return { erreur: "Le prix doit être un nombre positif." };
  return { item: { kind, name, qty, price, currency: s.currency === "USD" ? "USD" : "FC", place: String(s.place || "").slice(0, 40), state: String(s.state || "").slice(0, 30), priority: String(s.priority || "").slice(0, 30), note: String(s.note || "").trim().slice(0, 200) } };
}
