// sw-academy.js — rend WEBSERVICES ACADEMY installable et garde sa page en mémoire (réseau d'abord).
// Portée limitée à webs-classroom.html : n'interfère pas avec le service worker de My World RS.
const VERSION = "academy-sw-v1";
const FICHIERS = ["./webs-classroom.html", "config.js", "manifest-academy.webmanifest", "academy-192.png", "academy-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => Promise.all(FICHIERS.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("academy-sw-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((k) => k.put(req, c)); } return r; }).catch(() => caches.match(req).then((m) => m || caches.match("./webs-classroom.html"))));
});
