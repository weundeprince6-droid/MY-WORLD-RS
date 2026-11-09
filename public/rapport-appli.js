// Rapport complet de l'application (PDF téléchargeable depuis l'onglet Profil)
export const RAPPORT_APPLI = [
  { titre: "Résumé", paragraphes: [
    "My World RS regroupe en une seule application la messagerie, les agendas, les réseaux sociaux, les bases de données et les finances personnelles, et en tire l'essentiel sur un tableau de bord.",
    "Elle fonctionne entièrement dans le navigateur, sans serveur à maintenir. Les données personnelles sont enregistrées dans Firebase (projet my-world-rs) et protégées par la connexion Google et un code PIN."] },
  { titre: "Les onglets", puces: [
    "Tableau de bord : synthèse des messages importants, des rendez-vous et des bases.",
    "Messages : Gmail avec lecture dans l'application, envoi direct, pièces jointes, réponse, messages envoyés, messages importants (marquage depuis l'application), filtres comptes personnels et professionnels.",
    "Agenda : Google Agenda, création et modification.",
    "Ma maison : bouton « Télévision » (lecteur vidéo, MP3 et galerie photo avec vignettes, regroupement par dossier ou par mois, visionneuse et diaporama, en plein écran, qui peut être masqué et continuer à lire en arrière-plan), dépenses et revenus du foyer, budget familial, projet de construction, matériel répertorié et matériel à ravitailler, avec déduction du compte choisi.",
    "Projet pro : même modèle côté professionnel (dépenses, revenus, budget, investissement du projet, équipements) et équipements.",
    "Drive : accès aux fichiers récents.",
    "Réseaux sociaux : Telegram et Facebook raccordés. WhatsApp n'est pas encore raccordé.",
    "Bases de données : AVEC LA SAGESSE et ESE DB, synthèses et indicateurs.",
    "Notes : notes et projets dans l'application, import de Google Keep par export Takeout (Keep n'a pas d'API pour un compte Google personnel).",
    "Porte-monnaie : comptes, mouvements, prévisions, rapport financier PDF avec graphiques hebdomadaires et mensuels, compte « Mes parts de ristourne » (50 % de la ristourne, retirable et réinitialisable).",
    "Mode hors ligne : sans connexion internet au démarrage, seule la Télévision (Ma maison) s'ouvre, sans PIN ; les autres espaces reviennent avec le PIN dès que la connexion est retrouvée. Si la connexion coupe en cours d'utilisation, vos modifications (porte-monnaie, Ma maison, Projet pro) sont mises en attente puis envoyées automatiquement au retour d'internet.",
    "Assistant IA : onglet dédié, en bas du menu. Vous cochez les données qu'il peut consulter (finances, messages, agenda, bases, réseaux, notes, Drive) et il répond grâce à l'API Claude (clé personnelle conservée sur l'appareil, données envoyées seulement au moment de la question).",
    "Profil : informations personnelles et téléchargement de ce rapport."] },
  { titre: "Connexion Google", paragraphes: [
    "La connexion utilise Firebase Auth (fenêtre Google) puis un jeton d'accès valable une heure, conservé sur l'appareil et renouvelé automatiquement avant son expiration. Si le navigateur bloque le renouvellement, un bouton « Reprendre ma session Google » le rétablit en un clic.",
    "Sept autorisations sont demandées : Gmail (lecture, écriture/brouillons, modification pour marquer important), Agenda (lecture et rendez-vous), bases Firestore et Drive (métadonnées, lecture seule). La première utilisation de la modification Gmail demande un nouveau consentement."] },
  { titre: "Architecture", puces: [
    "Gmail, Agenda, Drive : API REST Google appelées depuis le navigateur.",
    "Firestore « my-world-rs » : porte-monnaie, notes et profil.",
    "Bases externes AVEC LA SAGESSE et ESE DB : Firestore REST en lecture.",
    "Telegram : API Bot. Facebook : API Graph.",
    "Hébergement : GitHub Pages, fichier unique construit par scripts/build-html.mjs.",
    "Cloud Functions : écrites mais non déployées (plan Blaze requis)."] },
  { titre: "Sécurité et confidentialité", puces: [
    "Accès limité à l'adresse Google autorisée et verrouillé par un code PIN.",
    "Les jetons restent sur l'appareil ; aucun mot de passe n'est stocké.",
    "Les en-têtes des mails envoyés sont assainis contre l'injection de lignes.",
    "Les règles Firestore limitent chaque utilisateur à ses propres données."] },
  { titre: "Qualité et mise en ligne", paragraphes: [
    "Tests automatiques (calculs, Firestore, Telegram, Facebook, rapport, notes) et 27 scénarios de bout en bout dans un navigateur automatisé. Mise en ligne par GitHub Pages à chaque modification.",
    "Vérifié uniquement avec des services simulés : rendu réel du PDF, envoi réel de mails avec pièces jointes, marquage important dans Gmail, format réel de l'export Keep et consentement Google pour la nouvelle autorisation."] },
  { titre: "Limites connues", puces: [
    "WhatsApp non raccordé.",
    "Google Keep : import manuel seulement.",
    "Cloud Functions non déployées.",
    "Un test Telegram est parfois instable (message compté deux fois lors d'interrogations simultanées) ; l'effet réel est probablement nul.",
    "Quota Firestore gratuit : 50 000 lectures par jour."] },
  { titre: "Prochaines étapes recommandées", puces: [
    "Essayer en conditions réelles l'envoi de mails, les pièces jointes et le marquage important.",
    "Raccorder WhatsApp.",
    "Passer au plan Blaze et déployer les Cloud Functions.",
    "Ajouter une signature et la mise en forme riche dans les mails."] },
];

const nb = (n) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const jour = (d) => { const x = new Date(d); return Number.isNaN(x.getTime()) ? "" : x.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }); };
const heureJour = (d) => { const x = new Date(d); return Number.isNaN(x.getTime()) ? "" : jour(x) + " " + x.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
const coupe = (t, n = 90) => { const x = String(t ?? "").replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1) + "…" : x; };
const NON = "Non chargé (connexion nécessaire ou source indisponible).";

/** Transforme les données collectées dans l'application en sections lisibles. */
export function sectionsDonnees(d = {}) {
  const out = [];
  const p = d.profil;
  out.push({ titre: "Mon profil", puces: p && Object.values(p).some(Boolean)
    ? Object.entries({ Nom: p.nom, Postnom: p.postnom, "Prénom": p.prenom, "Naissance": p.naissance, Sexe: p.sexe, "Téléphone": p.telephone, Adresse: p.adresse, "Compte Google": p.email }).filter(([, v]) => v).map(([k, v]) => k + " : " + v)
    : ["Profil non renseigné."] });
  const m = d.messages;
  out.push({ titre: "Messages (Gmail)", puces: !m ? [NON] : [
    nb(m.recents) + " message(s) récent(s) dans la boîte, dont " + nb(m.nonLus) + " non lu(s).",
    nb(m.importants.length) + " message(s) important(s) :",
    ...m.importants.slice(0, 12).map((x) => "  " + jour(x.date) + " · " + coupe(x.de, 30) + " · " + coupe(x.sujet, 70)) ] });
  const a = d.agenda;
  out.push({ titre: "Agenda", puces: !a ? [NON] : [
    nb(a.aujourdhui.length) + " rendez-vous aujourd'hui, " + nb(a.aVenir.length) + " à venir.",
    ...[...a.aujourdhui, ...a.aVenir].slice(0, 15).map((e) => heureJour(e.debut) + " · " + coupe(e.titre, 70) + (e.lieu ? " (" + coupe(e.lieu, 30) + ")" : "")) ] });
  const k = d.indicateurs;
  out.push({ titre: "Bases de données (AVEC LA SAGESSE, ESE DB)", puces: !k || !k.length ? [NON]
    : k.map((x) => (x.base ? x.base + " · " : "") + (x.nom || x.titre || x.id || "Indicateur") + " : " + (x.erreur ? "indisponible" : nb(x.valeur) + (x.unite ? " " + x.unite : ""))) });
  const r = d.ristourne;
  out.push({ titre: "Ristournes", puces: !r ? [NON] : [
    ...[["solde", "Solde"], ["depots", "Dépôts"], ["retraits", "Retraits"], ["interets", "Intérêts"]].map(([c, l]) => l + " : " + nb(r.total?.[c]?.FC) + " FC · " + nb(r.total?.[c]?.USD) + " USD"),
    nb(r.mouvements) + " mouvement(s) lus." ] });
  const w = d.wallet;
  out.push({ titre: "Porte-monnaie", puces: !w ? [NON] : [
    nb(w.comptes.length) + " compte(s), " + nb(w.nbMouvements) + " mouvement(s).",
    ...w.comptes.map((c) => c.name + " : " + nb(c.balance) + " " + (c.currency || "")),
    ...Object.entries(w.totaux || {}).map(([dv, v]) => "Total " + dv + " : revenus " + nb(v.revenus) + ", dépenses " + nb(v.depenses) + ", solde " + nb(v.solde)),
    ...(w.derniers.length ? ["Derniers mouvements :", ...w.derniers.map((x) => "  " + x.date + " · " + coupe(x.compte, 25) + " · " + x.kind + " " + nb(x.amount) + " " + (x.currency || "") + (x.description ? " · " + coupe(x.description, 40) : ""))] : []) ] });
  const n = d.notes;
  out.push({ titre: "Notes et projets", puces: !n ? [NON] : n.length ? [nb(n.length) + " élément(s) :", ...n.slice(0, 25).map((x) => (x.type ? x.type + " · " : "") + coupe(x.title, 60) + (x.category ? " [" + coupe(x.category, 20) + "]" : ""))] : ["Aucune note."] });
  const so = d.social;
  out.push({ titre: "Réseaux sociaux", puces: !so ? [NON] : so.length ? [nb(so.length) + " message(s) enregistré(s) :", ...so.slice(0, 15).map((x) => jour(x.date) + " · " + coupe(x.de, 25) + (x.groupe ? " (" + coupe(x.groupe, 20) + ")" : "") + " : " + coupe(x.texte, 70))] : ["Aucun message enregistré."] });
  return out;
}

export function dessinerRapportAppli(doc, { date = new Date(), utilisateur = "", donnees = null } = {}) {
  const L = 14, R = 196, W = R - L;
  const VERT = [11, 92, 62], OR = [196, 154, 58], ENCRE = [34, 44, 40];
  const fond = (c) => doc.setFillColor(...c), trait = (c) => doc.setDrawColor(...c), encre = (c) => doc.setTextColor(...c);
  // ---------- page de garde ----------
  if (doc.rect && doc.circle) {
    fond([255, 255, 255]); doc.rect(0, 0, 210, 297, "F");
    fond(VERT); doc.rect(0, 196, 210, 101, "F");
    fond(OR); doc.ellipse && doc.ellipse(125, 203, 110, 7, "F");
    trait(VERT); doc.setLineWidth(1.2); doc.circle(105, 34, 14, "S");
    fond(VERT); doc.rect(98, 38, 3.4, 7, "F"); doc.rect(103, 33, 3.4, 12, "F"); doc.rect(108, 28, 3.4, 17, "F");
    trait(OR); doc.setLineWidth(0.8); doc.circle(114, 25, 4.2, "S");
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); encre(VERT); doc.text("MY WORLD RS", 105, 62, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); encre(ENCRE); doc.text("Tout l'essentiel, dans une seule application", 105, 69, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(25); encre(VERT);
    doc.text("RAPPORT COMPLET", 105, 100, { align: "center" });
    doc.text(donnees ? "DE MES DONNÉES" : "DE L'APPLICATION", 105, 113, { align: "center" });
    if (donnees) doc.text("ET DE L'APPLICATION", 105, 126, { align: "center" });
    trait(OR); doc.setLineWidth(0.5); doc.line(30, 135, 180, 135);
    doc.setFontSize(12.5); encre(OR); doc.text("MESSAGES · AGENDA · BASES · PORTE-MONNAIE", 105, 145, { align: "center" });
    const info = (yy, e, v) => { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); encre([214, 235, 224]); doc.text(e, 32, yy - 3); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); encre([255, 255, 255]); doc.text(String(v).slice(0, 70), 32, yy + 2.5); };
    info(236, "Utilisateur", utilisateur || "Utilisateur My World RS");
    info(251, "Date de génération", date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) + " à " + date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    doc.addPage();
  }
  let y = 22;
  const place = (h) => { if (y + h > 280) { doc.addPage(); y = 20; } };
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(20, 70, 55);
  doc.text("MY WORLD RS", L, y); y += 8;
  doc.setFontSize(13); doc.setTextColor(30, 40, 36); doc.text(donnees ? "Rapport complet : mes données et l'application" : "Rapport complet de l'application", L, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(75, 91, 84);
  doc.text(date.toLocaleDateString("fr-FR") + (utilisateur ? " · " + utilisateur : ""), L, y); y += 4;
  doc.setDrawColor(218, 228, 223); doc.line(L, y, R, y); y += 8;
  const toutes = donnees ? [{ titre: "PARTIE 1 · MES DONNÉES", partie: true }, ...sectionsDonnees(donnees), { titre: "PARTIE 2 · FONCTIONNEMENT DE L'APPLICATION", partie: true }, ...RAPPORT_APPLI] : RAPPORT_APPLI;
  for (const s of toutes) {
    if (s.partie) { place(18); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(75, 91, 84); doc.text(s.titre, L, y); y += 7; continue; }
    place(16);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(20, 70, 55);
    doc.text(s.titre, L, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(30, 40, 36);
    for (const p of s.paragraphes || []) {
      const l = doc.splitTextToSize(p, W);
      place(l.length * 4.8); doc.text(l, L, y); y += l.length * 4.8 + 2;
    }
    for (const p of s.puces || []) {
      const sous = p.startsWith("  "); const l = doc.splitTextToSize(p.trim(), W - 6 - (sous ? 6 : 0));
      place(l.length * 4.8); if (!sous) doc.text("•", L + 1, y); doc.text(l, L + 6 + (sous ? 6 : 0), y); y += l.length * 4.8 + 1.5;
    }
    y += 4;
  }
  const n = doc.getNumberOfPages();
  for (let i = 2; i <= n; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(75, 91, 84);
    doc.text("MY WORLD RS · Rapport de l'application", L, 290); doc.text("Page " + i + " / " + n, R, 290, { align: "right" });
  }
}
