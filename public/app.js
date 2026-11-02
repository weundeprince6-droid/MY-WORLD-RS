// app.js — interface My World RS : connexion Google, lecture Gmail/Agenda/Firestore, rendu.
import {
  messagesImportants, repartirAgenda, evaluerSeuil, construireAlertes,
  resumeDuJour, remplirModele, construireBrouillonBrut, expediteurLisible,
} from "./core.js";
import {
  corpsAgregation, lireAgregat, corpsListe, lireListe, decoderDocument,
  calculerCreditsAvec, MESURES_CREDITS_AVEC,
} from "./firestore.js";

const $ = (id) => document.getElementById(id);
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  // Lecture des bases Firestore avec les droits de VOTRE compte Google (propriétaire des projets)
  "https://www.googleapis.com/auth/datastore",
];

let jetonGoogle = null;
let fb = null; // composants Firebase, chargés après l'affichage de la page
let etat = { messages: [], agenda: { aujourdhui: [], aVenir: [] }, kpis: [], social: [] };

// Les boutons réagissent dès le départ, même si Firebase n'est pas encore chargé
$("adresse-page").textContent = location.protocol === "file:"
  ? "Page ouverte comme un fichier local : la connexion Google ne marchera pas (voir le message ci-dessus)."
  : `Domaine de cette page : ${location.hostname} (il doit figurer dans Firebase > Authentication > Paramètres > Domaines autorisés).`;
$("bouton-connexion").addEventListener("click", seConnecter);
$("bouton-deconnexion").addEventListener("click", async () => {
  try { if (fb) await fb.signOut(fb.auth); } catch { /* ignoré */ }
  jetonGoogle = null;
  afficherSession(false);
});
$("bouton-actualiser").addEventListener("click", () => tout());

let config;
try {
  config = await import("./config.js");
} catch {
  $("configuration-manquante").hidden = false;
  $("zone-connexion").hidden = true;
  throw new Error("config.js introuvable dans le dossier public");
}
const { firebaseConfig, reglages, bases } = config;

// Chargement de Firebase en arrière-plan : une panne ici est expliquée au clic, elle n'arrête pas la page
const sdkPret = (async () => {
  try {
    const [appM, authM] = await Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js")]);
    const app = appM.initializeApp(firebaseConfig);
    fb = { ...authM, auth: authM.getAuth(app) };
  } catch (e) {
    const erreur = new Error(e?.message || "chargement impossible");
    erreur.code = "sdk-load";
    throw erreur;
  }
})();
sdkPret.catch(() => {});
window.__appPret = true;

function afficherSession(connecte, nom = "") {
  $("zone-connexion").hidden = connecte;
  $("tableau").hidden = !connecte;
  $("bouton-deconnexion").hidden = !connecte;
  $("bouton-actualiser").hidden = !connecte;
  $("utilisateur").textContent = connecte ? nom : "";
}

function expliquerErreur(e) {
  const code = e?.code || "";
  if (window.self !== window.top && (code === "sdk-load" || code.startsWith("auth/"))) {
    return "Cette page est affichée dans un aperçu intégré (par exemple dans Claude), où Google bloque la connexion. Ouvrez-la dans un vrai onglet du navigateur, avec une adresse https:// (par exemple votre site GitHub Pages ou Firebase).";
  }
  const domaine = location.hostname || "ce domaine";
  const aides = {
    "sdk-load": "Les composants Firebase n'ont pas pu être chargés depuis www.gstatic.com. Vérifiez votre connexion internet, désactivez un bloqueur de publicités ou un VPN, puis rechargez la page.",
    "auth/unauthorized-domain": `Le domaine « ${domaine} » n'est pas autorisé. Console Firebase > Authentication > Paramètres > Domaines autorisés > Ajouter « ${domaine} ».`,
    "auth/operation-not-allowed": "La connexion Google est désactivée. Console Firebase > Authentication > Méthode de connexion > activez « Google ».",
    "auth/popup-blocked": "Le navigateur a bloqué la fenêtre de connexion. Autorisez les fenêtres surgissantes pour cette page (icône dans la barre d'adresse), puis cliquez à nouveau.",
    "auth/popup-closed-by-user": "La fenêtre de connexion a été fermée avant la fin. Cliquez à nouveau et terminez la connexion.",
    "auth/network-request-failed": "Problème de réseau pendant la connexion. Vérifiez votre internet et réessayez.",
    "auth/operation-not-supported-in-this-environment": "Cette page doit être ouverte avec une adresse http:// ou https://, pas comme un fichier local.",
    "auth/invalid-api-key": "La clé Firebase de config.js est refusée. Vérifiez firebaseConfig.",
    "no-token": "Connexion réussie, mais Google n'a pas donné l'accès à Gmail, Agenda et aux bases. Recommencez et cochez toutes les autorisations demandées.",
  };
  return aides[code] || `Connexion impossible (${code || e?.message || "erreur inconnue"}).`;
}

async function seConnecter() {
  afficherErreur("");
  const bouton = $("bouton-connexion");
  bouton.disabled = true;
  bouton.textContent = "Connexion en cours…";
  try {
    await sdkPret;
    const fournisseur = new fb.GoogleAuthProvider();
    SCOPES.forEach((s) => fournisseur.addScope(s));
    fournisseur.setCustomParameters({ prompt: "select_account" });
    const resultat = await fb.signInWithPopup(fb.auth, fournisseur);
    jetonGoogle = fb.GoogleAuthProvider.credentialFromResult(resultat)?.accessToken || null;
    if (!jetonGoogle) throw Object.assign(new Error("pas de jeton"), { code: "no-token" });
    afficherSession(true, resultat.user.displayName || resultat.user.email);
    await tout();
  } catch (e) {
    if (e?.code !== "auth/cancelled-popup-request") afficherErreur(expliquerErreur(e));
  } finally {
    bouton.disabled = false;
    bouton.textContent = "Se connecter avec Google";
  }
}

// ---------- Utilitaires ----------
function afficherErreur(texte) {
  const bandeau = $("erreur");
  bandeau.textContent = texte;
  bandeau.hidden = !texte;
}
function echapper(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const heure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const jourCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const jourHeure = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function google(url, options = {}) {
  if (!jetonGoogle) throw new Error("Session Google expirée : cliquez sur « Se reconnecter ».");
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${jetonGoogle}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (r.status === 401) {
    jetonGoogle = null;
    afficherSession(false);
    throw new Error("Session Google expirée (1 h). Reconnectez-vous.");
  }
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      // Les requêtes Firestore (runQuery, runAggregationQuery) renvoient les erreurs dans un tableau
      detail = (Array.isArray(j) ? j[0]?.error : j?.error)?.message || "";
    } catch { /* réponse sans détail */ }
    detail = detail.replace(/\s+/g, " ").slice(0, 230);
    const projet = (url.match(/projects\/([^/]+)\//) || [])[1];
    let conseil = "";
    if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(detail)) {
      conseil = " → Cette API n'est pas activée dans le projet Google : activez-la dans Google Cloud Console > API et services > Bibliothèque.";
    } else if (r.status === 403 && /insufficient|scope/i.test(detail)) {
      conseil = " → Autorisation refusée : déconnectez-vous, reconnectez-vous et cochez toutes les cases demandées par Google.";
    } else if (r.status === 403 && projet) {
      conseil = ` → Votre compte Google n'a pas accès au projet « ${projet} » (ou Firestore y est désactivé).`;
    }
    throw new Error(`Google a répondu ${r.status}${detail ? " : " + detail : ""}${conseil}`);
  }
  return r.json();
}

// ---------- Sources ----------
async function chargerGmail() {
  const g = reglages.gmail;
  const liste = await google(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${g.maxMessages}&q=${encodeURIComponent(g.requete)}`,
  );
  const ids = (liste.messages || []).map((m) => m.id);
  const complets = await Promise.all(
    ids.map((id) =>
      google(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      ),
    ),
  );
  return messagesImportants(complets, {
    seuil: g.seuilImportance, contactsVip: g.contactsVip, motsImportants: g.motsImportants,
  });
}

async function chargerAgenda() {
  const debut = new Date();
  debut.setHours(0, 0, 0, 0);
  const fin = new Date(debut.getTime() + (reglages.agenda.joursAVenir + 1) * 86400000);
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
    `?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${debut.toISOString()}&timeMax=${fin.toISOString()}`;
  const data = await google(url);
  return repartirAgenda(data.items || []);
}

// --- Firestore (API REST, avec les droits de votre compte Google) ---
function urlFirestore(projectId, suite) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${suite}`;
}
function firestore(projectId, suite, corps) {
  return google(urlFirestore(projectId, suite), {
    method: corps ? "POST" : "GET",
    body: corps ? JSON.stringify(corps) : undefined,
    headers: { "x-goog-user-project": projectId },
  });
}

// Tous les documents d'une collection (pagination), mis en cache le temps d'une actualisation
let cacheDocuments = new Map();
function tousLesDocuments(projectId, collectionId) {
  const cle = `${projectId}/${collectionId}`;
  if (!cacheDocuments.has(cle)) {
    cacheDocuments.set(cle, (async () => {
      const docs = [];
      let page = "";
      do {
        const r = await firestore(projectId, `/${collectionId}?pageSize=300${page ? `&pageToken=${page}` : ""}`);
        (r.documents || []).forEach((d) => docs.push(decoderDocument(d)));
        page = r.nextPageToken || "";
      } while (page);
      return docs;
    })());
  }
  return cacheDocuments.get(cle);
}

async function valeurKpi(k) {
  const base = bases[k.base];
  if (!base) throw new Error(`Base inconnue : ${k.base}`);
  if (k.op === "avec_credits") {
    const membres = await tousLesDocuments(base.projectId, "members");
    const mesure = MESURES_CREDITS_AVEC[k.mesure];
    if (!mesure) throw new Error(`Mesure inconnue : ${k.mesure}`);
    return mesure(calculerCreditsAvec(membres, new Date().toISOString().slice(0, 10)));
  }
  const reponse = await firestore(base.projectId, ":runAggregationQuery", corpsAgregation(k));
  return lireAgregat(reponse);
}

async function chargerKpis() {
  cacheDocuments = new Map();
  return Promise.all(
    reglages.kpis.map(async (k) => {
      const base = bases[k.base]?.nom || "";
      try {
        const valeur = await valeurKpi(k);
        return { ...k, base, valeur, unite: k.unite || "", etat: evaluerSeuil(valeur, k.seuil) };
      } catch (e) {
        return { ...k, base, valeur: "—", unite: "", etat: "ok", erreur: e.message };
      }
    }),
  );
}

async function chargerSocial() {
  const s = reglages.social;
  const base = s && bases[s.base];
  if (!base) return [];
  try {
    const r = await firestore(base.projectId, ":runQuery", corpsListe({ collection: s.collection, tri: "date", max: s.max }));
    return lireListe(r).map((x) => ({
      id: x.id, source: x.source || "autre", de: x.de || "", texte: x.texte || "",
      date: x.date instanceof Date ? x.date : null, important: !!x.important,
    }));
  } catch {
    return [];
  }
}

// ---------- Rendu ----------
function rendreMessages() {
  const el = $("liste-messages");
  if (!etat.messages.length) {
    el.innerHTML = '<li class="vide">Rien d\'important pour le moment.</li>';
    return;
  }
  el.innerHTML = etat.messages
    .map(
      (m, i) => `<li class="${m.nonLu ? "non-lu" : ""}">
        <div class="ligne"><strong>${echapper(m.de)}</strong><span class="meta">${m.date ? jourHeure.format(new Date(m.date)) : ""}</span></div>
        <div>${echapper(m.sujet)}</div>
        <div class="extrait">${echapper(m.extrait)}</div>
        <div class="actions">
          <a href="https://mail.google.com/mail/u/0/#inbox/${m.threadId}" target="_blank" rel="noopener">Ouvrir</a>
          <button data-brouillon="${i}">Brouillon de réponse</button>
        </div></li>`,
    )
    .join("");
  el.querySelectorAll("[data-brouillon]").forEach((b) => b.addEventListener("click", () => ouvrirModeles(Number(b.dataset.brouillon))));
}

function rendreAgenda() {
  const ligne = (e) => `<li><div class="ligne"><strong>${echapper(e.titre)}</strong>
      <span class="meta">${e.toutLeJour ? "Journée entière" : heure.format(e.debut)}</span></div>
      ${e.lieu ? `<div class="extrait">${echapper(e.lieu)}</div>` : ""}</li>`;
  const auj = etat.agenda.aujourdhui;
  $("liste-agenda").innerHTML = auj.length ? auj.map(ligne).join("") : '<li class="vide">Aucun rendez-vous aujourd\'hui.</li>';
  const suite = etat.agenda.aVenir.slice(0, 6);
  $("liste-avenir").innerHTML = suite.length
    ? suite.map((e) => `<li><div class="ligne"><strong>${echapper(e.titre)}</strong><span class="meta">${jourCourt.format(e.debut)}${e.toutLeJour ? "" : " · " + heure.format(e.debut)}</span></div></li>`).join("")
    : '<li class="vide">Rien de prévu dans les prochains jours.</li>';
}

function rendreKpis() {
  if (!etat.kpis.length) {
    $("grille-kpis").innerHTML = '<p class="vide">Aucun indicateur configuré (voir config.js).</p>';
    return;
  }
  const groupes = new Map();
  for (const k of etat.kpis) {
    if (!groupes.has(k.base)) groupes.set(k.base, []);
    groupes.get(k.base).push(k);
  }
  $("grille-kpis").innerHTML = [...groupes.entries()]
    .map(
      ([nom, liste]) => `<h3 class="titre-base">${echapper(nom || "Données")}</h3><div class="kpis">${liste
        .map(
          (k) => `<div class="kpi ${k.erreur ? "erreur" : k.etat !== "ok" ? "alerte" : ""}" ${k.erreur ? `title="${echapper(k.erreur)}"` : ""}>
            <div class="valeur">${echapper(typeof k.valeur === "number" ? k.valeur.toLocaleString("fr-FR") : k.valeur)} <small>${echapper(k.unite)}</small></div>
            <div class="libelle">${echapper(k.label)}</div></div>`,
        )
        .join("")}</div>`,
    )
    .join("");
}

function rendreSocial() {
  const noms = { telegram: "Telegram", whatsapp: "WhatsApp", facebook: "Facebook" };
  const el = $("liste-social");
  if (!etat.social.length) {
    el.innerHTML = '<li class="vide">Aucun message reçu. Branchez Telegram, WhatsApp ou Facebook (voir docs/reseaux-sociaux.md).</li>';
    return;
  }
  el.innerHTML = etat.social
    .map((s) => `<li class="${s.important ? "non-lu" : ""}"><div class="ligne"><strong>${echapper(s.de)}</strong>
      <span class="meta">${echapper(noms[s.source] || s.source)}${s.date ? " · " + jourHeure.format(s.date) : ""}</span></div>
      <div class="extrait">${echapper(s.texte)}</div></li>`)
    .join("");
}

function rendreAlertes() {
  const alertes = construireAlertes({ ...etat });
  $("liste-alertes").innerHTML = alertes.length
    ? alertes.map((a) => `<li class="niveau-${a.niveau}"><span class="pastille"></span>${echapper(a.texte)} <span class="meta">${echapper(a.source)}</span></li>`).join("")
    : '<li class="vide">Aucune alerte. Tout est calme.</li>';
  $("resume").textContent = resumeDuJour({ messages: etat.messages, agenda: etat.agenda, alertes });
}

function tout_rendre() {
  rendreMessages(); rendreAgenda(); rendreKpis(); rendreSocial(); rendreAlertes();
  $("derniere-maj").textContent = `Mis à jour à ${heure.format(new Date())}`;
}

async function tout() {
  afficherErreur("");
  $("resume").textContent = "Chargement…";
  const [gm, ag, kp, so] = await Promise.allSettled([chargerGmail(), chargerAgenda(), chargerKpis(), chargerSocial()]);
  const erreurs = [];
  if (gm.status === "fulfilled") etat.messages = gm.value; else erreurs.push(`Gmail : ${gm.reason.message}`);
  if (ag.status === "fulfilled") etat.agenda = ag.value; else erreurs.push(`Agenda : ${ag.reason.message}`);
  if (kp.status === "fulfilled") etat.kpis = kp.value; else erreurs.push(`Données : ${kp.reason.message}`);
  if (so.status === "fulfilled") etat.social = so.value;
  if (erreurs.length) afficherErreur(erreurs.join(" · "));
  tout_rendre();
}

// ---------- Brouillons de réponse ----------
let messageCible = null;
function ouvrirModeles(index) {
  messageCible = etat.messages[index];
  $("modeles-titre").textContent = `Répondre à ${messageCible.de}`;
  $("modeles-liste").innerHTML = reglages.modeles
    .map((m, i) => `<button data-modele="${i}">${echapper(m.nom)}</button>`)
    .join("");
  $("modeles-liste").querySelectorAll("[data-modele]").forEach((b) => b.addEventListener("click", () => creerBrouillon(Number(b.dataset.modele))));
  $("modeles").showModal();
}
$("modeles-fermer").addEventListener("click", () => $("modeles").close());

async function creerBrouillon(i) {
  const modele = reglages.modeles[i];
  const valeurs = { nom: messageCible.de, sujet: messageCible.sujet };
  const brut = construireBrouillonBrut({
    a: messageCible.deBrut.includes("<") ? messageCible.deBrut.match(/<([^>]+)>/)[1] : messageCible.deBrut,
    sujet: `${modele.sujetPrefixe || ""}${messageCible.sujet}`,
    corps: remplirModele(modele.corps, valeurs),
  });
  try {
    await google("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      body: JSON.stringify({ message: { raw: brut, threadId: messageCible.threadId } }),
    });
    $("modeles").close();
    afficherErreur("");
    $("confirmation").textContent = `Brouillon créé dans Gmail pour ${expediteurLisible(messageCible.deBrut)}. Relisez-le puis envoyez-le.`;
    $("confirmation").hidden = false;
    setTimeout(() => ($("confirmation").hidden = true), 8000);
  } catch (e) {
    $("modeles").close();
    afficherErreur(`Brouillon non créé : ${e.message}`);
  }
}
