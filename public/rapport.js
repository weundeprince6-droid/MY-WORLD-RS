// rapport.js — rapport financier PDF du Porte-Monnaie (calculs purs + dessin jsPDF, sans DOM).
// Mise en page : couverture, synthèse, graphiques mensuels, ristournes, dépenses par catégorie, historique détaillé.
// Attention : les polices standard du PDF n'affichent pas « − », « → », « ✓ » : les flèches et coches sont dessinées.

export const MOYENS_PAIEMENT = ["Espèces", "Virement", "Mobile Money", "Carte bancaire", "Chèque", "Autre"];

const MOIS_COURTS = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];

/** Format de montant stable dans un PDF : espaces simples, virgule décimale, 2 décimales seulement si nécessaire. */
export function formaterMontant(n, devise = "") {
  const v = Number(n) || 0;
  const entier = Math.abs(v - Math.round(v)) < 0.005;
  const texte = (entier ? Math.round(v).toString() : v.toFixed(2)).replace(".", ",");
  const [a, b] = texte.split(",");
  const signe = a.startsWith("-") ? "-" : "";
  const groupes = a.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${signe}${groupes}${b ? "," + b : ""}${devise ? " " + devise : ""}`;
}

/** Effet d'un mouvement sur le solde de son compte. */
export function effetMouvement(t) {
  const m = Number(t.amount || 0);
  if (t.kind === "income") return m;
  if (t.kind === "expense") return -m;
  return t.direction === "in" ? m : -m;
}

const dateTri = (t) => `${t.date || ""}|${t.createdAt || ""}|${t.id || ""}`;

/** Graduation « ronde » d'un axe : renvoie { max, pas } pour 4 intervalles. */
export function graduation(maxBrut) {
  const v = Math.max(1, Number(maxBrut) || 1);
  const brut = v / 4;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const f = brut / puissance;
  const pas = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * puissance;
  return { pas, max: pas * 4 };
}

export function etiquetteAxe(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a % 1e6 === 0 ? 0 : 1).replace(".", ",")}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a % 1e3 === 0 ? 0 : 1).replace(".", ",")}k`;
  return String(Math.round(v * 100) / 100).replace(".", ",");
}

/** Répartition en pourcentages qui totalisent toujours 100 (méthode du plus grand reste). */
export function pourcentages(valeurs) {
  const total = valeurs.reduce((s, v) => s + v, 0);
  if (!total) return valeurs.map(() => 0);
  const bruts = valeurs.map((v) => (v / total) * 1000);
  const bas = bruts.map(Math.floor);
  let reste = 1000 - bas.reduce((s, v) => s + v, 0);
  const ordre = bruts.map((b, i) => [b - bas[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of ordre) { if (reste <= 0) break; bas[i] += 1; reste -= 1; }
  return bas.map((v) => v / 10);
}

const pct = (x) => `${String(x.toFixed(1)).replace(".", ",")}%`;

/**
 * Calcule toutes les données du rapport.
 * entrée : { transactions, comptes, devise, ristourne, maintenant, utilisateur }
 */
export function calculerRapport({ transactions = [], comptes = [], devise, ristourne = null, maintenant = new Date(), utilisateur = "" }) {
  const tx = [...transactions].sort((a, b) => dateTri(b).localeCompare(dateTri(a)));
  const devises = [...new Set([...comptes.map((c) => c.currency), ...tx.map((t) => t.currency)].filter(Boolean))];
  if (!devise || !devises.includes(devise)) {
    // devise la plus utilisée par défaut
    const compte = {};
    tx.forEach((t) => { if (t.currency) compte[t.currency] = (compte[t.currency] || 0) + 1; });
    devise = Object.entries(compte).sort((a, b) => b[1] - a[1])[0]?.[0] || devises[0] || "FC";
  }
  const enDevise = (t) => t.currency === devise;

  const dates = tx.map((t) => String(t.date || "")).filter(Boolean).sort();
  const periode = { debut: dates[0] || "", fin: dates[dates.length - 1] || "" };

  // Indicateurs
  const comptesDevise = comptes.filter((c) => c.currency === devise);
  const soldeNet = comptesDevise.reduce((s, c) => s + Number(c.balance || 0), 0);
  const entrees = tx.filter((t) => enDevise(t) && t.kind === "income").reduce((s, t) => s + Number(t.amount || 0), 0);
  const sorties = tx.filter((t) => enDevise(t) && t.kind === "expense").reduce((s, t) => s + Number(t.amount || 0), 0);

  // Répartition par compte
  const lignesComptes = comptes.map((c) => ({
    nom: String(c.name || "Compte"), devise: c.currency || "", solde: Number(c.balance || 0),
    pct: c.currency === devise && soldeNet ? (Number(c.balance || 0) / soldeNet) * 100 : null,
  }));

  // Répartition des mouvements
  const nbParType = [
    ["Entrées", tx.filter((t) => t.kind === "income").length],
    ["Sorties", tx.filter((t) => t.kind === "expense").length],
    ["Transferts", tx.filter((t) => t.kind === "transfer").length],
  ];
  const pType = pourcentages(nbParType.map((x) => x[1]));
  const parType = nbParType.map(([nom, nb], i) => ({ nom, nb, pct: pType[i] }));

  const moyens = {};
  tx.forEach((t) => { const k = t.paymentMethod || "Non précisé"; moyens[k] = (moyens[k] || 0) + 1; });
  const moyensTri = Object.entries(moyens).sort((a, b) => (a[0] === "Non précisé") - (b[0] === "Non précisé") || b[1] - a[1]);
  const pMoy = pourcentages(moyensTri.map((x) => x[1]));
  const parMoyen = moyensTri.slice(0, 4).map(([nom, nb], i) => ({ nom, nb, pct: pMoy[i] }));

  // Dépenses par catégorie (devise du rapport)
  const depenses = {};
  tx.filter((t) => enDevise(t) && t.kind === "expense").forEach((t) => { const k = (t.category || "").trim() || "Non classé"; depenses[k] = (depenses[k] || 0) + Number(t.amount || 0); });
  let cats = Object.entries(depenses).sort((a, b) => b[1] - a[1]);
  if (cats.length > 6) { const reste = cats.slice(5).reduce((s, x) => s + x[1], 0); cats = [...cats.slice(0, 5), ["Autres", reste]]; }
  const pCat = pourcentages(cats.map((x) => x[1]));
  const parCategorie = cats.map(([nom, montant], i) => ({ nom, montant, pct: pCat[i] }));

  // Mensuel : année en cours (au moins 6 mois), solde de fin de mois reconstitué depuis les soldes actuels
  const annee = maintenant.getFullYear(), moisCourant = maintenant.getMonth();
  const nbMois = Math.max(moisCourant + 1, 6);
  const mois = [];
  for (let i = nbMois - 1; i >= 0; i--) {
    const d = new Date(annee, moisCourant - i, 1);
    mois.push({ cle: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MOIS_COURTS[d.getMonth()], entrees: 0, sorties: 0, solde: 0 });
  }
  tx.filter((t) => enDevise(t) && t.kind !== "transfer").forEach((t) => {
    const m = mois.find((x) => x.cle === String(t.date || "").slice(0, 7));
    if (!m) return;
    if (t.kind === "income") m.entrees += Number(t.amount || 0); else m.sorties += Number(t.amount || 0);
  });
  mois.forEach((m) => {
    const apres = tx.filter((t) => enDevise(t) && String(t.date || "").slice(0, 7) > m.cle);
    m.solde = soldeNet - apres.reduce((s, t) => s + effetMouvement(t), 0);
  });

  // Hebdomadaire : 12 dernières semaines (lundi au dimanche), solde de fin de semaine reconstitué
  const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const lundi = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
  const semaines = [];
  for (let i = 11; i >= 0; i--) {
    const debut = new Date(lundi); debut.setDate(debut.getDate() - 7 * i);
    const fin = new Date(debut); fin.setDate(fin.getDate() + 6);
    semaines.push({ debut: iso(debut), fin: iso(fin), label: `${String(debut.getDate()).padStart(2, "0")}/${String(debut.getMonth() + 1).padStart(2, "0")}`, entrees: 0, sorties: 0, solde: 0 });
  }
  tx.filter((t) => enDevise(t) && t.kind !== "transfer").forEach((t) => {
    const j = String(t.date || "").slice(0, 10);
    const s = semaines.find((x) => j >= x.debut && j <= x.fin);
    if (!s) return;
    if (t.kind === "income") s.entrees += Number(t.amount || 0); else s.sorties += Number(t.amount || 0);
  });
  semaines.forEach((s) => {
    const apres = tx.filter((t) => enDevise(t) && String(t.date || "").slice(0, 10) > s.fin);
    s.solde = soldeNet - apres.reduce((a, t) => a + effetMouvement(t), 0);
  });

  // Historique avec solde après opération, compte par compte
  const soldes = new Map(comptes.map((c) => [c.id, Number(c.balance || 0)]));
  const apresOperation = new Map();
  for (const t of tx) { // du plus récent au plus ancien
    if (!soldes.has(t.accountId)) { apresOperation.set(t.id, null); continue; }
    const courant = soldes.get(t.accountId);
    apresOperation.set(t.id, courant);
    soldes.set(t.accountId, courant - effetMouvement(t));
  }
  const historique = tx.map((t) => ({
    date: String(t.date || ""), heure: String(t.createdAt || "").length >= 16 ? String(t.createdAt).slice(11, 16) : "",
    compte: t.accountName || (comptes.find((c) => c.id === t.accountId) || {}).name || "—",
    type: t.kind === "income" ? "Entrée" : t.kind === "expense" ? "Sortie" : "Transfert",
    sens: effetMouvement(t) >= 0 ? "in" : "out",
    description: String(t.description || "—"), categorie: String(t.category || "—"), moyen: String(t.paymentMethod || "—"),
    montant: Number(t.amount || 0), devise: t.currency || devise, soldeApres: apresOperation.get(t.id),
  }));

  // Ristournes (ESE DB) : dépôts uniquement, par devise
  const lignesRist = (ristourne?.lignes || []).filter((l) => l.type === "in");
  const totalRist = { FC: 0, USD: 0 };
  lignesRist.forEach((l) => { totalRist[l.devise === "USD" ? "USD" : "FC"] += l.montant; });
  const ristournes = {
    disponible: !!ristourne, nb: lignesRist.length, total: totalRist,
    moyenne: { FC: totalRist.FC / Math.max(1, lignesRist.filter((l) => l.devise !== "USD").length), USD: totalRist.USD / Math.max(1, lignesRist.filter((l) => l.devise === "USD").length) },
    lignes: lignesRist.slice(0, 8),
  };

  return {
    devise, devises, utilisateur, maintenant, periode,
    kpis: { soldeNet, entrees, sorties, nbMouvements: tx.length },
    comptes: lignesComptes, totalComptes: soldeNet,
    parType, parMoyen, parCategorie, mois, semaines, historique, ristournes,
  };
}

// ====================================================================================================
//                                           DESSIN PDF
// ====================================================================================================

const C = {
  vert: [11, 92, 62], vert2: [31, 140, 96], or: [196, 154, 58], menthe: [232, 241, 236], pale: [247, 250, 248],
  encre: [34, 44, 40], gris: [100, 112, 106], trait: [210, 222, 215], blanc: [255, 255, 255],
  rouge: [212, 63, 58], bleu: [58, 118, 178], orange: [226, 160, 50], violet: [128, 82, 150], sable: [168, 160, 134],
};
const PALETTE = [C.bleu, C.rouge, C.orange, C.violet, C.vert2, C.sable];
const W = 210, H = 297, M = 10, CW = 190, BAS = 279;

export function dessinerRapport(doc, d) {
  const fill = (c) => doc.setFillColor(...c), draw = (c) => doc.setDrawColor(...c), txt = (c) => doc.setTextColor(...c);
  const police = (style = "normal", taille = 8) => { doc.setFont("helvetica", style); doc.setFontSize(taille); };
  const fmt = (n, dv) => formaterMontant(n, dv);
  const dateFr = (iso) => { const [a, m, j] = String(iso || "").split("-"); return a ? `${j}/${m}/${a}` : "—"; };
  const dateLongue = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d.maintenant).replace(" à ", " à ");
  const dateCourte = `${String(d.maintenant.getDate()).padStart(2, "0")}/${String(d.maintenant.getMonth() + 1).padStart(2, "0")}/${d.maintenant.getFullYear()} à ${String(d.maintenant.getHours()).padStart(2, "0")}:${String(d.maintenant.getMinutes()).padStart(2, "0")}`;
  let y = 0;

  // ---------- briques graphiques ----------
  const fleche = (cx, cy, haut, couleur, taille = 2.6) => { // flèche pleine (haut ou bas)
    fill(couleur); draw(couleur); doc.setLineWidth(0.5);
    const s = haut ? -1 : 1;
    doc.line(cx, cy - s * taille, cx, cy + s * taille * 0.2);
    doc.triangle(cx - taille * 0.8, cy + s * taille * 0.1, cx + taille * 0.8, cy + s * taille * 0.1, cx, cy + s * taille, "F");
  };
  const coche = (x, yy, couleur = C.vert2) => { draw(couleur); doc.setLineWidth(0.5); doc.line(x, yy, x + 1, yy + 1.1); doc.line(x + 1, yy + 1.1, x + 2.6, yy - 1.2); };
  const donut = (cx, cy, r, ri, parts) => {
    const total = parts.reduce((s, p) => s + p.v, 0);
    if (!total) { fill(C.menthe); doc.circle(cx, cy, r, "F"); fill(C.blanc); doc.circle(cx, cy, ri, "F"); return; }
    let a0 = -Math.PI / 2;
    parts.forEach((p) => {
      if (p.v <= 0) return;
      const a1 = a0 + (p.v / total) * Math.PI * 2;
      const pas = Math.max(2, Math.ceil(((a1 - a0) * 180) / Math.PI / 4));
      const pts = [];
      for (let i = 0; i <= pas; i++) { const a = a0 + ((a1 - a0) * i) / pas; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      for (let i = pas; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / pas; pts.push([cx + ri * Math.cos(a), cy + ri * Math.sin(a)]); }
      fill(p.c); draw(p.c);
      doc.lines(pts.slice(1).map((pt, i) => [pt[0] - pts[i][0], pt[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], "FD", true);
      a0 = a1;
    });
  };
  const legende = (x, yy, items, largeur) => items.forEach((it, i) => {
    fill(it.c); doc.rect(x, yy + i * 6 - 2.2, 2.6, 2.6, "F"); police("normal", 7); txt(C.encre);
    doc.text(doc.splitTextToSize(String(it.nom), largeur - 22)[0], x + 4.5, yy + i * 6);
    txt(C.gris); doc.text(pct(it.pct), x + largeur, yy + i * 6, { align: "right" });
  });

  const piedDePage = () => {
    const n = doc.getNumberOfPages();
    for (let p = 2; p <= n; p++) {
      doc.setPage(p); draw(C.trait); doc.setLineWidth(0.2); doc.line(M, 287, W - M, 287);
      police("normal", 7); txt(C.gris); doc.text("My World RS - Rapport détaillé", W / 2, 292, { align: "center" }); doc.text(String(p - 1), W - M, 292, { align: "right" });
    }
  };
  const nouvellePage = () => { doc.addPage(); y = 14; };
  const titre = (numero, texte, droite = "") => {
    fill(C.vert); doc.rect(M, y - 5, 7, 7, "F"); police("bold", 9); txt(C.blanc); doc.text(String(numero), M + 3.5, y + 0.1, { align: "center" });
    police("bold", 11); txt(C.vert); doc.text(texte, M + 11, y + 0.3);
    if (droite) { police("normal", 7.5); txt(C.encre); doc.text(droite, W - M, y + 0.3, { align: "right" }); }
    draw(C.trait); doc.setLineWidth(0.3); doc.line(M, y + 3, W - M, y + 3);
    y += 10;
  };
  const sousTitre = (texte) => { police("bold", 8.5); txt(C.vert); doc.text(texte, M, y); y += 5; };

  // ---------- couverture ----------
  const couverture = () => {
    fill(C.blanc); doc.rect(0, 0, W, H, "F");
    fill(C.vert); doc.rect(0, 196, W, 101, "F");
    fill(C.vert); doc.ellipse(50, 200, 120, 26, "F");
    fill(C.or); doc.ellipse(125, 203, 110, 7, "F");
    fill(C.vert); doc.ellipse(120, 209, 120, 12, "F");
    // logo
    draw(C.vert); doc.setLineWidth(1.2); doc.circle(105, 34, 14, "S");
    fill(C.vert); doc.rect(98, 38, 3.4, 7, "F"); doc.rect(103, 33, 3.4, 12, "F"); doc.rect(108, 28, 3.4, 17, "F");
    draw(C.or); doc.setLineWidth(0.8); doc.circle(114, 25, 4.2, "S"); police("bold", 6); txt(C.or); doc.text("$", 114, 27, { align: "center" });
    police("bold", 20); txt(C.vert); doc.text("MY WORLD RS", 105, 62, { align: "center" });
    police("normal", 8.5); txt(C.encre); doc.text("Maîtrisez vos finances, construisez votre avenir", 105, 69, { align: "center" });
    police("bold", 25); txt(C.vert);
    doc.text("RAPPORT DÉTAILLÉ", 105, 100, { align: "center" });
    doc.text("HISTORIQUE DES MOUVEMENTS", 105, 113, { align: "center", maxWidth: 170 });
    doc.text("DE TOUS LES COMPTES", 105, 126, { align: "center" });
    draw(C.or); doc.setLineWidth(0.5); doc.line(30, 135, 180, 135);
    police("bold", 12.5); txt(C.or); doc.text("ANALYSE COMPLÈTE DE VOS FINANCES", 105, 145, { align: "center" });
    // médaillon
    fill(C.blanc); draw(C.or); doc.setLineWidth(1.4); doc.circle(105, 178, 27, "FD");
    fill(C.vert); doc.rect(92, 182, 6, 13, "F"); doc.rect(101, 175, 6, 20, "F"); doc.rect(110, 168, 6, 27, "F");
    draw(C.vert2); doc.setLineWidth(1.8); doc.line(90, 176, 100, 168); doc.line(100, 168, 108, 173); doc.line(108, 173, 122, 158);
    fill(C.vert2); doc.triangle(122, 158, 116, 158.5, 121.5, 164, "F");
    fill(C.or); [[122, 193], [122, 190], [122, 187]].forEach(([cx, cy]) => doc.ellipse(cx, cy, 7, 2, "F"));
    // informations
    const info = (yy, etiquette, valeur) => {
      draw(C.blanc); doc.setLineWidth(0.5); doc.circle(32, yy - 2.5, 3.3, "S");
      police("normal", 8.5); txt([214, 235, 224]); doc.text(etiquette, 42, yy - 3);
      police("bold", 9.5); txt(C.blanc); doc.text(String(valeur).slice(0, 70), 42, yy + 2.5);
    };
    info(236, "Utilisateur", d.utilisateur || "Utilisateur My World RS");
    info(251, "Période du rapport", d.periode.debut ? `Du ${dateFr(d.periode.debut)} au ${dateFr(d.periode.fin)}` : "Aucun mouvement enregistré");
    info(266, "Date de génération", dateLongue);
    police("italic", 9); txt([226, 241, 232]); doc.text("Une vision claire pour de meilleures décisions", 105, 287, { align: "center" });
  };

  // ---------- tableau générique ----------
  const tableau = ({ colonnes, largeurs, lignes, alignements = [], total = null, tailleTexte = 7.2, entete = "menthe", pageSuite = null }) => {
    const enteteLigne = () => {
      fill(C.menthe); doc.rect(M, y - 4, CW, 7, "F"); police("bold", tailleTexte); txt(C.vert);
      let x = M + 2; colonnes.forEach((c, i) => { doc.text(c, alignements[i] === "right" ? x + largeurs[i] - 4 : x, y + 0.5, { align: alignements[i] === "right" ? "right" : "left" }); x += largeurs[i]; });
      y += 7;
    };
    enteteLigne();
    lignes.forEach((ligne, idx) => {
      police("normal", tailleTexte);
      const cellules = ligne.map((v, i) => doc.splitTextToSize(String(v.texte ?? v), largeurs[i] - 4));
      const nb = Math.max(1, ...cellules.map((c) => c.length));
      const h = Math.max(6.4, nb * (tailleTexte * 0.42) + 3);
      if (y + h > BAS) { nouvellePage(); if (pageSuite) pageSuite(); enteteLigne(); }
      let x = M + 2;
      cellules.forEach((c, i) => {
        const v = ligne[i];
        txt(v && v.couleur ? v.couleur : C.encre); police(v && v.gras ? "bold" : "normal", tailleTexte);
        const dec = v && v.decalage ? v.decalage : 0;
        doc.text(c, alignements[i] === "right" ? x + largeurs[i] - 4 : x + dec, y, { align: alignements[i] === "right" ? "right" : "left" });
        if (v && v.fleche) fleche(x + 2, y - 1, v.fleche === "haut", v.flecheCouleur, 1.7);
        x += largeurs[i];
      });
      draw(C.trait); doc.setLineWidth(0.15); doc.line(M, y + h - 4.1, M + CW, y + h - 4.1);
      y += h;
    });
    if (total) {
      fill(C.menthe); doc.rect(M, y - 4, CW, 7, "F"); police("bold", tailleTexte); txt(C.vert);
      let x = M + 2; total.forEach((v, i) => { doc.text(String(v), alignements[i] === "right" ? x + largeurs[i] - 4 : x, y + 0.5, { align: alignements[i] === "right" ? "right" : "left" }); x += largeurs[i]; });
      y += 8;
    }
  };

  // ---------- page 2 : synthèse ----------
  const pageSynthese = () => {
    nouvellePage(); titre(1, "SYNTHÈSE GÉNÉRALE", `Date du rapport : ${dateCourte}`); y += 2;
    const cartes = [
      ["SOLDE NET GLOBAL", fmt(d.kpis.soldeNet, d.devise), C.vert, "sac"],
      ["TOTAL ENTRÉES", fmt(d.kpis.entrees, d.devise), C.vert2, "bas"],
      ["TOTAL SORTIES", fmt(d.kpis.sorties, d.devise), C.rouge, "haut"],
      ["NOMBRE DE MOUVEMENTS", String(d.kpis.nbMouvements), C.bleu, "liste"],
    ];
    const lc = (CW - 9) / 4;
    cartes.forEach(([lib, val, coul, icone], i) => {
      const x = M + i * (lc + 3);
      fill(C.blanc); draw(C.trait); doc.setLineWidth(0.3); doc.roundedRect(x, y, lc, 35, 1.5, 1.5, "FD");
      police("bold", 5.8); txt(coul === C.bleu ? C.bleu : C.encre); doc.text(lib, x + lc / 2, y + 7, { align: "center" });
      police("bold", String(val).length > 17 ? 8 : 9.6); txt(coul); doc.text(String(val), x + lc / 2, y + 15, { align: "center", maxWidth: lc - 3 });
      const cx = x + lc / 2, cy = y + 26;
      if (icone === "sac") { fill(C.vert); doc.circle(cx, cy + 1, 5.2, "F"); fill(C.vert); doc.triangle(cx - 2, cy - 4.5, cx + 2, cy - 4.5, cx, cy - 1.5, "F"); police("bold", 9); txt(C.blanc); doc.text("$", cx, cy + 4, { align: "center" }); }
      if (icone === "bas") { draw(C.vert2); doc.setLineWidth(0.9); doc.line(cx - 5, cy + 1, cx - 5, cy + 5); doc.line(cx - 5, cy + 5, cx + 5, cy + 5); doc.line(cx + 5, cy + 5, cx + 5, cy + 1); fleche(cx, cy + 0.5, false, C.vert2, 4); }
      if (icone === "haut") { draw(C.rouge); doc.setLineWidth(0.9); doc.line(cx - 5, cy + 1, cx - 5, cy + 5); doc.line(cx - 5, cy + 5, cx + 5, cy + 5); doc.line(cx + 5, cy + 1, cx + 5, cy + 5); fleche(cx, cy - 0.5, true, C.rouge, 4); }
      if (icone === "liste") { draw(C.bleu); doc.setLineWidth(0.7); doc.roundedRect(cx - 4.5, cy - 5, 9, 11, 1, 1, "S"); for (let k = 0; k < 3; k++) { fill(C.bleu); doc.rect(cx - 2.8, cy - 3 + k * 3, 1, 1, "F"); doc.line(cx - 1, cy - 2.5 + k * 3, cx + 3, cy - 2.5 + k * 3); } }
    });
    y += 44;

    sousTitre("RÉPARTITION PAR COMPTE (SOLDE ACTUEL)");
    fill(C.menthe);
    tableau({
      colonnes: ["Compte", `Solde actuel`, "% du total"], largeurs: [90, 60, 40], alignements: ["left", "right", "right"],
      lignes: d.comptes.length ? d.comptes.map((c) => [c.nom, fmt(c.solde, c.devise), c.pct == null ? "—" : pct(c.pct)]) : [["Aucun compte enregistré", "", ""]],
      total: [`TOTAL (${d.devise})`, fmt(d.totalComptes, d.devise), d.totalComptes ? "100 %" : "—"],
    });
    if (d.devises.length > 1) { police("italic", 6.8); txt(C.gris); doc.text(`Totaux et graphiques exprimés en ${d.devise}. Les comptes en autre devise sont indiqués dans leur propre devise.`, M, y - 1); y += 4; }
    y += 3;

    sousTitre("RÉPARTITION DES MOUVEMENTS"); y += 1;
    const lb = (CW - 8) / 3, hb = 50, top = y;
    ["PAR TYPE", "PAR MOYEN DE PAIEMENT", "PAR CATÉGORIE PRINCIPALE"].forEach((t, i) => {
      const x = M + i * (lb + 4); fill(C.blanc); draw(C.trait); doc.setLineWidth(0.3); doc.roundedRect(x, top, lb, hb, 1.5, 1.5, "FD");
      police("bold", 6.5); txt(C.vert); doc.text(t, x + 4, top + 6);
    });
    // par type : donut + légende
    const typeCouleurs = [C.vert2, C.rouge, C.orange];
    donut(M + 14, top + 28, 11, 6.2, d.parType.map((p, i) => ({ v: p.nb, c: typeCouleurs[i] })));
    legende(M + 28, top + 18, d.parType.map((p, i) => ({ nom: p.nom, c: typeCouleurs[i], pct: p.pct })), lb - 32);
    // par moyen
    const x2 = M + lb + 4;
    legende(x2 + 4, top + 16, d.parMoyen.length ? d.parMoyen.map((p, i) => ({ nom: p.nom, c: PALETTE[i % PALETTE.length], pct: p.pct })) : [{ nom: "Aucune donnée", c: C.sable, pct: 0 }], lb - 8);
    // par catégorie
    const x3 = M + 2 * (lb + 4);
    const cats = d.parCategorie.slice(0, 4);
    legende(x3 + 4, top + 16, cats.length ? cats.map((p, i) => ({ nom: p.nom, c: PALETTE[i % PALETTE.length], pct: p.pct })) : [{ nom: "Aucune dépense", c: C.sable, pct: 0 }], lb - 8);
    y = top + hb + 8;
  };

  // ---------- page 3 : graphiques mensuels ----------
  const axeY = (x0, x1, haut, bas, max, pas, devise) => {
    police("normal", 6.5); txt(C.gris);
    for (let k = 0; k <= 4; k++) {
      const yy = bas - ((bas - haut) * k) / 4; draw(C.trait); doc.setLineWidth(0.2); doc.line(x0, yy, x1, yy);
      doc.text(etiquetteAxe(pas * k), x0 - 2, yy + 1, { align: "right" });
    }
  };
  const pageGraphiques = (serie, nom, n1, n2) => {
    nouvellePage(); titre(n1, `ENTRÉES ET SORTIES PAR ${nom}`); y += 2;
    const nbm = serie.length, gx0 = M + 12, gx1 = W - M - 2, haut = y + 10, bas = y + 70;
    const g = graduation(Math.max(...serie.flatMap((m) => [m.entrees, m.sorties]), 1));
    fill(C.vert2); doc.rect(M + 12, y, 4, 3, "F"); police("normal", 7); txt(C.encre); doc.text(`Entrées (${d.devise})`, M + 18, y + 2.6);
    fill(C.rouge); doc.rect(M + 52, y, 4, 3, "F"); doc.text(`Sorties (${d.devise})`, M + 58, y + 2.6);
    axeY(gx0, gx1, haut, bas, g.max, g.pas);
    const pas = (gx1 - gx0) / nbm, bw = Math.min(5.2, pas * 0.3);
    serie.forEach((m, i) => {
      const cx = gx0 + pas * (i + 0.5), he = (m.entrees / g.max) * (bas - haut), hs = (m.sorties / g.max) * (bas - haut);
      fill(C.vert2); doc.rect(cx - bw - 0.4, bas - he, bw, he, "F"); fill(C.rouge); doc.rect(cx + 0.4, bas - hs, bw, hs, "F");
      police("normal", 6.8); txt(C.gris); doc.text(m.label, cx, bas + 5, { align: "center" });
    });
    y = bas + 16;

    titre(n2, `ÉVOLUTION DU SOLDE NET (${nom === "MOIS" ? "MENSUEL" : "HEBDOMADAIRE"})`); y += 2;
    const haut2 = y + 6, bas2 = y + 66;
    const soldes = serie.map((m) => m.solde), mn = Math.min(0, ...soldes), mx = Math.max(...soldes, 1);
    const g2 = graduation(mx - mn); const origine = mn < 0 ? Math.floor(mn / g2.pas) * g2.pas : 0;
    const plage = Math.max(g2.pas * 4, mx - origine); const pas2 = graduation(plage).pas; const max2 = pas2 * 4;
    police("normal", 6.5); txt(C.gris);
    for (let k = 0; k <= 4; k++) { const yy = bas2 - ((bas2 - haut2) * k) / 4; draw(C.trait); doc.setLineWidth(0.2); doc.line(gx0, yy, gx1, yy); doc.text(etiquetteAxe(origine + pas2 * k), gx0 - 2, yy + 1, { align: "right" }); }
    let prec = null;
    serie.forEach((m, i) => {
      const px = gx0 + pas * (i + 0.5), py = bas2 - ((m.solde - origine) / max2) * (bas2 - haut2);
      if (prec) { draw(C.vert); doc.setLineWidth(0.9); doc.line(prec[0], prec[1], px, py); }
      fill(C.vert); doc.circle(px, py, 1.1, "F"); police("normal", 6.8); txt(C.gris); doc.text(m.label, px, bas2 + 5, { align: "center" });
      prec = [px, py];
    });
    y = bas2 + 14;
  };

  // ---------- page 4 : ristournes + dépenses ----------
  const pageRistournes = () => {
    nouvellePage(); titre(6, "RISTOURNES ET REMBOURSEMENTS"); y += 1;
    const r = d.ristournes;
    const totalTxt = ["FC", "USD"].filter((c) => r.total[c] > 0).map((c) => fmt(r.total[c], c)).join("  +  ") || "0";
    const moyTxt = ["FC", "USD"].filter((c) => r.total[c] > 0).map((c) => fmt(r.moyenne[c], c)).join("  +  ") || "0";
    fill(C.menthe); doc.rect(M, y - 3, CW, 15, "F");
    [["TOTAL RISTOURNES", totalTxt], ["NOMBRE D'OPÉRATIONS", String(r.nb)], ["MOYENNE PAR OPÉRATION", moyTxt]].forEach(([l, v], i) => {
      const cx = M + (CW / 3) * i + CW / 6; police("bold", 6.2); txt(C.vert); doc.text(l, cx, y + 1.5, { align: "center" }); police("bold", 9); txt(C.encre); doc.text(v, cx, y + 8, { align: "center", maxWidth: CW / 3 - 4 });
    });
    y += 20;
    if (!r.disponible) { police("italic", 7.5); txt(C.gris); doc.text("Données ESE DB non synchronisées : ouvrez Mon Porte-Monnaie avant d'exporter pour les inclure.", M, y); y += 8; }
    else if (!r.lignes.length) { police("italic", 7.5); txt(C.gris); doc.text("Aucune ristourne enregistrée dans ESE DB.", M, y); y += 8; }
    else {
      tableau({
        colonnes: ["Date", "Description", "Source / Partenaire", "Montant"], largeurs: [28, 70, 52, 40], alignements: ["left", "left", "left", "right"],
        lignes: r.lignes.map((l) => [dateFr(l.date), l.note || "Ristourne", l.groupe, fmt(l.montant, l.devise)]),
        total: ["TOTAL", "", "", totalTxt],
      });
    }
    y += 4;
    titre(7, "RÉPARTITION DES DÉPENSES PAR CATÉGORIE"); y += 2;
    fill(C.blanc); draw(C.trait); doc.setLineWidth(0.3); doc.roundedRect(M, y - 2, CW, 52, 1.5, 1.5, "FD");
    const parts = d.parCategorie.map((p, i) => ({ v: p.montant, c: PALETTE[i % PALETTE.length] }));
    donut(M + 55, y + 24, 21, 11, parts);
    if (d.parCategorie.length) legende(M + 95, y + 12, d.parCategorie.map((p, i) => ({ nom: p.nom, c: PALETTE[i % PALETTE.length], pct: p.pct })), 70);
    else { police("italic", 8); txt(C.gris); doc.text(`Aucune dépense en ${d.devise}.`, M + 95, y + 24); }
    y += 58;
  };

  // ---------- page 5+ : historique ----------
  const pageHistorique = () => {
    nouvellePage(); titre(8, "HISTORIQUE DÉTAILLÉ DE TOUS LES MOUVEMENTS");
    const lignes = d.historique.map((h) => {
      const enEntree = h.sens === "in";
      return [
        { texte: h.date ? `${dateFr(h.date)}${h.heure ? " " + h.heure : ""}` : "—" },
        h.compte,
        { texte: h.type, decalage: 4, fleche: enEntree ? "bas" : "haut", flecheCouleur: h.type === "Transfert" ? C.bleu : enEntree ? C.vert2 : C.rouge },
        h.description, h.categorie, h.moyen,
        { texte: enEntree ? fmt(h.montant) + (h.devise !== d.devise ? " " + h.devise : "") : "-", couleur: C.vert2 },
        { texte: !enEntree ? fmt(h.montant) + (h.devise !== d.devise ? " " + h.devise : "") : "-", couleur: C.rouge },
        { texte: h.soldeApres == null ? "—" : fmt(h.soldeApres) + (h.devise !== d.devise ? " " + h.devise : ""), gras: true },
      ];
    });
    tableau({
      colonnes: ["Date", "Compte", "Type", "Description", "Catégorie", "Moyen de paiement", `Entrées (${d.devise})`, `Sorties (${d.devise})`, `Solde après (${d.devise})`],
      largeurs: [22, 25, 17, 30, 19, 22, 18, 17, 20], alignements: ["left", "left", "left", "left", "left", "left", "right", "right", "right"],
      lignes: lignes.length ? lignes : [["Aucun mouvement enregistré", "", "", "", "", "", "", "", ""]], tailleTexte: 6.2,
      pageSuite: () => titre(8, "HISTORIQUE DÉTAILLÉ (suite)"),
    });
    // légende et informations
    if (y + 30 > BAS) nouvellePage();
    y += 4;
    fill(C.pale); draw(C.trait); doc.setLineWidth(0.3); doc.roundedRect(M, y, 58, 26, 1.5, 1.5, "FD");
    police("bold", 7); txt(C.vert); doc.text("LÉGENDE", M + 4, y + 6);
    [[C.vert2, false, "Entrée d'argent"], [C.rouge, true, "Sortie d'argent"], [C.bleu, true, "Transfert entre comptes"]].forEach(([coul, haut, lib], i) => { fleche(M + 6, y + 12 + i * 5, haut, coul, 1.6); police("normal", 6.8); txt(C.encre); doc.text(lib, M + 11, y + 13 + i * 5); });
    police("bold", 8); txt(C.vert); doc.text("Merci pour votre confiance.", W / 2 + 2, y + 11, { align: "center" });
    police("normal", 6.8); txt(C.encre); doc.text("Continuez à gérer intelligemment vos finances avec My World RS.", W / 2 + 2, y + 16, { align: "center", maxWidth: 70 });
    fill(C.pale); doc.roundedRect(W - M - 74, y, 74, 26, 1.5, 1.5, "FD");
    police("bold", 7); txt(C.vert); doc.text("INFORMATIONS IMPORTANTES", W - M - 70, y + 6);
    ["Ce rapport est généré automatiquement par My World RS.", `Totaux et graphiques exprimés en ${d.devise}.`, "Les données sont exactes jusqu'à la date de génération."].forEach((l, i) => { coche(W - M - 70, y + 11.5 + i * 5); police("normal", 6.4); txt(C.encre); doc.text(l, W - M - 65, y + 12 + i * 5, { maxWidth: 62 }); });
  };

  couverture();
  pageSynthese();
  pageGraphiques(d.mois, "MOIS", 2, 3);
  pageGraphiques(d.semaines, "SEMAINE", 4, 5);
  pageRistournes();
  pageHistorique();
  piedDePage();
  return doc;
}
