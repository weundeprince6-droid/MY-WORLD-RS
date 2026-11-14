// sw.js — permet d'ouvrir My World RS sans internet : garde l'application et le kit Firebase en mémoire.
const VERSION = "mwrs-sw-v30";
const FICHIERS = ["./", "index.html", "style.css", "app.js", "config.js", "core.js", "firestore.js", "telegram.js", "facebook.js", "rapport.js", "assistant.js", "maison.js", "notes.js", "rapport-appli.js", "horsligne.js", "television.html", "manifest.webmanifest", "icone-192.png", "icone-512.png", "pdfjs/pdf.min.mjs", "pdfjs/pdf.worker.min.mjs"];
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SDK_FICHIERS = ["firebase-app.js", "firebase-auth.js"].map((f) => SDK + f);

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(FICHIERS.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    // Kit Firebase : on garde aussi les modules qu'il importe lui-même (récursif), sinon l'application ne démarre pas sans internet
    const vus = new Set();
    const garder = async (u, profondeur) => {
      if (vus.has(u) || profondeur > 4) return; vus.add(u);
      try {
        const r = await fetch(new Request(u, { cache: "reload" })); if (!r.ok) return;
        await c.put(u, r.clone());
        const texte = await r.text();
        const liens = [...texte.matchAll(/(?:from|import)\s*["']([^"']+\.js)["']/g)].map((m) => { try { return new URL(m[1], u).href; } catch { return null; } }).filter((x) => x && x.startsWith(SDK));
        await Promise.all(liens.map((l) => garder(l, profondeur + 1)));
      } catch { /* sera mis en mémoire à la prochaine ouverture en ligne */ }
    };
    await Promise.all(SDK_FICHIERS.map((u) => garder(u, 0)));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Réseau d'abord (toujours la dernière version en ligne), mémoire si le réseau est absent.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const memeSite = url.origin === self.location.origin;
  const sdk = req.url.startsWith("https://www.gstatic.com/firebasejs/");
  if (!memeSite && !sdk) return; // données Google, Telegram, etc. : gérées par l'application
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    try {
      // même site : on revalide toujours auprès du serveur (jamais de version périmée gardée par le navigateur)
      const r = memeSite ? await fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : await fetch(req);
      if (r && r.ok) c.put(req, r.clone()).catch(() => {});
      return r;
    } catch (err) {
      const m = (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? (await c.match("index.html")) || (await c.match("./")) : null);
      if (m) return m;
      throw err;
    }
  })());
});
