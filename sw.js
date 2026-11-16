// Service worker: cangkang aplikasi tersedia offline. Data tetap diambil dari Appwrite (butuh internet).
// Naikkan VERSION setiap kali Anda mengubah file aplikasi agar cache lama dibuang.
const VERSION = "v4";
const CACHE = "omahku-" + VERSION;
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "css/style.css",
  "js/ai.js", "js/assets.js", "js/assetcalc.js", "js/health.js", "js/healthcalc.js", "js/app.js", "js/config.js", "js/data.js", "js/modules.js", "js/pages.js", "js/ui.js",
  "vendor/appwrite.js",
  "fonts/space-grotesk-latin-500-normal.woff2", "fonts/space-grotesk-latin-700-normal.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("omahku-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Appwrite & lainnya: langsung ke jaringan

  // Network-first: selalu ambil versi terbaru bila online, jatuh ke cache saat offline.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))
  );
});
