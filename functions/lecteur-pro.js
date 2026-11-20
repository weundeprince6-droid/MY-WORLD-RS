const { onRequest } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto = require("node:crypto");

const db = getFirestore();
const REGION = "us-central1";
const ADMIN_EMAIL = "weundeprince6@gmail.com";
const ORIGINS = [
  "https://weundeprince6-droid.github.io",
  "https://my-world-rs.web.app",
  "https://my-world-rs.firebaseapp.com"
];
const PRICES = {
  monthly: { label: "Premium mensuel", amount: 3000, currency: "CDF", days: 30 },
  annual: { label: "Premium annuel", amount: 30000, currency: "CDF", days: 365 },
  lifetime: { label: "Licence à vie", amount: 60000, currency: "CDF", days: null }
};

function sendError(res, e) {
  const status = e.status || 500;
  res.status(status).json({ error: e.message || "Erreur serveur." });
}
async function getUser(req) {
  const h = req.get("authorization") || "";
  if (!h.startsWith("Bearer ")) throw Object.assign(new Error("Connexion requise."), { status: 401 });
  return getAuth().verifyIdToken(h.slice(7));
}
async function getAdmin(req) {
  const user = await getUser(req);
  if (!user.email || user.email_verified !== true || user.email.toLowerCase() !== ADMIN_EMAIL) {
    throw Object.assign(new Error("Accès administrateur refusé."), { status: 403 });
  }
  return user;
}
function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}
function codeHash(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}
function newCode() {
  const raw = crypto.randomBytes(15).toString("hex").toUpperCase();
  return "LP-" + raw.match(/.{1,5}/g).join("-");
}
function cors(req, res) {
  const origin = req.get("origin") || "";
  if (ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).send(""); return true; }
  return false;
}
function api(handler, adminOnly = false) {
  return onRequest({ region: REGION, cors: ORIGINS }, async (req, res) => {
    try {
      if (cors(req, res)) return;
      if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée." });
      const user = adminOnly ? await getAdmin(req) : await getUser(req);
      await handler(req, res, user);
    } catch (e) { sendError(res, e); }
  });
}

// L'administrateur émet une licence uniquement après vérification manuelle du paiement.
// Aucun client ne peut déclarer lui-même qu'un paiement est effectué.
exports.lecteurProCreateLicense = api(async (req, res, admin) => {
  const plan = String(req.body?.plan || "");
  const buyerEmail = String(req.body?.buyerEmail || "").trim().toLowerCase();
  const note = String(req.body?.paymentReference || "").trim().slice(0, 160);
  if (!PRICES[plan]) return res.status(400).json({ error: "Formule invalide." });
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) return res.status(400).json({ error: "Adresse e-mail du client invalide." });
  if (note.length < 4) return res.status(400).json({ error: "Ajoutez une référence de paiement vérifiée (au moins 4 caractères)." });
  const code = newCode();
  const now = Date.now();
  const duration = PRICES[plan].days;
  const expiresAt = duration ? Timestamp.fromMillis(now + duration * 86400000) : null;
  const ref = db.collection("lecteurProLicenses").doc(codeHash(code));
  await ref.create({
    plan, planLabel: PRICES[plan].label, amount: PRICES[plan].amount, currency: "CDF",
    buyerEmail, paymentStatus: "verified_manual", paymentReference: note,
    status: "issued", createdAt: FieldValue.serverTimestamp(),
    createdBy: admin.uid, expiresAt, activatedAt: null, activatedBy: null,
    revokedAt: null, revokedBy: null
  });
  res.json({ ok: true, code, plan, buyerEmail, expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null });
}, true);

exports.lecteurProListLicenses = api(async (req, res) => {
  const snap = await db.collection("lecteurProLicenses").orderBy("createdAt", "desc").limit(100).get();
  res.set("Cache-Control", "no-store");
  res.json({ licenses: snap.docs.map(d => {
    const x = d.data();
    return { id: d.id, plan: x.plan, planLabel: x.planLabel, amount: x.amount, currency: x.currency,
      buyerEmail: x.buyerEmail, paymentStatus: x.paymentStatus, paymentReference: x.paymentReference,
      status: x.status, createdAt: x.createdAt?.toDate?.().toISOString() || null,
      expiresAt: x.expiresAt?.toDate?.().toISOString() || null,
      activatedAt: x.activatedAt?.toDate?.().toISOString() || null,
      revokedAt: x.revokedAt?.toDate?.().toISOString() || null };
  }) });
}, true);

exports.lecteurProRevokeLicense = api(async (req, res, admin) => {
  const id = String(req.body?.id || "");
  if (!/^[a-f0-9]{64}$/.test(id)) return res.status(400).json({ error: "Identifiant de licence invalide." });
  const ref = db.collection("lecteurProLicenses").doc(id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error("Licence introuvable."), { status: 404 });
    if (snap.get("status") === "revoked") return;
    tx.update(ref, { status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: admin.uid });
  });
  res.json({ ok: true });
}, true);

exports.lecteurProActivateLicense = api(async (req, res, user) => {
  const code = cleanCode(req.body?.code);
  if (!/^LP-(?:[A-F0-9]{5}-){2}[A-F0-9]{5}$/.test(code)) return res.status(400).json({ error: "Code de licence invalide." });
  const ref = db.collection("lecteurProLicenses").doc(codeHash(code));
  let result;
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw Object.assign(new Error("Code inconnu."), { status: 404 });
    const x = snap.data();
    if (x.status === "revoked") throw Object.assign(new Error("Cette licence a été désactivée."), { status: 403 });
    if (x.expiresAt && x.expiresAt.toMillis() <= Date.now()) throw Object.assign(new Error("Cette licence a expiré."), { status: 403 });
    if (x.buyerEmail && user.email?.toLowerCase() !== x.buyerEmail) throw Object.assign(new Error("Connectez-vous avec l'adresse e-mail utilisée lors de l'achat."), { status: 403 });
    if (x.activatedBy && x.activatedBy !== user.uid) throw Object.assign(new Error("Cette licence est déjà liée à un autre compte."), { status: 409 });
    tx.update(ref, { status: "active", activatedBy: user.uid, activatedAt: x.activatedAt || FieldValue.serverTimestamp() });
    result = { plan: x.plan, planLabel: x.planLabel, expiresAt: x.expiresAt?.toDate?.().toISOString() || null };
  });
  await db.collection("lecteurProEntitlements").doc(user.uid).set({
    ...result, active: true, licenseId: ref.id, updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  res.json({ ok: true, entitlement: result });
});

exports.lecteurProGetEntitlement = api(async (req, res, user) => {
  const ref = db.collection("lecteurProEntitlements").doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) return res.json({ active: false, plan: "free" });
  const x = snap.data();
  const expired = x.expiresAt && new Date(x.expiresAt).getTime() <= Date.now();
  if (expired || x.active !== true) return res.json({ active: false, plan: "free" });
  res.set("Cache-Control", "no-store");
  res.json({ active: true, plan: x.plan, planLabel: x.planLabel, expiresAt: x.expiresAt || null });
}, false);
