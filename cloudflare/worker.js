const ALLOWED_ORIGIN = "https://weundeprince6-droid.github.io";
const APP_URL = "https://weundeprince6-droid.github.io/MY-WORLD-RS/";

const GOOGLE_SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/datastore",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets"
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Vary": "Origin"
    }
  });
}

function redirectError(message) {
  return Response.redirect(APP_URL + "?google=error&message=" + encodeURIComponent(message), 302);
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64url(value) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signState(payload, secret) {
  const data = base64url(JSON.stringify(payload));
  return data + "." + await hmac(data, secret);
}

async function verifyState(value, secret) {
  const [data, signature] = String(value || "").split(".");
  if (!data || !signature || signature !== await hmac(data, secret)) {
    throw new Error("État OAuth invalide.");
  }
  const payload = JSON.parse(atob(data.replace(/-/g, "+").replace(/_/g, "/")));
  if (!payload.uid || !payload.exp || payload.exp < Date.now() || !payload.nonce) {
    throw new Error("La demande Google a expiré. Recommencez.");
  }
  return payload;
}

async function firebaseUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("Session Firebase absente.");
  const idToken = auth.slice(7);
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(env.FIREBASE_API_KEY),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }
  );
  const data = await response.json();
  const user = data.users && data.users[0];
  if (!response.ok || !user) throw new Error("Session Firebase invalide. Reconnectez-vous.");
  return { uid: user.localId, email: user.email || "" };
}

async function start(request, env) {
  const user = await firebaseUser(request, env);
  const nonce = crypto.randomUUID();
  const state = await signState({
    uid: user.uid, email: user.email, nonce, exp: Date.now() + 10 * 60 * 1000
  }, env.GOOGLE_STATE_SECRET);
  await env.GOOGLE_TOKENS.put("state:" + nonce, user.uid, { expirationTtl: 600 });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state
  });
  if (user.email) params.set("login_hint", user.email);
  return json({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?" + params });
}

async function callback(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return Response.redirect(APP_URL + "?google=cancelled", 302);
  try {
    const state = await verifyState(url.searchParams.get("state"), env.GOOGLE_STATE_SECRET);
    const savedUid = await env.GOOGLE_TOKENS.get("state:" + state.nonce);
    if (!savedUid || savedUid !== state.uid) throw new Error("Cette demande Google a déjà été utilisée ou a expiré.");
    await env.GOOGLE_TOKENS.delete("state:" + state.nonce);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("Google n'a pas renvoyé de code d'autorisation.");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI, grant_type: "authorization_code"
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokens.error_description || tokens.error || "Échange du code Google impossible.");
    const verifyResponse = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(tokens.id_token || ""));
    const identity = await verifyResponse.json();
    if (!verifyResponse.ok || identity.aud !== env.GOOGLE_CLIENT_ID || identity.email_verified !== "true") {
      throw new Error("Google n'a pas confirmé le compte autorisé.");
    }
    if (state.email && String(identity.email || "").toLowerCase() !== state.email.toLowerCase()) {
      throw new Error("Le compte Google autorisé ne correspond pas au compte connecté à MY WORLD RS.");
    }
    const previous = await env.GOOGLE_TOKENS.get("refresh:" + state.uid);
    const refreshToken = tokens.refresh_token || previous;
    if (!refreshToken) throw new Error("Google n'a pas fourni de jeton de renouvellement. Recommencez l'autorisation.");
    await env.GOOGLE_TOKENS.put("refresh:" + state.uid, refreshToken);
    await env.GOOGLE_TOKENS.put("email:" + state.uid, identity.email || state.email);
    return Response.redirect(APP_URL + "?google=connected", 302);
  } catch (error) {
    return redirectError(error.message || "Autorisation Google impossible.");
  }
}

async function accessToken(request, env) {
  const user = await firebaseUser(request, env);
  const refreshToken = await env.GOOGLE_TOKENS.get("refresh:" + user.uid);
  if (!refreshToken) return json({ needsAuthorization: true, error: "Autorisation Google initiale nécessaire." }, 409);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: "refresh_token"
    })
  });
  const tokens = await response.json();
  if (!response.ok) {
    if (tokens.error === "invalid_grant") {
      await env.GOOGLE_TOKENS.delete("refresh:" + user.uid);
      await env.GOOGLE_TOKENS.delete("email:" + user.uid);
    }
    return json({
      needsAuthorization: tokens.error === "invalid_grant",
      error: tokens.error_description || tokens.error || "Renouvellement Google impossible."
    }, tokens.error === "invalid_grant" ? 409 : 502);
  }
  return json({
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in || 3600,
    email: await env.GOOGLE_TOKENS.get("email:" + user.uid) || user.email
  });
}

async function revoke(request, env) {
  const user = await firebaseUser(request, env);
  const refreshToken = await env.GOOGLE_TOKENS.get("refresh:" + user.uid);
  if (refreshToken) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken })
    }).catch(() => {});
  }
  await env.GOOGLE_TOKENS.delete("refresh:" + user.uid);
  await env.GOOGLE_TOKENS.delete("email:" + user.uid);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }});
    }
    try {
      if (url.pathname === "/googleOAuthCallback" && request.method === "GET") return await callback(request, env);
      if (request.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
      if (url.pathname === "/googleOAuthStart") return await start(request, env);
      if (url.pathname === "/googleAccessToken") return await accessToken(request, env);
      if (url.pathname === "/googleRevoke") return await revoke(request, env);
      return json({ error: "Route inconnue." }, 404);
    } catch (error) {
      return json({ error: error.message || "Erreur serveur." }, 500);
    }
  }
};