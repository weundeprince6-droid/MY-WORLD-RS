// Assistant IA : préparation des données financières et de l'appel à l'API Claude (sans réseau ici)
export const IA_MODELE = "claude-sonnet-5-5";
export const IA_URL = "https://api.anthropic.com/v1/messages";

const iaArr = (n) => Math.round(Number(n || 0) * 100) / 100;
const iaMois = (d) => String(d || "").slice(0, 7);

/** Totaux revenus / dépenses des trois derniers mois, par devise, à partir des mouvements du porte-monnaie. */
export function iaTotauxParMois(mouvements = [], moisCourant) {
  const [a, m] = moisCourant.split("-").map(Number);
  const mois = [0, 1, 2].map((i) => { const d = new Date(a, m - 1 - i, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
  const out = {};
  for (const mo of mois) out[mo] = { FC: { revenus: 0, depenses: 0 }, USD: { revenus: 0, depenses: 0 } };
  for (const t of mouvements) {
    const mo = iaMois(t.date); if (!out[mo]) continue;
    const dv = t.currency === "USD" ? "USD" : "FC", v = Number(t.amount || 0);
    if (t.kind === "income") out[mo][dv].revenus += v; else if (t.kind === "expense") out[mo][dv].depenses += v;
  }
  for (const mo of mois) for (const dv of ["FC", "USD"]) { out[mo][dv].revenus = iaArr(out[mo][dv].revenus); out[mo][dv].depenses = iaArr(out[mo][dv].depenses); }
  return out;
}

/** Texte JSON compact, volontairement limité, décrivant les finances de l'utilisateur. */
export function construireContexteFinances({ comptes = [], mouvements = [], caisse = null, espaces = [], aujourdhui = new Date().toISOString().slice(0, 10) } = {}) {
  const moisCourant = iaMois(aujourdhui);
  const recents = [...mouvements].sort((x, y) => String(y.date || "").localeCompare(String(x.date || ""))).slice(0, 40)
    .map((t) => ({ date: t.date, type: t.kind, compte: t.accountName || "", montant: iaArr(t.amount), devise: t.currency, categorie: t.category || "", note: String(t.description || "").slice(0, 60) }));
  const ctx = {
    date_du_jour: aujourdhui,
    comptes_porte_monnaie: comptes.map((c) => ({ nom: c.name, type: c.type, devise: c.currency, solde: iaArr(c.balance) })),
    totaux_par_mois_porte_monnaie: iaTotauxParMois(mouvements, moisCourant),
    derniers_mouvements: recents,
  };
  if (caisse) ctx.caisse_ese_db = { somme_restante: iaArr(caisse.total), devise: caisse.cur, francs: iaArr(caisse.FC), dollars: iaArr(caisse.USD) };
  ctx.espaces = espaces.map((e) => ({
    nom: e.nom, mois: e.calc?.mois,
    depenses_du_mois: e.calc?.depensesMois, revenus_du_mois: e.calc?.revenusMois, solde_du_mois: e.calc?.soldeMois,
    budget_mensuel: e.calc?.budgetMensuel, budget_utilise_pourcent: e.calc?.budgetUtilise, budget_restant: e.calc?.budgetRestant,
    depenses_du_mois_par_categorie: (e.calc?.parCategorie || []).slice(0, 10),
    projet: e.calc ? { budget: e.calc.chantier.budget, depense: e.calc.chantier.depense, reste: e.calc.chantier.reste, avancement_pourcent: e.calc.chantier.avancement } : null,
    dernieres_operations: (e.entrees || []).slice(0, 15).map((x) => ({ date: x.date, type: x.section, categorie: x.category, montant: iaArr(x.amount), devise: x.currency, note: String(x.note || "").slice(0, 60) })),
    materiel: { valeur_inventaire: e.materiel?.valeurStock, cout_a_acquerir: e.materiel?.coutAchats, nb_a_acquerir: e.materiel?.nbAchats, urgents: e.materiel?.urgents,
      a_acquerir: (e.articles || []).filter((i) => i.kind === "ravitailler").slice(0, 15).map((i) => ({ nom: i.name, quantite: i.qty, prix_unitaire: i.price, devise: i.currency, priorite: i.priority })) },
  }));
  let texte = JSON.stringify(ctx);
  if (texte.length > 14000) { ctx.derniers_mouvements = ctx.derniers_mouvements.slice(0, 15); ctx.espaces.forEach((e) => { e.dernieres_operations = e.dernieres_operations.slice(0, 6); }); texte = JSON.stringify(ctx); }
  return texte;
}

export function consigneAssistant(contexte, rubrique = "") {
  return "Tu es l'assistant financier intégré à l'application personnelle « My World RS ». Tu réponds toujours en français, de façon claire et concise (quelques phrases ou une courte liste).\n"
    + "Tu t'appuies UNIQUEMENT sur les données JSON ci-dessous : porte-monnaie, caisse ESE DB, « Ma maison » (foyer) et « Projet pro » (activité). Si une information manque, dis-le au lieu de l'inventer.\n"
    + "Les montants sont en franc congolais (FC) ou en dollars (USD) : ne les additionne jamais entre devises sans le dire, et indique toujours la devise. Utilise les totaux déjà calculés plutôt que de refaire de longs calculs.\n"
    + "Tu peux donner des conseils de gestion simples, sans prétendre être un conseiller financier. Tu ne peux pas modifier les données : tu expliques et tu recommandes."
    + (rubrique ? "\nL'utilisateur consulte actuellement la rubrique : " + rubrique + "." : "")
    + "\n\nDONNÉES (date du jour incluse) :\n" + contexte;
}

/** Prépare la requête HTTP pour l'API Messages d'Anthropic. */
export function preparerRequeteAssistant({ cle, contexte, rubrique, historique = [], question }) {
  const messages = [...historique.slice(-8), { role: "user", content: String(question || "").slice(0, 2000) }];
  return {
    url: IA_URL,
    options: {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: IA_MODELE, max_tokens: 1000, system: consigneAssistant(contexte, rubrique), messages }),
    },
  };
}

export function extraireReponseAssistant(json) {
  const blocs = Array.isArray(json?.content) ? json.content : [];
  return blocs.filter((b) => b && b.type === "text").map((b) => b.text).join("\n").trim();
}

export function messageErreurAssistant(status, corps) {
  const detail = corps?.error?.message ? " (" + String(corps.error.message).slice(0, 160) + ")" : "";
  if (status === 401) return "Clé refusée : vérifiez la clé de l'API Claude enregistrée." + detail;
  if (status === 403) return "Accès refusé par l'API Claude." + detail;
  if (status === 429) return "Trop de demandes pour le moment : réessayez dans une minute." + detail;
  if (status === 529 || status >= 500) return "Le service d'IA est momentanément indisponible : réessayez plus tard." + detail;
  return "La demande a échoué (code " + status + ")." + detail;
}
