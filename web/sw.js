// Service Worker: macht die App installierbar, lädt die App-Hülle auch bei schlechtem
// Netz und empfängt Push-Nachrichten.
// Bei jeder Änderung an App-Dateien die Version erhöhen, damit alle die neue Version bekommen.
const VERSION = "v14";
const CACHE = `weihnachten-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "config.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Netz zuerst (immer aktuelle Version), bei Offline die gespeicherte Kopie.
// Supabase-Anfragen (Daten, Login) werden nie zwischengespeichert.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;
  const ownFile = url.origin === self.location.origin;
  const library = url.hostname === "esm.sh";
  if (!ownFile && !library) return;
  // Eigene Dateien immer beim Server nachfragen (no-cache), damit Updates sofort ankommen.
  event.respondWith(
    fetch(ownFile ? new Request(req, { cache: "no-cache" }) : req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("index.html"))),
  );
});

// ---- Push-Nachrichten ----
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  const title = data.title || "Weihnachten";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "./" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const win of windows) {
      if (win.url.startsWith(self.registration.scope)) {
        await win.focus();
        return win.navigate(target);
      }
    }
    return self.clients.openWindow(target);
  })());
});
