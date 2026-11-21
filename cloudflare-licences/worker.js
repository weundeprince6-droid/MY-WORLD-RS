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
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: auth.slice(7) })
    });
    d = await r.json();
  } catch (e) { throw new HttpError(503, "Vérification de connexion indisponible."); }
  const u = d && d.users && d.users[0];
  if (!r.ok || !u) throw new HttpError(401, "Session invalide. Reconnectez-vous.");
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
