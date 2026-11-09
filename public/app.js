// app.js — interface My World RS : connexion Google, lecture Gmail/Agenda/Firestore, rendu.
import {
  messagesImportants, repartirAgenda, corpsEvenement, evaluerSeuil, construireAlertes,
  resumeDuJour, remplirModele, construireBrouillonBrut, construireMessageBrut, lireMessageComplet, expediteurLisible, enLots, typeCompte,
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
  calculerCreditsAvec, MESURES_CREDITS_AVEC, calculerEse, MESURES_ESE, calculerRistourne, calculerCaisseEse, decoderChamps,
} from "./firestore.js";
import { calculerRapport, dessinerRapport } from "./rapport.js";
import { construireContexteGlobal, preparerRequeteAssistant, extraireReponseAssistant, messageErreurAssistant } from "./assistant.js";
import { calculerMateriel, normaliserMateriel, calculerMaison, normaliserEntreeMaison, moisDe, CATEGORIES_PRO, CATEGORIES_REVENU_PRO, CATEGORIES_PROJET_PRO, CATEGORIES_MAISON, CATEGORIES_REVENU, CATEGORIES_CHANTIER } from "./maison.js";
import { dessinerRapportAppli } from "./rapport-appli.js";
import { lireFichiersKeep } from "./notes.js";
import { estLectureMemorisable, cleCache, analyserEcriture, reponseSimulee, superposerFile, ajouterALaFile, retirerDeLaFile, verdictRenvoi, ouvrirMemoire } from "./horsligne.js";

const $ = (id) => document.getElementById(id);
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  // Étoile / libellé « Important » posés depuis l'application
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  // Ajout et suppression de rendez-vous depuis l'onglet Agenda
  "https://www.googleapis.com/auth/calendar.events",
  // Lecture des bases Firestore avec les droits de VOTRE compte Google (propriétaire des projets)
  "https://www.googleapis.com/auth/datastore",
  // Métadonnées des fichiers et dossiers Google Drive (lecture seule)
  "https://www.googleapis.com/auth/drive.metadata.readonly",
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
  if (minuterieVerrouillage) clearTimeout(minuterieVerrouillage);
  minuterieVerrouillage = null;
  $("pin-gate").hidden = true;
  effacerJetonMemorise();
  memoireHL.vider();
  afficherSession(false);
  afficherBoutonRenouveler(false);
  const bc = $("bouton-connexion"); if (bc) bc.textContent = "Se connecter avec Google";
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
        if (minuterieVerrouillage) clearTimeout(minuterieVerrouillage);
        minuterieVerrouillage = null;
        $("pin-gate").hidden = true;
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
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) { const avait = !!navigator.serviceWorker.controller; navigator.serviceWorker.addEventListener("controllerchange", () => { if (avait) { majDispo = true; majBandeauReseau(); } }); }
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").then((reg) => { reg.update().catch(() => {}); return verifierPretHorsLigne(); }).catch((e) => console.info("Mode hors ligne : service worker indisponible", e?.message));

function afficherSession(connecte, nom = "") {
  if (modeTvSeule) return;
  if (connecte) demarrerSurveillanceSocial();
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
  catch (e) { if (reglages.googleClientId && fb?.auth.currentUser) afficherBoutonRenouveler(true); throw e; }
  finally { recuperationGoogleEnCours = null; }
}

const UID_SESSION_CHARGEE = new Set();
let minuterieVerrouillage = null;
let derniereActivite = Date.now();
let pinGateEnCours = null;
const DELAI_VERROUILLAGE = 10 * 60 * 1000;
const CLE_PIN_PREFIXE = "mwrs.pin.v1.";

function emailAutorise(user) {
  const autorise = String(reglages?.allowedGoogleEmail || "").trim().toLowerCase();
  return !!autorise && String(user?.email || "").trim().toLowerCase() === autorise;
}
function clePin(uid) { return CLE_PIN_PREFIXE + uid; }
async function hacherPin(pin, sel) {
  const enc = new TextEncoder();
  const materiel = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2", salt:enc.encode(sel), iterations:150000, hash:"SHA-256"}, materiel, 256);
  return Array.from(new Uint8Array(bits), b=>b.toString(16).padStart(2,"0")).join("");
}
function verrouillerApplication() {
  if (!utilisateurConnecte || pinGateEnCours) return;
  if (minuterieVerrouillage) clearTimeout(minuterieVerrouillage);
  minuterieVerrouillage = null;
  demanderPin(utilisateurConnecte).then(() => {
    if (UID_SESSION_CHARGEE.has(utilisateurConnecte.uid)) afficherSession(true, utilisateurConnecte.displayName || utilisateurConnecte.email);
  }).catch(e => afficherErreur(e?.message || "Verrouillage PIN indisponible."));
}
function programmerVerrouillage() {
  if (minuterieVerrouillage) clearTimeout(minuterieVerrouillage);
  minuterieVerrouillage = setTimeout(verrouillerApplication, DELAI_VERROUILLAGE);
}
function activerSurveillanceInactivite() {
  const activite = () => {
    if ($("pin-gate").hidden && utilisateurConnecte) {
      derniereActivite = Date.now();
      programmerVerrouillage();
    }
  };
  ["pointerdown","keydown","touchstart","mousemove","scroll"].forEach(ev=>document.addEventListener(ev,activite,{passive:true}));
}
activerSurveillanceInactivite();

async function demanderPin(user) {
  if (pinGateEnCours) return pinGateEnCours;
  pinGateEnCours = new Promise((resolve,reject)=>{
    const gate=$("pin-gate"),form=$("pin-gate-form"),input=$("pin-gate-input"),confirm=$("pin-confirmation");
    const cle=clePin(user.uid);
    let sauvegarde=null;
    try{sauvegarde=JSON.parse(localStorage.getItem(cle)||"null");}catch{}
    const mode=sauvegarde?.hash?"unlock":"create";
    form.dataset.mode=mode;
    gate.hidden=false;
    $("tableau").hidden=true;$("zone-connexion").hidden=true;
    $("pin-gate-titre").textContent=mode==="create"?"Créer votre PIN de sécurité":"Déverrouiller My World RS";
    $("pin-gate-description").textContent=mode==="create"?"Choisissez un PIN numérique de 6 chiffres. Il sera demandé à chaque nouvelle connexion ou après 10 minutes d’inactivité.":"Saisissez votre PIN de 6 chiffres pour accéder à votre espace.";
    $("pin-confirmation-wrap").hidden=mode!=="create";
    $("pin-gate-erreur").textContent="";
    input.value="";confirm.value="";
    input.focus();
    form.onsubmit=async event=>{
      event.preventDefault();
      const pin=input.value.trim();
      if(!/^\d{6}$/.test(pin)){ $("pin-gate-erreur").textContent="Le PIN doit contenir exactement 6 chiffres.";return;}
      try{
        if(mode==="create"){
          if(confirm.value.trim()!==pin){$("pin-gate-erreur").textContent="Les deux PIN ne correspondent pas.";return;}
          const sel=crypto.randomUUID();
          const hash=await hacherPin(pin,sel);
          localStorage.setItem(cle,JSON.stringify({sel,hash,createdAt:new Date().toISOString()}));
        }else{
          if(!sauvegarde?.sel||!sauvegarde?.hash||await hacherPin(pin,sauvegarde.sel)!==sauvegarde.hash){
            $("pin-gate-erreur").textContent="PIN incorrect. Réessayez.";input.value="";return;
          }
        }
        gate.hidden=true;
        programmerVerrouillage();
        resolve(true);
      }catch(err){$("pin-gate-erreur").textContent="Impossible de vérifier le PIN dans ce navigateur. Utilisez un navigateur récent et HTTPS.";reject(err);}
    };
  }).finally(()=>{pinGateEnCours=null;});
  return pinGateEnCours;
}

async function restaurerSessionGoogle(user) {
  await sondeDemarrage;
  if (modeTvSeule) return;
  if (connexionGoogleEnCours || uidSessionTraitee === user.uid) return;
  uidSessionTraitee = user.uid;
  if (!emailAutorise(user)) {
    afficherErreur("Compte Google non autorisé. Utilisez le compte Google configuré pour MY WORLD RS.");
    try { await fb.signOut(fb.auth); } catch {}
    uidSessionTraitee=null;
    return;
  }
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
    await demanderPin(user);
    if (UID_SESSION_CHARGEE.has(user.uid)) {
      afficherSession(true, user.displayName || user.email);
      return;
    }
    const passerHorsLigne = () => { noterHorsLigne(true); jetonGoogle = "hors-ligne"; jetonGoogleExpireA = 0; };
    if (!(await reseauAccessible())) passerHorsLigne();
    else {
      try { await obtenirJetonGoogle(); }
      catch (e) { if (erreurReseauHL(e) || !(await reseauAccessible())) passerHorsLigne(); else throw e; }
    }
    afficherSession(true, user.displayName || user.email);
    chargerProfilGoogle(user);
    await tout();
    await chargerWallet(true);
    UID_SESSION_CHARGEE.add(user.uid);
    if (paramsRetour.has("google")) history.replaceState({}, document.title, location.pathname + location.hash);
  } catch (e) {
    uidSessionTraitee = null;
    if (e.needsAuthorization || e.status === 409) {
      afficherErreur("Une autorisation Google unique est nécessaire. Ouverture de la page de confirmation…");
      await lancerAutorisationGoogle(user);
      return;
    }
    afficherSession(false);
    const b = $("bouton-connexion"); if (b) b.textContent = libelleConnexion();
    console.info("Session Google non renouvelée :", e?.message);
    throw new Error(reglages.googleClientId
      ? "Votre accès Google a expiré (il dure 1 heure). Cliquez sur « Reprendre ma session Google » : un clic, sans choisir de compte."
      : "Votre accès Google a expiré (il dure 1 heure). Cliquez sur « Se connecter avec Google » : une seule fois suffit.");
  }
}

const libelleConnexion = () => fb?.auth.currentUser && emailAutorise(fb.auth.currentUser) && reglages.googleClientId ? "Reprendre ma session Google" : "Se connecter avec Google";

// Votre identité reste connue du navigateur ; seul l'accès Gmail/Agenda (1 h) doit être renouvelé.
// Un clic suffit : fenêtre Google qui se ferme seule, sans choix de compte, sans rechargement.
async function renouvelerAccesGoogle() {
  const user = fb?.auth.currentUser;
  if (!user || !reglages.googleClientId) return false;
  const r = await renouvelerJetonSilencieux(user.email);
  jetonGoogle = r.access_token;
  jetonGoogleExpireA = Date.now() + (Number(r.expires_in) || 3600) * 1000;
  memoriserJetonGoogle(user.uid, jetonGoogle, jetonGoogleExpireA);
  afficherBoutonRenouveler(false);
  return true;
}
function afficherBoutonRenouveler(visible) { const b = $("bouton-renouveler"); if (b) b.hidden = !visible; }
$("bouton-renouveler")?.addEventListener("click", async () => {
  const b = $("bouton-renouveler"); if (b.disabled) return;
  b.disabled = true;
  try { await renouvelerAccesGoogle(); afficherErreur(""); await tout(); }
  catch (e) { afficherErreur("Renouvellement impossible (" + (e?.message || "fenêtre bloquée") + "). Autorisez les fenêtres surgissantes pour ce site, puis réessayez."); afficherBoutonRenouveler(true); }
  finally { b.disabled = false; }
});
// Surveillance : renouvelle en silence avant l'expiration ; si le navigateur bloque la fenêtre, propose le bouton « Renouveler l'accès »
let renouvellementAuto = false;
setInterval(async () => {
  if (renouvellementAuto || !jetonGoogle || !fb?.auth.currentUser || $("tableau")?.hidden) return;
  const restant = jetonGoogleExpireA - Date.now();
  if (restant > 6 * 60 * 1000) return;
  renouvellementAuto = true;
  try { await renouvelerAccesGoogle(); }
  catch { afficherBoutonRenouveler(true); }
  finally { renouvellementAuto = false; }
}, 30000);

async function seConnecter() {
  afficherErreur("");
  const bouton = $("bouton-connexion");
  bouton.disabled = true;
  bouton.textContent = "Connexion en cours…";
  try {
    await sdkPret;
    const existant = fb.auth.currentUser;
    if (existant && emailAutorise(existant) && reglages.googleClientId) {
      try {
        await renouvelerAccesGoogle();
        uidSessionTraitee = null;
        await restaurerSessionGoogle(existant);
        bouton.disabled = false; bouton.textContent = libelleConnexion();
        return;
      } catch (e) { console.info("Reprise en un clic impossible, connexion complète :", e?.message); }
    }
  } catch { /* le chargement du SDK est géré plus bas */ }
  connexionGoogleEnCours = true;
  try {
    await sdkPret;
    await fb.setPersistence(fb.auth, fb.browserLocalPersistence);
    const fournisseur = new fb.GoogleAuthProvider();
    SCOPES.forEach((scope) => fournisseur.addScope(scope));
    fournisseur.setCustomParameters({ prompt: "select_account" });
    const resultat = await fb.signInWithPopup(fb.auth, fournisseur);
    utilisateurConnecte = resultat.user;
    if (!emailAutorise(resultat.user)) {
      afficherErreur("Compte Google non autorisé. Utilisez le compte Google configuré pour MY WORLD RS.");
      connexionGoogleEnCours = false;
      await fb.signOut(fb.auth);
      return;
    }
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
      uidSessionTraitee = resultat.user.uid;
      await demanderPin(resultat.user);
      afficherSession(true, resultat.user.displayName || resultat.user.email);
      chargerProfilGoogle(resultat.user);
      await tout();
      await chargerWallet(true);
      UID_SESSION_CHARGEE.add(resultat.user.uid);
      // Situation attendue tant que les fonctions Firebase ne sont pas déployées : simple information, pas une erreur
      console.info("Renouvellement automatique indisponible :", erreurServeur?.message);
      afficherInfo("Connexion active pour environ 1 heure. Pour rester connecté plus longtemps, il faudra déployer les fonctions Firebase (voir la documentation).");
    }
  } catch (e) {
    connexionGoogleEnCours = false;
    if (e?.code !== "auth/cancelled-popup-request") afficherErreur(expliquerErreur(e));
  } finally {
    bouton.disabled = false;
    bouton.textContent = libelleConnexion();
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

// ---------- Mode sans internet ----------
// Les dernières réponses de Google sont gardées sur l'appareil ; les modifications de vos données privées
// (porte-monnaie, Ma maison, Projet pro…) faites sans connexion attendent dans une file et partent au retour d'internet.
const memoireHL = ouvrirMemoire();
const CLE_FILE_HL = "mwrs.hl.file";
let horsLigne = !navigator.onLine;
let synchroEnCours = false;
let messageSynchro = "";
let majDispo = false;
function lireFileHL() { try { const f = JSON.parse(localStorage.getItem(CLE_FILE_HL) || "[]"); return Array.isArray(f) ? f : []; } catch { return []; } }
function ecrireFileHL(f) { try { localStorage.setItem(CLE_FILE_HL, JSON.stringify(f)); } catch { /* stockage indisponible */ } majBandeauReseau(); }
function erreurReseauHL(e) { return !!(e?.reseau || e instanceof TypeError || /failed to fetch|network|load failed/i.test(e?.message || "")); }
// Vrai test de connexion : « navigator.onLine » dit parfois oui alors qu'aucune donnée ne passe (Wi-Fi sans internet).
let sondeReseau = { t: 0, ok: true };
async function reseauAccessible() {
  if (!navigator.onLine) return false;
  if (Date.now() - sondeReseau.t < 8000) return sondeReseau.ok;
  let ok = true;
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), 3500);
  try { await fetch("https://www.googleapis.com/generate_204?_=" + Date.now(), { mode: "no-cors", cache: "no-store", signal: c.signal }); }
  catch { ok = false; }
  clearTimeout(tm);
  sondeReseau = { t: Date.now(), ok };
  return ok;
}
function noterHorsLigne(v) { if (horsLigne !== v) { horsLigne = v; majBandeauReseau(); } }
function majBandeauReseau() {
  const b = $("bandeau-reseau"); if (!b) return;
  const n = lireFileHL().length;
  const attente = n ? ` · ${n} modification${n > 1 ? "s" : ""} en attente d'envoi` : "";
  let texte = "";
  if (horsLigne) texte = "📴 Mode hors ligne : vous voyez les dernières données enregistrées sur cet appareil" + attente + ". Tout sera synchronisé dès le retour d'internet.";
  else if (synchroEnCours) texte = "🔄 Synchronisation en cours" + attente + "…";
  else if (messageSynchro) texte = messageSynchro;
  else if (n) texte = "⏳" + attente.replace(" · ", " ") + " : envoi dès que la connexion est stable.";
  if (majDispo) { texte = "🔄 Une nouvelle version de My World RS est installée : cliquez ici pour recharger."; b.style.cursor = "pointer"; b.onclick = () => location.reload(); }
  b.textContent = texte; b.hidden = !texte;
}
window.addEventListener("offline", () => { noterHorsLigne(true); });
window.addEventListener("online", () => { reprendreConnexion(); });
async function reprendreConnexion() {
  sondeReseau = { t: 0, ok: true };
  if (!(await reseauAccessible())) return;
  noterHorsLigne(false);
  try { await obtenirJetonGoogle(); } catch { return; }
  await synchroniserFileHL(true);
}
async function synchroniserFileHL(rafraichir = false) {
  if (synchroEnCours || !navigator.onLine || !jetonGoogle || jetonGoogle === "hors-ligne") return;
  const depart = lireFileHL();
  if (!depart.length && !rafraichir) return;
  synchroEnCours = true; messageSynchro = ""; majBandeauReseau();
  let envoyees = 0, abandonnees = 0, interrompu = false;
  try {
    await obtenirJetonGoogle();
    for (const op of lireFileHL()) {
      let r;
      try {
        r = await fetch(op.url, { method: op.methode, headers: { Authorization: `Bearer ${jetonGoogle}`, "Content-Type": "application/json" }, body: op.body || undefined });
      } catch { interrompu = true; break; }
      const v = verdictRenvoi(op, r.status);
      if (v === "reseau") { interrompu = true; if (r.status === 401) { jetonGoogle = null; jetonGoogleExpireA = 0; } break; }
      ecrireFileHL(retirerDeLaFile(lireFileHL(), op.n));
      if (v === "ok") envoyees++; else abandonnees++;
    }
  } catch { interrompu = true; }
  finally { synchroEnCours = false; }
  if (!interrompu && (depart.length || rafraichir)) {
    messageSynchro = depart.length ? `✅ Synchronisé : ${envoyees} modification${envoyees > 1 ? "s" : ""} envoyée${envoyees > 1 ? "s" : ""}${abandonnees ? ` · ${abandonnees} ignorée${abandonnees > 1 ? "s" : ""} (déjà prises en compte ou refusées)` : ""}.` : "";
    majBandeauReseau();
    if ($("tableau") && !$("tableau").hidden) { try { await tout(); await chargerWallet(true); } catch { /* sera réessayé à l'actualisation */ } }
    if (messageSynchro) setTimeout(() => { messageSynchro = ""; majBandeauReseau(); }, 6000);
  } else majBandeauReseau();
}
setInterval(() => { if (navigator.onLine && lireFileHL().length) synchroniserFileHL(); }, 30000);
majBandeauReseau();
// ---------- Sans connexion au démarrage : seule la Télévision s'ouvre, sans PIN ----------
let modeTvSeule = false;
function modeTelevisionSeule() {
  if (modeTvSeule) return;
  modeTvSeule = true;
  ["zone-connexion", "tableau", "pin-gate", "bandeau-reseau", "erreur", "bouton-deconnexion"].forEach((id) => { const e = $(id); if (e) e.hidden = true; });
  $("tv-seule").hidden = false;
  tvOuvrir();
  const retour = setInterval(async () => {
    sondeReseau = { t: 0, ok: true };
    if (await reseauAccessible()) { clearInterval(retour); $("tv-seule-etat").textContent = "Connexion retrouvée, rechargement…"; setTimeout(() => location.reload(), 600); }
  }, 5000);
}
const sondeDemarrage = reseauAccessible().then((ok) => { if (!ok) modeTelevisionSeule(); return ok; });
document.getElementById("tv-seule-ouvrir")?.addEventListener("click", () => tvOuvrir());

// Vérifie que l'application et le kit Firebase sont bien gardés sur l'appareil, et le dit à l'utilisateur.
async function verifierPretHorsLigne() {
  try {
    await navigator.serviceWorker.ready;
    await new Promise((r) => setTimeout(r, 4000));
    const noms = await caches.keys(); const nom = noms.find((n) => n.startsWith("mwrs-sw-")); const c = nom && await caches.open(nom);
    const cles = c ? (await c.keys()).map((r) => r.url) : [];
    const ok = ["/app.js", "/index.html", "/style.css", "firebase-app.js", "firebase-auth.js"].every((f) => cles.some((u) => u.includes(f))) || (cles.some((u) => u.endsWith("/")) && ["/app.js", "firebase-app.js", "firebase-auth.js"].every((f) => cles.some((u) => u.includes(f))));
    let vu = false; try { vu = localStorage.getItem("mwrs.hl.pret") === "1"; } catch {}
    if (ok) { try { localStorage.setItem("mwrs.hl.pret", "1"); } catch {} if (!vu && !horsLigne) { messageSynchro = "✅ Mode hors ligne prêt : l'application s'ouvrira désormais sans internet sur cet appareil."; majBandeauReseau(); setTimeout(() => { messageSynchro = ""; majBandeauReseau(); }, 8000); } }
    else if (!horsLigne) { messageSynchro = "ℹ️ Mode hors ligne pas encore prêt : gardez la connexion internet et rechargez la page une fois."; majBandeauReseau(); setTimeout(() => { messageSynchro = ""; majBandeauReseau(); }, 8000); }
  } catch { /* navigateur sans service worker */ }
}
async function servirHorsLigne(url, options, cause) {
  noterHorsLigne(true);
  const op = analyserEcriture(url, options);
  if (op) { ecrireFileHL(ajouterALaFile(lireFileHL(), op)); return reponseSimulee(op); }
  if (estLectureMemorisable(url, options)) {
    const m = await memoireHL.lire(cleCache(url, options));
    if (m) {
      const r = superposerFile(url, m.v, lireFileHL());
      if (r !== null) return r;
      const e404 = new Error("Hors ligne : ce document a été supprimé."); e404.status = 404; throw e404;
    }
    const e = new Error("Hors ligne : cette section n'a pas encore été enregistrée sur cet appareil (ouvrez-la une fois avec internet)."); e.reseau = true; throw e;
  }
  const e = new Error("Hors ligne : cette action nécessite une connexion internet."); e.reseau = true; throw e;
}

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
  if (!navigator.onLine || (horsLigne && !(await reseauAccessible()))) return servirHorsLigne(url, options);
  try { await obtenirJetonGoogle(); }
  catch (e) { if (erreurReseauHL(e) || !(await reseauAccessible())) return servirHorsLigne(url, options, e); throw e; }
  const envoyer = () => fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${jetonGoogle}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  let r;
  try {
    r = await envoyer();
  } catch (e) {
    // Coupure réseau : un seul nouvel essai, uniquement pour les lectures (jamais pour une écriture, pour éviter les doublons)
    const lecture = !options.method || String(options.method).toUpperCase() === "GET" || /:run(Aggregation)?Query/.test(url);
    if (lecture) {
      await new Promise((ok) => setTimeout(ok, 1500));
      try { r = await envoyer(); } catch { r = null; }
    }
    if (!r) {
      const erreur = new Error("Connexion internet interrompue : Google est injoignable pour le moment. Vérifiez votre connexion (ou un bloqueur de publicités / VPN), l'application réessaiera toute seule.");
      erreur.reseau = true;
      if (analyserEcriture(url, options) || estLectureMemorisable(url, options)) return servirHorsLigne(url, options, erreur);
      throw erreur;
    }
  }
  noterHorsLigne(false);
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
    erreur.status = r.status;
    erreur.portee = r.status === 403 && /insufficient|scope/i.test(detail);
    throw erreur;
  }
  if (r.status === 204) return {};
  const donnees = await r.json();
  if (estLectureMemorisable(url, options)) {
    memoireHL.ecrire(cleCache(url, options), { t: Date.now(), v: donnees });
    return superposerFile(url, donnees, lireFileHL());
  }
  return donnees;
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
  driveFichiersIA = (ajouter ? driveFichiersIA : []).concat(fichiers.map(f => ({ name: f.name, mimeType: f.mimeType || "", modifiedTime: f.modifiedTime || "" })));
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
          <button data-lire="${echapper(m.id)}">Lire</button>
          <button data-important="${echapper(m.id)}" class="btn-important${m.etoile ? " actif" : ""}" aria-pressed="${m.etoile ? "true" : "false"}" title="${m.etoile ? "Retirer des messages importants" : "Marquer comme important"}">${m.etoile ? "★ Important" : "☆ Marquer important"}</button>
          <a href="https://mail.google.com/mail/u/0/#inbox/${m.threadId}" target="_blank" rel="noopener">Ouvrir</a>
          ${avecBrouillon ? `<button data-brouillon="${i}">Brouillon de réponse</button>` : ""}
        </div></li>`;
}

let filtreCompte = "tous"; // tous | personnel | professionnel
const domainesPerso = () => reglages.gmail?.domainesPersonnels || [];
const compteDe = (m, envoye = false) => typeCompte(envoye ? m.a : m.deBrut, domainesPerso());
const gardeCompte = (m, envoye = false) => filtreCompte === "tous" || compteDe(m, envoye) === filtreCompte;
function majCompteurs() {
  const vue = ["importants", "recus", "envoyes"].find((v) => !$("vue-" + v).hidden) || "importants";
  const liste = vue === "importants" ? etat.messages : vue === "recus" ? etat.recents : listeEnvoyes;
  const envoye = vue === "envoyes";
  const n = { tous: liste.length, personnel: 0, professionnel: 0 };
  liste.forEach((m) => { n[compteDe(m, envoye)]++; });
  document.querySelectorAll("[data-compteur]").forEach((s) => { s.textContent = liste.length ? String(n[s.dataset.compteur]) : ""; });
}
function rendreMessages() {
  const el = $("liste-messages");
  const vides = { personnel: "Aucun message de compte personnel.", professionnel: "Aucun message de compte professionnel." };
  const importants = etat.messages.map((m, i) => ({ m, i })).filter(({ m }) => gardeCompte(m));
  if (!importants.length) {
    el.innerHTML = '<li class="vide">' + (etat.messages.length && filtreCompte !== "tous" ? vides[filtreCompte] : "Rien d'important pour le moment.") + '</li>';
  } else {
    el.innerHTML = importants.map(({ m, i }) => ligneMessage(m, i, true)).join("");
    el.querySelectorAll("[data-brouillon]").forEach((b) => b.addEventListener("click", () => ouvrirModeles(Number(b.dataset.brouillon))));
  }
  const rec = $("liste-recents");
  if (rec) {
    const recents = etat.recents.map((m, i) => ({ m, i })).filter(({ m }) => gardeCompte(m));
    rec.innerHTML = recents.length
      ? recents.map(({ m, i }) => ligneMessage(m, i, false)).join("")
      : '<li class="vide">' + (etat.recents.length && filtreCompte !== "tous" ? vides[filtreCompte] : "Aucun message récent dans la boîte de réception.") + '</li>';
  }
  if (typeof listeEnvoyes !== "undefined" && envoyesCharges) rendreEnvoyes();
  majCompteurs();
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
let caisseEse = null; // somme de caisse d'ESE DB, affichée comme un compte (lecture seule) dans le porte-monnaie
function comptesCaisseEse() {
  if (!caisseEse) return [];
  return ["FC", "USD"].map(d => ({ name: "Caisse ESE DB", currency: d, balance: caisseEse[d] }));
}
function htmlCaisseEse() {
  const c = caisseEse; if (!c) return "";
  const dev = c.cur === "USD" ? "$" : "FC";
  return `<article class="wallet-account wallet-account-ese"><div><strong>Caisse ESE DB</strong><small>Somme restante en caisse · synchronisé depuis ESE DB</small></div><b class="${c.total<0?"neg":""}">${walletMoney(c.total,dev)}</b></article>`;
}

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
  const info = $("rist-part-info"), bouton = $("rist-part-enregistrer"), reinit = $("rist-part-reinit");
  if (!info || !bouton) return;
  if (reinit) reinit.disabled = !walletAccounts.some(a => a.name === NOM_COMPTE_PART);
  if (!derniereRistourne) { info.textContent = "Synchronisation avec ESE DB en attente…"; bouton.disabled = true; return; }
  const parts = calculerPartsRistourne().filter(p => p.solde > 0 || p.deja > 0);
  if (!parts.length) { info.textContent = "Aucun solde de ristourne disponible pour le moment."; bouton.disabled = true; return; }
  info.textContent = parts.map(p => `${p.devise} : part de 50 % = ${formatMontantDevise(p.cible, p.devise)} · déjà enregistrée ${formatMontantDevise(p.deja, p.devise)} · à enregistrer ${formatMontantDevise(Math.max(0, p.aEnregistrer), p.devise)}`).join("  |  ")
    + ". Une fois enregistrée, la somme est dans le compte « " + NOM_COMPTE_PART + " » : retirez-la ou utilisez-la avec une sortie ou un transfert.";
  bouton.disabled = !parts.some(p => p.aEnregistrer > 0);
}
const estPartRistourne = (x) => x.kind === "income" && x.category === "Ristourne" && String(x.description || "").startsWith("Part de ristourne");
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

// Réinitialise le compte « Mes parts de ristourne » : efface ses mouvements, remet solde et part enregistrée à zéro
async function reinitialiserPartsRistourne() {
  if (partRistourneEnCours) return;
  const comptes = walletAccounts.filter(a => a.name === NOM_COMPTE_PART);
  if (!comptes.length) return;
  const ids = new Set(comptes.map(a => a.id));
  const lignes = walletTransactions.filter(x => ids.has(x.accountId));
  const liens = new Set(lignes.filter(x => x.transferId).map(x => x.transferId));
  const lot = walletTransactions.filter(x => ids.has(x.accountId) || (x.transferId && liens.has(x.transferId)));
  const autres = lot.filter(x => !ids.has(x.accountId)).length;
  if (!confirm(`Réinitialiser « ${NOM_COMPTE_PART} » ?\n• ${lignes.length} mouvement(s) seront supprimés et le solde remis à 0.\n• La part de 50 % redeviendra entièrement « à enregistrer ».` + (autres ? `\n• ${autres} mouvement(s) liés dans d'autres comptes (transferts) seront aussi annulés.` : ""))) return;
  const statut = $("wallet-status"), uid = fb?.auth.currentUser?.uid;
  partRistourneEnCours = true;
  try {
    if (statut) statut.textContent = "Réinitialisation en cours…";
    for (const ligne of lot) {
      await walletDeleteDoc("walletTransactions", ligne.id);
      walletTransactions = walletTransactions.filter(x => x.id !== ligne.id);
      if (!ids.has(ligne.accountId)) {
        const autre = walletAccounts.find(a => a.id === ligne.accountId);
        if (autre) { const effet = walletEffet(ligne); await walletPatchAccount(autre, -effet); autre.balance = Number(autre.balance || 0) - effet; }
      }
    }
    for (const compte of comptes) {
      await google(urlFirestore(firebaseConfig.projectId, walletPath(uid, "walletAccounts", compte.id)) + "?updateMask.fieldPaths=balance&updateMask.fieldPaths=ristourneCredite", { method: "PATCH", body: JSON.stringify(walletFields({ balance: 0, ristourneCredite: 0 })) });
      compte.balance = 0; compte.ristourneCredite = 0;
    }
    walletRender();
    if (statut) statut.textContent = "Compte « " + NOM_COMPTE_PART + " » réinitialisé : cliquez sur « Enregistrer ma part » pour repartir sur une base correcte.";
  } catch (e) {
    walletRender();
    if (statut) statut.textContent = "Réinitialisation non terminée : " + e.message + " — cliquez sur « Actualiser » pour revérifier vos soldes.";
  } finally { partRistourneEnCours = false; rendrePartRistourne(); }
}
$("rist-part-reinit")?.addEventListener("click", reinitialiserPartsRistourne);

// ---------- Ma part de caisse ESE : 50 % de la somme restante en caisse, versés dans le solde professionnel ----------
const NOM_COMPTE_CAISSE = "Ma part de caisse ESE", TAUX_CAISSE = 0.5;
const estPartCaisse = (x) => x.kind === "income" && x.category === "Caisse ESE" && String(x.description || "").startsWith("Part de caisse ESE");
function calculerPartsCaisse() {
  return ["FC", "USD"].map(devise => {
    const solde = caisseEse ? Number(caisseEse[devise] || 0) : 0;
    const cible = Math.max(0, arrondir2(solde * TAUX_CAISSE));
    const compte = walletAccounts.find(a => a.name === NOM_COMPTE_CAISSE && a.currency === devise);
    const deja = Number(compte?.caisseCredite || 0);
    return { devise, solde, cible, deja, aEnregistrer: arrondir2(cible - deja), compte };
  });
}
function rendrePartCaisse() {
  const info = $("caisse-part-info"), bouton = $("caisse-part-enregistrer"), reinit = $("caisse-part-reinit");
  if (!info || !bouton) return;
  if (reinit) reinit.disabled = !walletAccounts.some(a => a.name === NOM_COMPTE_CAISSE);
  if (!caisseEse) { info.textContent = "Synchronisation avec ESE DB en attente…"; bouton.disabled = true; return; }
  const parts = calculerPartsCaisse().filter(p => p.cible > 0 || p.deja > 0);
  if (!parts.length) { info.textContent = "Aucune somme en caisse à partager pour le moment."; bouton.disabled = true; return; }
  info.textContent = parts.map(p => `${p.devise} : part de 50 % = ${formatMontantDevise(p.cible, p.devise)} · déjà encaissée ${formatMontantDevise(p.deja, p.devise)} · à encaisser ${formatMontantDevise(Math.max(0, p.aEnregistrer), p.devise)}`).join("  |  ")
    + ". Une fois encaissée, la somme est dans le compte professionnel « " + NOM_COMPTE_CAISSE + " ».";
  bouton.disabled = !parts.some(p => p.aEnregistrer > 0);
}
let partCaisseEnCours = false;
async function enregistrerPartCaisse() {
  if (partCaisseEnCours) return;
  const bouton = $("caisse-part-enregistrer"), statut = $("wallet-status");
  partCaisseEnCours = true; if (bouton) bouton.disabled = true;
  try {
    if (!walletLoaded) await chargerWallet(true);
    await chargerRistourne(true, true);
    const uid = fb?.auth.currentUser?.uid;
    if (!uid) throw new Error("Connectez-vous à votre compte Google.");
    const faits = [];
    for (const p of calculerPartsCaisse()) {
      if (!(p.aEnregistrer > 0)) continue;
      let compte = p.compte;
      if (!compte) {
        const id = walletId();
        compte = { name: NOM_COMPTE_CAISSE, type: "professional", currency: p.devise, balance: 0, caisseCredite: 0, createdAt: new Date().toISOString() };
        await walletCreate("walletAccounts", id, compte);
        compte = { ...compte, id }; walletAccounts.push(compte);
      }
      const tx = { kind: "income", accountId: compte.id, accountName: compte.name, accountType: compte.type, currency: p.devise, amount: p.aEnregistrer, category: "Caisse ESE", description: "Part de caisse ESE (50 %)", paymentMethod: "", date: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString() };
      const txId = walletId();
      await walletCreate("walletTransactions", txId, tx);
      const nouveauSolde = Number(compte.balance || 0) + p.aEnregistrer, nouveauCredite = p.deja + p.aEnregistrer;
      await google(urlFirestore(firebaseConfig.projectId, walletPath(uid, "walletAccounts", compte.id)) + "?updateMask.fieldPaths=balance&updateMask.fieldPaths=caisseCredite", { method: "PATCH", body: JSON.stringify(walletFields({ balance: nouveauSolde, caisseCredite: nouveauCredite })) });
      compte.balance = nouveauSolde; compte.caisseCredite = nouveauCredite;
      walletTransactions.unshift({ ...tx, id: txId });
      faits.push(formatMontantDevise(p.aEnregistrer, p.devise));
    }
    walletRender();
    if (statut) statut.textContent = faits.length ? "Part de caisse encaissée : " + faits.join(" + ") + " ajouté(s) au solde professionnel (« " + NOM_COMPTE_CAISSE + " »)." : "Rien de nouveau à encaisser.";
  } catch (e) {
    if (statut) statut.textContent = "Encaissement de la part impossible : " + e.message;
  } finally { partCaisseEnCours = false; rendrePartCaisse(); }
}
$("caisse-part-enregistrer")?.addEventListener("click", enregistrerPartCaisse);
async function reinitialiserPartsCaisse() {
  if (partCaisseEnCours) return;
  const comptes = walletAccounts.filter(a => a.name === NOM_COMPTE_CAISSE);
  if (!comptes.length) return;
  const ids = new Set(comptes.map(a => a.id));
  const lignes = walletTransactions.filter(x => ids.has(x.accountId));
  const liens = new Set(lignes.filter(x => x.transferId).map(x => x.transferId));
  const lot = walletTransactions.filter(x => ids.has(x.accountId) || (x.transferId && liens.has(x.transferId)));
  if (!confirm(`Réinitialiser « ${NOM_COMPTE_CAISSE} » ?\n• ${lignes.length} mouvement(s) seront supprimés et le solde remis à 0.\n• La part de 50 % redeviendra entièrement « à encaisser ».`)) return;
  const statut = $("wallet-status"), uid = fb?.auth.currentUser?.uid;
  partCaisseEnCours = true;
  try {
    for (const ligne of lot) {
      await walletDeleteDoc("walletTransactions", ligne.id);
      walletTransactions = walletTransactions.filter(x => x.id !== ligne.id);
      if (!ids.has(ligne.accountId)) {
        const autre = walletAccounts.find(a => a.id === ligne.accountId);
        if (autre) { const effet = walletEffet(ligne); await walletPatchAccount(autre, -effet); autre.balance = Number(autre.balance || 0) - effet; }
      }
    }
    for (const compte of comptes) {
      await google(urlFirestore(firebaseConfig.projectId, walletPath(uid, "walletAccounts", compte.id)) + "?updateMask.fieldPaths=balance&updateMask.fieldPaths=caisseCredite", { method: "PATCH", body: JSON.stringify(walletFields({ balance: 0, caisseCredite: 0 })) });
      compte.balance = 0; compte.caisseCredite = 0;
    }
    walletRender();
    if (statut) statut.textContent = "Compte « " + NOM_COMPTE_CAISSE + " » réinitialisé.";
  } catch (e) {
    walletRender();
    if (statut) statut.textContent = "Réinitialisation non terminée : " + e.message + " — cliquez sur « Actualiser ».";
  } finally { partCaisseEnCours = false; rendrePartCaisse(); }
}
$("caisse-part-reinit")?.addEventListener("click", reinitialiserPartsCaisse);

// ---------- Espaces « Ma maison » et « Projet pro » : dépenses, budgets, projet, matériel (même modèle) ----------
function creerEspaceProjet(cfg) {
  const $ = (id) => document.getElementById(id.replace(/^maison-/, cfg.p + "-").replace(/^materiel-/, cfg.m + "-"));
let maisonEntrees = [], maisonReglages = {}, maisonCharge = false;
const MAISON_LIBELLES = cfg.lib;
async function chargerMaison() {
  try {
    const [entrees, reglages] = await Promise.all([walletReadCollection(cfg.c.entries), walletReadCollection(cfg.c.settings)]);
    maisonEntrees = entrees.map(e => ({ ...e, amount: Number(e.amount || 0) })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    maisonReglages = reglages.find(r => r.id === "main") || {};
    maisonCharge = true;
  } catch (e) {
    const st = $("maison-status"); if (st) st.textContent = "Chargement de « " + cfg.nom + " » impossible : " + e.message;
  }
  rendreMaison();
}
function maisonCategories(section) { return section === "revenu" ? cfg.cat.revenu : section === "chantier" ? cfg.cat.chantier : cfg.cat.depense; }
function majComptesMaison() {
  const sel = $("maison-compte"), f = $("maison-form"); if (!sel || !f) return;
  const dev = f.elements.namedItem("currency")?.value === "USD" ? "USD" : "FC", precedent = sel.value;
  const comptes = walletAccounts.filter(a => a.currency === dev);
  sel.innerHTML = '<option value="">Aucun (suivi seulement)</option>' + comptes.map(a => `<option value="${echapper(a.id)}">${echapper(a.name)} · ${walletMoney(a.balance, a.currency)}</option>`).join("");
  if (comptes.some(a => a.id === precedent)) sel.value = precedent;
  const aide = $("maison-compte-aide"); if (aide) aide.textContent = comptes.length ? "Choisissez un compte pour que la dépense soit déduite de son solde (ou le revenu ajouté)." : "Aucun compte en " + dev + " dans votre porte-monnaie : l'opération sera seulement suivie ici.";
}
function majCategoriesMaison() {
  const sel = $("maison-categorie"), sec = $("maison-section")?.value || "depense";
  if (sel) sel.innerHTML = maisonCategories(sec).map(c => `<option>${echapper(c)}</option>`).join("");
}
function rendreMaison() {
  if (!$("maison-resume")) return;
  majComptesMaison();
  const m = calculerMaison(maisonEntrees, maisonReglages, moisDe());
  const dv = (o) => `${walletMoney(o.FC, "FC")}${o.USD ? " · " + walletMoney(o.USD, "USD") : ""}`;
  const pct = (o) => ["FC", "USD"].filter(d => o[d] !== null).map(d => `${o[d]} %${d === "USD" ? " (USD)" : ""}`).join(" · ") || "Budget non défini";
  $("maison-resume").innerHTML =
    `<article><span>Dépenses du mois</span><strong>${dv(m.depensesMois)}</strong><b>Budget utilisé : ${pct(m.budgetUtilise)}</b></article>` +
    `<article><span>Revenus du mois</span><strong>${dv(m.revenusMois)}</strong><b>${cfg.t.solde} : ${dv(m.soldeMois)}</b></article>` +
    `<article><span>${cfg.t.projet}</span><strong>${dv(m.chantier.depense)}</strong><b>Budget utilisé : ${pct(m.chantier.utilise)} · avancement ${m.chantier.avancement} %</b></article>`;
  const barre = (p) => p === null ? "" : `<div class="maison-barre${p > 100 ? " depasse" : ""}"><i style="width:${Math.min(100, p)}%"></i></div>`;
  const lignes = (arr) => arr.length ? arr.map(c => `<div class="maison-ligne"><span>${echapper(c.nom)}</span><b>${dv(c)}</b></div>`).join("") : '<p class="meta">Rien d\'enregistré.</p>';
  const restant = (o, bud) => ["FC", "USD"].filter(d => o[d] !== null).map(d => `${o[d] < 0 ? "Dépassement" : "Reste"} : ${walletMoney(Math.abs(o[d]), d)}`).join(" · ");
  $("maison-detail").innerHTML = `<div class="maison-detail-grille"><div><h4>${cfg.t.budget} · ${echapper(m.mois)}</h4>${barre(m.budgetUtilise.FC)}${barre(m.budgetUtilise.USD)}<p class="meta">${restant(m.budgetRestant) || "Définissez un budget mensuel pour suivre ce qu'il reste."}</p>${lignes(m.parCategorie)}</div>`
    + `<div><h4>${cfg.t.projet}</h4>${barre(m.chantier.utilise.FC)}${barre(m.chantier.utilise.USD)}<p class="meta">${restant(m.chantier.reste) || "Définissez le budget du projet pour suivre ce qu'il reste."}</p><div class="maison-barre"><i style="width:${m.chantier.avancement}%"></i></div><p class="meta">Avancement du chantier : ${m.chantier.avancement} %</p>${lignes(m.chantier.parCategorie)}</div></div>`;
  const f = $("maison-filtre")?.value || "all";
  const liste = maisonEntrees.filter(e => f === "all" || e.section === f);
  $("maison-liste").innerHTML = liste.length ? liste.slice(0, 80).map(e => `<div class="maison-liste-ligne"><div><strong>${echapper(e.category || "Autre")}</strong> · ${echapper(MAISON_LIBELLES[e.section] || "")}<small>${echapper(e.date || "")}${e.accountId ? " · " + echapper(walletAccountName(e.accountId)) : ""}${e.note ? " · " + echapper(e.note) : ""}</small></div><b>${e.section === "revenu" ? "+" : "−"} ${walletMoney(e.amount, e.currency === "USD" ? "USD" : "FC")}</b><button class="btn btn-secondary" type="button" data-maison-supprimer="${echapper(e.id)}">Supprimer</button></div>`).join("") : '<p class="meta">Aucune opération pour le moment.</p>';
  const form = $("maison-reglages");
  if (form && !form.dataset.rempli) {
    for (const k of ["budgetFC", "budgetUSD", "chantierFC", "chantierUSD", "avancement"]) { const el = form.elements.namedItem(k); if (el && maisonReglages[k] !== undefined && maisonReglages[k] !== "") el.value = maisonReglages[k]; }
    if (maisonCharge) form.dataset.rempli = "1";
    majAvancementMaison();
  }
}
function majAvancementMaison() { const r = $("maison-avancement"), v = $("maison-avancement-val"); if (r && v) v.textContent = r.value + " %"; }
async function ouvrirMaison() {
  const d = document.querySelector("#" + cfg.p + "-form input[name=date]"); if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
  if (!walletLoaded) await chargerWallet(false);
  if (!maisonCharge) await chargerMaison(); else rendreMaison();
  await chargerMateriel();
}
document.querySelector('[data-tab="' + cfg.tab + '"]')?.addEventListener("click", ouvrirMaison);
$("maison-section")?.addEventListener("change", majCategoriesMaison);
$("maison-form")?.elements.namedItem("currency")?.addEventListener("change", majComptesMaison);
$("maison-filtre")?.addEventListener("change", rendreMaison);
$("maison-avancement")?.addEventListener("input", majAvancementMaison);
majCategoriesMaison();
$("maison-form")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const st = $("maison-status"), f = ev.target;
  const res = normaliserEntreeMaison(Object.fromEntries(new FormData(f)));
  if (res.erreur) { if (st) st.textContent = res.erreur; return; }
  try {
    const id = walletId(), entree = { ...res.entree, createdAt: new Date().toISOString() };
    const compte = walletAccounts.find(a => a.id === f.elements.namedItem("accountId")?.value && a.currency === entree.currency);
    let note = "";
    if (compte) {
      const txId = walletId();
      const tx = { kind: entree.section === "revenu" ? "income" : "expense", accountId: compte.id, accountName: compte.name, accountType: compte.type, currency: entree.currency, amount: entree.amount, category: cfg.nom + " · " + entree.category, description: entree.note || (MAISON_LIBELLES[entree.section] + " : " + entree.category), paymentMethod: "", date: entree.date, createdAt: entree.createdAt, source: "maison" };
      await walletCreate("walletTransactions", txId, tx);
      await walletPatchAccount(compte, walletEffet(tx));
      compte.balance = Number(compte.balance || 0) + walletEffet(tx);
      walletTransactions.unshift({ ...tx, id: txId });
      entree.accountId = compte.id; entree.txId = txId;
      note = entree.section === "revenu" ? " Ajouté au compte « " + compte.name + " »." : " Déduit du compte « " + compte.name + " ».";
      walletRender();
    }
    await walletCreate(cfg.c.entries, id, entree);
    maisonEntrees.unshift({ ...entree, id });
    maisonEntrees.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    f.elements.namedItem("amount").value = ""; f.elements.namedItem("note").value = "";
    rendreMaison();
    if (st) st.textContent = "Opération enregistrée dans « " + cfg.nom + " »." + note;
  } catch (e) { if (st) st.textContent = "Enregistrement impossible : " + e.message; }
});
$("maison-reglages")?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const st = $("maison-status"), f = ev.target, uid = fb?.auth.currentUser?.uid;
  const nbr = (k) => { const n = Number(String(f.elements.namedItem(k).value || "0").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const reg = { budgetFC: nbr("budgetFC"), budgetUSD: nbr("budgetUSD"), chantierFC: nbr("chantierFC"), chantierUSD: nbr("chantierUSD"), avancement: Math.max(0, Math.min(100, nbr("avancement"))) };
  try {
    if (!uid) throw new Error("Connectez-vous à votre compte Google.");
    const masque = Object.keys(reg).map(k => "updateMask.fieldPaths=" + k).join("&");
    await google(urlFirestore(firebaseConfig.projectId, walletPath(uid, cfg.c.settings, "main")) + "?" + masque, { method: "PATCH", body: JSON.stringify(walletFields(reg)) });
    maisonReglages = { ...reg, id: "main" }; rendreMaison();
    if (st) st.textContent = "Budgets enregistrés.";
  } catch (e) { if (st) st.textContent = "Enregistrement des budgets impossible : " + e.message; }
});
$("maison-liste")?.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-maison-supprimer]"); if (!b) return;
  const id = b.dataset.maisonSupprimer, st = $("maison-status");
  if (!confirm("Supprimer cette opération ?")) return;
  try {
    const e = maisonEntrees.find(x => x.id === id); let note = "";
    if (e?.txId) {
      const tx = walletTransactions.find(x => x.id === e.txId), compte = walletAccounts.find(a => a.id === e.accountId);
      if (tx && compte) { const effet = walletEffet(tx); await walletPatchAccount(compte, -effet); compte.balance = Number(compte.balance || 0) - effet; note = " Le solde du compte « " + compte.name + " » a été rétabli."; }
      await walletDeleteDoc("walletTransactions", e.txId); walletTransactions = walletTransactions.filter(x => x.id !== e.txId);
      walletRender();
    }
    await walletDeleteDoc(cfg.c.entries, id); maisonEntrees = maisonEntrees.filter(x => x.id !== id); rendreMaison(); if (st) st.textContent = "Opération supprimée." + note; }
  catch (e) { if (st) st.textContent = "Suppression impossible : " + e.message; }
});

// ---------- Ma maison : matériel répertorié et matériel à ravitailler ----------
let materielItems = [];
async function chargerMateriel() {
  try { materielItems = (await walletReadCollection(cfg.c.items)).map(i => ({ ...i, qty: Number(i.qty || 1), price: Number(i.price || 0) })).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "fr")); }
  catch (e) { const st = $("maison-status"); if (st) st.textContent = "Chargement du matériel impossible : " + e.message; }
  rendreMateriel();
}
function majComptesAchat() {
  const sel = $("materiel-compte"); if (!sel) return;
  const prec = sel.value;
  sel.innerHTML = '<option value="">Choisir un compte…</option>' + walletAccounts.map(a => `<option value="${echapper(a.id)}">${echapper(a.name)} (${echapper(a.currency)}) · ${walletMoney(a.balance, a.currency)}</option>`).join("");
  if (walletAccounts.some(a => a.id === prec)) sel.value = prec;
}
function rendreMateriel() {
  if (!$("materiel-stock-liste")) return;
  majComptesAchat();
  const t = calculerMateriel(materielItems);
  const dv = (o) => [o.FC ? walletMoney(o.FC, "FC") : "", o.USD ? walletMoney(o.USD, "USD") : ""].filter(Boolean).join(" · ") || "0 FC";
  const stock = materielItems.filter(i => i.kind === "stock"), achats = materielItems.filter(i => i.kind === "ravitailler");
  const ordre = { Urgent: 0, Normal: 1, "Plus tard": 2 };
  achats.sort((a, b) => (ordre[a.priority] ?? 1) - (ordre[b.priority] ?? 1));
  $("materiel-total").textContent = stock.length ? `${stock.length} matériel(s) répertorié(s) · ${t.nbArticlesStock} pièce(s) · valeur estimée : ${dv(t.valeurStock)}` : "Aucun matériel répertorié.";
  $("materiel-achat-total").textContent = achats.length ? `${achats.length} article(s) à acheter · coût estimé : ${dv(t.coutAchats)}${t.urgents ? " · " + t.urgents + " urgent(s)" : ""}` : "Rien à acheter pour le moment.";
  const prix = (i) => i.price > 0 ? `${walletMoney(i.price, i.currency === "USD" ? "USD" : "FC")} × ${i.qty} = ${walletMoney(Math.round(i.price * i.qty * 100) / 100, i.currency === "USD" ? "USD" : "FC")}` : `× ${i.qty} · prix non renseigné`;
  $("materiel-stock-liste").innerHTML = stock.length ? stock.map(i => `<div class="maison-liste-ligne"><div><strong>${echapper(i.name)}</strong><small>${echapper(i.place || "")}${i.state ? " · " + echapper(i.state) : ""} · ${prix(i)}</small></div><span></span><button class="btn btn-secondary" type="button" data-materiel-supprimer="${echapper(i.id)}">Supprimer</button></div>`).join("") : "";
  $("materiel-achat-liste").innerHTML = achats.length ? achats.map(i => `<div class="maison-liste-ligne"><div><strong>${echapper(i.name)}</strong><small>${echapper(i.priority || "Normal")} · ${prix(i)}</small></div><button class="btn btn-primary" type="button" data-materiel-achete="${echapper(i.id)}">Acheté</button><button class="btn btn-secondary" type="button" data-materiel-supprimer="${echapper(i.id)}">Supprimer</button></div>`).join("") : "";
}
async function ajouterMateriel(ev, kind) {
  ev.preventDefault();
  const f = ev.target, st = $("maison-status");
  const res = normaliserMateriel({ ...Object.fromEntries(new FormData(f)), kind });
  if (res.erreur) { if (st) st.textContent = res.erreur; return; }
  try {
    const id = walletId(), item = { ...res.item, createdAt: new Date().toISOString() };
    await walletCreate(cfg.c.items, id, item);
    materielItems.push({ ...item, id });
    f.elements.namedItem("name").value = ""; f.elements.namedItem("qty").value = "1"; f.elements.namedItem("price").value = "";
    rendreMateriel();
    if (st) st.textContent = kind === "stock" ? "Matériel ajouté au répertoire." : "Article ajouté à la liste d'achats.";
  } catch (e) { if (st) st.textContent = "Enregistrement impossible : " + e.message; }
}
$("materiel-stock-form")?.addEventListener("submit", (ev) => ajouterMateriel(ev, "stock"));
$("materiel-achat-form")?.addEventListener("submit", (ev) => ajouterMateriel(ev, "ravitailler"));
["materiel-stock-liste", "materiel-achat-liste"].forEach(zone => $(zone)?.addEventListener("click", async (ev) => {
  const st = $("maison-status"), uid = fb?.auth.currentUser?.uid;
  const sup = ev.target.closest("[data-materiel-supprimer]"), ach = ev.target.closest("[data-materiel-achete]");
  try {
    if (sup) {
      if (!confirm("Supprimer ce matériel ?")) return;
      await walletDeleteDoc(cfg.c.items, sup.dataset.materielSupprimer);
      materielItems = materielItems.filter(i => i.id !== sup.dataset.materielSupprimer); rendreMateriel();
      if (st) st.textContent = "Matériel supprimé.";
    } else if (ach) {
      const item = materielItems.find(i => i.id === ach.dataset.materielAchete); if (!item || !uid) return;
      const totalPrevu = Math.round(item.price * item.qty * 100) / 100, devItem = item.currency === "USD" ? "USD" : "FC";
      const compte = walletAccounts.find(a => a.id === $("materiel-compte")?.value);
      if (totalPrevu > 0) {
        if (!compte) { if (st) st.textContent = "Choisissez d'abord le compte du porte-monnaie à débiter pour cet achat."; return; }
        if (compte.currency !== devItem) { if (st) st.textContent = "« " + item.name + " » est en " + devItem + " : choisissez un compte en " + devItem + "."; return; }
      }
      await google(urlFirestore(firebaseConfig.projectId, walletPath(uid, cfg.c.items, item.id)) + "?updateMask.fieldPaths=kind&updateMask.fieldPaths=state&updateMask.fieldPaths=place", { method: "PATCH", body: JSON.stringify(walletFields({ kind: "stock", state: "Neuf", place: item.place || "Autre" })) });
      Object.assign(item, { kind: "stock", state: "Neuf", place: item.place || "Autre" });
      let note = "";
      const total = Math.round(item.price * item.qty * 100) / 100;
      if (total > 0) {
        const entree = { section: "depense", category: "Autre", amount: total, currency: item.currency === "USD" ? "USD" : "FC", date: new Date().toISOString().slice(0, 10), note: "Achat de matériel : " + item.name, createdAt: new Date().toISOString() };
        if (compte) {
          const txId = walletId();
          const tx = { kind: "expense", accountId: compte.id, accountName: compte.name, accountType: compte.type, currency: entree.currency, amount: total, category: cfg.nom + " · Achat de matériel", description: "Achat de matériel : " + item.name, paymentMethod: "", date: entree.date, createdAt: entree.createdAt, source: "maison" };
          await walletCreate("walletTransactions", txId, tx);
          await walletPatchAccount(compte, walletEffet(tx));
          compte.balance = Number(compte.balance || 0) + walletEffet(tx);
          walletTransactions.unshift({ ...tx, id: txId });
          entree.accountId = compte.id; entree.txId = txId;
          walletRender();
        }
        const id = walletId(); await walletCreate(cfg.c.entries, id, entree); maisonEntrees.unshift({ ...entree, id });
        note = " " + walletMoney(total, entree.currency) + " déduit du compte « " + compte.name + " ».";
      }
      rendreMateriel(); rendreMaison();
      if (st) st.textContent = "« " + item.name + " » acheté : il rejoint " + cfg.t.rejoint + note;
    }
  } catch (e) { if (st) st.textContent = "Action impossible : " + e.message; }
}));
  return { ouvrir: ouvrirMaison, donnees: () => ({ nom: cfg.nom, charge: maisonCharge, calc: calculerMaison(maisonEntrees, maisonReglages, moisDe()), entrees: maisonEntrees, materiel: calculerMateriel(materielItems), articles: materielItems }) };
}
const ESPACE_MAISON = creerEspaceProjet({ p: "maison", m: "materiel", tab: "maison", nom: "Ma maison", c: { entries: "houseEntries", settings: "houseSettings", items: "houseItems" },
  cat: { depense: CATEGORIES_MAISON, revenu: CATEGORIES_REVENU, chantier: CATEGORIES_CHANTIER },
  lib: { depense: "Dépense maison", revenu: "Revenu du foyer", chantier: "Chantier" },
  t: { solde: "Solde du foyer", projet: "Projet de construction", budget: "Budget familial", rejoint: "le matériel de la maison." } });
const ESPACE_PRO = creerEspaceProjet({ p: "pro", m: "promat", tab: "pro", nom: "Projet pro", c: { entries: "proEntries", settings: "proSettings", items: "proItems" },
  cat: { depense: CATEGORIES_PRO, revenu: CATEGORIES_REVENU_PRO, chantier: CATEGORIES_PROJET_PRO },
  lib: { depense: "Dépense pro", revenu: "Revenu de l'activité", chantier: "Investissement" },
  t: { solde: "Solde de l'activité", projet: "Investissement du projet", budget: "Budget professionnel", rejoint: "le matériel du projet." } });

// ---------- Assistant IA (clé de l'API Claude conservée uniquement sur cet appareil) ----------
const IA_CLE = "mwrs_cle_claude";
const iaAfficheurs = [];
const iaMajTous = () => iaAfficheurs.forEach(f => f());
const iaLireCle = () => { try { return localStorage.getItem(IA_CLE) || ""; } catch { return ""; } };
const iaEcrireCle = (c) => { try { if (c) localStorage.setItem(IA_CLE, c); else localStorage.removeItem(IA_CLE); } catch {} };
let driveFichiersIA = [];
async function iaPreparerDonnees(portee) {
  if (portee.includes("finances")) {
    if (!walletLoaded) await chargerWallet(false);
    if (!ESPACE_MAISON.donnees().charge) await ESPACE_MAISON.ouvrir();
    if (!ESPACE_PRO.donnees().charge) await ESPACE_PRO.ouvrir();
  }
  if (portee.includes("notes") && !notesLoaded) await notesLoad();
  if (portee.includes("drive") && !driveFichiersIA.length && jetonGoogle) { try { await chargerDrive({ nouvelleRecherche: true }); } catch {} }
}
function iaContexte(portee) {
  return construireContexteGlobal(portee, {
    finances: { comptes: walletAccounts, mouvements: walletTransactions, caisse: caisseEse, espaces: [ESPACE_MAISON.donnees(), ESPACE_PRO.donnees()] },
    messages: { importants: etat.messages, recents: etat.recents }, agenda: etat.agenda, bases: etat.kpis, social: etat.social, notes: notesItems, drive: driveFichiersIA });
}
const IA_PORTEES = [["finances", "Finances (porte-monnaie, Ma maison, Projet pro, caisse ESE)"], ["messages", "Messages Gmail"], ["agenda", "Agenda"], ["bases", "Bases de données"], ["social", "Réseaux sociaux"], ["notes", "Notes et projets"], ["drive", "Fichiers Drive"]];
const IA_PORTEES_CLE = "mwrs_ia_portees";
function iaPorteesEnregistrees() { try { const v = JSON.parse(localStorage.getItem(IA_PORTEES_CLE) || "null"); if (Array.isArray(v)) return v.filter(x => IA_PORTEES.some(p => p[0] === x)); } catch {} return ["finances"]; }
function monterAssistant(cle, paneId, rubrique, suggestions, porteeFixe = null) {
  const entete = document.querySelector("#" + paneId + " .section-heading"); if (!entete) return;
  const id = (x) => "ia-" + cle + "-" + x;
  entete.insertAdjacentHTML("afterend", `<section class="carte ia-carte" id="${id("carte")}"><div class="card-heading"><div><p class="eyebrow">ASSISTANT IA</p><h3>Posez une question à l'assistant</h3></div></div>
    <form id="${id("cle-form")}" class="ia-cle" autocomplete="off"><p class="meta">Pour activer l'assistant, collez votre clé de l'API Claude. Elle reste uniquement sur cet appareil (navigateur) et n'est envoyée qu'à Anthropic. Utilisez une clé réservée à cet usage et dont la dépense est plafonnée.</p><div class="ia-ligne"><input id="${id("cle")}" type="password" placeholder="Clé de l'API Claude" autocomplete="off"><button class="btn btn-primary" type="submit">Enregistrer la clé</button></div></form>
    <div id="${id("zone")}" hidden>${porteeFixe ? "" : `<fieldset class="ia-portee"><legend>Données que l'assistant peut consulter pour répondre</legend>${IA_PORTEES.map(([k, l]) => `<label><input type="checkbox" data-ia-portee="${k}"${iaPorteesEnregistrees().includes(k) ? " checked" : ""}> ${echapper(l)}</label>`).join("")}</fieldset>`}<div class="ia-suggestions">${suggestions.map(([q, pt]) => `<button type="button" class="ia-chip" data-ia-question="${echapper(q)}" data-ia-pour="${echapper((pt || []).join(","))}">${echapper(q)}</button>`).join("")}</div>
      <div id="${id("fil")}" class="ia-fil" aria-live="polite"></div>
      <form id="${id("form")}" class="ia-ligne"><textarea id="${id("question")}" rows="2" maxlength="2000" placeholder="Posez votre question…"></textarea><button class="btn btn-primary" type="submit" id="${id("envoyer")}">Demander</button></form>
      <p class="meta">Seules les catégories cochées sont envoyées à l'IA, au moment où vous posez la question. Les réponses peuvent contenir des erreurs : vérifiez les montants importants. <button type="button" class="ia-lien" id="${id("effacer")}">Effacer la conversation</button> · <button type="button" class="ia-lien" id="${id("oublier")}">Supprimer la clé</button></p></div></section>`);
  const historique = []; let occupe = false;
  const porteeCochee = () => porteeFixe || [...document.querySelectorAll("#" + id("zone") + " [data-ia-portee]:checked")].map(c => c.dataset.iaPortee);
  const fil = $(id("fil")), zone = $(id("zone")), cleForm = $(id("cle-form"));
  const afficher = () => { const a = !!iaLireCle(); zone.hidden = !a; cleForm.hidden = a; };
  const bulle = (role, texte) => { const d = document.createElement("div"); d.className = "ia-msg ia-" + role; d.textContent = texte; fil.appendChild(d); fil.scrollTop = fil.scrollHeight; return d; };
  cleForm.addEventListener("submit", (ev) => { ev.preventDefault(); const v = $(id("cle")).value.trim(); if (v.length < 20) { return; } iaEcrireCle(v); $(id("cle")).value = ""; iaMajTous(); });
  $(id("oublier")).addEventListener("click", () => { if (confirm("Supprimer la clé enregistrée sur cet appareil ?")) { iaEcrireCle(""); iaMajTous(); } });
  $(id("effacer")).addEventListener("click", () => { historique.length = 0; fil.innerHTML = ""; });
  async function poser(question) {
    question = String(question || "").trim(); if (!question || occupe) return;
    const portee = porteeCochee();
    if (!portee.length) { const d = document.createElement("div"); d.className = "ia-msg ia-assistant ia-erreur"; d.textContent = "Cochez au moins une catégorie de données que l'assistant peut consulter."; fil.appendChild(d); return; }
    occupe = true; $(id("envoyer")).disabled = true;
    bulle("user", question);
    const attente = bulle("assistant", "Réflexion en cours…");
    try {
      await iaPreparerDonnees(portee);
      const req = preparerRequeteAssistant({ cle: iaLireCle(), contexte: iaContexte(portee), rubrique, historique, question });
      const rep = await fetch(req.url, req.options);
      let json = null; try { json = await rep.json(); } catch {}
      if (!rep.ok) throw new Error(messageErreurAssistant(rep.status, json));
      const texte = extraireReponseAssistant(json) || "Je n'ai pas pu formuler de réponse.";
      attente.textContent = texte;
      historique.push({ role: "user", content: question }, { role: "assistant", content: texte });
    } catch (e) {
      attente.textContent = e.message && !/Failed to fetch|NetworkError/i.test(e.message) ? e.message : "Connexion à l'IA impossible : vérifiez votre connexion internet.";
      attente.classList.add("ia-erreur");
    } finally { occupe = false; $(id("envoyer")).disabled = false; }
  }
  $(id("form")).addEventListener("submit", (ev) => { ev.preventDefault(); const q = $(id("question")).value; $(id("question")).value = ""; poser(q); });
  zone.addEventListener("change", (ev) => { if (ev.target.matches("[data-ia-portee]")) { try { localStorage.setItem(IA_PORTEES_CLE, JSON.stringify(porteeCochee())); } catch {} } });
  zone.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ia-question]"); if (!b) return;
    (b.dataset.iaPour || "").split(",").filter(Boolean).forEach(k => { const c = zone.querySelector(`[data-ia-portee="${k}"]`); if (c) c.checked = true; });
    zone.dispatchEvent(new Event("change", { bubbles: false })); try { localStorage.setItem(IA_PORTEES_CLE, JSON.stringify(porteeCochee())); } catch {}
    poser(b.dataset.iaQuestion);
  });
  iaAfficheurs.push(afficher);
  afficher();
}
// ===== Télévision (Ma maison) : le lecteur s'ouvre en plein écran à chaque clic =====
async function tvHtml() {
  if (typeof window.__TV_HTML__ === "string") return window.__TV_HTML__;
  const r = await fetch("television.html", { cache: "no-cache" }); if (!r.ok) throw new Error("television.html introuvable");
  return r.text();
}
let tvMinuteur = null;
function tvTitreEnCours() { try { const t = document.querySelector("#tv-zone iframe")?.contentDocument?.title || ""; return t.replace(/ — Lecteur Pro$/, "") || "Télévision en lecture"; } catch { return "Télévision en lecture"; } }
// Masquer = le lecteur disparaît mais continue de jouer (son/vidéo) ; une petite pastille permet de le réafficher.
function tvMasquer() {
  const fen = document.getElementById("tv-fenetre"); if (fen.hidden || !document.querySelector("#tv-zone iframe")) return;
  fen.classList.add("masque");
  document.getElementById("tv-mini").hidden = false;
  const maj = () => { document.getElementById("tv-mini-titre").textContent = tvTitreEnCours(); };
  maj(); clearInterval(tvMinuteur); tvMinuteur = setInterval(maj, 2000);
}
function tvAfficher() { document.getElementById("tv-fenetre").classList.remove("masque"); document.getElementById("tv-mini").hidden = true; clearInterval(tvMinuteur); }
async function tvOuvrir() {
  const fen = document.getElementById("tv-fenetre"), zone = document.getElementById("tv-zone");
  if (zone.querySelector("iframe")) { fen.hidden = false; tvAfficher(); return; } // déjà lancé : on le réaffiche sans le relancer
  zone.innerHTML = ""; fen.hidden = false; tvAfficher();
  try {
    const f = document.createElement("iframe");
    f.title = "Télévision"; f.allow = "fullscreen; autoplay; picture-in-picture"; f.setAttribute("allowfullscreen", "");
    f.srcdoc = await tvHtml(); zone.appendChild(f);
  } catch (e) { zone.textContent = "Impossible de charger la télévision : " + e.message; zone.style.color = "#fff"; zone.style.padding = "20px"; }
}
function tvFermer() { tvAfficher(); document.getElementById("tv-zone").innerHTML = ""; document.getElementById("tv-fenetre").hidden = true; }
document.getElementById("tv-ouvrir")?.addEventListener("click", tvOuvrir);
document.getElementById("dash-media")?.addEventListener("click", tvOuvrir);
document.getElementById("tv-fermer")?.addEventListener("click", tvFermer);
document.getElementById("tv-masquer")?.addEventListener("click", tvMasquer);
document.getElementById("tv-mini-afficher")?.addEventListener("click", tvOuvrir);
document.getElementById("tv-mini-arreter")?.addEventListener("click", tvFermer);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.getElementById("tv-fenetre").hidden && !document.getElementById("tv-fenetre").classList.contains("masque")) tvMasquer(); });

// L'assistant vit dans son propre onglet « Assistant IA » (en bas du menu) et n'apparaît dans aucun autre.
monterAssistant("assistant", "pane-assistant", "Assistant IA", [
  ["Fais-moi un résumé de ma situation", ["finances", "agenda", "messages"]],
  ["Où est parti mon argent ce mois-ci ?", ["finances"]],
  ["Que dois-je faire aujourd'hui ?", ["agenda", "messages"]],
  ["Quels messages demandent une réponse ?", ["messages"]],
  ["Explique-moi mes indicateurs", ["bases"]],
  ["Résume mes notes et projets", ["notes"]]]);

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
    caisseEse = calculerCaisseEse(jours, cfg);
    rendreRistourne(r);
    rendrePartRistourne();
    rendrePartCaisse();
    if (walletLoaded) walletRender();
    if (statut) statut.textContent = `Synchronisé avec ESE DB à ${heure.format(new Date())} · ${r.mouvements} mouvement(s) de ristourne lus.`;
  } catch (e) {
    if (statut) statut.textContent = "Synchronisation ESE DB impossible : " + e.message;
    if (silencieux) throw e;
  }
}

async function chargerWallet(force = false) {
  chargerRistourne(force);
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
  rendrePartCaisse();
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
  $("wallet-accounts").innerHTML = (walletAccounts.length || caisseEse) ? htmlCaisseEse() + walletAccounts.map(a => `<article class="wallet-account"><div><strong>${echapper(a.name)}</strong><small>${a.type==="personal"?"Personnel":"Professionnel"} · ${echapper(a.currency)}</small></div><b>${walletMoney(a.balance,a.currency)}</b></article>`).join("") : '<p class="vide">Aucun compte. Créez votre premier compte.</p>';
  walletRenderForecasts();
  const options = walletAccounts.map(a=>`<option value="${echapper(a.id)}">${echapper(a.name)} — ${a.currency} (${a.type==="personal"?"Personnel":"Pro"})</option>`).join("");
  ["wallet-op-account","wallet-transfer-from","wallet-transfer-to"].forEach(id => { const el=$(id); if(el){const old=el.value;el.innerHTML=options || '<option value="">Créez d’abord un compte</option>';if(walletAccounts.some(a=>a.id===old))el.value=old;} });
  const filter=$("wallet-history-account"), old=filter.value;
  filter.innerHTML='<option value="all">Tous les comptes</option>'+options;
  if(walletAccounts.some(a=>a.id===old))filter.value=old;
  const selectedCurrency=$("wallet-chart-currency")?.value || "FC";
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
  const currency=$("wallet-chart-currency")?.value || "FC";
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
  const currency=$("wallet-chart-currency")?.value || "FC";
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
  if (!confirm(`Supprimer ${resume} ?\nLe solde du compte sera corrigé automatiquement.${estPartRistourne(tx) ? "\nLa somme redeviendra « à enregistrer » dans le bloc des ristournes." : ""}`)) return;
  const status = $("wallet-status");
  try {
    if (status) status.textContent = "Suppression en cours…";
    let partRetiree = false;
    for (const ligne of lot) {
      await walletDeleteDoc("walletTransactions", ligne.id);
      walletTransactions = walletTransactions.filter((x) => x.id !== ligne.id);
      const compte = walletAccounts.find((a) => a.id === ligne.accountId);
      if (compte) {
        const effet = walletEffet(ligne);
        await walletPatchAccount(compte, -effet);
        compte.balance = Number(compte.balance || 0) - effet;
        // Part de ristourne supprimée : la somme redevient « à enregistrer »
        if (estPartCaisse(ligne)) {
          const credite = Math.max(0, arrondir2(Number(compte.caisseCredite || 0) - Number(ligne.amount || 0)));
          const uid = fb?.auth.currentUser?.uid;
          await google(urlFirestore(firebaseConfig.projectId, walletPath(uid, "walletAccounts", compte.id)) + "?updateMask.fieldPaths=caisseCredite", { method: "PATCH", body: JSON.stringify(walletFields({ caisseCredite: credite })) });
          compte.caisseCredite = credite;
          partRetiree = true;
        }
        if (estPartRistourne(ligne)) {
          const credite = Math.max(0, arrondir2(Number(compte.ristourneCredite || 0) - Number(ligne.amount || 0)));
          const uid = fb?.auth.currentUser?.uid;
          await google(urlFirestore(firebaseConfig.projectId, walletPath(uid, "walletAccounts", compte.id)) + "?updateMask.fieldPaths=ristourneCredite", { method: "PATCH", body: JSON.stringify(walletFields({ ristourneCredite: credite })) });
          compte.ristourneCredite = credite;
          partRetiree = true;
        }
      }
    }
    walletRender();
    if (partRetiree && status) { status.textContent = "Part supprimée : la somme est de nouveau « à enregistrer / à encaisser » dans son bloc."; return; }
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

async function collecterDonneesRapport() {
  const essayer = async (f) => { try { return await f(); } catch { return null; } };
  const status = $("rapport-appli-status"), etape = (t) => { if (status) status.textContent = t; };
  const d = {};
  const form = $("form-profil"), pf = {};
  ["nom","postnom","prenom","naissance","sexe","telephone","adresse"].forEach(k => { pf[k] = form?.elements.namedItem(k)?.value?.trim() || ""; });
  pf.email = utilisateurConnecte?.email || ""; d.profil = pf;
  if (jetonGoogle) {
    etape("Lecture de vos messages et de votre agenda…");
    const [gm, ag, kp] = await Promise.all([
      etat.recents.length ? { importants: etat.messages, recents: etat.recents } : essayer(chargerGmail),
      (etat.agenda.aujourdhui.length || etat.agenda.aVenir.length) ? etat.agenda : essayer(chargerAgenda),
      etat.kpis.length ? etat.kpis : essayer(() => chargerKpis()),
    ]);
    if (gm) d.messages = { recents: gm.recents.length, nonLus: gm.recents.filter(x => x.nonLu).length, importants: gm.importants };
    if (ag) d.agenda = ag;
    if (kp) d.indicateurs = kp;
    etape("Lecture du porte-monnaie, des ristournes et des notes…");
    await essayer(() => walletLoaded ? null : chargerWallet(true));
    if (walletLoaded) {
      const totaux = {};
      for (const t of walletTransactions) {
        const dv = t.currency || "—", x = totaux[dv] ||= { revenus: 0, depenses: 0, solde: 0 };
        if (t.kind === "income") x.revenus += t.amount; else if (t.kind === "expense") x.depenses += t.amount;
      }
      for (const a of walletAccounts) { const x = totaux[a.currency || "—"] ||= { revenus: 0, depenses: 0, solde: 0 }; x.solde += a.balance; }
      d.wallet = { comptes: walletAccounts, nbMouvements: walletTransactions.length, totaux, derniers: walletTransactions.slice(0, 15).map(t => ({ ...t, compte: walletAccountName(t.accountId) })) };
    }
    if (!derniereRistourne) await essayer(() => chargerRistourne(false, true));
    if (derniereRistourne) d.ristourne = derniereRistourne;
  }
  await essayer(() => notesLoad());
  if (notesLoaded) d.notes = notesItems;
  d.social = etat.social;
  return d;
}
async function exporterRapportAppli() {
  const btn=$("rapport-appli-pdf"), status=$("rapport-appli-status");
  if(btn?.disabled)return;
  if(btn){btn.disabled=true;btn.dataset.ancienTexte=btn.textContent;btn.textContent="Préparation du PDF…";}
  try {
    const donnees=await collecterDonneesRapport();
    const JsPDF=await walletChargerJsPdf();
    const doc=new JsPDF({orientation:"portrait",unit:"mm",format:"a4"});
    dessinerRapportAppli(doc,{date:new Date(),utilisateur:utilisateurConnecte?.displayName||utilisateurConnecte?.email||"",donnees});
    doc.save("My-World-RS_Rapport-complet_"+new Date().toISOString().slice(0,10)+".pdf");
    if(status)status.textContent="Rapport téléchargé avec vos données.";
  }catch(e){if(status)status.textContent="Export PDF impossible : "+e.message;}
  finally{if(btn){btn.disabled=false;btn.textContent=btn.dataset.ancienTexte||"↓ Télécharger le rapport de l'application";}}
}
$("rapport-appli-pdf")?.addEventListener("click",exporterRapportAppli);

$("wallet-export")?.addEventListener("click",()=>{
  const rows=[["Date","Compte","Type","Devise","Montant","Catégorie","Description"],...walletTransactions.map(t=>[t.date,t.accountName,t.kind,t.currency,t.amount,t.category,t.description])];
  const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\r\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="mon-porte-monnaie.csv";a.click();URL.revokeObjectURL(url);
});
walletSetDateDefaults();
//
// ---------- Nouveau mail Gmail ----------
const nouveauMailDialog = $("nouveau-mail-dialog");
const MAX_PJ = 10 * 1024 * 1024;
let piecesJointes = [];
let reponseEnCours = null; // { threadId, messageId } quand on répond à un message
const tailleLisible = (o) => (o >= 1048576 ? (o / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(o / 1024)) + " Ko");
function rendrePiecesJointes() {
  const ul = $("nouveau-mail-pj");
  ul.innerHTML = piecesJointes.map((f, i) => `<li><span>📎 ${echapper(f.nom)} <span class="meta">${tailleLisible(f.taille)}</span></span><button type="button" data-pj-retirer="${i}" aria-label="Retirer">✕</button></li>`).join("");
  ul.querySelectorAll("[data-pj-retirer]").forEach((b) => b.addEventListener("click", () => { piecesJointes.splice(Number(b.dataset.pjRetirer), 1); rendrePiecesJointes(); }));
}
function fichierEnBase64(fichier) {
  return new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => ko(new Error("Lecture du fichier impossible : " + fichier.name));
    lecteur.onload = () => ok(String(lecteur.result).split(",")[1] || "");
    lecteur.readAsDataURL(fichier);
  });
}
$("nouveau-mail-fichiers").addEventListener("change", async (e) => {
  const choisis = [...e.target.files];
  e.target.value = "";
  const statut = $("nouveau-mail-statut");
  for (const f of choisis) {
    if (piecesJointes.reduce((s, x) => s + x.taille, 0) + f.size > MAX_PJ) { statut.textContent = `« ${f.name} » dépasse la limite de 10 Mo au total : non joint.`; continue; }
    try { piecesJointes.push({ nom: f.name, type: f.type || "application/octet-stream", taille: f.size, base64: await fichierEnBase64(f) }); statut.textContent = ""; }
    catch (err) { statut.textContent = err.message; }
  }
  rendrePiecesJointes();
});
$("nouveau-mail").addEventListener("click", () => {
  $("nouveau-mail-form").reset();
  piecesJointes = []; rendrePiecesJointes(); reponseEnCours = null;
  $("nouveau-mail-titre").textContent = "Nouveau mail";
  $("nouveau-mail-statut").textContent = "";
  nouveauMailDialog.showModal();
});
$("nouveau-mail-fermer").addEventListener("click", () => nouveauMailDialog.close());
const URL_GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me/";
const messageEnvoye = (texte) => {
  afficherErreur("");
  $("confirmation").textContent = texte;
  $("confirmation").hidden = false;
  setTimeout(() => ($("confirmation").hidden = true), 8000);
};
async function envoyerOuEnregistrerMail(envoyer) {
  const form = $("nouveau-mail-form");
  if (!form.reportValidity()) return;
  const donnees = new FormData(form);
  const a = String(donnees.get("a") || "").trim();
  const cc = String(donnees.get("cc") || "").trim();
  const sujet = String(donnees.get("sujet") || "").trim();
  const corps = String(donnees.get("corps") || "").trim();
  if (envoyer && !confirm(`Envoyer ce mail à ${a}${cc ? " (Cc : " + cc + ")" : ""} ?\nObjet : ${sujet}` + (piecesJointes.length ? `\nPièces jointes : ${piecesJointes.map((f) => f.nom).join(", ")}` : ""))) return;
  const boutons = [$("nouveau-mail-creer"), $("nouveau-mail-envoyer")];
  boutons.forEach((b) => (b.disabled = true));
  $("nouveau-mail-statut").textContent = envoyer ? "Envoi en cours…" : "Création du brouillon…";
  try {
    const raw = construireMessageBrut({ a, cc, sujet, corps, pieces: piecesJointes, enReponseA: reponseEnCours?.messageId });
    const threadId = reponseEnCours?.threadId;
    if (envoyer) await google(URL_GMAIL + "messages/send", { method: "POST", body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }) });
    else await google(URL_GMAIL + "drafts", { method: "POST", body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }) });
    nouveauMailDialog.close();
    if (envoyer) { envoyesCharges = false; if (!$("vue-envoyes").hidden) chargerEnvoyes(); }
    messageEnvoye(envoyer ? `Mail envoyé à ${a}${piecesJointes.length ? " avec " + piecesJointes.length + " pièce(s) jointe(s)" : ""}.` : "Brouillon créé dans Gmail. Vous pouvez le relire et l’envoyer depuis Gmail.");
  } catch (e) {
    $("nouveau-mail-statut").textContent = "";
    afficherErreur(`${envoyer ? "Mail non envoyé" : "Brouillon non créé"} : ${e.message}`);
  } finally {
    boutons.forEach((b) => (b.disabled = false));
  }
}
$("nouveau-mail-form").addEventListener("submit", (event) => { event.preventDefault(); envoyerOuEnregistrerMail(true); });
$("nouveau-mail-creer").addEventListener("click", () => envoyerOuEnregistrerMail(false));


// ---------- Mails envoyés et lecture d'un message ----------
let envoyesCharges = false, envoyesEnCours = false, listeEnvoyes = [];
function rendreEnvoyes() {
  const zone = $("liste-envoyes");
  const visibles = listeEnvoyes.filter((m) => gardeCompte(m, true));
  zone.innerHTML = visibles.length ? visibles.map((m) => `<li><div class="ligne"><strong>À : ${echapper(expediteurLisible(m.a) || m.a || "—")}</strong><span class="meta">${m.date ? jourHeure.format(new Date(m.date)) : ""}</span></div><div>${echapper(m.sujet)}</div><div class="extrait">${echapper(m.extrait)}</div><div class="actions"><button data-lire="${echapper(m.id)}">Lire</button><a href="https://mail.google.com/mail/u/0/#sent/${m.threadId}" target="_blank" rel="noopener">Ouvrir</a></div></li>`).join("")
    : '<li class="vide">' + (listeEnvoyes.length ? (filtreCompte === "personnel" ? "Aucun mail envoyé vers un compte personnel." : "Aucun mail envoyé vers un compte professionnel.") : "Aucun mail envoyé trouvé.") + '</li>';
  majCompteurs();
}
async function chargerEnvoyes() {
  if (envoyesEnCours) return;
  envoyesEnCours = true;
  const zone = $("liste-envoyes");
  try {
    if (!envoyesCharges) zone.innerHTML = '<li class="vide">Chargement des mails envoyés…</li>';
    const liste = await google(URL_GMAIL + "messages?maxResults=30&q=" + encodeURIComponent("in:sent"));
    const complets = await enLots((liste.messages || []).map((m) => m.id), 4, (id) =>
      google(URL_GMAIL + `messages/${id}?format=metadata&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`));
    const h = (m, n) => (m.payload?.headers || []).find((x) => x.name.toLowerCase() === n)?.value || "";
    listeEnvoyes = complets.map((m) => ({ id: m.id, threadId: m.threadId, a: h(m, "to"), cc: h(m, "cc"), sujet: h(m, "subject") || "(sans objet)", extrait: m.snippet || "", date: Number(m.internalDate || 0) }))
      .sort((x, y) => y.date - x.date);
    envoyesCharges = true;
    rendreEnvoyes();
  } catch (e) {
    zone.innerHTML = `<li class="vide">Mails envoyés indisponibles : ${echapper(e.message)}</li>`;
  } finally { envoyesEnCours = false; }
}
$("envoyes-actualiser").addEventListener("click", () => chargerEnvoyes());
const TEXTES_VUES = { importants: "Les messages qui méritent votre attention.", recus: "Vos messages Gmail récents, importants ou non.", envoyes: "Les derniers messages que vous avez envoyés, depuis Gmail ou cette application." };
function choisirVueMessages(vue) {
  ["importants", "recus", "envoyes"].forEach((v) => { $("vue-" + v).hidden = v !== vue; });
  document.querySelectorAll("[data-vue-messages]").forEach((b) => { const actif = b.dataset.vueMessages === vue; b.classList.toggle("vue-actif", actif); b.setAttribute("aria-pressed", String(actif)); });
  $("messages-vue-texte").textContent = TEXTES_VUES[vue];
  if (vue === "envoyes" && !envoyesCharges) chargerEnvoyes();
  majCompteurs();
}
document.querySelectorAll("[data-compte-messages]").forEach((b) => b.addEventListener("click", () => {
  filtreCompte = b.dataset.compteMessages;
  document.querySelectorAll("[data-compte-messages]").forEach((x) => { const actif = x === b; x.classList.toggle("vue-actif", actif); x.setAttribute("aria-pressed", String(actif)); });
  rendreMessages();
}));
document.querySelectorAll("[data-vue-messages]").forEach((b) => b.addEventListener("click", () => choisirVueMessages(b.dataset.vueMessages)));

async function telechargerPieceJointe(idMessage, piece) {
  const r = await google(URL_GMAIL + `messages/${idMessage}/attachments/${piece.idPiece}`);
  const bin = atob(String(r.data || "").replace(/-/g, "+").replace(/_/g, "/"));
  const octets = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const lien = document.createElement("a");
  lien.href = URL.createObjectURL(new Blob([octets], { type: piece.type || "application/octet-stream" }));
  lien.download = piece.nom;
  document.body.appendChild(lien); lien.click(); lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 5000);
}
let mailLu = null;
const adresseDe = (s) => (String(s || "").match(/<([^>]+)>/)?.[1] || String(s || "").split(",")[0]).trim();
function repondreAuMail() {
  const m = mailLu; if (!m) return;
  const moi = String(fb?.auth.currentUser?.email || "").toLowerCase();
  const envoyeParMoi = moi && String(m.de).toLowerCase().includes(moi);
  const destinataire = envoyeParMoi ? adresseDe(m.a) : adresseDe(m.repondreA || m.de);
  $("mail-lecture").close();
  $("nouveau-mail-form").reset();
  piecesJointes = []; rendrePiecesJointes();
  $("nouveau-mail-statut").textContent = "";
  $("nouveau-mail-titre").textContent = "Répondre";
  reponseEnCours = { threadId: m.threadId, messageId: m.messageId };
  const f = $("nouveau-mail-form").elements;
  f.a.value = destinataire;
  f.sujet.value = /^(re|réf?)\s*:/i.test(m.sujet) ? m.sujet : "Re : " + m.sujet;
  f.corps.value = ""; // zone vide : le message d'origine n'est pas recopié
  nouveauMailDialog.showModal();
  f.corps.focus();
}
$("mail-lecture-repondre").addEventListener("click", repondreAuMail);
async function lireMail(id) {
  mailLu = null;
  const dlg = $("mail-lecture");
  $("mail-lecture-sujet").textContent = "Chargement…"; $("mail-lecture-meta").textContent = ""; $("mail-lecture-corps").textContent = ""; $("mail-lecture-pj").innerHTML = "";
  if (!dlg.open) dlg.showModal();
  try {
    const m = lireMessageComplet(await google(URL_GMAIL + `messages/${encodeURIComponent(id)}?format=full`));
    mailLu = m;
    majBoutonImportantLecture();
    $("mail-lecture-sujet").textContent = m.sujet;
    $("mail-lecture-meta").textContent = `De : ${m.de}` + (m.a ? ` · À : ${m.a}` : "") + (m.cc ? ` · Cc : ${m.cc}` : "") + (m.date ? ` · ${jourHeure.format(new Date(m.date))}` : "");
    $("mail-lecture-corps").textContent = m.corps;
    $("mail-lecture-gmail").href = "https://mail.google.com/mail/u/0/#all/" + (m.threadId || m.id);
    const ul = $("mail-lecture-pj");
    ul.innerHTML = m.pieces.map((f, i) => `<li><span>📎 ${echapper(f.nom)} <span class="meta">${tailleLisible(f.taille)}</span></span><button type="button" data-pj-telecharger="${i}">Télécharger</button></li>`).join("");
    ul.querySelectorAll("[data-pj-telecharger]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await telechargerPieceJointe(m.id, m.pieces[Number(b.dataset.pjTelecharger)]); } catch (e) { afficherErreur("Téléchargement impossible : " + e.message); }
      b.disabled = false;
    }));
  } catch (e) { $("mail-lecture-sujet").textContent = "Lecture impossible"; $("mail-lecture-corps").textContent = e.message; }
}
$("mail-lecture-fermer").addEventListener("click", () => $("mail-lecture").close());
$("pane-messages").addEventListener("click", (ev) => { const b = ev.target.closest("[data-lire]"); if (b) lireMail(b.dataset.lire); });


// ---------- Marquer un message important (étoile + libellé Important dans Gmail) ----------
async function modifierMessageGmail(id, ajouter, retirer) {
  const appel = () => google(URL_GMAIL + `messages/${encodeURIComponent(id)}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: ajouter, removeLabelIds: retirer }) });
  try { return await appel(); }
  catch (e) {
    if (!e.portee) throw e;
    // Nouvelle autorisation nécessaire (modification des libellés) : un clic dans la fenêtre Google, puis on réessaie
    effacerJetonMemorise(); jetonGoogle = null; jetonGoogleExpireA = 0;
    await renouvelerAccesGoogle();
    return appel();
  }
}
async function basculerImportant(id, bouton) {
  const tous = [...etat.messages, ...etat.recents];
  const m = tous.find((x) => x.id === id) || (mailLu && mailLu.id === id ? mailLu : null);
  const actif = !(m && m.etoile);
  if (bouton) bouton.disabled = true;
  try {
    await modifierMessageGmail(id, actif ? ["STARRED", "IMPORTANT"] : [], actif ? [] : ["STARRED", "IMPORTANT"]);
    [...etat.messages, ...etat.recents].filter((x) => x.id === id).forEach((x) => { x.etoile = actif; });
    if (mailLu && mailLu.id === id) { mailLu.etoile = actif; majBoutonImportantLecture(); }
    const base = etat.recents.find((x) => x.id === id) || etat.messages.find((x) => x.id === id);
    if (actif && base && !etat.messages.some((x) => x.id === id)) etat.messages = [{ ...base, etoile: true }, ...etat.messages].sort((a, b) => b.date - a.date);
    if (!actif) etat.messages = etat.messages.filter((x) => x.id !== id);
    rendreMessages();
    if (typeof rendreDashboard === "function") { try { rendreDashboard(); } catch { /* non bloquant */ } }
    messageEnvoye(actif ? "Message marqué comme important (étoile ajoutée dans Gmail)." : "Message retiré des importants (étoile retirée dans Gmail).");
  } catch (e) {
    afficherErreur("Impossible de modifier le message : " + e.message);
  } finally { if (bouton) bouton.disabled = false; }
}
function majBoutonImportantLecture() {
  const b = $("mail-lecture-important"); if (!b || !mailLu) return;
  b.textContent = mailLu.etoile ? "★ Important" : "☆ Marquer important";
  b.classList.toggle("actif", !!mailLu.etoile);
}
$("mail-lecture-important")?.addEventListener("click", () => mailLu && basculerImportant(mailLu.id, $("mail-lecture-important")));
$("pane-messages").addEventListener("click", (ev) => { const b = ev.target.closest("[data-important]"); if (b) basculerImportant(b.dataset.important, b); });

// ---------- Brouillons de réponse ----------
let messageCible = null;
function ouvrirModeles(index) {
  messageCible = etat.messages[index];
  $("modeles-titre").textContent = `Répondre à ${messageCible.de}`;
  $("modeles-liste").innerHTML = reglages.modeles
    .map((m, i) => `<div class="modele-ligne"><span>${echapper(m.nom)}</span><button data-modele="${i}" title="Enregistrer dans les brouillons Gmail">Brouillon</button><button data-modele-envoyer="${i}" class="btn-envoyer" title="Envoyer tout de suite">Envoyer</button></div>`)
    .join("");
  $("modeles-liste").querySelectorAll("[data-modele]").forEach((b) => b.addEventListener("click", () => creerBrouillon(Number(b.dataset.modele), false)));
  $("modeles-liste").querySelectorAll("[data-modele-envoyer]").forEach((b) => b.addEventListener("click", () => creerBrouillon(Number(b.dataset.modeleEnvoyer), true)));
  $("modeles").showModal();
}
$("modeles-fermer").addEventListener("click", () => $("modeles").close());

async function creerBrouillon(i, envoyer = false) {
  const modele = reglages.modeles[i];
  const valeurs = { nom: messageCible.de, sujet: messageCible.sujet };
  const brut = construireBrouillonBrut({
    a: messageCible.deBrut.includes("<") ? messageCible.deBrut.match(/<([^>]+)>/)[1] : messageCible.deBrut,
    sujet: `${modele.sujetPrefixe || ""}${messageCible.sujet}`,
    corps: remplirModele(modele.corps, valeurs),
  });
  if (envoyer && !confirm(`Envoyer la réponse « ${modele.nom} » à ${expediteurLisible(messageCible.deBrut)} ?`)) return;
  try {
    if (envoyer) await google(URL_GMAIL + "messages/send", { method: "POST", body: JSON.stringify({ raw: brut, threadId: messageCible.threadId }) });
    else await google(URL_GMAIL + "drafts", { method: "POST", body: JSON.stringify({ message: { raw: brut, threadId: messageCible.threadId } }) });
    $("modeles").close();
    messageEnvoye(envoyer ? `Réponse envoyée à ${expediteurLisible(messageCible.deBrut)}.` : `Brouillon créé dans Gmail pour ${expediteurLisible(messageCible.deBrut)}. Relisez-le puis envoyez-le.`);
  } catch (e) {
    $("modeles").close();
    afficherErreur(`${envoyer ? "Réponse non envoyée" : "Brouillon non créé"} : ${e.message}`);
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
      '<div class="notes-item-head"><div><span class="notes-kind">' + (isProject ? "📌 Projet" : "📝 Note") + (item.pinned ? '<span class="notes-pinned" title="Épinglée dans Keep">📍</span>' : '') + '</span>' +
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

// ---------- Import Google Keep (Takeout) ----------
$("keep-fichiers")?.addEventListener("change", async (e) => {
  const entree = e.target, statut = $("keep-statut");
  const fichiers = [...entree.files];
  if (!fichiers.length) return;
  const dire = (m, erreur = false) => { if (statut) { statut.textContent = m; statut.style.color = erreur ? "var(--danger,#b42318)" : ""; } };
  try {
    if (!fb?.auth.currentUser) throw new Error("Connectez-vous d'abord à votre compte Google.");
    dire("Lecture des fichiers…");
    if (!notesLoaded) await notesLoad(true);
    const { notes, ignorees } = await lireFichiersKeep(fichiers);
    const connus = new Set(notesItems.map(x => x.id));
    const nouvelles = notes.filter(n => !connus.has(n.id));
    let faites = 0, echecs = 0;
    for (const n of nouvelles) {
      dire(`Import en cours : ${faites + echecs}/${nouvelles.length}…`);
      try { await notesSave(n, false); notesItems.push(n); faites++; } catch { echecs++; }
    }
    notesItems.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    notesRender();
    dire(`${faites} note(s) importée(s), ${notes.length - nouvelles.length} déjà présente(s), ${ignorees} fichier(s) ignoré(s)` + (echecs ? `, ${echecs} échec(s) (relancez l'import pour réessayer)` : "") + ".", echecs > 0);
  } catch (err) {
    dire("Import impossible : " + (err?.message || err), true);
  } finally { entree.value = ""; }
});



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
