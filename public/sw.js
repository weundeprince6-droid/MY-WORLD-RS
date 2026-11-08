// sw.js — permet d'ouvrir My World RS sans internet : garde l'application et le kit Firebase en mémoire.
const VERSION = "mwrs-sw-v1";
const FICHIERS = ["./", "index.html", "style.css", "app.js", "config.js", "core.js", "firestore.js", "telegram.js", "facebook.js", "rapport.js", "assistant.js", "maison.js", "notes.js", "rapport-appli.js", "horsligne.js", "television.html"];
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SDK_FICHIERS = ["firebase-app.js", "firebase-auth.js"].map((f) => SDK + f);

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all([...FICHIERS, ...SDK_FICHIERS].map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
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
      const r = await fetch(req);
      if (r && r.ok) c.put(req, r.clone()).catch(() => {});
      return r;
    } catch (err) {
      const m = (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? (await c.match("index.html")) || (await c.match("./")) : null);
      if (m) return m;
      throw err;
    }
  })());
});
