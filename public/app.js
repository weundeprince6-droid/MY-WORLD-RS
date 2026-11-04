// app.js — interface My World RS : connexion Google, lecture Gmail/Agenda/Firestore, rendu.
import {
  messagesImportants, repartirAgenda, corpsEvenement, evaluerSeuil, construireAlertes,
  resumeDuJour, remplirModele, construireBrouillonBrut, expediteurLisible, enLots,
} from "./core.js";
import {
  jetonFacebookValide, urlGraph, expliquerErreurFacebook, choisirPages, extraireMessagesConversations,
  dateLaPlusRecente, idDocumentFacebook, champsFirestoreFacebook, CHAMPS_CONVERSATIONS, VERSION_API_PAR_DEFAUT,
} from "./facebook.js";
import {
  jetonValide, urlTelegram, expliquerErreurTelegram, extraireMessage, champsFirestore, idDocument, dernierUpdateId,
} from "./telegram.js";
import {
  corpsAgregation, lireAgregat, corpsListe, lireListe, decoderDocument,
  calculerCreditsAvec, MESURES_CREDITS_AVEC, calculerEse, MESURES_ESE, calculerRistourne, decoderChamps,
} from "./firestore.js";
import { calculerRapport, dessinerRapport } from "./rapport.js";

const $ = (id) => document.getElementById(id);
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  // Ajout et suppression de rendez-vous depuis l'onglet Agenda
  "https://www.googleapis.com/auth/calendar.events",
  // Lecture des bases Firestore avec les droits de VOTRE compte Google (propriétaire des projets)
  "https://www.googleapis.com/auth/datastore",
  // Métadonnées des fichiers et dossiers Google Drive (lecture seule)
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  // Gestion complète des listes et tâches Google Tasks
  "https://www.googleapis.com/auth/tasks",
];

let jetonGoogle = null;
let jetonGoogleExpireA = 0;
let utilisateurConnecte = null;
let uidSessionTraitee = null;
let connexionGoogleEnCours = false;
let recuperationGoogleEnCours = null;
const URL_FONCTIONS_GOOGLE = "https://us-central1-my-world-rs.cloudfunctions.net";
let minuteurSocial = null; // lecture régulière de Telegram tant que la page est ouverte
let fb = null; // composants Firebase, chargés après l'affichage de la page
let etat = { messages: [], recents: [], agenda: { aujourdhui: [], aVenir: [] }, kpis: [], social: [] };
let drivePageToken = null;
let driveRecherche = "";
let driveCharge = false;
let tasksTickerItems = [];
let tasksTickerIndex = 0;
let tasksTickerTimer = null;

// Les boutons réagissent dès le départ, même si Firebase n'est pas encore chargé
$("adresse-page").textContent = location.protocol === "file:"
  ? "Page ouverte comme un fichier local : la connexion Google ne marchera pas (voir le message ci-dessus)."
  : `Domaine de cette page : ${location.hostname} (il doit figurer dans Firebase > Authentication > Paramètres > Domaines autorisés).`;
$("bouton-connexion").addEventListener("click", seConnecter);
$("bouton-deconnexion").addEventListener("click", async () => {
  try {
    if (fb?.auth.currentUser) {
      const idToken = await fb.auth.currentUser.getIdToken();
      await fetch(URL_FONCTIONS_GOOGLE + "/googleRevoke", { method: "POST", headers: { Authorization: "Bearer " + idToken } });
    }
  } catch (e) { console.warn("Révocation Google non confirmée :", e); }
  try { if (fb) await fb.signOut(fb.auth); } catch { /* ignoré */ }
  jetonGoogle = null; jetonGoogleExpireA = 0; utilisateurConnecte = null; uidSessionTraitee = null;
  effacerJetonMemorise();
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
    const auth = authM.getAuth(app);
    fb = { ...authM, auth };
    await authM.setPersistence(auth, authM.browserLocalPersistence);
    authM.onAuthStateChanged(auth, (user) => {
      utilisateurConnecte = user || null;
      if (!user) {
        uidSessionTraitee = null; jetonGoogle = null; jetonGoogleExpireA = 0;
        afficherSession(false);
      } else if (!connexionGoogleEnCours) {
        restaurerSessionGoogle(user).catch((e) => afficherErreur(e.message));
      }
    });
  } catch (e) {
    const erreur = new Error(e?.message || "chargement impossible");
    erreur.code = "sdk-load";
    throw erreur;
  }
})();
sdkPret.catch(() => {});
window.__appPret = true;

function afficherSession(connecte, nom = "") {
  if (connecte) { demarrerSurveillanceSocial(); if (jetonGoogle) chargerTasks(); }
  else { tasksTickerItems = []; actualiserTacheEntete(); if (tasksTickerTimer) clearInterval(tasksTickerTimer); tasksTickerTimer = null; }
  $("zone-connexion").hidden = connecte;
  $("tableau").hidden = !connecte;
  $("bouton-deconnexion").hidden = !connecte;
  $("bouton-actualiser").hidden = !connecte;
  const utilisateurEl = $("utilisateur");
  if (utilisateurEl) {
    if (connecte && utilisateurConnecte?.photoURL) {
      utilisateurEl.innerHTML = `<img class="entete-avatar" src="${echapper(utilisateurConnecte.photoURL)}" alt="Photo de profil">`;
      const nomEl = document.createElement("span");
      nomEl.textContent = nom || utilisateurConnecte.displayName || utilisateurConnecte.email || "";
      utilisateurEl.appendChild(nomEl);
    } else {
      utilisateurEl.textContent = connecte ? nom : "";
    }
  }
  if ($("direct")) $("direct").hidden = !connecte;
}

// ---------- Profil personnel : sauvegarde Firebase par compte Google ----------
let utilisateurProfil = null;
function cleProfil() {
  return utilisateurProfil?.uid ? `my-world-rs-profil-${utilisateurProfil.uid}` : null;
}
function urlProfilFirestore(uid) {
  return urlFirestore(firebaseConfig.projectId, `/users/${encodeURIComponent(uid)}/profile/main`);
}
function champsProfilFirestore(profil) {
  const fields = {};
  for (const key of ["nom", "postnom", "prenom", "naissance", "sexe", "telephone", "adresse", "enregistreLe"]) {
    fields[key] = { stringValue: String(profil[key] || "") };
  }
  fields.emailGoogle = { stringValue: String(utilisateurProfil?.email || "") };
  fields.nomGoogle = { stringValue: String(utilisateurProfil?.nomGoogle || "") };
  return fields;
}
async function lireProfilCloud(uid) {
  const r = await fetch(urlProfilFirestore(uid), {
    headers: { Authorization: `Bearer ${jetonGoogle}`, "Content-Type": "application/json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Firestore (${r.status}) : ${detail.slice(0, 180)}`);
  }
  const doc = await r.json();
  return decoderChamps(doc.fields || {});
}
async function enregistrerProfilCloud(profil) {
  const uid = utilisateurProfil?.uid;
  if (!uid || !jetonGoogle) throw new Error("Connectez-vous à Google avant d'enregistrer.");
  const url = urlProfilFirestore(uid) + "?updateMask.fieldPaths=nom&updateMask.fieldPaths=postnom&updateMask.fieldPaths=prenom&updateMask.fieldPaths=naissance&updateMask.fieldPaths=sexe&updateMask.fieldPaths=telephone&updateMask.fieldPaths=adresse&updateMask.fieldPaths=enregistreLe&updateMask.fieldPaths=emailGoogle&updateMask.fieldPaths=nomGoogle";
  const r = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${jetonGoogle}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: champsProfilFirestore(profil) }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Firestore (${r.status}) : ${detail.slice(0, 220)}`);
  }
  return r.json();
}

function rendreApercuProfil(){
  const form=$("form-profil"),zone=$("profil-apercu");if(!form||!zone)return;
  const labels={nom:"Nom",postnom:"Postnom",prenom:"Prénom",naissance:"Date de naissance",sexe:"Sexe",telephone:"Téléphone",adresse:"Adresse / ville"};
  const values={};
  Object.keys(labels).forEach(k=>{
    let v=form.elements.namedItem(k)?.value?.trim()||"";
    if(k==="sexe")v=({F:"Féminin",M:"Masculin",autre:"Autre / préfère ne pas préciser"})[v]||v;
    if(k==="naissance"&&v){const d=new Date(v+"T12:00:00");if(!Number.isNaN(d.getTime()))v=d.toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"});}
    values[k]=v||"Non renseigné";
  });
  zone.innerHTML='<div class="profil-apercu-grid">'+Object.keys(labels).map(k=>'<div class="profil-apercu-item"><span>'+labels[k]+'</span><strong>'+echapper(values[k])+'</strong></div>').join("")+'</div>';
}
function ouvrirEditionProfil(){
  const f=$("form-profil");if(!f)return;f.hidden=false;$("profil-apercu").hidden=true;$("profil-modifier").hidden=true;
  f.scrollIntoView({behavior:"smooth",block:"start"});
}
function fermerEditionProfil(){
  const f=$("form-profil");if(!f)return;f.hidden=true;$("profil-apercu").hidden=false;$("profil-modifier").hidden=false;rendreApercuProfil();
}
$("profil-modifier")?.addEventListener("click",ouvrirEditionProfil);

async function chargerProfilGoogle(user) {
  utilisateurProfil = {
    uid: user.uid,
    nomGoogle: user.displayName || "",
    email: user.email || "",
    photo: user.photoURL || "",
  };
  const nomEl = $("profil-google-nom"), emailEl = $("profil-google-email"), avatar = $("profil-avatar");
  if (nomEl) nomEl.textContent = utilisateurProfil.nomGoogle || "Compte Google";
  if (emailEl) emailEl.textContent = utilisateurProfil.email;
  if (avatar) {
    avatar.textContent = (utilisateurProfil.nomGoogle || utilisateurProfil.email || "G").trim().charAt(0).toUpperCase();
    if (utilisateurProfil.photo) avatar.innerHTML = `<img src="${echapper(utilisateurProfil.photo)}" alt="Photo Google">`;
  }
  const form = $("form-profil");
  if (!form) return;
  let local = {};
  try { local = JSON.parse(localStorage.getItem(cleProfil()) || "{}"); } catch { local = {}; }
  const parts = (utilisateurProfil.nomGoogle || "").trim().split(/\s+/);
  const defaults = {
    nom: parts.length > 1 ? parts.slice(1).join(" ") : "",
    postnom: "", prenom: parts[0] || "",
    naissance: "", sexe: "", telephone: "", adresse: "",
  };
  let saved = local;
  let cloudOk = false;
  try {
    const cloud = await lireProfilCloud(user.uid);
    if (cloud && cloud.enregistreLe) {
      saved = { ...local, ...cloud };
      cloudOk = true;
      try { localStorage.setItem(cleProfil(), JSON.stringify(saved)); } catch {}
    }
  } catch (e) {
    console.warn("Profil Firebase non chargé, utilisation de la copie locale :", e);
  }
  Object.entries({ ...defaults, ...saved }).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field && typeof value === "string") field.value = value;
  });
  const status = $("profil-status");
  if (status) {
    status.textContent = cloudOk
      ? "Profil synchronisé avec Firebase — disponible sur vos autres appareils."
      : saved.enregistreLe
        ? "Profil local retrouvé. La synchronisation Firebase sera vérifiée à l'enregistrement."
        : "Complétez vos informations puis enregistrez-les dans Firebase.";
  }
  rendreApercuProfil();
  fermerEditionProfil();
  afficherAnniversaireAgenda();
}
$("form-profil")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!utilisateurProfil?.uid) return;
  const form = event.currentTarget;
  const bouton = form.querySelector('button[type="submit"]');
  if (bouton) { bouton.disabled = true; bouton.textContent = "Synchronisation…"; }
  const profil = {};
  ["nom", "postnom", "prenom", "naissance", "sexe", "telephone", "adresse"].forEach((key) => {
    profil[key] = form.elements.namedItem(key)?.value?.trim() || "";
  });
  profil.enregistreLe = new Date().toISOString();
  try {
    await enregistrerProfilCloud(profil);
    try { localStorage.setItem(cleProfil(), JSON.stringify(profil)); } catch {}
    afficherAnniversaireAgenda();
    rendreCalendrierAgenda();
    rendreApercuProfil();
    fermerEditionProfil();
    $("profil-status").textContent = "Profil synchronisé avec Firebase. Vous le retrouverez avec ce compte Google sur vos autres appareils.";
    $("confirmation").textContent = "Votre profil a été enregistré et synchronisé dans Firebase.";
    $("confirmation").hidden = false;
    setTimeout(() => ($("confirmation").hidden = true), 5000);
  } catch (e) {
    try { localStorage.setItem(cleProfil(), JSON.stringify(profil)); } catch {}
    $("profil-status").textContent = "Copie locale enregistrée, mais Firebase n'a pas accepté la synchronisation.";
    afficherErreur("Profil enregistré seulement sur cet appareil. Synchronisation Firebase impossible : " + e.message + ". Vérifiez l'accès Firestore du compte Google.");
  } finally {
    if (bouton) { bouton.disabled = false; bouton.textContent = "Enregistrer mon profil"; }
  }
});

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

async function appelerFonctionGoogle(nom, idToken) {
  const response = await fetch(URL_FONCTIONS_GOOGLE + "/" + nom, {
    method: "POST",
    headers: { Authorization: "Bearer " + idToken, "Content-Type": "application/json" },
  });
  let data = {};
  try { data = await response.json(); } catch { /* réponse non JSON */ }
  if (!response.ok) {
    const error = new Error(data.error || "Service de connexion Google indisponible (" + response.status + ").");
    error.status = response.status;
    error.needsAuthorization = !!data.needsAuthorization;
    throw error;
  }
  return data;
}

async function lancerAutorisationGoogle(user) {
  const idToken = await user.getIdToken(true);
  const data = await appelerFonctionGoogle("googleOAuthStart", idToken);
  if (!data.authorizationUrl) throw new Error("Google n'a pas fourni le lien d'autorisation.");
  window.location.assign(data.authorizationUrl);
}

// ---------- Mémoire du jeton Google (évite de se reconnecter à chaque ouverture) ----------
const CLE_JETON_GOOGLE = "mwrs.google.jeton";
function memoriserJetonGoogle(uid, jeton, expireA) {
  try { localStorage.setItem(CLE_JETON_GOOGLE, JSON.stringify({ uid, jeton, expireA })); } catch { /* stockage indisponible */ }
}
function lireJetonMemorise(uid) {
  try {
    const m = JSON.parse(localStorage.getItem(CLE_JETON_GOOGLE) || "null");
    if (m && m.uid === uid && m.jeton && Date.now() < m.expireA - 60000) return m;
  } catch { /* contenu illisible */ }
  return null;
}
function effacerJetonMemorise() {
  try { localStorage.removeItem(CLE_JETON_GOOGLE); } catch { /* stockage indisponible */ }
}

// Renouvellement silencieux via Google Identity Services : sans fenêtre si vous êtes connecté à Google
// et avez déjà accepté les autorisations. Demande reglages.googleClientId (voir docs/connexion-persistante.md).
let chargementGis = null;
function chargerGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!chargementGis) {
    chargementGis = new Promise((ok, ko) => {
      const el = document.createElement("script");
      el.src = "https://accounts.google.com/gsi/client";
      el.onload = ok;
      el.onerror = () => { chargementGis = null; ko(new Error("Google Identity Services n'a pas pu être chargé.")); };
      document.head.appendChild(el);
    });
  }
  return chargementGis;
}
async function renouvelerJetonSilencieux(email) {
  const clientId = reglages.googleClientId;
  if (!clientId) throw new Error("googleClientId non configuré.");
  await chargerGis();
  return new Promise((ok, ko) => {
    const minuteur = setTimeout(() => ko(new Error("Renouvellement silencieux trop long.")), 15000);
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(" "),
      prompt: "",
      login_hint: email || undefined,
      callback: (r) => { clearTimeout(minuteur); r?.access_token ? ok(r) : ko(new Error(r?.error || "Renouvellement refusé.")); },
      error_callback: (e) => { clearTimeout(minuteur); ko(new Error(e?.type || "Renouvellement impossible.")); },
    });
    client.requestAccessToken();
  });
}

async function obtenirJetonGoogle(force = false) {
  if (!force && jetonGoogle && Date.now() < jetonGoogleExpireA - 60000) return jetonGoogle;
  if (recuperationGoogleEnCours) return recuperationGoogleEnCours;
  recuperationGoogleEnCours = (async () => {
    const user = fb?.auth.currentUser;
    if (!user) throw new Error("Votre session est fermée. Connectez-vous à nouveau.");
    // 1) jeton gardé par ce navigateur, encore valable
    const memorise = lireJetonMemorise(user.uid);
    if (memorise) {
      jetonGoogle = memorise.jeton;
      jetonGoogleExpireA = memorise.expireA;
      return jetonGoogle;
    }
    // 2) renouvellement silencieux (si configuré)
    if (reglages.googleClientId) {
      try {
        const r = await renouvelerJetonSilencieux(user.email);
        jetonGoogle = r.access_token;
        jetonGoogleExpireA = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        memoriserJetonGoogle(user.uid, jetonGoogle, jetonGoogleExpireA);
        return jetonGoogle;
      } catch (e) {
        console.info("Renouvellement silencieux impossible :", e?.message);
      }
    }
    // 3) serveur de renouvellement (fonctions Firebase), s'il est déployé
    const data = await appelerFonctionGoogle("googleAccessToken", await user.getIdToken());
    jetonGoogle = data.accessToken;
    jetonGoogleExpireA = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
    memoriserJetonGoogle(user.uid, jetonGoogle, jetonGoogleExpireA);
    return jetonGoogle;
  })();
  try { return await recuperationGoogleEnCours; }
  finally { recuperationGoogleEnCours = null; }
}

async function restaurerSessionGoogle(user) {
  if (connexionGoogleEnCours || uidSessionTraitee === user.uid) return;
  uidSessionTraitee = user.uid;
  afficherSession(true, user.displayName || user.email);
  const paramsRetour = new URLSearchParams(location.search);
  if (paramsRetour.get("google") === "error" || paramsRetour.get("google") === "cancelled") {
    const message = paramsRetour.get("message");
    history.replaceState({}, document.title, location.pathname + location.hash);
    afficherErreur(paramsRetour.get("google") === "cancelled"
      ? "Autorisation Google annulée. Relancez la connexion pour réessayer."
      : "Autorisation Google impossible : " + (message || "vérifiez la configuration OAuth."));
    return;
  }
  try {
    await obtenirJetonGoogle();
    chargerProfilGoogle(user);
    await tout();
    await chargerWallet(true);
    chargerTasks();
    if (paramsRetour.has("google")) history.replaceState({}, document.title, location.pathname + location.hash);
  } catch (e) {
    uidSessionTraitee = null;
    if (e.needsAuthorization || e.status === 409) {
      afficherErreur("Une autorisation Google unique est nécessaire. Ouverture de la page de confirmation…");
      await lancerAutorisationGoogle(user);
      return;
    }
    afficherSession(false);
    console.info("Session Google non renouvelée :", e?.message);
    throw new Error("Votre accès Google a expiré (il dure 1 heure). Cliquez sur « Se connecter avec Google » : une seule fois suffit.");
  }
}

async function seConnecter() {
  afficherErreur("");
  const bouton = $("bouton-connexion");
  bouton.disabled = true;
  bouton.textContent = "Connexion en cours…";
  connexionGoogleEnCours = true;
  try {
    await sdkPret;
    await fb.setPersistence(fb.auth, fb.browserLocalPersistence);
    const fournisseur = new fb.GoogleAuthProvider();
    SCOPES.forEach((scope) => fournisseur.addScope(scope));
    fournisseur.setCustomParameters({ prompt: "select_account" });
    const resultat = await fb.signInWithPopup(fb.auth, fournisseur);
    utilisateurConnecte = resultat.user;
    const jetonTemporaire = fb.GoogleAuthProvider.credentialFromResult(resultat)?.accessToken || null;
    try {
      await lancerAutorisationGoogle(resultat.user);
    } catch (erreurServeur) {
      if (!jetonTemporaire) throw erreurServeur;
      // Mode de secours : l'application reste utilisable pendant la configuration du serveur OAuth.
      connexionGoogleEnCours = false;
      jetonGoogle = jetonTemporaire;
      jetonGoogleExpireA = Date.now() + 3500 * 1000;
      memoriserJetonGoogle(resultat.user.uid, jetonGoogle, jetonGoogleExpireA);
      afficherSession(true, resultat.user.displayName || resultat.user.email);
      chargerProfilGoogle(resultat.user);
      await tout();
      chargerWallet(true);
      // Situation attendue tant que les fonctions Firebase ne sont pas déployées : simple information, pas une erreur
      console.info("Renouvellement automatique indisponible :", erreurServeur?.message);
      afficherInfo("Connexion active pour environ 1 heure. Pour rester connecté plus longtemps, il faudra déployer les fonctions Firebase (voir la documentation).");
    }
  } catch (e) {
    connexionGoogleEnCours = false;
    if (e?.code !== "auth/cancelled-popup-request") afficherErreur(expliquerErreur(e));
  } finally {
    bouton.disabled = false;
    bouton.textContent = "Se connecter avec Google";
  }
}

// ---------- Utilitaires ----------
function afficherErreur(texte) {
  const bandeau = $("erreur");
  bandeau.classList.remove("info");
  bandeau.textContent = texte;
  bandeau.hidden = !texte;
}
let minuteurInfo = null;
function afficherInfo(texte, duree = 10000) {
  afficherErreur(texte);
  const bandeau = $("erreur");
  bandeau.classList.add("info");
  clearTimeout(minuteurInfo);
  minuteurInfo = setTimeout(() => { if (bandeau.classList.contains("info")) { bandeau.hidden = true; bandeau.classList.remove("info"); } }, duree);
}
function echapper(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const heure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const jourCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const jourHeure = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Appel Google avec un nouvel essai automatique si le quota est momentanément dépassé
async function google(url, options = {}) {
  try {
    return await googleUneFois(url, options);
  } catch (e) {
    if (!e.quota) throw e;
    await new Promise((ok) => setTimeout(ok, 3000));
    return googleUneFois(url, options);
  }
}

async function googleUneFois(url, options = {}, nouvelEssai = true) {
  await obtenirJetonGoogle();
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${jetonGoogle}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (r.status === 401 && nouvelEssai) {
    jetonGoogle = null; jetonGoogleExpireA = 0; effacerJetonMemorise();
    await obtenirJetonGoogle(true);
    return googleUneFois(url, options, false);
  }
  if (r.status === 401) throw new Error("Google a refusé la session. Une nouvelle autorisation est nécessaire.");
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
    const quota = r.status === 429 || /quota exceeded|rate limit|userRateLimitExceeded/i.test(detail);
    if (quota) conseil = " → Google limite temporairement les requêtes. Attendez une minute puis cliquez sur « Actualiser ».";
    const erreur = new Error(`Google a répondu ${r.status}${detail ? " : " + detail : ""}${conseil}`);
    erreur.quota = quota;
    throw erreur;
  }
  if (r.status === 204) return {};
  return r.json();
}

// ---------- Google Drive : consultation des fichiers et dossiers ----------
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
function urlDrive(q, pageToken) {
  const params = new URLSearchParams({
    pageSize: "50",
    orderBy: "folder,name",
    fields: "nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,iconLink,size)",
    q: q || "trashed = false",
  });
  if (pageToken) params.set("pageToken", pageToken);
  return DRIVE_API + "?" + params.toString();
}
function afficherFichiersDrive(fichiers, ajouter = false) {
  const liste = $("drive-fichiers");
  const lignes = fichiers.map((f) => {
    const dossier = f.mimeType === "application/vnd.google-apps.folder";
    const icone = dossier ? "📁" : f.mimeType === "application/pdf" ? "📕" : f.mimeType.includes("spreadsheet") ? "📊" : f.mimeType.includes("document") ? "📄" : "📎";
    const date = f.modifiedTime ? jourHeure.format(new Date(f.modifiedTime)) : "";
    const lien = f.webViewLink || `https://drive.google.com/open?id=${encodeURIComponent(f.id)}`;
    return `<li><div class="drive-file"><span class="drive-file-icon">${icone}</span><div class="drive-file-info"><strong>${echapper(f.name || "Sans nom")}</strong><span class="meta">${dossier ? "Dossier" : "Fichier"} · ${echapper(date)}</span></div><a class="btn btn-light" href="${echapper(lien)}" target="_blank" rel="noopener noreferrer">Ouvrir ↗</a></div></li>`;
  }).join("");
  if (!ajouter) liste.innerHTML = "";
  liste.insertAdjacentHTML("beforeend", lignes);
  if (!liste.children.length) liste.innerHTML = '<li class="vide">Aucun fichier trouvé.</li>';
}
async function chargerDrive({ nouvelleRecherche = false } = {}) {
  if (!jetonGoogle) return;
  if (nouvelleRecherche) drivePageToken = null;
  const statut = $("drive-statut");
  const bouton = $("drive-actualiser");
  statut.textContent = "Chargement de Google Drive…";
  bouton.disabled = true;
  try {
    let q = "trashed = false";
    if (driveRecherche.trim()) q += " and name contains '" + driveRecherche.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    const resultat = await google(urlDrive(q, nouvelleRecherche ? null : drivePageToken));
    afficherFichiersDrive(resultat.files || [], !nouvelleRecherche && Boolean(drivePageToken));
    drivePageToken = resultat.nextPageToken || null;
    $("drive-plus").hidden = !drivePageToken;
    statut.textContent = `${$("drive-fichiers").querySelectorAll("li:not(.vide)").length} fichier(s) affiché(s). Les éléments s'ouvrent dans Google Drive.`;
    driveCharge = true;
  } catch (e) {
    statut.textContent = "Impossible de lire Google Drive : " + e.message;
    $("drive-fichiers").innerHTML = "";
  } finally { bouton.disabled = false; }
}
$("drive-actualiser")?.addEventListener("click", () => chargerDrive({ nouvelleRecherche: true }));
$("drive-plus")?.addEventListener("click", () => chargerDrive());
let driveRechercheTimer = null;
$("drive-recherche")?.addEventListener("input", (event) => {
  driveRecherche = event.target.value;
  clearTimeout(driveRechercheTimer);
  driveRechercheTimer = setTimeout(() => chargerDrive({ nouvelleRecherche: true }), 350);
});
document.querySelector('[data-tab="drive"]')?.addEventListener("click", () => {
  if (!driveCharge) chargerDrive({ nouvelleRecherche: true });
});


// ---------- Google Tasks : gestion complète des listes et tâches ----------
const TASKS_API = "https://tasks.googleapis.com/tasks/v1";
let tasksCharge = false;
function dateTache(date) {
  if (!date) return "Sans échéance";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(d);
}
function actualiserTacheEntete() {
  const zone = $("tasks-entete-texte");
  if (!zone) return;
  if (!tasksTickerItems.length) { zone.textContent = jetonGoogle ? "Aucune tâche à afficher" : "Connectez-vous pour voir vos tâches"; return; }
  const tache = tasksTickerItems[tasksTickerIndex % tasksTickerItems.length];
  zone.textContent = tache.title + (tache.list ? " · " + tache.list : "") + (tache.due ? " · " + dateTache(tache.due) : "");
}
function demarrerDefilementTasks() {
  if (tasksTickerTimer) clearInterval(tasksTickerTimer);
  tasksTickerIndex = 0;
  actualiserTacheEntete();
  tasksTickerTimer = setInterval(() => {
    if (tasksTickerItems.length > 1) tasksTickerIndex = (tasksTickerIndex + 1) % tasksTickerItems.length;
    actualiserTacheEntete();
  }, 20000);
}
function urlListeTasks(id = "") {
  return TASKS_API + "/users/@me/lists" + (id ? "/" + encodeURIComponent(id) : "");
}
function urlTacheTasks(listeId, tacheId = "") {
  return TASKS_API + "/lists/" + encodeURIComponent(listeId) + "/tasks" + (tacheId ? "/" + encodeURIComponent(tacheId) : "");
}
async function chargerTasks() {
  if (!jetonGoogle) return;
  const statut = $("tasks-statut");
  const bouton = $("tasks-actualiser");
  const conteneur = $("tasks-listes");
  statut.textContent = "Chargement de Google Tasks…";
  bouton.disabled = true;
  try {
    const reponseListes = await google(urlListeTasks() + "?maxResults=100");
    const listes = reponseListes.items || [];
    const resultats = await Promise.all(listes.map(async (liste) => {
      const params = new URLSearchParams({ maxResults: "100", showCompleted: "true", showHidden: "true" });
      const reponse = await google(urlTacheTasks(liste.id) + "?" + params.toString());
      return { liste, taches: reponse.items || [] };
    }));
    conteneur.innerHTML = resultats.length ? resultats.map(({ liste, taches }) => {
      const ouvertes = taches.filter((t) => t.status !== "completed").length;
      const lignes = taches.length ? taches.map((t) => {
        const terminee = t.status === "completed";
        const detail = terminee ? "Terminée" : (t.due ? "Échéance : " + dateTache(t.due) : "À faire");
        return '<li class="task-ligne"><div class="task-contenu"><label class="task-case"><input type="checkbox" data-task-action="toggle" data-list-id="' + echapper(liste.id) + '" data-task-id="' + echapper(t.id) + '"' + (terminee ? " checked" : "") + ' aria-label="Marquer comme ' + (terminee ? "à faire" : "terminée") + '"></label><div class="drive-file-info"><strong' + (terminee ? ' class="task-complete"' : "") + '>' + echapper(t.title || "Tâche sans titre") + '</strong><span class="meta">' + echapper(detail) + (t.notes ? " · " + echapper(t.notes) : "") + '</span></div></div><div class="task-actions"><button type="button" class="btn btn-light" data-task-action="edit" data-list-id="' + echapper(liste.id) + '" data-task-id="' + echapper(t.id) + '" data-title="' + echapper(t.title || "") + '" data-notes="' + echapper(t.notes || "") + '" data-due="' + echapper(t.due ? t.due.slice(0,10) : "") + '">Modifier</button><button type="button" class="btn btn-light task-delete" data-task-action="delete" data-list-id="' + echapper(liste.id) + '" data-task-id="' + echapper(t.id) + '">Supprimer</button></div></li>';
      }).join("") : '<li class="vide">Aucune tâche dans cette liste.</li>';
      return '<section class="tasks-groupe" data-list-id="' + echapper(liste.id) + '"><div class="card-heading"><div><h3>' + echapper(liste.title || "Liste sans titre") + '</h3><span class="meta">' + ouvertes + ' à faire · ' + taches.length + ' au total</span></div><div class="task-actions"><button type="button" class="btn btn-light" data-task-action="rename-list" data-list-id="' + echapper(liste.id) + '" data-title="' + echapper(liste.title || "") + '">Renommer</button><button type="button" class="btn btn-light task-delete" data-task-action="delete-list" data-list-id="' + echapper(liste.id) + '">Supprimer la liste</button></div></div><ul class="liste task-liste">' + lignes + '</ul><form class="task-ajout" data-task-form="add" data-list-id="' + echapper(liste.id) + '"><input name="title" required maxlength="1024" placeholder="Nouvelle tâche…" aria-label="Titre de la tâche"><input name="due" type="date" aria-label="Date d’échéance"><input name="notes" placeholder="Notes (facultatif)" aria-label="Notes"><button class="btn btn-primary" type="submit">Ajouter</button></form></section>';
    }).join("") : '<p class="vide">Aucune liste Google Tasks trouvée. Créez votre première liste ci-dessus.</p>';
    tasksTickerItems = resultats.flatMap(({ liste, taches }) => taches.filter(t => t.status !== "completed").map(t => ({ title: t.title || "Tâche sans titre", list: liste.title || "", due: t.due || "" })));
    demarrerDefilementTasks();
    const total = resultats.reduce((n, r) => n + r.taches.length, 0);
    statut.textContent = listes.length + " liste(s) chargée(s), " + total + " tâche(s). Les modifications sont synchronisées avec Google.";
    tasksCharge = true;
    rendreDashboard();
  } catch (e) {
    statut.textContent = "Impossible de charger Google Tasks : " + e.message;
    conteneur.innerHTML = "";
  } finally { bouton.disabled = false; }
}
function dateApiTasks(date) {
  return date ? date + "T00:00:00.000Z" : null;
}
async function actionTasks(action, element) {
  const listeId = element.dataset.listId;
  const taskId = element.dataset.taskId;
  if (action === "toggle") {
    const terminee = element.checked;
    await google(urlTacheTasks(listeId, taskId), {
      method: "PATCH",
      body: JSON.stringify(terminee
        ? { status: "completed", completed: new Date().toISOString() }
        : { status: "needsAction", completed: null }),
    });
  } else if (action === "edit") {
    const titre = prompt("Titre de la tâche :", element.dataset.title || "");
    if (titre === null) return;
    if (!titre.trim()) { alert("Le titre ne peut pas être vide."); return; }
    const notes = prompt("Notes de la tâche :", element.dataset.notes || "");
    if (notes === null) return;
    const due = prompt("Date d’échéance (AAAA-MM-JJ), laisser vide pour aucune :", element.dataset.due || "");
    if (due === null) return;
    await google(urlTacheTasks(listeId, taskId), {
      method: "PATCH",
      body: JSON.stringify({ title: titre.trim(), notes: notes.trim(), due: dateApiTasks(due.trim()) }),
    });
  } else if (action === "delete") {
    if (!confirm("Supprimer définitivement cette tâche Google Tasks ?")) return;
    await google(urlTacheTasks(listeId, taskId), { method: "DELETE" });
  } else if (action === "rename-list") {
    const titre = prompt("Nouveau nom de la liste :", element.dataset.title || "");
    if (titre === null) return;
    if (!titre.trim()) { alert("Le nom ne peut pas être vide."); return; }
    await google(urlListeTasks(listeId), { method: "PATCH", body: JSON.stringify({ title: titre.trim() }) });
  } else if (action === "delete-list") {
    if (!confirm("Supprimer cette liste et toutes les tâches qu’elle contient ? Cette action est définitive.")) return;
    await google(urlListeTasks(listeId), { method: "DELETE" });
  }
  await chargerTasks();
}
$("tasks-actualiser")?.addEventListener("click", chargerTasks);
$("tasks-listes")?.addEventListener("change", async (event) => {
  const el = event.target.closest('[data-task-action="toggle"]');
  if (!el) return;
  try { await actionTasks("toggle", el); }
  catch (e) { el.checked = !el.checked; afficherErreur("Modification de la tâche impossible : " + e.message); }
});
$("tasks-listes")?.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-task-action]");
  if (!el || el.dataset.taskAction === "toggle") return;
  try { await actionTasks(el.dataset.taskAction, el); }
  catch (e) { afficherErreur("Action Google Tasks impossible : " + e.message); }
});
$("tasks-listes")?.addEventListener("submit", async (event) => {
  const form = event.target.closest('[data-task-form="add"]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const titre = String(data.get("title") || "").trim();
  if (!titre) return;
  const bouton = form.querySelector('button[type="submit"]');
  bouton.disabled = true;
  try {
    const payload = { title: titre };
    const notes = String(data.get("notes") || "").trim();
    const due = String(data.get("due") || "");
    if (notes) payload.notes = notes;
    if (due) payload.due = dateApiTasks(due);
    await google(urlTacheTasks(form.dataset.listId), { method: "POST", body: JSON.stringify(payload) });
    await chargerTasks();
  } catch (e) {
    afficherErreur("Création de la tâche impossible : " + e.message);
    bouton.disabled = false;
  }
});
$("tasks-creer-liste")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const champ = form.elements.namedItem("title");
  const titre = champ.value.trim();
  if (!titre) return;
  const bouton = form.querySelector('button[type="submit"]');
  bouton.disabled = true;
  try {
    await google(urlListeTasks(), { method: "POST", body: JSON.stringify({ title: titre }) });
    champ.value = "";
    await chargerTasks();
  } catch (e) {
    afficherErreur("Création de la liste impossible : " + e.message);
  } finally { bouton.disabled = false; }
});
document.querySelector('[data-tab="tasks"]')?.addEventListener("click", () => {
  if (!tasksCharge) chargerTasks();
});

// ---------- Sources ----------
async function chargerGmail() {
  const g = reglages.gmail;
  const liste = await google(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${g.maxMessages}&q=${encodeURIComponent(g.requete)}`,
  );
  const ids = (liste.messages || []).map((m) => m.id);
  // 4 lectures à la fois : Gmail limite le nombre de requêtes par minute
  const complets = await enLots(ids, 4, (id) =>
    google(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    ),
  );
  const options = { contactsVip: g.contactsVip, motsImportants: g.motsImportants };
  return {
    importants: messagesImportants(complets, { ...options, seuil: g.seuilImportance }),
    // Boîte de réception : tous les messages récents, du plus récent au plus ancien
    recents: messagesImportants(complets, { ...options, seuil: -100, max: 100 }).sort((a, b) => b.date - a.date),
  };
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

// Date du jour dans le fuseau de l'ordinateur (AAAA-MM-JJ), comme le font les applications
function aujourdhuiLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Un document précis (ex. « cfg/main »), mis en cache le temps d'une actualisation
function unDocument(projectId, chemin) {
  const cle = `${projectId}/doc/${chemin}`;
  if (!cacheDocuments.has(cle)) {
    cacheDocuments.set(cle, firestore(projectId, `/${chemin}`).then(decoderDocument));
  }
  return cacheDocuments.get(cle);
}

// ESE DB : lecture économe pour l'actualisation automatique (le quota gratuit Firestore est de 50 000 lectures par jour).
// Tous les jours sont lus en entier au chargement puis toutes les 10 minutes ; entre-temps, seul le document du jour est relu.
const magasinJoursEse = new Map(); // projectId -> { docs: Map, complet: ms, memo }
async function lireJoursEse(projectId) {
  let m = magasinJoursEse.get(projectId);
  if (!m) { m = { docs: new Map(), complet: 0, memo: null, cfg: null }; magasinJoursEse.set(projectId, m); }
  if (m.memo && Date.now() - m.memo.t < 1500) return m.memo.p;
  const p = (async () => {
    if (!m.docs.size || Date.now() - m.complet > 600000) {
      cacheDocuments.delete(`${projectId}/days`);
      const docs = await tousLesDocuments(projectId, "days");
      m.docs = new Map(docs.map((d) => [d.id, d]));
      m.complet = Date.now();
    } else {
      const iso = aujourdhuiLocal();
      try {
        const d = decoderDocument(await firestore(projectId, `/days/${iso}`));
        m.docs.set(d.id || iso, d);
      } catch (e) {
        if (!/404|NOT_FOUND|not found/i.test(e.message || "")) throw e; // pas encore de vente aujourd'hui
      }
    }
    return [...m.docs.values()];
  })();
  m.memo = { t: Date.now(), p };
  p.catch(() => { if (m.memo && m.memo.p === p) m.memo = null; });
  return p;
}
// cfg/main change rarement : relu au plus toutes les 10 secondes
function lireCfgEse(projectId) {
  let m = magasinJoursEse.get(projectId);
  if (!m) { m = { docs: new Map(), complet: 0, memo: null, cfg: null }; magasinJoursEse.set(projectId, m); }
  if (!m.cfg || Date.now() - m.cfg.t > 10000) {
    const p = firestore(projectId, "/cfg/main").then(decoderDocument).catch(() => ({}));
    m.cfg = { t: Date.now(), p };
  }
  return m.cfg.p;
}
function oublierCachesEse() { magasinJoursEse.forEach((m) => { m.complet = 0; m.memo = null; m.cfg = null; }); }

async function valeurKpi(k) {
  const base = bases[k.base];
  if (!base) throw new Error(`Base inconnue : ${k.base}`);
  if (k.op === "avec_credits") {
    const membres = await tousLesDocuments(base.projectId, "members");
    const mesure = MESURES_CREDITS_AVEC[k.mesure];
    if (!mesure) throw new Error(`Mesure inconnue : ${k.mesure}`);
    return mesure(calculerCreditsAvec(membres, aujourdhuiLocal()));
  }
  if (k.op === "ese") {
    const mesure = MESURES_ESE[k.mesure];
    if (!mesure) throw new Error(`Mesure inconnue : ${k.mesure}`);
    const [jours, cfg] = await Promise.all([lireJoursEse(base.projectId), lireCfgEse(base.projectId)]);
    return mesure(calculerEse(jours, cfg, aujourdhuiLocal()));
  }
  const reponse = await firestore(base.projectId, ":runAggregationQuery", corpsAgregation(k));
  return lireAgregat(reponse);
}

async function chargerKpis(filtre = null) {
  if (!filtre) cacheDocuments = new Map();
  return Promise.all(
    reglages.kpis.map(async (k, i) => {
      if (filtre && !filtre(k) && etat.kpis[i]) return etat.kpis[i]; // indicateur non concerné : valeur conservée
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
function ligneMessage(m, i, avecBrouillon) {
  return `<li class="${m.nonLu ? "non-lu" : ""}">
        <div class="ligne"><strong>${echapper(m.de)}</strong><span class="meta">${m.date ? jourHeure.format(new Date(m.date)) : ""}</span></div>
        <div>${echapper(m.sujet)}</div>
        <div class="extrait">${echapper(m.extrait)}</div>
        <div class="actions">
          <a href="https://mail.google.com/mail/u/0/#inbox/${m.threadId}" target="_blank" rel="noopener">Ouvrir</a>
          ${avecBrouillon ? `<button data-brouillon="${i}">Brouillon de réponse</button>` : ""}
        </div></li>`;
}

function rendreMessages() {
  const el = $("liste-messages");
  if (!etat.messages.length) {
    el.innerHTML = '<li class="vide">Rien d\'important pour le moment.</li>';
  } else {
    el.innerHTML = etat.messages.map((m, i) => ligneMessage(m, i, true)).join("");
    el.querySelectorAll("[data-brouillon]").forEach((b) => b.addEventListener("click", () => ouvrirModeles(Number(b.dataset.brouillon))));
  }
  const rec = $("liste-recents");
  if (rec) {
    rec.innerHTML = etat.recents.length
      ? etat.recents.map((m, i) => ligneMessage(m, i, false)).join("")
      : '<li class="vide">Aucun message récent dans la boîte de réception.</li>';
  }
}

let agendaMoisAffiche = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
function rendreCalendrierAgenda() {
  const grille = $("agenda-calendrier");
  if (!grille) return;
  const annee = agendaMoisAffiche.getFullYear(), mois = agendaMoisAffiche.getMonth();
  $("agenda-mois-titre").textContent = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(agendaMoisAffiche);
  const premier = new Date(annee, mois, 1), decalage = (premier.getDay()+6)%7, nbJours = new Date(annee, mois+1, 0).getDate();
  const selection = $("agenda-form").elements.date.value;
  const auj = new Date(), keyAuj = [auj.getFullYear(),String(auj.getMonth()+1).padStart(2,"0"),String(auj.getDate()).padStart(2,"0")].join("-");
  let html = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map(n=>'<div class="agenda-cal-jour agenda-cal-entete">'+n+'</div>').join("");
  for(let i=0;i<decalage;i++) html += '<div class="agenda-cal-jour agenda-cal-vide"></div>';
  for(let d=1;d<=nbJours;d++){
    const key=[annee,String(mois+1).padStart(2,"0"),String(d).padStart(2,"0")].join("-");
    const naissance=obtenirDateNaissanceProfil();
    const cls=["agenda-cal-jour","agenda-cal-case"];
    if(naissance && key.slice(5)===naissance.slice(5)) cls.push("agenda-cal-anniversaire");
    if(key===keyAuj) cls.push("agenda-cal-aujourdhui");
    if(key===selection) cls.push("agenda-cal-selection");
    html += '<button type="button" class="'+cls.join(" ")+'" data-agenda-date="'+key+'"'+(naissance&&key.slice(5)===naissance.slice(5)?' title="Anniversaire 🎂"':'')+'>'+d+'</button>';
  }
  grille.innerHTML=html;
  grille.querySelectorAll("[data-agenda-date]").forEach(btn=>btn.addEventListener("click",()=>{
    $("agenda-form").elements.date.value=btn.dataset.agendaDate;
    const d=new Date(btn.dataset.agendaDate+"T12:00:00");
    agendaMoisAffiche=new Date(d.getFullYear(),d.getMonth(),1);
    rendreCalendrierAgenda();
  }));
}
$("agenda-mois-precedent").addEventListener("click",()=>{agendaMoisAffiche=new Date(agendaMoisAffiche.getFullYear(),agendaMoisAffiche.getMonth()-1,1);rendreCalendrierAgenda();});
$("agenda-mois-suivant").addEventListener("click",()=>{agendaMoisAffiche=new Date(agendaMoisAffiche.getFullYear(),agendaMoisAffiche.getMonth()+1,1);rendreCalendrierAgenda();});
$("agenda-form").elements.date.addEventListener("change",rendreCalendrierAgenda);


// ---------- Anniversaire personnel : date du profil + compte à rebours ----------
function obtenirDateNaissanceProfil(){
  let profil={};
  try{profil=JSON.parse(localStorage.getItem(cleProfil())||"{}");}catch{}
  const date=profil.naissance||$("form-profil")?.elements.namedItem("naissance")?.value||"";
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:"";
}
function dateAnniversairePourAnnee(naissance,annee){
  const mois=Number(naissance.slice(5,7)),jour=Number(naissance.slice(8,10));
  // Pour une naissance le 29 février, célébration le 28 février les années non bissextiles.
  if(mois===2&&jour===29&&new Date(annee,1,29).getDate()!==29)return new Date(annee,1,28);
  return new Date(annee,mois-1,jour);
}
function afficherAnniversaireAgenda(){
  const box=$("agenda-anniversaire");
  if(!box)return;
  const naissance=obtenirDateNaissanceProfil();
  const dateEl=$("agenda-anniversaire-date"), compteEl=$("agenda-anniversaire-compte"), detailEl=$("agenda-anniversaire-detail");
  if(!naissance){
    box.hidden=false;
    if(dateEl)dateEl.textContent="Date de naissance non renseignée";
    if(compteEl)compteEl.textContent="—";
    if(detailEl)detailEl.textContent="Ajoutez votre date de naissance dans l’onglet Profil pour afficher votre anniversaire.";
    return;
  }
  const [anneeN,moisN,jourN]=naissance.split("-").map(Number);
  const today=new Date();today.setHours(0,0,0,0);
  let prochain=dateAnniversairePourAnnee(naissance,today.getFullYear());
  if(prochain<today)prochain=dateAnniversairePourAnnee(naissance,today.getFullYear()+1);
  const days=Math.round((prochain-today)/86400000);
  const dateTexte=new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"long"}).format(new Date(2000,moisN-1,jourN));
  const prochainTexte=new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(prochain);
  const age=prochain.getFullYear()-anneeN;
  box.hidden=false;
  if(dateEl)dateEl.textContent="🎂 "+dateTexte;
  if(compteEl)compteEl.textContent=days===0?"C’est aujourd’hui !":days===1?"Demain !":days+" jours";
  if(detailEl)detailEl.textContent=days===0?"Joyeux anniversaire !": "Prochain anniversaire : "+prochainTexte+" · Vous aurez "+age+" ans.";
}

function rendreAgenda() {
  const ligne = (e) => '<li><div class="ligne"><strong>'+echapper(e.titre)+'</strong><span class="meta">'+(e.toutLeJour ? "Journée entière" : heure.format(e.debut))+'</span></div>'+(e.lieu ? '<div class="extrait">'+echapper(e.lieu)+'</div>' : '')+'<div class="actions"><button type="button" data-modifier-evenement="'+echapper(e.id)+'">Modifier</button><button type="button" data-supprimer-evenement="'+echapper(e.id)+'">Supprimer</button></div></li>';
  const auj = etat.agenda.aujourdhui.slice(0,2);
  $("liste-agenda").innerHTML = auj.length ? auj.map(ligne).join("") : '<li class="vide">Aucun rendez-vous aujourd’hui.</li>';
  const suite = etat.agenda.aVenir.slice(0,2);
  $("liste-avenir").innerHTML = suite.length ? suite.map(e=>'<li><div class="ligne"><strong>'+echapper(e.titre)+'</strong><span class="meta">'+jourCourt.format(e.debut)+(e.toutLeJour ? "" : " · "+heure.format(e.debut))+'</span></div><div class="actions"><button type="button" data-modifier-evenement="'+echapper(e.id)+'">Modifier</button><button type="button" data-supprimer-evenement="'+echapper(e.id)+'">Supprimer</button></div></li>').join("") : '<li class="vide">Rien de prévu dans les prochains jours.</li>';
  rendreCalendrierAgenda();
}
// ---------- Agenda : ajouter et supprimer des rendez-vous ----------

let agendaEvenementEnEdition=null;
function ouvrirFormAgenda(e=null){
  const card=$("agenda-editor-card"),f=$("agenda-form");if(!card||!f)return;
  agendaEvenementEnEdition=e?.id||null;
  f.reset();
  f.elements.titre.value=e?.titre||"";
  f.elements.date.value=e?.date||"";
  f.elements.debut.value=e?.debutHeure||"";
  f.elements.fin.value=e?.finHeure||"";
  f.elements.lieu.value=e?.lieu||"";
  f.elements.description.value=e?.description||"";
  f.elements.toutlejour.checked=!!e?.toutLeJour;
  $("agenda-heures").hidden=!!e?.toutLeJour;
  $("agenda-form-title").textContent=e?"Modifier le rendez-vous":"Nouveau rendez-vous";
  $("agenda-ajouter").textContent=e?"Enregistrer les modifications":"Ajouter à Google Agenda";
  card.hidden=false;
  card.scrollIntoView({behavior:"smooth",block:"start"});
}
$("agenda-nouveau")?.addEventListener("click",()=>ouvrirFormAgenda());
$("agenda-annuler")?.addEventListener("click",()=>{
  agendaEvenementEnEdition=null;
  $("agenda-editor-card").hidden=true;
  $("agenda-form").reset();
  $("agenda-heures").hidden=false;
});

function retourAgenda(texte, erreur = false) {
  const el = $("agenda-retour");
  el.textContent = texte;
  el.classList.toggle("erreur", erreur);
}
function expliquerErreurAgenda(e) {
  if (/insufficient|permission|scope|403/i.test(e?.message || "")) {
    effacerJetonMemorise();
    return "Google n'a pas encore l'autorisation de modifier votre agenda. Cliquez sur « Déconnexion », puis « Se connecter avec Google » et acceptez l'autorisation Agenda.";
  }
  return e?.message || "Impossible de modifier l'agenda.";
}
$("agenda-toutlejour").addEventListener("change", (ev) => {
  $("agenda-heures").hidden = ev.target.checked;
});
$("agenda-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const bouton = $("agenda-ajouter");
  try {
    const corps = corpsEvenement({
      titre: f.titre.value, date: f.date.value, debut: f.debut.value, fin: f.fin.value,
      toutLeJour: f.toutlejour.checked, lieu: f.lieu.value, description: f.description.value,
    }, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    bouton.disabled = true;
    retourAgenda(agendaEvenementEnEdition?"Modification en cours…":"Ajout en cours…");
    const urlAgenda=agendaEvenementEnEdition?`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(agendaEvenementEnEdition)}`:"https://www.googleapis.com/calendar/v3/calendars/primary/events";
    await google(urlAgenda, { method: agendaEvenementEnEdition?"PATCH":"POST", body: JSON.stringify(corps) });
    agendaEvenementEnEdition=null;$("agenda-editor-card").hidden=true;
    f.reset();
    $("agenda-heures").hidden = false;
    retourAgenda("Rendez-vous enregistré dans Google Agenda.");
    etat.agenda = await chargerAgenda();
    tout_rendre();
  } catch (e) {
    retourAgenda(expliquerErreurAgenda(e), true);
  } finally {
    bouton.disabled = false;
  }
});
document.addEventListener("click", async (ev) => {
  const edit=ev.target.closest?.("[data-modifier-evenement]");
  if(edit){const e=[...etat.agenda.aujourdhui,...etat.agenda.aVenir].find(x=>x.id===edit.dataset.modifierEvenement);if(e){const d=e.debut;const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;const fmt=t=>`${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;ouvrirFormAgenda({...e,date,debutHeure:e.toutLeJour?"":fmt(d),finHeure:e.toutLeJour?"":fmt(e.fin)});}return;}
  const b = ev.target.closest?.("[data-supprimer-evenement]");
  if (!b) return;
  if (!confirm("Supprimer ce rendez-vous de Google Agenda ?")) return;
  try {
    await google(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(b.dataset.supprimerEvenement)}`, { method: "DELETE" });
    retourAgenda("Rendez-vous supprimé.");
    etat.agenda = await chargerAgenda();
    tout_rendre();
  } catch (e) {
    retourAgenda(expliquerErreurAgenda(e), true);
  }
});

function rendreKpis() {
  if (!etat.kpis.length) {
    $("grille-kpis").innerHTML = '<p class="vide">Aucun indicateur configuré (voir config.js).</p>';
    return;
  }
  const groupes = new Map();
  for (const k of etat.kpis.filter((x) => !(x.masquerSiZero && x.valeur === 0))) {
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
    el.innerHTML = '<li class="vide">Aucun message reçu. Connectez Telegram ou Facebook dans les cartes ci-dessus (WhatsApp : voir docs/reseaux-sociaux.md).</li>';
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
  if(typeof resumeRotatifItems==="undefined") $("resume").textContent = resumeDuJour({ messages: etat.messages, agenda: etat.agenda, alertes });
  else afficherResumeRotatif(resumeRotatifIndex);
}




/* Résumé rotatif du tableau de bord : change de section toutes les 30 secondes */
const resumeRotatifItems=[
 {titre:"Vue d’ensemble",texte:()=>resumeDuJour({messages:etat.messages,agenda:etat.agenda,alertes:construireAlertes({...etat})})},
 {titre:"Agenda",texte:()=>{const n=(etat.agenda.aujourdhui||[]).length+(etat.agenda.aVenir||[]).length;return n? n+" rendez-vous aujourd’hui et à venir.":"Aucun rendez-vous aujourd’hui ou à venir.";}},
 {titre:"Notes & Projets",texte:()=>{const n=typeof notesItems!=="undefined"?notesItems.length:0;const p=typeof notesItems!=="undefined"?notesItems.filter(x=>x.type==="project").length:0;return n+" notes et projets enregistrés, dont "+p+" projet(s).";}},
 {titre:"Profil",texte:()=>{const f=$("form-profil");const nom=f?[f.elements.nom?.value,f.elements.prenom?.value].filter(Boolean).join(" "):"";return nom?"Profil de "+nom+".":"Votre profil personnel est disponible à consulter et modifier.";}},
 {titre:"Porte-monnaie",texte:()=>{const s=$("wallet-personal-usd")?.textContent||"";return s&&s!=="0 USD"?"Solde personnel : "+s+".":"Consultez vos soldes et opérations dans le porte-monnaie.";}},
 {titre:"Messages",texte:()=>etat.messages.length?etat.messages.length+" message(s) important(s) à consulter.":"Aucun message important pour le moment."}
];
let resumeRotatifIndex=0,resumeRotatifTimer=null;
function afficherResumeRotatif(index){
 const zone=$("resume"),label=document.querySelector(".resume-jour .summary-label");
 if(!zone||!resumeRotatifItems.length)return;
 resumeRotatifIndex=(index+resumeRotatifItems.length)%resumeRotatifItems.length;
 const item=resumeRotatifItems[resumeRotatifIndex];
 if(label)label.textContent="RÉSUMÉ · "+item.titre.toLocaleUpperCase("fr-FR");
 zone.textContent=item.texte();
 zone.classList.remove("resume-rotation-entree");
 void zone.offsetWidth;
 zone.classList.add("resume-rotation-entree");
}
function demarrerResumeRotatif(){
 if(resumeRotatifTimer)clearInterval(resumeRotatifTimer);
 afficherResumeRotatif(resumeRotatifIndex);
 resumeRotatifTimer=setInterval(()=>afficherResumeRotatif(resumeRotatifIndex+1),30000);
}

// ---------- Résumé synthétique du tableau de bord ----------
function rendreDashboard() {
  const el = (id) => $(id);
  if (!el("dash-messages")) return;
  el("dash-messages").textContent = etat.messages.length.toLocaleString("fr-FR");
  el("dash-messages-note").textContent = etat.messages.length ? "À consulter en priorité" : "Aucun message important";
  el("dash-agenda").textContent = etat.agenda.aujourdhui.length.toLocaleString("fr-FR");
  el("dash-agenda-note").textContent = etat.agenda.aVenir.length + " rendez-vous à venir";
  const kpisOk = etat.kpis.filter(k => !k.erreur && k.valeur !== "—");
  el("dash-kpis").textContent = kpisOk.length.toLocaleString("fr-FR");
  el("dash-kpis-note").textContent = etat.kpis.some(k => k.erreur) ? "Certaines données sont indisponibles" : "AVEC LA SAGESSE · ESE DB";
  el("dash-social").textContent = etat.social.length.toLocaleString("fr-FR");
  el("dash-social-note").textContent = etat.social.length ? "Messages enregistrés" : "Aucun nouveau message";
  el("dash-tasks").textContent = tasksCharge ? tasksTickerItems.length.toLocaleString("fr-FR") : "—";
  el("dash-tasks-note").textContent = tasksCharge ? "Tâches non terminées" : "Ouvrez Google Tasks pour charger";

  const kpis = kpisOk.filter(k => !(k.masquerSiZero && k.valeur === 0)).slice(0, 6);
  el("dashboard-kpis").innerHTML = kpis.length ? kpis.map(k =>
    '<div class="dashboard-kpi-row"><div><strong>' + echapper(k.label) + '</strong><span>' + echapper(k.base || "Données") + '</span></div><b>' +
    echapper(typeof k.valeur === "number" ? k.valeur.toLocaleString("fr-FR") : k.valeur) + ' <small>' + echapper(k.unite || "") + '</small></b></div>'
  ).join("") : '<p class="vide">Aucun indicateur disponible pour le moment.</p>';

  const prochains = etat.agenda.aVenir.slice(0, 5);
  el("dashboard-agenda").innerHTML = prochains.length ? prochains.map(e =>
    '<li><div class="ligne"><strong>' + echapper(e.titre) + '</strong><span class="meta">' + jourCourt.format(e.debut) + (e.toutLeJour ? "" : " · " + heure.format(e.debut)) + '</span></div>' +
    (e.lieu ? '<div class="extrait">' + echapper(e.lieu) + '</div>' : '') + '</li>'
  ).join("") : '<li class="vide">Aucun rendez-vous à venir.</li>';

  const mails = etat.recents.slice(0, 3);
  const social = etat.social.slice(0, 2);
  const activites = [
    ...mails.map(m => ({ type:"Gmail", nom:m.de, texte:m.sujet, date:m.date })),
    ...social.map(s => ({ type:s.source || "Réseau social", nom:s.de, texte:s.texte, date:s.date })),
  ].sort((a,b) => (b.date?.getTime?.() || 0) - (a.date?.getTime?.() || 0)).slice(0,5);
  el("dashboard-activity").innerHTML = activites.length ? activites.map(a =>
    '<li><div class="ligne"><strong>' + echapper(a.nom || "Message") + '</strong><span class="meta">' + echapper(a.type) + '</span></div><div class="extrait">' + echapper(a.texte || "Sans objet") + '</div></li>'
  ).join("") : '<li class="vide">Aucun message récent à afficher.</li>';
}

function tout_rendre() {
  rendreMessages(); rendreAgenda(); rendreKpis(); rendreSocial(); rendreAlertes(); rendreDashboard();
  if(typeof demarrerResumeRotatif==="function") demarrerResumeRotatif();
  $("derniere-maj").textContent = `Mis à jour à ${heure.format(new Date())}`;
}

async function tout() {
  oublierCachesEse();
  afficherErreur("");
  $("resume").textContent = "Chargement…";
  const [gm, ag, kp, so] = await Promise.allSettled([chargerGmail(), chargerAgenda(), chargerKpis(), chargerSocialComplet()]);
  const erreurs = [];
  if (gm.status === "fulfilled") { etat.messages = gm.value.importants; etat.recents = gm.value.recents; } else erreurs.push(`Gmail : ${gm.reason.message}`);
  if (ag.status === "fulfilled") etat.agenda = ag.value; else erreurs.push(`Agenda : ${ag.reason.message}`);
  if (kp.status === "fulfilled") etat.kpis = kp.value; else erreurs.push(`Données : ${kp.reason.message}`);
  if (so.status === "fulfilled") etat.social = so.value;
  if (erreurs.length) afficherErreur(erreurs.join(" · "));
  tout_rendre();
  chargerRistourne();
}

// ---------- Mon Porte-Monnaie : données privées par utilisateur Firebase ----------
let walletAccounts = [];
let walletTransactions = [];
let walletLoaded = false;
const walletMoney = (n, currency) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(n || 0)) + " " + currency;
// Prévisions à 30 jours par compte, d'après les mouvements des 90 derniers jours (transferts exclus)
function walletRenderForecasts() {
  const zone = $("wallet-forecasts"), select = $("wallet-forecast-account"), next = $("wallet-forecast-next");
  if (!zone || !select) return;
  const previous = select.value;
  select.innerHTML = walletAccounts.map(a => `<option value="${echapper(a.id)}">${echapper(a.name)} — ${echapper(a.currency)} (${a.type === "personal" ? "Personnel" : "Professionnel"})</option>`).join("");
  if (!walletAccounts.length) {
    select.innerHTML = '<option value="">Aucun compte disponible</option>';
    zone.innerHTML = '<p class="vide">Créez un compte et enregistrez quelques mouvements pour afficher les prévisions.</p>';
    if (next) next.disabled = true;
    return;
  }
  select.value = walletAccounts.some(a => a.id === previous) ? previous : walletAccounts[0].id;
  if (next) next.disabled = walletAccounts.length < 2;
  select.onchange = () => walletRenderForecasts();
  if (next) next.onclick = () => {
    const index = walletAccounts.findIndex(a => a.id === select.value);
    select.value = walletAccounts[(index + 1) % walletAccounts.length].id;
    walletRenderForecasts();
  };
  const a = walletAccounts.find(x => x.id === select.value) || walletAccounts[0];
  const jour = 86400000, debut = new Date(Date.now() - 90 * jour).toISOString().slice(0, 10);
  const tx = walletTransactions.filter(t => t.accountId === a.id && t.kind !== "transfer" && String(t.date || "") >= debut);
  const somme = k => tx.filter(t => t.kind === k).reduce((s, t) => s + Number(t.amount || 0), 0);
  const entrees = somme("income") / 3, sorties = somme("expense") / 3;
  const net = entrees - sorties, solde = Number(a.balance || 0), projete = solde + net;
  const classe = projete < 0 ? "negative" : net < 0 ? "warning" : "positive";
  const tag = tx.length < 3 ? "Données limitées" : projete < 0 ? "Risque de solde négatif" : net < 0 ? "Tendance à la baisse" : "Tendance stable ou positive";
  zone.innerHTML = `<article class="wallet-forecast-item"><div class="wallet-forecast-top"><div><strong>${echapper(a.name)}</strong><small>${a.type === "personal" ? "Personnel" : "Professionnel"} · ${echapper(a.currency)}</small></div><span class="wallet-forecast-tag">${tag}</span></div>
    <div class="wallet-forecast-metrics"><div><span>Solde actuel</span><b>${walletMoney(solde, a.currency)}</b></div>
    <div><span>Entrées estimées (30 jours)</span><b>${walletMoney(Math.round(entrees), a.currency)}</b></div>
    <div><span>Sorties estimées (30 jours)</span><b>${walletMoney(Math.round(sorties), a.currency)}</b></div>
    <div><span>Solde estimé dans 30 jours</span><b class="wallet-forecast-${classe}">${walletMoney(Math.round(projete), a.currency)}</b></div></div></article>`;
  if (!tx.length) zone.innerHTML += '<p class="meta">Aucun mouvement récent pour ce compte : les estimations sont à zéro. Enregistrez des entrées et sorties pour améliorer la projection.</p>';
}const walletId = () => (crypto.randomUUID ? crypto.randomUUID() : "w" + Date.now().toString(36) + Math.random().toString(36).slice(2));
const walletPath = (uid, collection, id = "") => `/users/${encodeURIComponent(uid)}/${collection}${id ? "/" + encodeURIComponent(id) : ""}`;
const walletFields = (obj) => ({ fields: Object.fromEntries(Object.entries(obj).map(([k,v]) => [k, typeof v === "number" ? { doubleValue: v } : typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v ?? "") }])) });
async function walletReadCollection(collection) {
  const uid = fb?.auth.currentUser?.uid;
  if (!uid) throw new Error("Votre session My World RS n'est pas connectée.");
  const docs = [];
  let page = "";
  do {
    const url = urlFirestore(firebaseConfig.projectId, walletPath(uid, collection)) + `?pageSize=300${page ? "&pageToken=" + encodeURIComponent(page) : ""}`;
    const res = await google(url);
    (res.documents || []).forEach(d => docs.push(decoderChamps(d.fields || {}).id ? decoderChamps(d.fields || {}) : { ...decoderChamps(d.fields || {}), id: d.name.split("/").pop() }));
    page = res.nextPageToken || "";
  } while (page);
  return docs;
}
async function walletCreate(collection, id, obj) {
  const uid = fb?.auth.currentUser?.uid;
  if (!uid) throw new Error("Connectez-vous à votre compte Google.");
  const url = urlFirestore(firebaseConfig.projectId, walletPath(uid, collection)) + "?documentId=" + encodeURIComponent(id);
  return google(url, { method: "POST", body: JSON.stringify(walletFields(obj)) });
}
async function walletPatchAccount(account, delta) {
  const uid = fb?.auth.currentUser?.uid;
  const url = urlFirestore(firebaseConfig.projectId, walletPath(uid, "walletAccounts", account.id)) + "?updateMask.fieldPaths=balance";
  return google(url, { method: "PATCH", body: JSON.stringify(walletFields({ balance: Number(account.balance || 0) + delta })) });
}
// ---------- Ristournes ESE DB (dans Mon Porte-Monnaie) ----------
const formatMontantDevise = (n, devise) => `${Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${devise}`;
function rendreRistourne(r) {
  const met = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  for (const [cle, prefixe] of [["depots", "depots"], ["retraits", "retraits"], ["solde", "solde"]]) {
    met(`rist-${prefixe}-fc`, formatMontantDevise(r.total[cle].FC, "FC"));
    met(`rist-${prefixe}-usd`, formatMontantDevise(r.total[cle].USD, "USD"));
  }
  const zone = $("rist-groupes");
  if (zone) {
    zone.innerHTML = r.groupes.length
      ? r.groupes.map((g) => `<div class="rist-groupe"><strong>${echapper(g.nom)}</strong>
          <span>Dépôts ${echapper(formatMontantDevise(g.depots.FC, "FC"))}${g.depots.USD ? " · " + echapper(formatMontantDevise(g.depots.USD, "USD")) : ""}</span>
          <span>Retraits ${echapper(formatMontantDevise(g.retraits.FC, "FC"))}${g.retraits.USD ? " · " + echapper(formatMontantDevise(g.retraits.USD, "USD")) : ""}</span>
          <b class="${g.solde.FC < 0 || g.solde.USD < 0 ? "neg" : ""}">Solde ${echapper(formatMontantDevise(g.solde.FC, "FC"))}${g.solde.USD ? " · " + echapper(formatMontantDevise(g.solde.USD, "USD")) : ""}</b></div>`).join("")
      : '<p class="vide">Aucun mouvement de ristourne dans ESE DB pour le moment.</p>';
  }
  const cr = $("rist-credits");
  if (cr) {
    cr.textContent = r.credits
      ? `${r.credits} crédit(s) de ristourne en cours · reste à rembourser : ${formatMontantDevise(r.total.reste.FC, "FC")}${r.total.reste.USD ? " · " + formatMontantDevise(r.total.reste.USD, "USD") : ""} · intérêts dus déjà déduits du solde : ${formatMontantDevise(r.total.interets.FC, "FC")}${r.total.interets.USD ? " · " + formatMontantDevise(r.total.interets.USD, "USD") : ""}.`
      : "Aucun crédit de ristourne en cours.";
  }
}
let derniereRistourne = null;

// ---------- Mes parts de ristourne : 50 % du solde des ristournes, versés dans un compte du porte-monnaie ----------
const NOM_COMPTE_PART = "Mes parts de ristourne", TAUX_PART = 0.5;
const arrondir2 = n => Math.floor(Number(n || 0) * 100 + 1e-6) / 100;
function calculerPartsRistourne() {
  const r = derniereRistourne;
  return ["FC", "USD"].map(devise => {
    const solde = r ? Number(r.total.solde[devise] || 0) : 0;
    const cible = Math.max(0, arrondir2(solde * TAUX_PART));
    const compte = walletAccounts.find(a => a.name === NOM_COMPTE_PART && a.currency === devise);
    const deja = Number(compte?.ristourneCredite || 0);
    return { devise, solde, cible, deja, aEnregistrer: arrondir2(cible - deja), compte };
  });
}
function rendrePartRistourne() {
  const info = $("rist-part-info"), bouton = $("rist-part-enregistrer");
  if (!info || !bouton) return;
  if (!derniereRistourne) { info.textContent = "Synchronisation avec ESE DB en attente…"; bouton.disabled = true; return; }
  const parts = calculerPartsRistourne().filter(p => p.solde > 0 || p.deja > 0);
  if (!parts.length) { info.textContent = "Aucun solde de ristourne disponible pour le moment."; bouton.disabled = true; return; }
  info.textContent = parts.map(p => `${p.devise} : part de 50 % = ${formatMontantDevise(p.cible, p.devise)} · déjà enregistrée ${formatMontantDevise(p.deja, p.devise)} · à enregistrer ${formatMontantDevise(Math.max(0, p.aEnregistrer), p.devise)}`).join("  |  ")
    + ". Une fois enregistrée, la somme est dans le compte « " + NOM_COMPTE_PART + " » : retirez-la ou utilisez-la avec une sortie ou un transfert.";
  bouton.disabled = !parts.some(p => p.aEnregistrer > 0);
}
let partRistourneEnCours = false;
async function enregistrerPartRistourne() {
  if (partRistourneEnCours) return;
  const bouton = $("rist-part-enregistrer"), statut = $("wallet-status");
  partRistourneEnCours = true; if (bouton) bouton.disabled = true;
  try {
    if (!walletLoaded) await chargerWallet(true);
    await chargerRistourne(true, true);
    const uid = fb?.auth.currentUser?.uid;
    if (!uid) throw new Error("Connectez-vous à votre compte Google.");
    const faits = [];
    for (const p of calculerPartsRistourne()) {
      if (!(p.aEnregistrer > 0)) continue;
      let compte = p.compte;
      if (!compte) {
        const id = walletId();
        compte = { name: NOM_COMPTE_PART, type: "personal", currency: p.devise, balance: 0, ristourneCredite: 0, createdAt: new Date().toISOString() };
        await walletCreate("walletAccounts", id, compte);
        compte = { ...compte, id }; walletAccounts.push(compte);
      }
      const tx = { kind: "income", accountId: compte.id, accountName: compte.name, accountType: compte.type, currency: p.devise, amount: p.aEnregistrer, category: "Ristourne", description: "Part de ristourne (50 %)", paymentMethod: "", date: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString() };
      const txId = walletId();
      await walletCreate("walletTransactions", txId, tx);
      const nouveauSolde = Number(compte.balance || 0) + p.aEnregistrer, nouveauCredite = p.deja + p.aEnregistrer;
      const url = urlFirestore(firebaseConfig.projectId, walletPath(uid, "walletAccounts", compte.id)) + "?updateMask.fieldPaths=balance&updateMask.fieldPaths=ristourneCredite";
      await google(url, { method: "PATCH", body: JSON.stringify(walletFields({ balance: nouveauSolde, ristourneCredite: nouveauCredite })) });
      compte.balance = nouveauSolde; compte.ristourneCredite = nouveauCredite;
      walletTransactions.unshift({ ...tx, id: txId });
      faits.push(formatMontantDevise(p.aEnregistrer, p.devise));
    }
    walletRender(); rendrePartRistourne();
    if (statut) statut.textContent = faits.length ? "Part de ristourne enregistrée : " + faits.join(" + ") + " ajouté(s) à « " + NOM_COMPTE_PART + " »." : "Rien de nouveau à enregistrer.";
  } catch (e) {
    if (statut) statut.textContent = "Enregistrement de la part impossible : " + e.message;
  } finally { partRistourneEnCours = false; rendrePartRistourne(); }
}
$("rist-part-enregistrer")?.addEventListener("click", enregistrerPartRistourne);
async function chargerRistourne(force = false, silencieux = false) {
  const statut = $("wallet-ristourne-status");
  const base = bases.ese;
  if (!base || !jetonGoogle) return;
  if (force) oublierCachesEse();
  try {
    if (statut && !silencieux) statut.textContent = "Synchronisation avec ESE DB…";
    const [jours, cfg] = await Promise.all([lireJoursEse(base.projectId), lireCfgEse(base.projectId)]);
    const r = calculerRistourne(jours, cfg);
    derniereRistourne = r;
    rendreRistourne(r);
    rendrePartRistourne();
    if (statut) statut.textContent = `Synchronisé avec ESE DB à ${heure.format(new Date())} · ${r.mouvements} mouvement(s) de ristourne lus.`;
  } catch (e) {
    if (statut) statut.textContent = "Synchronisation ESE DB impossible : " + e.message;
    if (silencieux) throw e;
  }
}

async function chargerWallet(force = false) {
  chargerRistourne();
  if (!fb?.auth.currentUser || !jetonGoogle) return;
  if (walletLoaded && !force) { walletRender(); return; }
  const status = $("wallet-status");
  if (status) status.textContent = "Chargement des comptes et opérations…";
  try {
    const [accounts, transactions] = await Promise.all([walletReadCollection("walletAccounts"), walletReadCollection("walletTransactions")]);
    walletAccounts = accounts.map(a => ({ ...a, id: a.id, balance: Number(a.balance || 0) })).sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    walletTransactions = transactions.map(t => ({ ...t, id: t.id, amount: Number(t.amount || 0), targetAmount: Number(t.targetAmount || 0) })).sort((a,b) => String(b.date || "").localeCompare(String(a.date || "")));
    walletLoaded = true;
    walletRender();
    if (status) status.textContent = "Données synchronisées avec votre Firebase My World RS. Elles sont séparées des bases AVEC LA SAGESSE et ESE DB.";
  } catch (e) {
    if (status) status.textContent = "Chargement impossible : " + e.message + " — vérifiez les autorisations Firestore de votre compte.";
  }
}
function walletAccountName(id) { return walletAccounts.find(a => a.id === id)?.name || "Compte supprimé"; }
function walletFilteredTransactions() {
  const period = $("wallet-period")?.value || "month", type = $("wallet-type-filter")?.value || "all";
  const now = new Date(), start = period === "month" ? new Date(now.getFullYear(),now.getMonth(),1) : period === "year" ? new Date(now.getFullYear(),0,1) : null;
  return walletTransactions.filter(t => {
    const a = walletAccounts.find(x => x.id === t.accountId);
    return (!start || String(t.date || "") >= start.toISOString().slice(0,10)) && (type === "all" || a?.type === type);
  });
}
function walletRender() {
  rendrePartRistourne();
  if (!$("wallet-accounts")) return;
  const sum = (type,currency) => walletAccounts.filter(a => a.type === type && a.currency === currency).reduce((s,a)=>s+Number(a.balance||0),0);
  $("wallet-personal-usd").textContent = walletMoney(sum("personal","USD"),"USD");
  $("wallet-personal-fc").textContent = walletMoney(sum("personal","FC"),"FC");
  $("wallet-pro-usd").textContent = walletMoney(sum("professional","USD"),"USD");
  $("wallet-pro-fc").textContent = walletMoney(sum("professional","FC"),"FC");
  $("wallet-count").textContent = String(walletTransactions.length);
  const monthKey = new Date().toISOString().slice(0,7);
  const monthTx = walletTransactions.filter(t => String(t.date||"").startsWith(monthKey) && t.kind !== "transfer");
  const monthNet = currency => monthTx.filter(t=>t.currency===currency).reduce((s,t)=>s+(t.kind==="income"?1:-1)*Number(t.amount||0),0);
  $("wallet-month-total").textContent = "Ce mois : " + walletMoney(monthNet("USD"),"USD") + " · " + walletMoney(monthNet("FC"),"FC");
  $("wallet-accounts").innerHTML = walletAccounts.length ? walletAccounts.map(a => `<article class="wallet-account"><div><strong>${echapper(a.name)}</strong><small>${a.type==="personal"?"Personnel":"Professionnel"} · ${echapper(a.currency)}</small></div><b>${walletMoney(a.balance,a.currency)}</b></article>`).join("") : '<p class="vide">Aucun compte. Créez votre premier compte.</p>';
  walletRenderForecasts();
  const options = walletAccounts.map(a=>`<option value="${echapper(a.id)}">${echapper(a.name)} — ${a.currency} (${a.type==="personal"?"Personnel":"Pro"})</option>`).join("");
  ["wallet-op-account","wallet-transfer-from","wallet-transfer-to"].forEach(id => { const el=$(id); if(el){const old=el.value;el.innerHTML=options || '<option value="">Créez d’abord un compte</option>';if(walletAccounts.some(a=>a.id===old))el.value=old;} });
  const filter=$("wallet-history-account"), old=filter.value;
  filter.innerHTML='<option value="all">Tous les comptes</option>'+options;
  if(walletAccounts.some(a=>a.id===old))filter.value=old;
  const selectedCurrency=$("wallet-chart-currency")?.value || "USD";
  const tx=walletFilteredTransactions();
  const currencyTx=tx.filter(t=>t.currency===selectedCurrency&&t.kind!=="transfer");
  const income=currencyTx.filter(t=>t.kind==="income").reduce((s,t)=>s+Number(t.amount||0),0);
  const expense=currencyTx.filter(t=>t.kind==="expense").reduce((s,t)=>s+Number(t.amount||0),0);
  $("wallet-statistics").innerHTML=`<div class="wallet-stat"><span>Entrées · ${selectedCurrency}</span><strong>${walletMoney(income,selectedCurrency)}</strong></div><div class="wallet-stat"><span>Sorties · ${selectedCurrency}</span><strong>${walletMoney(expense,selectedCurrency)}</strong></div><div class="wallet-stat"><span>Solde net · ${selectedCurrency}</span><strong>${walletMoney(income-expense,selectedCurrency)}</strong></div>`;
  walletDrawChart(tx);
  walletDrawNetChart(tx);
  walletRenderHistory();
}
function walletDrawChart(tx) {
  const canvas=$("wallet-chart"); if(!canvas)return;
  const ctx=canvas.getContext("2d"), w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h);
  const currency=$("wallet-chart-currency")?.value || "USD";
  tx=tx.filter(t => t.currency===currency && t.kind!=="transfer");
  const months=[];
  for(let i=5;i>=0;i--){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);months.push({key:d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"),label:new Intl.DateTimeFormat("fr-FR",{month:"short"}).format(d)});}
  const vals=months.map(m=>({ ...m, income:0, expense:0 }));
  tx.forEach(t=>{const m=vals.find(v=>v.key===String(t.date||"").slice(0,7));if(m&&t.kind==="income")m.income+=t.amount;if(m&&t.kind==="expense")m.expense+=t.amount;});
  const max=Math.max(1,...vals.flatMap(v=>[v.income,v.expense])), base=h-35, top=15, plotH=base-top, groupW=(w-40)/vals.length, barW=Math.min(24,groupW*.28);
  ctx.font="12px sans-serif";ctx.textAlign="center";
  vals.forEach((v,i)=>{const x=30+i*groupW+groupW/2;const hi=v.income/max*plotH, he=v.expense/max*plotH;ctx.fillStyle="#087a4b";ctx.fillRect(x-barW-2,base-hi,barW,hi);ctx.fillStyle="#1759a6";ctx.fillRect(x+2,base-he,barW,he);ctx.fillStyle=getComputedStyle(document.body).color;ctx.fillText(v.label,x,h-12);});
  ctx.textAlign="left";ctx.fillStyle="#087a4b";ctx.fillRect(12,8,9,9);ctx.fillStyle=getComputedStyle(document.body).color;ctx.fillText("Entrées",25,17);ctx.fillStyle="#1759a6";ctx.fillRect(90,8,9,9);ctx.fillStyle=getComputedStyle(document.body).color;ctx.fillText("Sorties",103,17);
}
function walletDrawNetChart(tx) {
  const canvas=$("wallet-net-chart"); if(!canvas)return;
  const ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  const currency=$("wallet-chart-currency")?.value || "USD";
  tx=tx.filter(t=>t.currency===currency&&t.kind!=="transfer");
  const months=[];
  for(let i=5;i>=0;i--){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);months.push({key:d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"),label:new Intl.DateTimeFormat("fr-FR",{month:"short"}).format(d)});}
  const vals=months.map(m=>({...m,net:0}));
  tx.forEach(t=>{const m=vals.find(v=>v.key===String(t.date||"").slice(0,7));if(m)m.net+=(t.kind==="income"?1:-1)*Number(t.amount||0);});
  const max=Math.max(1,...vals.map(v=>Math.abs(v.net))),zero=h/2,scale=(h-64)/2/max,step=(w-70)/vals.length;
  ctx.strokeStyle=getComputedStyle(document.body).color;ctx.globalAlpha=.2;ctx.beginPath();ctx.moveTo(30,zero);ctx.lineTo(w-20,zero);ctx.stroke();ctx.globalAlpha=1;
  ctx.font="12px sans-serif";ctx.textAlign="center";
  vals.forEach((v,i)=>{const x=35+i*step+step/2,y=zero-v.net*scale;ctx.strokeStyle=v.net>=0?"#087a4b":"#c65348";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x,zero);ctx.lineTo(x,y);ctx.stroke();ctx.fillStyle=v.net>=0?"#087a4b":"#c65348";ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.fillStyle=getComputedStyle(document.body).color;ctx.fillText(v.label,x,h-12);});
  ctx.textAlign="left";ctx.fillStyle=getComputedStyle(document.body).color;ctx.fillText("Excédent au-dessus de zéro · déficit en dessous",12,17);
}
function walletRenderHistory() {
  const search=($("wallet-search").value||"").toLowerCase(), account=$("wallet-history-account").value, kind=$("wallet-history-kind").value;
  const rows=walletTransactions.filter(t=>(account==="all"||t.accountId===account)&&(kind==="all"||t.kind===kind)&&[t.description,t.category,t.kind,t.accountName].join(" ").toLowerCase().includes(search));
  $("wallet-history").innerHTML=rows.length?rows.map(t=>{
    const label=t.kind==="income"?"Entrée":t.kind==="expense"?"Sortie":"Transfert";
    const amount=(t.kind==="expense"?"−":t.kind==="income"?"+":"↔")+walletMoney(t.amount,t.currency||"");
    const desc=[t.category,t.description].filter(Boolean).map(echapper).join(" · ")||"—";
    return `<tr><td>${echapper(t.date||"")}</td><td>${echapper(t.accountName||walletAccountName(t.accountId))}</td><td><span class="wallet-kind ${t.kind}">${label}</span></td><td>${desc}</td><td class="wallet-amount">${amount}</td><td class="wallet-actions"><button type="button" class="wallet-delete" data-wallet-supprimer="${echapper(t.id)}" title="Supprimer ce mouvement" aria-label="Supprimer ce mouvement">🗑 Supprimer</button></td></tr>`;
  }).join(""):'<tr><td colspan="6" class="vide">Aucune opération ne correspond à votre recherche.</td></tr>';
}
function walletSetDateDefaults() {
  const d=new Date().toISOString().slice(0,10);
  ["wallet-operation-form","wallet-transfer-form"].forEach(id=>{const f=$(id);if(f&&!f.elements.namedItem("date").value)f.elements.namedItem("date").value=d;});
}
$("wallet-account-form")?.addEventListener("submit",async e=>{
  e.preventDefault();const f=e.currentTarget,btn=f.querySelector("button[type=submit]");btn.disabled=true;
  try{
    const name=f.elements.namedItem("name").value.trim(),type=f.elements.namedItem("type").value,currency=f.elements.namedItem("currency").value,id=walletId();
    const account={name,type,currency,balance:0,createdAt:new Date().toISOString()};
    await walletCreate("walletAccounts",id,account);walletAccounts.push({...account,id});f.reset();walletRender();$("wallet-status").textContent="Compte créé et synchronisé.";
  }catch(err){$("wallet-status").textContent="Erreur de création : "+err.message;}
  finally{btn.disabled=false;}
});
$("wallet-operation-form")?.addEventListener("submit",async e=>{
  e.preventDefault();const f=e.currentTarget,btn=f.querySelector("button[type=submit]");btn.disabled=true;
  try{
    const account=walletAccounts.find(a=>a.id===f.elements.namedItem("account").value);if(!account)throw new Error("Sélectionnez un compte.");
    const amount=Number(f.elements.namedItem("amount").value);if(!(amount>0))throw new Error("Le montant doit être supérieur à zéro.");
    const kind=f.elements.namedItem("kind").value,id=walletId(),date=f.elements.namedItem("date").value;
    const tx={kind,accountId:account.id,accountName:account.name,accountType:account.type,currency:account.currency,amount,category:f.elements.namedItem("category").value.trim(),description:f.elements.namedItem("description").value.trim(),paymentMethod:f.elements.namedItem("paymentMethod")?.value||"",date,createdAt:new Date().toISOString()};
    await walletCreate("walletTransactions",id,tx);await walletPatchAccount(account,kind==="income"?amount:-amount);account.balance+=kind==="income"?amount:-amount;walletTransactions.unshift({...tx,id});f.reset();walletSetDateDefaults();walletRender();$("wallet-status").textContent="Opération enregistrée.";
  }catch(err){$("wallet-status").textContent="Erreur : "+err.message;}
  finally{btn.disabled=false;}
});
$("wallet-transfer-form")?.addEventListener("submit",async e=>{
  e.preventDefault();const f=e.currentTarget,btn=f.querySelector("button[type=submit]");btn.disabled=true;
  try{
    const from=walletAccounts.find(a=>a.id===f.elements.namedItem("from").value),to=walletAccounts.find(a=>a.id===f.elements.namedItem("to").value);
    if(!from||!to||from.id===to.id)throw new Error("Choisissez deux comptes différents.");
    const amount=Number(f.elements.namedItem("amount").value),rateText=f.elements.namedItem("rate").value.trim(),rate=Number(rateText);if(!(amount>0))throw new Error("Montant invalide.");
    if(from.currency!==to.currency&&(!rateText||!(rate>0)))throw new Error("Saisissez le taux de change (montant reçu = montant envoyé × taux).");
    if(from.balance<amount)throw new Error("Solde insuffisant dans le compte de départ.");
    const received=from.currency===to.currency?amount:amount*rate,date=f.elements.namedItem("date").value,transferId=walletId(),description=f.elements.namedItem("description").value.trim();
    const txOut={kind:"transfer",transferId,accountId:from.id,accountName:from.name,accountType:from.type,currency:from.currency,amount,description:"Vers "+to.name+(description?" · "+description:""),date,createdAt:new Date().toISOString(),direction:"out",targetAccountId:to.id,targetAccountName:to.name,targetAmount:received,targetCurrency:to.currency};
    const txIn={...txOut,id:undefined,accountId:to.id,accountName:to.name,accountType:to.type,currency:to.currency,amount:received,description:"Depuis "+from.name+(description?" · "+description:""),direction:"in",targetAccountId:from.id,targetAccountName:from.name,targetAmount:amount,targetCurrency:from.currency};
    const outId=walletId(),inId=walletId();await walletCreate("walletTransactions",outId,txOut);await walletCreate("walletTransactions",inId,txIn);
    await walletPatchAccount(from,-amount);await walletPatchAccount(to,received);from.balance-=amount;to.balance+=received;
    walletTransactions.unshift({...txOut,id:outId},{...txIn,id:inId});f.reset();walletSetDateDefaults();walletRender();$("wallet-status").textContent="Transfert enregistré entre les deux comptes.";
  }catch(err){$("wallet-status").textContent="Transfert non terminé : "+err.message+" (vérifiez l'historique avant de réessayer).";}
  finally{btn.disabled=false;}
});
// ---------- Suppression d'un mouvement d'argent ----------
async function walletDeleteDoc(collection, id) {
  const uid = fb?.auth.currentUser?.uid;
  if (!uid) throw new Error("Connectez-vous à votre compte Google.");
  return google(urlFirestore(firebaseConfig.projectId, walletPath(uid, collection, id)), { method: "DELETE" });
}
// Effet d'un mouvement sur le solde de son compte (à inverser lors de la suppression)
function walletEffet(tx) {
  const montant = Number(tx.amount || 0);
  if (tx.kind === "income") return montant;
  if (tx.kind === "expense") return -montant;
  return tx.direction === "in" ? montant : -montant; // transfert : sortie (−) ou entrée (+)
}
async function supprimerMouvementWallet(id) {
  const tx = walletTransactions.find((x) => x.id === id);
  if (!tx) return;
  // Un transfert est enregistré en deux lignes (départ et arrivée) : elles partent ensemble
  const lot = tx.kind === "transfer" && tx.transferId ? walletTransactions.filter((x) => x.transferId === tx.transferId) : [tx];
  const resume = tx.kind === "transfer"
    ? "ce transfert (départ et arrivée seront annulés)"
    : `cette ${tx.kind === "income" ? "entrée" : "sortie"} de ${walletMoney(tx.amount, tx.currency || "")}`;
  if (!confirm(`Supprimer ${resume} ?\nLe solde du compte sera corrigé automatiquement.`)) return;
  const status = $("wallet-status");
  try {
    if (status) status.textContent = "Suppression en cours…";
    for (const ligne of lot) {
      await walletDeleteDoc("walletTransactions", ligne.id);
      walletTransactions = walletTransactions.filter((x) => x.id !== ligne.id);
      const compte = walletAccounts.find((a) => a.id === ligne.accountId);
      if (compte) {
        const effet = walletEffet(ligne);
        await walletPatchAccount(compte, -effet);
        compte.balance = Number(compte.balance || 0) - effet;
      }
    }
    walletRender();
    if (status) status.textContent = lot.length > 1 ? "Transfert supprimé, soldes corrigés." : "Mouvement supprimé, solde corrigé.";
  } catch (e) {
    walletRender();
    if (status) status.textContent = "Suppression non terminée : " + e.message + " — cliquez sur « Actualiser » pour revérifier vos soldes.";
  }
}
// À l'ouverture de l'onglet, on charge les comptes et opérations s'ils ne le sont pas encore
document.querySelector('[data-tab="wallet"]')?.addEventListener("click", () => { chargerWallet(false); });
$("wallet-history")?.addEventListener("click", (ev) => {
  const b = ev.target.closest?.("[data-wallet-supprimer]");
  if (b) supprimerMouvementWallet(b.dataset.walletSupprimer);
});
["wallet-period","wallet-type-filter","wallet-chart-currency"].forEach(id=>$(id)?.addEventListener("change",walletRender));
["wallet-search","wallet-history-account","wallet-history-kind"].forEach(id=>$(id)?.addEventListener(id==="wallet-search"?"input":"change",walletRenderHistory));

async function walletChargerJsPdf() {
  if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
  await new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.onload=resolve; script.onerror=()=>reject(new Error("Impossible de charger le moteur PDF. Vérifiez votre connexion internet."));
    document.head.appendChild(script);
  });
  if(!window.jspdf?.jsPDF) throw new Error("Le moteur PDF n'est pas disponible.");
  return window.jspdf.jsPDF;
}
function walletPdfTexte(doc, texte, x, y, maxWidth, options={}) {
  const lignes=doc.splitTextToSize(String(texte??"—"),maxWidth);
  doc.text(lignes,x,y,options);
  return y+lignes.length*(options.lineHeightFactor?doc.getFontSize()*options.lineHeightFactor:doc.getFontSize()*1.35);
}
function walletPdfPied(doc) {
  const n=doc.getNumberOfPages();
  for(let i=2;i<=n;i++){doc.setPage(i);doc.setDrawColor(218,228,223);doc.line(14,284,196,284);doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(75,91,84);doc.text("MY WORLD RS · Rapport confidentiel du porte-monnaie",14,290);doc.text("Page "+i+" / "+n,196,290,{align:"right"});}
}
async function walletExporterPdf() {
  const btn=$("wallet-export-pdf"), status=$("wallet-status");
  if(btn?.disabled)return;
  if(btn){btn.disabled=true;btn.dataset.ancienTexte=btn.textContent;btn.textContent="Préparation du PDF…";}
  try {
    if(!walletLoaded) await chargerWallet(true);
    const JsPDF=await walletChargerJsPdf();
    const doc=new JsPDF({orientation:"portrait",unit:"mm",format:"a4"});
    const devise=$("wallet-chart-currency")?.value||undefined;
    const donnees=calculerRapport({transactions:walletTransactions,comptes:walletAccounts,devise,ristourne:derniereRistourne,maintenant:new Date(),utilisateur:utilisateurConnecte?.displayName||utilisateurConnecte?.email||""});
    dessinerRapport(doc,donnees);
    doc.save("My-World-RS_Rapport-Porte-monnaie_"+new Date().toISOString().slice(0,10)+".pdf");
    if(status)status.textContent="Rapport PDF téléchargé : "+walletTransactions.length+" mouvement(s), tous comptes confondus.";
  }catch(e){if(status)status.textContent="Export PDF impossible : "+e.message;}
  finally{if(btn){btn.disabled=false;btn.textContent=btn.dataset.ancienTexte||"Télécharger le rapport PDF";}}
}$("wallet-export-pdf")?.addEventListener("click",walletExporterPdf);

$("wallet-export")?.addEventListener("click",()=>{
  const rows=[["Date","Compte","Type","Devise","Montant","Catégorie","Description"],...walletTransactions.map(t=>[t.date,t.accountName,t.kind,t.currency,t.amount,t.category,t.description])];
  const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="mon-porte-monnaie.csv";a.click();URL.revokeObjectURL(url);
});
walletSetDateDefaults();
//
// ---------- Nouveau mail Gmail ----------
const nouveauMailDialog = $("nouveau-mail-dialog");
$("nouveau-mail").addEventListener("click", () => {
  $("nouveau-mail-form").reset();
  $("nouveau-mail-statut").textContent = "";
  nouveauMailDialog.showModal();
});
$("nouveau-mail-fermer").addEventListener("click", () => nouveauMailDialog.close());
$("nouveau-mail-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const donnees = new FormData(form);
  const a = String(donnees.get("a") || "").trim();
  const sujet = String(donnees.get("sujet") || "").trim();
  const corps = String(donnees.get("corps") || "").trim();
  const bouton = $("nouveau-mail-creer");
  bouton.disabled = true;
  $("nouveau-mail-statut").textContent = "Création du brouillon…";
  try {
    const raw = construireBrouillonBrut({ a, sujet, corps });
    await google("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      body: JSON.stringify({ message: { raw } }),
    });
    nouveauMailDialog.close();
    afficherErreur("");
    $("confirmation").textContent = "Brouillon créé dans Gmail. Vous pouvez le relire et l’envoyer depuis Gmail.";
    $("confirmation").hidden = false;
    setTimeout(() => ($("confirmation").hidden = true), 8000);
  } catch (e) {
    $("nouveau-mail-statut").textContent = "";
    afficherErreur(`Brouillon non créé : ${e.message}`);
  } finally {
    bouton.disabled = false;
  }
});

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

// ---------- Telegram (bot personnel lu depuis le navigateur) ----------
// Le jeton du bot reste dans ce navigateur (localStorage) : il n'est jamais envoyé sur GitHub ni écrit dans Firestore.
const CLE_TG_JETON = "mwrs.telegram.jeton";
const CLE_TG_OFFSET = "mwrs.telegram.offset";
const CLE_TG_NOM = "mwrs.telegram.nom";
const stockage = {
  lire(cle) { try { return localStorage.getItem(cle) || ""; } catch { return ""; } },
  ecrire(cle, valeur) { try { localStorage.setItem(cle, valeur); } catch { /* navigateur sans stockage */ } },
  effacer(cle) { try { localStorage.removeItem(cle); } catch { /* ignoré */ } },
};
let statutTelegram = { erreur: "", derniere: null, nouveaux: 0 };

function messageReseau(e, nom = "Telegram") {
  return e instanceof TypeError ? `${nom} est injoignable pour le moment (réseau).` : e.message;
}

async function appelTelegram(methode, params) {
  const r = await fetch(urlTelegram(stockage.lire(CLE_TG_JETON), methode, params));
  let j;
  try { j = await r.json(); } catch { throw new Error("Réponse illisible de Telegram."); }
  if (!j.ok) throw new Error(expliquerErreurTelegram(j));
  return j.result;
}

// Lit les nouveaux messages du bot et les enregistre dans Firestore ; retourne leur nombre.
// L'identifiant du document est stable : relire un message ne crée jamais de doublon.
async function synchroniserTelegram() {
  if (!stockage.lire(CLE_TG_JETON)) return 0;
  const s = reglages.social;
  const base = s && bases[s.base];
  if (!base) throw new Error("Base des réseaux sociaux non configurée (reglages.social).");
  let total = 0;
  for (let tour = 0; tour < 5; tour++) {
    const offset = Number(stockage.lire(CLE_TG_OFFSET)) || undefined;
    const updates = await appelTelegram("getUpdates", {
      offset, limit: 100, timeout: 0, allowed_updates: JSON.stringify(["message", "channel_post"]),
    });
    if (!updates.length) break;
    const messages = updates.map((u) => extraireMessage(u, reglages.telegram?.motsImportants)).filter(Boolean);
    await enLots(messages, 4, (m) =>
      google(urlFirestore(base.projectId, `/${s.collection}/${idDocument(m)}`), {
        method: "PATCH",
        body: JSON.stringify({ fields: champsFirestore(m) }),
        headers: { "x-goog-user-project": base.projectId },
      }),
    );
    // On ne confirme à Telegram qu'après l'enregistrement : en cas d'échec, tout sera relu
    stockage.ecrire(CLE_TG_OFFSET, String(dernierUpdateId(updates) + 1));
    total += messages.length;
    if (updates.length < 100) break;
  }
  return total;
}

// Lit Telegram puis Facebook, enregistre les nouveaux messages, puis retourne la liste à afficher.
// `forcer` = false pour la lecture automatique : Facebook n'est alors relu que toutes les 3 minutes.
async function chargerSocialComplet(forcer = true, seulementSiNouveau = false) {
  let recus = 0;
  try {
    statutTelegram.nouveaux = await synchroniserTelegram();
    recus += statutTelegram.nouveaux || 0;
    statutTelegram.erreur = "";
  } catch (e) {
    statutTelegram.erreur = messageReseau(e);
  }
  statutTelegram.derniere = new Date();
  majStatutTelegram();
  if (stockage.lire(CLE_FB_JETON) && (forcer || Date.now() - statutFacebook.derniere >= 170000)) {
    try {
      statutFacebook.nouveaux = await synchroniserFacebook();
      recus += statutFacebook.nouveaux || 0;
      statutFacebook.erreur = "";
    } catch (e) {
      statutFacebook.erreur = messageReseau(e, "Facebook");
    }
    statutFacebook.derniere = Date.now();
  }
  majStatutFacebook();
  // Lecture automatique : on ne relit la liste (donc des documents facturés) que s'il y a du nouveau
  if (seulementSiNouveau && !recus) return null;
  return chargerSocial();
}

async function rafraichirSocial(forcer = true) {
  if (!jetonGoogle) return;
  etat.social = await chargerSocialComplet(forcer);
  rendreSocial();
  rendreAlertes();
}

// ---------- Actualisation automatique, silencieuse ----------
// ESE DB et ristournes : toutes les 2 secondes. Réseaux sociaux : 8 s. Indicateurs AVEC : 30 s.
// Gmail et Agenda : 60 s (Google limite le nombre de lectures par minute).
// Rien ne tourne quand l'onglet est caché ; après 5 minutes sans activité, le rythme est divisé par 15.
const planif = { minuteur: null, dernier: {}, enCours: {}, pauseJusqua: 0, echecs: 0, derniereActivite: Date.now(), sig: {}, desactive: false };
const signature = (o) => { try { return JSON.stringify(o); } catch { return String(Math.random()); } };

function afficherDirect(etatDirect, detail = "") {
  const el = $("direct");
  if (!el) return;
  el.dataset.etat = etatDirect;
  const heureTexte = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  el.textContent = etatDirect === "ok" ? `● En direct · ${heureTexte}`
    : etatDirect === "pause" ? `Ⅱ En pause${detail ? " · " + detail : ""}`
    : etatDirect === "off" ? "○ Actualisation arrêtée" : "● Reconnexion…";
}

function gererErreurAuto(e) {
  planif.echecs += 1;
  const message = String(e?.message || "");
  const auth = /session|expir|autoris|401|connectez/i.test(message);
  const quota = e?.quota || /quota|429|limite/i.test(message);
  const attente = quota ? 120000 : auth ? 120000 : Math.min(60000, 2000 * 2 ** Math.min(planif.echecs, 5));
  planif.pauseJusqua = Date.now() + attente;
  afficherDirect("pause", quota ? "limite Google atteinte" : auth ? "reconnexion nécessaire" : "nouvel essai bientôt");
  console.info("Actualisation automatique suspendue :", message);
}

async function majEseSilencieuse() {
  const kpis = await chargerKpis((k) => k.op === "ese");
  const sig = signature(kpis.filter((k) => k.op === "ese"));
  const change = sig !== planif.sig.ese;
  planif.sig.ese = sig;
  etat.kpis = kpis;
  if (change) { rendreKpis(); rendreAlertes(); rendreDashboard(); }
  await chargerRistourne(false, true);
}
async function majAvecSilencieuse() {
  const kpis = await chargerKpis((k) => k.op !== "ese");
  const sig = signature(kpis.filter((k) => k.op !== "ese"));
  const change = sig !== planif.sig.avec;
  planif.sig.avec = sig;
  etat.kpis = kpis;
  if (change) { rendreKpis(); rendreAlertes(); rendreDashboard(); }
}
async function majSocialSilencieuse() {
  const listeRecente = Date.now() - (planif.derniereListeSociale || 0) < 60000;
  const social = await chargerSocialComplet(false, listeRecente);
  if (!social) return;
  planif.derniereListeSociale = Date.now();
  const sig = signature(social);
  if (sig === planif.sig.social) return;
  planif.sig.social = sig;
  etat.social = social;
  rendreSocial(); rendreAlertes(); rendreDashboard();
}
async function majGoogleSilencieuse() {
  const [gm, ag] = await Promise.all([chargerGmail(), chargerAgenda()]);
  const sig = signature([gm, ag]);
  if (sig === planif.sig.google) return;
  planif.sig.google = sig;
  etat.messages = gm.importants; etat.recents = gm.recents; etat.agenda = ag;
  rendreMessages(); rendreAgenda(); rendreAlertes(); rendreDashboard();
}

function tickAuto() {
  if (planif.desactive) return;
  if (document.hidden || !jetonGoogle || !fb?.auth.currentUser) return;
  const maintenant = Date.now();
  if (maintenant < planif.pauseJusqua) return;
  if (planif.enCours.tout) return;
  const inactif = maintenant - planif.derniereActivite > 300000;
  const facteur = inactif ? 15 : 1;
  const echu = (cle, ms) => !planif.enCours[cle] && maintenant - (planif.dernier[cle] || 0) >= ms * facteur;
  const lancer = (cle, f) => {
    planif.dernier[cle] = maintenant;
    planif.enCours[cle] = true;
    f().then(() => { planif.echecs = 0; afficherDirect("ok"); }).catch(gererErreurAuto).finally(() => { planif.enCours[cle] = false; });
  };
  // Pas de lecture automatique tant que le premier chargement n'est pas terminé
  if (!etat.kpis.length) return;
  if (echu("ese", 2000)) lancer("ese", majEseSilencieuse);
  if (echu("avec", 30000)) lancer("avec", majAvecSilencieuse);
  if (echu("social", 8000) && (stockage.lire(CLE_TG_JETON) || stockage.lire(CLE_FB_JETON))) lancer("social", majSocialSilencieuse);
  if (echu("google", 60000)) lancer("google", majGoogleSilencieuse);
}

function demarrerSurveillanceSocial() {
  if (planif.minuteur) return;
  try { planif.desactive = localStorage.getItem("mwrs.auto.off") === "1"; } catch { /* stockage indisponible */ }
  const activite = () => { planif.derniereActivite = Date.now(); };
  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((ev) => window.addEventListener(ev, activite, { passive: true }));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { activite(); planif.pauseJusqua = 0; } });
  const bouton = $("direct");
  if (bouton) {
    bouton.hidden = false;
    afficherDirect(planif.desactive ? "off" : "ok");
    bouton.addEventListener("click", () => {
      planif.desactive = !planif.desactive;
      try { localStorage.setItem("mwrs.auto.off", planif.desactive ? "1" : "0"); } catch { /* stockage indisponible */ }
      planif.pauseJusqua = 0;
      afficherDirect(planif.desactive ? "off" : "ok");
    });
  }
  planif.minuteur = setInterval(tickAuto, 1000);
}

function retourTelegram(texte, erreur = false) {
  const el = $("telegram-retour");
  el.textContent = texte;
  el.classList.toggle("erreur", erreur);
}

function majStatutTelegram() {
  const jeton = stockage.lire(CLE_TG_JETON);
  const el = $("telegram-statut");
  $("telegram-form").hidden = !!jeton;
  $("telegram-retirer").hidden = !jeton;
  el.classList.toggle("erreur-texte", !!(jeton && statutTelegram.erreur));
  if (!jeton) {
    el.textContent = "Non connecté. Créez votre bot (2 minutes) puis collez son jeton ci-dessous.";
    return;
  }
  const nom = stockage.lire(CLE_TG_NOM);
  const parties = [`Connecté${nom ? " au bot @" + nom : ""}`];
  if (statutTelegram.derniere) parties.push(`dernière lecture à ${heure.format(statutTelegram.derniere)}`);
  if (statutTelegram.nouveaux) parties.push(`${statutTelegram.nouveaux} nouveau(x) message(s)`);
  el.textContent = parties.join(" · ") + (statutTelegram.erreur ? ` — ${statutTelegram.erreur}` : "");
}

async function connecterTelegram(saisie) {
  const jeton = String(saisie || "").trim();
  if (!jetonValide(jeton)) {
    retourTelegram("Ce jeton n'a pas le bon format (exemple : 123456789:AAH…). Copiez-le en entier depuis @BotFather.", true);
    return;
  }
  const bouton = $("telegram-connecter");
  bouton.disabled = true;
  retourTelegram("Vérification du jeton…");
  try {
    const r = await fetch(urlTelegram(jeton, "getMe"));
    const j = await r.json();
    if (!j.ok) throw new Error(expliquerErreurTelegram(j));
    stockage.ecrire(CLE_TG_JETON, jeton);
    stockage.ecrire(CLE_TG_NOM, j.result?.username || "");
    stockage.effacer(CLE_TG_OFFSET);
    $("telegram-jeton").value = "";
    statutTelegram = { erreur: "", derniere: null, nouveaux: 0 };
    retourTelegram(`Bot @${j.result?.username || ""} connecté. Écrivez-lui un message sur Telegram pour tester.`);
    majStatutTelegram();
    await rafraichirSocial();
  } catch (e) {
    retourTelegram(messageReseau(e), true);
  } finally {
    bouton.disabled = false;
  }
}

function retirerTelegram() {
  [CLE_TG_JETON, CLE_TG_OFFSET, CLE_TG_NOM].forEach((c) => stockage.effacer(c));
  statutTelegram = { erreur: "", derniere: null, nouveaux: 0 };
  majStatutTelegram();
  retourTelegram("Bot retiré de ce navigateur. Les messages déjà enregistrés restent dans votre base.");
}

$("telegram-form").addEventListener("submit", (e) => {
  e.preventDefault();
  connecterTelegram($("telegram-jeton").value);
});
$("telegram-retirer").addEventListener("click", retirerTelegram);
majStatutTelegram();

// ---------- Facebook (Pages : messages Messenger) ----------
// Le jeton reste dans ce navigateur (localStorage). Seules les Pages que vous administrez sont lues.
const CLE_FB_JETON = "mwrs.facebook.jeton";
const CLE_FB_DEPUIS = "mwrs.facebook.depuis"; // { idPage: date (ms) du dernier message déjà enregistré }
const CLE_FB_PAGES = "mwrs.facebook.pages"; // noms des Pages (affichage seulement)
let statutFacebook = { erreur: "", derniere: 0, nouveaux: 0 };

async function graph(chemin, params, jeton) {
  const version = reglages.facebook?.versionApi || VERSION_API_PAR_DEFAUT;
  const r = await fetch(urlGraph(version, chemin, params, jeton));
  let j;
  try { j = await r.json(); } catch { throw new Error("Réponse illisible de Facebook."); }
  if (j.error) throw new Error(expliquerErreurFacebook(j));
  return j;
}

// Lit les nouveaux messages de chaque Page et les enregistre dans Firestore ; retourne leur nombre.
// L'identifiant du document est stable : relire un message ne crée jamais de doublon.
async function synchroniserFacebook() {
  const jeton = stockage.lire(CLE_FB_JETON);
  if (!jeton) return 0;
  const s = reglages.social;
  const base = s && bases[s.base];
  if (!base) throw new Error("Base des réseaux sociaux non configurée (reglages.social).");
  const fb = reglages.facebook || {};
  const pages = choisirPages(await graph("/me/accounts", { fields: "id,name,access_token", limit: 25 }, jeton));
  if (!pages.length) {
    throw new Error("Aucune Page trouvée pour ce jeton (autorisation pages_show_list manquante, ou vous n'administrez aucune Page).");
  }
  stockage.ecrire(CLE_FB_PAGES, JSON.stringify(pages.map((p) => p.nom)));
  let depuis = {};
  try { depuis = JSON.parse(stockage.lire(CLE_FB_DEPUIS) || "{}"); } catch { depuis = {}; }
  const premiere = Date.now() - (fb.joursInitiaux ?? 7) * 86400000;
  let total = 0;
  const erreurs = [];
  for (const page of pages) {
    try {
      const conversations = await graph(
        `/${page.id}/conversations`,
        { platform: "messenger", limit: fb.maxConversations ?? 10, fields: CHAMPS_CONVERSATIONS },
        page.jeton,
      );
      const depuisPage = depuis[page.id] ?? premiere;
      const messages = extraireMessagesConversations(conversations, page, depuisPage, fb.motsImportants);
      await enLots(messages, 4, (m) =>
        google(urlFirestore(base.projectId, `/${s.collection}/${idDocumentFacebook(m)}`), {
          method: "PATCH",
          body: JSON.stringify({ fields: champsFirestoreFacebook(m) }),
          headers: { "x-goog-user-project": base.projectId },
        }),
      );
      // On ne mémorise la date qu'après l'enregistrement : en cas d'échec, tout sera relu
      depuis[page.id] = dateLaPlusRecente(messages, depuisPage);
      stockage.ecrire(CLE_FB_DEPUIS, JSON.stringify(depuis));
      total += messages.length;
    } catch (e) {
      erreurs.push(`${page.nom} : ${messageReseau(e, "Facebook")}`);
    }
  }
  if (erreurs.length) throw new Error(erreurs.join(" · "));
  return total;
}

function retourFacebook(texte, erreur = false) {
  const el = $("facebook-retour");
  el.textContent = texte;
  el.classList.toggle("erreur", erreur);
}

function majStatutFacebook() {
  const jeton = stockage.lire(CLE_FB_JETON);
  const el = $("facebook-statut");
  $("facebook-form").hidden = !!jeton;
  $("facebook-retirer").hidden = !jeton;
  el.classList.toggle("erreur-texte", !!(jeton && statutFacebook.erreur));
  if (!jeton) {
    el.textContent = "Non connecté. Suivez les étapes ci-dessous pour obtenir un jeton.";
    return;
  }
  let pages = [];
  try { pages = JSON.parse(stockage.lire(CLE_FB_PAGES) || "[]"); } catch { pages = []; }
  const parties = [`Connecté${pages.length ? " : " + pages.join(", ") : ""}`];
  if (statutFacebook.derniere) parties.push(`dernière lecture à ${heure.format(new Date(statutFacebook.derniere))}`);
  if (statutFacebook.nouveaux) parties.push(`${statutFacebook.nouveaux} nouveau(x) message(s)`);
  el.textContent = parties.join(" · ") + (statutFacebook.erreur ? ` — ${statutFacebook.erreur}` : "");
}

async function connecterFacebook(saisie) {
  const jeton = String(saisie || "").trim();
  if (!jetonFacebookValide(jeton)) {
    retourFacebook("Ce jeton n'a pas le bon format (c'est une longue suite de lettres et de chiffres, souvent commençant par EAA). Copiez-le en entier.", true);
    return;
  }
  const bouton = $("facebook-connecter");
  bouton.disabled = true;
  retourFacebook("Vérification du jeton…");
  try {
    const pages = choisirPages(await graph("/me/accounts", { fields: "id,name,access_token", limit: 25 }, jeton));
    if (!pages.length) {
      throw new Error("Aucune Page trouvée : ajoutez l'autorisation pages_show_list et sélectionnez vos Pages en générant le jeton.");
    }
    stockage.ecrire(CLE_FB_JETON, jeton);
    stockage.ecrire(CLE_FB_PAGES, JSON.stringify(pages.map((p) => p.nom)));
    stockage.effacer(CLE_FB_DEPUIS);
    $("facebook-jeton").value = "";
    statutFacebook = { erreur: "", derniere: 0, nouveaux: 0 };
    retourFacebook(`${pages.length} Page(s) connectée(s) : ${pages.map((p) => p.nom).join(", ")}.`);
    majStatutFacebook();
    await rafraichirSocial(true);
  } catch (e) {
    retourFacebook(messageReseau(e, "Facebook"), true);
  } finally {
    bouton.disabled = false;
  }
}

function retirerFacebook() {
  [CLE_FB_JETON, CLE_FB_DEPUIS, CLE_FB_PAGES].forEach((c) => stockage.effacer(c));
  statutFacebook = { erreur: "", derniere: 0, nouveaux: 0 };
  majStatutFacebook();
  retourFacebook("Facebook retiré de ce navigateur. Les messages déjà enregistrés restent dans votre base.");
}

$("facebook-form").addEventListener("submit", (e) => {
  e.preventDefault();
  connecterFacebook($("facebook-jeton").value);
});
$("facebook-retirer").addEventListener("click", retirerFacebook);
majStatutFacebook();


// ---------- Notes & Projets : stockage privé par utilisateur dans Firebase ----------
const notesCollection = "notesProjects";
let notesItems = [];
let notesLoaded = false;
let notesLoading = false;
const notesStatus = (message, error = false) => {
  const el = $("notes-status");
  if (el) { el.textContent = message; el.classList.toggle("erreur-texte", error); }
};
function notesId() { return crypto.randomUUID ? crypto.randomUUID() : "n" + Date.now().toString(36) + Math.random().toString(36).slice(2); }
function notesDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("fr-FR", { day:"numeric", month:"short", year:"numeric" }).format(d);
}
function notesStatusLabel(value) { return ({todo:"À faire",doing:"En cours",done:"Terminé"})[value] || "À faire"; }
async function notesRead() {
  const uid = fb?.auth.currentUser?.uid;
  if (!uid) throw new Error("Connectez-vous à votre compte Google.");
  const docs = [];
  let page = "";
  do {
    const url = urlFirestore(firebaseConfig.projectId, walletPath(uid, notesCollection)) + "?pageSize=300" + (page ? "&pageToken=" + encodeURIComponent(page) : "");
    const res = await google(url);
    for (const d of (res.documents || [])) {
      const item = decoderChamps(d.fields || {});
      item.id = item.id || d.name.split("/").pop();
      docs.push(item);
    }
    page = res.nextPageToken || "";
  } while (page);
  return docs.sort((a,b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
}
async function notesSave(item, existing=false) {
  const uid = fb?.auth.currentUser?.uid;
  if (!uid) throw new Error("Connectez-vous à votre compte Google.");
  const data = { ...item, updatedAt: new Date().toISOString() };
  if (!data.createdAt) data.createdAt = data.updatedAt;
  const fields = JSON.stringify(walletFields(data));
  if (existing) {
    // PATCH vise le document précis : documentId n'est pas un paramètre valide pour PATCH.
    const url = urlFirestore(firebaseConfig.projectId, walletPath(uid, notesCollection, data.id));
    return google(url, { method:"PATCH", body:fields });
  }
  // Pour un nouveau document, documentId est autorisé sur POST de collection.
  const url = urlFirestore(firebaseConfig.projectId, walletPath(uid, notesCollection)) + "?documentId=" + encodeURIComponent(data.id);
  return google(url, { method:"POST", body:fields });
}
async function notesDelete(id) {
  const uid = fb?.auth.currentUser?.uid;
  if (!uid) throw new Error("Connectez-vous à votre compte Google.");
  return google(urlFirestore(firebaseConfig.projectId, walletPath(uid, notesCollection, id)), { method:"DELETE" });
}
function notesSetType(type) {
  document.querySelectorAll(".notes-project-only").forEach(el => el.hidden = type !== "project");
  $("notes-form-title").textContent = type === "project" ? "Nouveau projet" : "Nouvelle note";
  $("notes-save").textContent = type === "project" ? "Enregistrer le projet" : "Enregistrer la note";
}
function notesReset() {
  $("notes-form").reset();
  $("notes-form").elements.id.value = "";
  $("notes-form").elements.type.value = "note";
  notesSetType("note");
  $("notes-cancel").hidden = true;
  $("notes-editor-card").hidden = true;
}
$("notes-new")?.addEventListener("click",()=>{notesReset();$("notes-editor-card").hidden=false;$("notes-editor-card").scrollIntoView({behavior:"smooth",block:"start"});});
function notesEdit(id) {
  const item = notesItems.find(x => x.id === id);
  if (!item) return;
  const f = $("notes-form").elements;
  f.id.value = item.id || "";
  f.type.value = item.type || "note";
  f.title.value = item.title || "";
  f.category.value = item.category || "";
  f.status.value = item.status || "todo";
  f.due.value = item.due || "";
  f.body.value = item.body || "";
  f.steps.value = item.steps || "";
  notesSetType(f.type.value);
  $("notes-form-title").textContent = "Modifier " + (item.type === "project" ? "le projet" : "la note");
  $("notes-save").textContent = "Enregistrer les modifications";
  $("notes-cancel").hidden = false;
  $("notes-editor-card").hidden = false;
  $("notes-form").scrollIntoView({ behavior:"smooth", block:"start" });
}
function notesRender() {
  const zone = $("notes-list");
  if (!zone) return;
  const q = ($("notes-search")?.value || "").trim().toLocaleLowerCase("fr");
  const filter = $("notes-filter")?.value || "all";
  const items = notesItems.filter(x => {
    const text = [x.title,x.category,x.body,x.steps].join(" ").toLocaleLowerCase("fr");
    if (q && !text.includes(q)) return false;
    if (filter === "note" || filter === "project") return (x.type || "note") === filter;
    if (["todo","doing","done"].includes(filter)) return x.type === "project" && (x.status || "todo") === filter;
    return true;
  });
  if (!items.length) {
    zone.innerHTML = '<p class="vide">' + (notesItems.length ? "Aucun résultat pour cette recherche." : "Aucune note ou projet pour le moment. Créez votre premier élément ci-dessus.") + '</p>';
    return;
  }
  zone.innerHTML = items.map(item => {
    const isProject = item.type === "project";
    const steps = isProject && item.steps ? item.steps.split(/\r?\n/).map(x=>x.trim()).filter(Boolean) : [];
    return '<article class="notes-item ' + (isProject ? "notes-project" : "notes-note") + '">' +
      '<div class="notes-item-head"><div><span class="notes-kind">' + (isProject ? "📌 Projet" : "📝 Note") + '</span>' +
      '<h3>' + echapper(item.title || "Sans titre") + '</h3><div class="notes-meta">' + (item.category ? '<span>' + echapper(item.category) + '</span>' : '') +
      (isProject ? '<span class="notes-status notes-status-' + echapper(item.status || "todo") + '">' + notesStatusLabel(item.status) + '</span>' : '') +
      (item.due ? '<span>Échéance : ' + notesDate(item.due) + '</span>' : '') + '</div></div>' +
      '<div class="notes-item-actions"><button class="btn btn-light" data-note-edit="' + echapper(item.id) + '" type="button">Modifier</button><button class="btn btn-quiet" data-note-delete="' + echapper(item.id) + '" type="button" aria-label="Supprimer">Supprimer</button></div></div>' +
      (item.body ? '<p class="notes-body">' + echapper(item.body).replace(/\n/g,"<br>") + '</p>' : '') +
      (steps.length ? '<div class="notes-steps"><strong>Étapes</strong><ul>' + steps.map(x=>'<li>'+echapper(x)+'</li>').join("") + '</ul></div>' : '') +
      '<div class="notes-footer">Mis à jour ' + notesDate(item.updatedAt || item.createdAt) + '</div></article>';
  }).join("");
  zone.querySelectorAll("[data-note-edit]").forEach(b => b.addEventListener("click", () => notesEdit(b.dataset.noteEdit)));
  zone.querySelectorAll("[data-note-delete]").forEach(b => b.addEventListener("click", async () => {
    const id=b.dataset.noteDelete, item=notesItems.find(x=>x.id===id);
    if (!confirm('Supprimer définitivement "' + (item?.title || "cet élément") + '" ?')) return;
    b.disabled=true;
    try { await notesDelete(id); notesItems=notesItems.filter(x=>x.id!==id); notesRender(); notesStatus("Élément supprimé."); }
    catch(e) { notesStatus("Suppression impossible : "+e.message,true); b.disabled=false; }
  }));
}
async function notesLoad(force = false) {
  if (notesLoading || (notesLoaded && !force)) return;
  if (!fb?.auth.currentUser) { notesStatus("Connectez-vous pour utiliser Notes & Projets.", true); return; }
  notesLoading=true;
  $("notes-list").innerHTML='<p class="vide">Chargement de vos notes et projets…</p>';
  try { notesItems=await notesRead(); notesLoaded=true; notesRender(); notesStatus("Synchronisé avec Firebase · "+notesItems.length+" élément(s)."); }
  catch(e) { notesStatus("Chargement impossible : "+e.message,true); $("notes-list").innerHTML='<p class="vide">Impossible de charger vos notes. Vérifiez la connexion et les autorisations Firestore.</p>'; }
  finally { notesLoading=false; }
}
$("notes-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f=e.currentTarget.elements, id=f.id.value || notesId(), type=f.type.value;
  const item={id,type,title:f.title.value.trim(),category:f.category.value.trim(),body:f.body.value.trim()};
  if (type==="project") { item.status=f.status.value; item.due=f.due.value; item.steps=f.steps.value.trim(); }
  const btn=$("notes-save"); btn.disabled=true; notesStatus("Enregistrement dans Firebase…");
  try { const old=notesItems.find(x=>x.id===id); if(old) item.createdAt=old.createdAt; await notesSave(item,!!old); notesItems=[item,...notesItems.filter(x=>x.id!==id)].sort((a,b)=>String(b.updatedAt||"").localeCompare(String(a.updatedAt||""))); notesReset(); notesRender(); notesStatus("Enregistré et synchronisé avec Firebase."); }
  catch(err) { notesStatus("Enregistrement impossible : "+err.message,true); }
  finally { btn.disabled=false; }
});
$("notes-form").elements.type.addEventListener("change", e => notesSetType(e.target.value));
$("notes-cancel").addEventListener("click", notesReset);
$("notes-refresh").addEventListener("click", () => notesLoad(true));
$("notes-search").addEventListener("input", notesRender);
$("notes-filter").addEventListener("change", notesRender);
document.querySelector('[data-tab="notes"]')?.addEventListener("click", () => notesLoad());



// ---------- Thème clair / sombre : préférence indépendante du navigateur ----------
(function initThemeToggle(){
  const root=document.documentElement, button=$("theme-toggle"), icon=$("theme-toggle-icon"), label=$("theme-toggle-label");
  if(!button)return;
  function applyTheme(theme, save=true){
    const dark=theme==="dark";
    root.dataset.theme=dark?"dark":"light";
    button.setAttribute("aria-label",dark?"Passer au mode clair":"Passer au mode sombre");
    button.setAttribute("title",dark?"Activer le mode clair":"Activer le mode sombre");
    if(icon)icon.textContent=dark?"☀️":"🌙";
    if(label)label.textContent=dark?"Clair":"Sombre";
    if(save){try{localStorage.setItem("mwrs.theme",dark?"dark":"light");}catch{}}
  }
  applyTheme(root.dataset.theme==="dark"?"dark":"light",false);
  button.addEventListener("click",()=>applyTheme(root.dataset.theme==="dark"?"light":"dark"));
})();
