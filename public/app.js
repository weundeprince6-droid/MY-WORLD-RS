// app.js — interface My World RS : connexion Google, lecture Gmail/Agenda/Firestore, rendu.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, getDocs, getCountFromServer, query, where, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  messagesImportants, repartirAgenda, minutesAvant, evaluerSeuil, construireAlertes,
  resumeDuJour, remplirModele, construireBrouillonBrut, expediteurLisible,
} from "./core.js";

const $ = (id) => document.getElementById(id);
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
];

let config;
try {
  config = await import("./config.js");
} catch {
  $("configuration-manquante").hidden = false;
  $("zone-connexion").hidden = true;
  throw new Error("config.js introuvable : copiez config.example.js en config.js");
}
const { firebaseConfig, reglages } = config;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let jetonGoogle = null;
let etat = { messages: [], agenda: { aujourdhui: [], aVenir: [] }, kpis: [], social: [] };

// ---------- Connexion ----------
$("bouton-connexion").addEventListener("click", async () => {
  const fournisseur = new GoogleAuthProvider();
  SCOPES.forEach((s) => fournisseur.addScope(s));
  try {
    const resultat = await signInWithPopup(auth, fournisseur);
    jetonGoogle = GoogleAuthProvider.credentialFromResult(resultat)?.accessToken || null;
    await tout();
  } catch (e) {
    afficherErreur(`Connexion impossible : ${e.message}`);
  }
});
$("bouton-deconnexion").addEventListener("click", async () => {
  await signOut(auth);
  jetonGoogle = null;
});
$("bouton-actualiser").addEventListener("click", () => tout());

onAuthStateChanged(auth, (user) => {
  $("zone-connexion").hidden = !!user;
  $("tableau").hidden = !user;
  $("bouton-deconnexion").hidden = !user;
  $("bouton-actualiser").hidden = !user;
  $("utilisateur").textContent = user ? user.displayName || user.email : "";
});

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
    throw new Error("Session Google expirée (1 h). Reconnectez-vous.");
  }
  if (!r.ok) throw new Error(`Google a répondu ${r.status}`);
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

async function chargerKpis() {
  const resultats = [];
  for (const k of reglages.kpis) {
    try {
      let ref = collection(db, k.collection);
      if (k.filtre) ref = query(ref, where(k.filtre.champ, "==", k.filtre.valeur));
      let valeur;
      if (k.op === "sum") {
        const snap = await getDocs(ref);
        valeur = snap.docs.reduce((t, d) => t + (Number(d.data()[k.champ]) || 0), 0);
      } else {
        valeur = (await getCountFromServer(ref)).data().count;
      }
      resultats.push({ label: k.label, valeur, unite: k.unite || "", etat: evaluerSeuil(valeur, k.seuil) });
    } catch (e) {
      resultats.push({ label: k.label, valeur: "—", unite: "", etat: "ok", erreur: e.message });
    }
  }
  return resultats;
}

async function chargerSocial() {
  const s = reglages.social;
  if (!s) return [];
  try {
    const q = query(collection(db, s.collection), orderBy("date", "desc"), limit(s.max));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const x = d.data();
      return { id: d.id, source: x.source || "autre", de: x.de || "", texte: x.texte || "", date: x.date?.toDate?.() || null, important: !!x.important };
    });
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
  $("grille-kpis").innerHTML = etat.kpis.length
    ? etat.kpis
        .map(
          (k) => `<div class="kpi ${k.etat !== "ok" ? "alerte" : ""}">
            <div class="valeur">${echapper(typeof k.valeur === "number" ? k.valeur.toLocaleString("fr-FR") : k.valeur)} <small>${echapper(k.unite)}</small></div>
            <div class="libelle">${echapper(k.label)}</div></div>`,
        )
        .join("")
    : '<p class="vide">Aucun indicateur configuré (voir config.js).</p>';
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
