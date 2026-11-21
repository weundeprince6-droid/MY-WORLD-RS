// Licences Lecteur Pro — Worker Cloudflare indépendant (stockage KV, sans carte bancaire).
// Mêmes routes, mêmes règles et mêmes messages que l'ancienne version Firebase Functions.
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
const HOUR = 3600000;
const OPERATORS = { mpesa: "M-Pesa", airtel: "Airtel Money", orange: "Orange Money" };
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, "0")).join("");
const orderSummary = (id, o) => ({ id, buyerEmail: o.buyerEmail, plan: o.plan, planLabel: o.planLabel, amount: o.amount, currency: o.currency,
  operator: o.operator, senderPhone: o.senderPhone, reference: o.reference, status: o.status, createdAt: o.createdAt,
  decidedAt: o.decidedAt || null, reason: o.reason ? String(o.reason).slice(0, 80) : null });
const saveOrder = (env, id, o) => env.LICENSES.put("ord:" + id, JSON.stringify(o), { metadata: orderSummary(id, o) });
const ORDER_ID = /^[A-Za-z0-9]{1,128}:[a-f0-9]{16}$/;
function paymentAccounts(env) {
  try { const a = JSON.parse(env.PAYMENT_ACCOUNTS || "{}"); const out = {};
    for (const k of Object.keys(OPERATORS)) if (a[k]) out[k] = { label: OPERATORS[k], number: String(a[k]) };
    return { accounts: out, holder: a.holder ? String(a.holder) : "" };
  } catch (e) { return { accounts: {}, holder: "" }; }
}
async function listAll(env, prefix) {
  const items = []; let cursor;
  do {
    const page = await env.LICENSES.list({ prefix, cursor });
    for (const k of page.keys) if (k.metadata) items.push(k.metadata);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return items;
}
const orderOut = (x) => ({ ...x, createdAt: iso(x.createdAt), decidedAt: iso(x.decidedAt) });

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function reply(request, data, status = 200) {
  const origin = request.headers.get("Origin") || "";
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return new Response(status === 204 ? null : JSON.stringify(data), { status, headers: h });
}

async function getUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "Connexion requise.");
  let r, d;
  try {
    r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_API_KEY), {
      method: "POST",
      // La clé Firebase n'accepte que les requêtes venant des sites du projet : on s'annonce comme tel
      headers: { "Content-Type": "application/json", "Referer": "https://weundeprince6-droid.github.io/MY-WORLD-RS/" },
      body: JSON.stringify({ idToken: auth.slice(7) })
    });
    d = await r.json();
  } catch (e) { throw new HttpError(503, "Vérification de connexion indisponible."); }
  const u = d && d.users && d.users[0];
  if (!r.ok || !u) {
    const why = d && d.error && d.error.message ? String(d.error.message).slice(0, 120) : "aucun compte";
    throw new HttpError(401, "Session invalide. Reconnectez-vous. (" + why + ")");
  }
  return { uid: u.localId, email: (u.email || "").toLowerCase(), email_verified: u.emailVerified === true };
}
async function getAdmin(request, env) {
  const user = await getUser(request, env);
  const admins = String(env.ADMIN_EMAIL || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  if (!user.email || !user.email_verified || !admins.includes(user.email)) throw new HttpError(403, "Accès administrateur refusé.");
  return user;
}

const cleanCode = (v) => String(v || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
async function codeHash(code) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function newCode() {
  const raw = [...crypto.getRandomValues(new Uint8Array(15))].map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
  return "LP-" + raw.match(/.{1,5}/g).join("-");
}
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
// Résumé léger gardé dans les métadonnées de la clé : la liste admin se lit en un seul appel
const summary = (id, x) => ({ id, plan: x.plan, planLabel: x.planLabel, amount: x.amount, currency: x.currency,
  buyerEmail: x.buyerEmail, paymentStatus: x.paymentStatus, paymentReference: x.paymentReference.slice(0, 80),
  status: x.status, createdAt: x.createdAt, expiresAt: x.expiresAt, activatedAt: x.activatedAt, revokedAt: x.revokedAt });
const saveLicense = (env, id, x) => env.LICENSES.put("lic:" + id, JSON.stringify(x), { metadata: summary(id, x) });
const readJson = async (request) => { try { return await request.json(); } catch (e) { return {}; } };

const routes = {
  // L'administrateur émet une licence uniquement après vérification manuelle du paiement.
  async lecteurProCreateLicense(request, env) {
    const admin = await getAdmin(request, env);
    const body = await readJson(request);
    const plan = String(body.plan || "");
    const buyerEmail = String(body.buyerEmail || "").trim().toLowerCase();
    const note = String(body.paymentReference || "").trim().slice(0, 160);
    if (!Object.prototype.hasOwnProperty.call(PRICES, plan)) throw new HttpError(400, "Formule invalide.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) throw new HttpError(400, "Adresse e-mail du client invalide.");
    if (note.length < 4) throw new HttpError(400, "Ajoutez une référence de paiement vérifiée (au moins 4 caractères).");
    const code = newCode(), now = Date.now(), p = PRICES[plan];
    const expiresAt = p.days ? now + p.days * 86400000 : null;
    await saveLicense(env, await codeHash(code), {
      plan, planLabel: p.label, amount: p.amount, currency: p.currency, buyerEmail,
      paymentStatus: "verified_manual", paymentReference: note, status: "issued",
      createdAt: now, createdBy: admin.uid, expiresAt, activatedAt: null, activatedBy: null, revokedAt: null, revokedBy: null
    });
    return { ok: true, code, plan, buyerEmail, expiresAt: iso(expiresAt) };
  },

  async lecteurProListLicenses(request, env) {
    await getAdmin(request, env);
    const items = [];
    let cursor;
    do {
      const page = await env.LICENSES.list({ prefix: "lic:", cursor });
      for (const k of page.keys) if (k.metadata) items.push(k.metadata);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return { licenses: items.slice(0, 100).map(x => ({ ...x, createdAt: iso(x.createdAt), expiresAt: iso(x.expiresAt), activatedAt: iso(x.activatedAt), revokedAt: iso(x.revokedAt) })) };
  },

  async lecteurProRevokeLicense(request, env) {
    const admin = await getAdmin(request, env);
    const id = String((await readJson(request)).id || "");
    if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpError(400, "Identifiant de licence invalide.");
    const x = await env.LICENSES.get("lic:" + id, "json");
    if (!x) throw new HttpError(404, "Licence introuvable.");
    if (x.status !== "revoked") {
      x.status = "revoked"; x.revokedAt = Date.now(); x.revokedBy = admin.uid;
      await saveLicense(env, id, x);
      if (x.activatedBy) await env.LICENSES.put("ent:" + x.activatedBy, JSON.stringify({ active: false, revokedAt: x.revokedAt }));
    }
    return { ok: true };
  },

  async lecteurProActivateLicense(request, env) {
    const user = await getUser(request, env);
    const now = Date.now();
    const limKey = "lim:" + user.uid;
    const recent = ((await env.LICENSES.get(limKey, "json")) || []).filter(t => Number(t) > now - HOUR);
    if (recent.length >= 10) throw new HttpError(429, "Trop de tentatives. Réessayez dans une heure.");
    recent.push(now);
    await env.LICENSES.put(limKey, JSON.stringify(recent), { expirationTtl: 3600 });

    const code = cleanCode((await readJson(request)).code);
    if (!/^LP-(?:[A-F0-9]{5}-){5}[A-F0-9]{5}$/.test(code)) throw new HttpError(400, "Code de licence invalide.");
    const id = await codeHash(code);
    const x = await env.LICENSES.get("lic:" + id, "json");
    if (!x) throw new HttpError(404, "Code inconnu.");
    if (x.status === "revoked") throw new HttpError(403, "Cette licence a été désactivée.");
    if (x.expiresAt && x.expiresAt <= now) throw new HttpError(403, "Cette licence a expiré.");
    if (x.buyerEmail && user.email !== x.buyerEmail) throw new HttpError(403, "Connectez-vous avec l'adresse e-mail utilisée lors de l'achat.");
    if (x.activatedBy && x.activatedBy !== user.uid) throw new HttpError(409, "Cette licence est déjà liée à un autre compte.");
    x.status = "active"; x.activatedBy = user.uid; x.activatedAt = x.activatedAt || now;
    await saveLicense(env, id, x);
    const result = { plan: x.plan, planLabel: x.planLabel, expiresAt: iso(x.expiresAt) };
    await env.LICENSES.put("ent:" + user.uid, JSON.stringify({ ...result, active: true, licenseId: id, updatedAt: now }));
    return { ok: true, entitlement: result };
  },

  // ---- Paiement Mobile Money semi-automatique ----
  // Prix et numéros de paiement : informations publiques, sans connexion.
  async lecteurProPaymentInfo(request, env) {
    const { accounts, holder } = paymentAccounts(env);
    return { prices: Object.fromEntries(Object.entries(PRICES).map(([k, v]) => [k, { label: v.label, amount: v.amount, currency: v.currency, days: v.days }])), accounts, holder };
  },

  // Le client déclare son paiement ; rien n'est accordé avant la validation de l'administrateur.
  async lecteurProCreateOrder(request, env) {
    const user = await getUser(request, env);
    const body = await readJson(request);
    const plan = String(body.plan || ""), operator = String(body.operator || "");
    const phone = String(body.senderPhone || "").replace(/[^0-9+]/g, "");
    const reference = String(body.reference || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!Object.prototype.hasOwnProperty.call(PRICES, plan)) throw new HttpError(400, "Formule invalide.");
    if (!Object.prototype.hasOwnProperty.call(OPERATORS, operator)) throw new HttpError(400, "Choisissez M-Pesa, Airtel Money ou Orange Money.");
    if (!/^\+?[0-9]{8,15}$/.test(phone)) throw new HttpError(400, "Numéro de téléphone invalide.");
    if (reference.length < 6 || reference.length > 30) throw new HttpError(400, "Référence de transaction invalide (6 à 30 caractères).");
    if (!user.email) throw new HttpError(403, "Votre compte n'a pas d'adresse e-mail.");
    const mine = await listAll(env, "ord:" + user.uid + ":");
    if (mine.filter(o => o.status === "pending").length >= 3) throw new HttpError(429, "Vous avez déjà 3 commandes en attente de validation.");
    const refKey = "ref:" + operator + ":" + reference;
    if (await env.LICENSES.get(refKey)) throw new HttpError(409, "Cette référence de transaction a déjà été utilisée.");
    const p = PRICES[plan], id = user.uid + ":" + hex(8);
    await env.LICENSES.put(refKey, id);
    await saveOrder(env, id, { uid: user.uid, buyerEmail: user.email, plan, planLabel: p.label, amount: p.amount, currency: p.currency,
      operator, senderPhone: phone, reference, status: "pending", createdAt: Date.now(), decidedAt: null, decidedBy: null, reason: null });
    return { ok: true, id };
  },

  async lecteurProMyOrders(request, env) {
    const user = await getUser(request, env);
    const items = (await listAll(env, "ord:" + user.uid + ":")).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    return { orders: items.map(orderOut) };
  },

  async lecteurProListOrders(request, env) {
    await getAdmin(request, env);
    const items = await listAll(env, "ord:");
    items.sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || b.createdAt - a.createdAt);
    return { orders: items.slice(0, 100).map(orderOut) };
  },

  // Validation : l'administrateur a vu l'argent arriver sur son compte Mobile Money.
  async lecteurProApproveOrder(request, env) {
    const admin = await getAdmin(request, env);
    const id = String((await readJson(request)).id || "");
    if (!ORDER_ID.test(id)) throw new HttpError(400, "Identifiant de commande invalide.");
    const o = await env.LICENSES.get("ord:" + id, "json");
    if (!o) throw new HttpError(404, "Commande introuvable.");
    if (o.status !== "pending") throw new HttpError(409, "Cette commande a déjà été traitée.");
    const now = Date.now(), p = PRICES[o.plan];
    const ent = await env.LICENSES.get("ent:" + o.uid, "json");
    const entLive = ent && ent.active === true && (!ent.expiresAt || new Date(ent.expiresAt).getTime() > now);
    const base = entLive && ent.expiresAt ? Math.max(now, new Date(ent.expiresAt).getTime()) : now;
    const expiresAt = p.days ? base + p.days * 86400000 : null;
    const licId = await codeHash(newCode()); // licence liée directement au compte : aucun code à transmettre
    await saveLicense(env, licId, {
      plan: o.plan, planLabel: p.label, amount: p.amount, currency: p.currency, buyerEmail: o.buyerEmail,
      paymentStatus: "verified_manual", paymentReference: OPERATORS[o.operator] + " " + o.reference, status: "active",
      createdAt: now, createdBy: admin.uid, expiresAt, activatedAt: now, activatedBy: o.uid, revokedAt: null, revokedBy: null, orderId: id
    });
    if (!(entLive && !ent.expiresAt)) { // un accès « à vie » déjà actif n'est jamais raccourci
      await env.LICENSES.put("ent:" + o.uid, JSON.stringify({ plan: o.plan, planLabel: p.label, expiresAt: iso(expiresAt), active: true, licenseId: licId, updatedAt: now }));
    }
    Object.assign(o, { status: "approved", decidedAt: now, decidedBy: admin.uid });
    await saveOrder(env, id, o);
    return { ok: true };
  },

  async lecteurProRejectOrder(request, env) {
    const admin = await getAdmin(request, env);
    const body = await readJson(request);
    const id = String(body.id || "");
    if (!ORDER_ID.test(id)) throw new HttpError(400, "Identifiant de commande invalide.");
    const o = await env.LICENSES.get("ord:" + id, "json");
    if (!o) throw new HttpError(404, "Commande introuvable.");
    if (o.status !== "pending") throw new HttpError(409, "Cette commande a déjà été traitée.");
    Object.assign(o, { status: "rejected", decidedAt: Date.now(), decidedBy: admin.uid, reason: String(body.reason || "Paiement non retrouvé").slice(0, 100) });
    await saveOrder(env, id, o);
    await env.LICENSES.delete("ref:" + o.operator + ":" + o.reference); // le client peut corriger sa saisie
    return { ok: true };
  },

  async lecteurProGetEntitlement(request, env) {
    const user = await getUser(request, env);
    const x = await env.LICENSES.get("ent:" + user.uid, "json");
    if (!x) return { active: false, plan: "free" };
    const expired = x.expiresAt && new Date(x.expiresAt).getTime() <= Date.now();
    if (expired || x.active !== true) return { active: false, plan: "free" };
    return { active: true, plan: x.plan, planLabel: x.planLabel, expiresAt: x.expiresAt || null };
  }
};

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return reply(request, null, 204);
      if (request.method !== "POST") return reply(request, { error: "Méthode non autorisée." }, 405);
      const name = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");
      if (!Object.prototype.hasOwnProperty.call(routes, name)) return reply(request, { error: "Route inconnue." }, 404);
      return reply(request, await routes[name](request, env));
    } catch (e) {
      return reply(request, { error: e instanceof HttpError ? e.message : "Erreur serveur." }, e instanceof HttpError ? e.status : 500);
    }
  }
};
