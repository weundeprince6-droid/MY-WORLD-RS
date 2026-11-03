const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("node:crypto");

initializeApp();
const db = getFirestore();
const GOOGLE_CLIENT_ID = defineSecret("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");
const GOOGLE_STATE_SECRET = defineSecret("GOOGLE_STATE_SECRET");
const REGION = "us-central1";
const APP_URL = "https://my-world-rs.web.app/";
const REDIRECT_URI = `https://${REGION}-my-world-rs.cloudfunctions.net/googleOAuthCallback`;
const ALLOWED_ORIGINS = [
  "https://my-world-rs.web.app",
  "https://my-world-rs.firebaseapp.com",
  "https://weundeprince6-droid.github.io"
];

function bearer(req) {
  const value = req.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}
async function utilisateur(req) {
  const token = bearer(req);
  if (!token) throw Object.assign(new Error("Session Firebase absente."), { status: 401 });
  return getAuth().verifyIdToken(token);
}
function signerEtat(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return data + "." + sig;
}
function verifierEtat(value, secret) {
  const [data, signature] = String(value || "").split(".");
  if (!data || !signature) throw new Error("État OAuth invalide.");
  const expected = crypto.createHmac("sha256", secret).update(data).digest();
  const received = Buffer.from(signature, "base64url");
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) throw new Error("Signature OAuth invalide.");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  if (!payload.uid || !payload.exp || payload.exp < Date.now()) throw new Error("La demande de connexion a expiré. Recommencez.");
  return payload;
}
function erreur(res, error) {
  res.status(error.status || 500).json({ error: error.message || "Erreur serveur." });
}

exports.googleOAuthStart = onRequest(
  { region: REGION, cors: ALLOWED_ORIGINS, secrets: [GOOGLE_CLIENT_ID, GOOGLE_STATE_SECRET] },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée." });
      const user = await utilisateur(req);
      const state = signerEtat({
        uid: user.uid, email: user.email || "",
        exp: Date.now() + 10 * 60 * 1000,
        nonce: crypto.randomBytes(16).toString("hex")
      }, GOOGLE_STATE_SECRET.value());
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID.value(),
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: [
          "openid", "email", "profile",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.compose",
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/datastore",
          "https://www.googleapis.com/auth/drive.metadata.readonly",
          "https://www.googleapis.com/auth/tasks"
        ].join(" "),
        access_type: "offline",
        prompt: "consent select_account",
        include_granted_scopes: "true",
        state
      });
      if (user.email) params.set("login_hint", user.email);
      res.json({ authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString() });
    } catch (error) { erreur(res, error); }
  }
);

exports.googleOAuthCallback = onRequest(
  { region: REGION, secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_STATE_SECRET] },
  async (req, res) => {
    try {
      if (req.method !== "GET") return res.status(405).send("Méthode non autorisée.");
      if (req.query.error) return res.redirect(APP_URL + "?google=cancelled");
      const state = verifierEtat(req.query.state, GOOGLE_STATE_SECRET.value());
      if (!req.query.code) throw new Error("Google n'a pas renvoyé de code d'autorisation.");
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: String(req.query.code), client_id: GOOGLE_CLIENT_ID.value(),
          client_secret: GOOGLE_CLIENT_SECRET.value(), redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code"
        })
      });
      const tokens = await response.json();
      if (!response.ok) throw new Error(tokens.error_description || tokens.error || "Échange du code Google impossible.");
      const oauth = new OAuth2Client(GOOGLE_CLIENT_ID.value());
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID.value() });
      const googleUser = ticket.getPayload();
      if (!googleUser?.email || googleUser.email_verified !== true) throw new Error("Google n'a pas confirmé l'adresse e-mail.");
      if (state.email && googleUser.email.toLowerCase() !== state.email.toLowerCase()) {
        throw new Error("Le compte Google autorisé n'est pas le même que celui connecté à My World RS.");
      }
      const ref = db.collection("googleOAuthTokens").doc(state.uid);
      const previous = await ref.get();
      const refreshToken = tokens.refresh_token || previous.get("refreshToken");
      if (!refreshToken) throw new Error("Google n'a pas fourni de jeton de renouvellement. Recommencez l'autorisation.");
      await ref.set({ refreshToken, googleEmail: googleUser.email, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      res.redirect(APP_URL + "?google=connected");
    } catch (error) {
      res.redirect(APP_URL + "?google=error&message=" + encodeURIComponent(error.message || "Connexion Google impossible."));
    }
  }
);

exports.googleAccessToken = onRequest(
  { region: REGION, cors: ALLOWED_ORIGINS, secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET] },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée." });
      const user = await utilisateur(req);
      const ref = db.collection("googleOAuthTokens").doc(user.uid);
      const doc = await ref.get();
      const refreshToken = doc.get("refreshToken");
      if (!refreshToken) return res.status(409).json({ needsAuthorization: true, error: "Autorisation Google initiale nécessaire." });
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID.value(), client_secret: GOOGLE_CLIENT_SECRET.value(),
          refresh_token: refreshToken, grant_type: "refresh_token"
        })
      });
      const tokens = await response.json();
      if (!response.ok) {
        if (tokens.error === "invalid_grant") await ref.delete();
        return res.status(tokens.error === "invalid_grant" ? 409 : 502).json({
          needsAuthorization: tokens.error === "invalid_grant",
          error: tokens.error_description || tokens.error || "Renouvellement Google impossible."
        });
      }
      res.set("Cache-Control", "no-store");
      res.json({ accessToken: tokens.access_token, expiresIn: tokens.expires_in || 3600, email: doc.get("googleEmail") || user.email });
    } catch (error) { erreur(res, error); }
  }
);

exports.googleRevoke = onRequest(
  { region: REGION, cors: ALLOWED_ORIGINS, secrets: [GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET] },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée." });
      const user = await utilisateur(req);
      const ref = db.collection("googleOAuthTokens").doc(user.uid);
      const doc = await ref.get();
      const refreshToken = doc.get("refreshToken");
      if (refreshToken) {
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken })
        }).catch(() => {});
      }
      await ref.delete();
      res.json({ ok: true });
    } catch (error) { erreur(res, error); }
  }
);
