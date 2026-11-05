// Rapport complet de l'application (PDF téléchargeable depuis l'onglet Profil)
export const RAPPORT_APPLI = [
  { titre: "Résumé", paragraphes: [
    "My World RS regroupe en une seule application la messagerie, les agendas, les réseaux sociaux, les bases de données et les finances personnelles, et en tire l'essentiel sur un tableau de bord.",
    "Elle fonctionne entièrement dans le navigateur, sans serveur à maintenir. Les données personnelles sont enregistrées dans Firebase (projet my-world-rs) et protégées par la connexion Google et un code PIN."] },
  { titre: "Les onglets", puces: [
    "Tableau de bord : synthèse des messages importants, des rendez-vous, des tâches et des bases.",
    "Messages : Gmail avec lecture dans l'application, envoi direct, pièces jointes, réponse, messages envoyés, messages importants (marquage depuis l'application), filtres comptes personnels et professionnels.",
    "Agenda et Tâches : Google Agenda et Google Tasks, création et modification.",
    "Drive : accès aux fichiers récents.",
    "Réseaux sociaux : Telegram et Facebook raccordés. WhatsApp n'est pas encore raccordé.",
    "Bases de données : AVEC LA SAGESSE et ESE DB, synthèses et indicateurs.",
    "Notes : notes et projets dans l'application, import de Google Keep par export Takeout (Keep n'a pas d'API pour un compte Google personnel).",
    "Porte-monnaie : comptes, mouvements, prévisions, rapport financier PDF avec graphiques hebdomadaires et mensuels, compte « Mes parts de ristourne » (50 % de la ristourne, retirable et réinitialisable).",
    "Profil : informations personnelles et téléchargement de ce rapport."] },
  { titre: "Connexion Google", paragraphes: [
    "La connexion utilise Firebase Auth (fenêtre Google) puis un jeton d'accès valable une heure, conservé sur l'appareil et renouvelé automatiquement avant son expiration. Si le navigateur bloque le renouvellement, un bouton « Reprendre ma session Google » le rétablit en un clic.",
    "Huit autorisations sont demandées : Gmail (lecture, écriture/brouillons, modification pour marquer important), Agenda, Tasks, Drive et le profil. La première utilisation de la modification Gmail demande un nouveau consentement."] },
  { titre: "Architecture", puces: [
    "Gmail, Agenda, Tasks, Drive : API REST Google appelées depuis le navigateur.",
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

export function dessinerRapportAppli(doc, { date = new Date(), utilisateur = "" } = {}) {
  const L = 14, R = 196, W = R - L;
  let y = 22;
  const place = (h) => { if (y + h > 280) { doc.addPage(); y = 20; } };
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(20, 70, 55);
  doc.text("MY WORLD RS", L, y); y += 8;
  doc.setFontSize(13); doc.setTextColor(30, 40, 36); doc.text("Rapport complet de l'application", L, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(75, 91, 84);
  doc.text(date.toLocaleDateString("fr-FR") + (utilisateur ? " · " + utilisateur : ""), L, y); y += 4;
  doc.setDrawColor(218, 228, 223); doc.line(L, y, R, y); y += 8;
  for (const s of RAPPORT_APPLI) {
    place(16);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(20, 70, 55);
    doc.text(s.titre, L, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(30, 40, 36);
    for (const p of s.paragraphes || []) {
      const l = doc.splitTextToSize(p, W);
      place(l.length * 4.8); doc.text(l, L, y); y += l.length * 4.8 + 2;
    }
    for (const p of s.puces || []) {
      const l = doc.splitTextToSize(p, W - 6);
      place(l.length * 4.8); doc.text("•", L + 1, y); doc.text(l, L + 6, y); y += l.length * 4.8 + 1.5;
    }
    y += 4;
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(75, 91, 84);
    doc.text("MY WORLD RS · Rapport de l'application", L, 290); doc.text("Page " + i + " / " + n, R, 290, { align: "right" });
  }
}
