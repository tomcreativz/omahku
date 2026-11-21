// Service worker: cangkang aplikasi tersedia offline. Data offline disimpan di perangkat oleh js/offline.js + js/data.js.
// Naikkan VERSION setiap kali Anda mengubah file aplikasi agar cache lama dibuang.
const VERSION = "v15";
const CACHE = "omahku-" + VERSION;
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "css/style.css",
  "js/ai.js", "js/offline.js", "js/theme.js", "js/search.js", "js/vaxcalc.js", "js/assets.js", "js/assetcalc.js", "js/clothes.js", "js/kitchen.js", "js/lock.js", "js/documents.js", "js/kitchenui.js", "js/health.js", "js/healthcalc.js", "js/app.js", "js/config.js", "js/data.js", "js/modules.js", "js/pages.js", "js/ui.js",
  "vendor/appwrite.js",
  "fonts/space-grotesk-latin-500-normal.woff2", "fonts/space-grotesk-latin-700-normal.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("omahku-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const NET_TIMEOUT = 4000; // sinyal lemah: setelah 4 detik pakai salinan di cache daripada menunggu

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Appwrite & lainnya: langsung ke jaringan

  const nav = req.mode === "navigate";
  const fromCache = async () => (await caches.match(req, { ignoreSearch: nav })) || (nav ? (await caches.match("./")) || (await caches.match("index.html")) : undefined);

  // Network-first: ambil versi terbaru bila online; jatuh ke cache bila gagal/terlalu lambat.
  e.respondWith(new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const timer = setTimeout(async () => { const c = await fromCache(); if (c) finish(c); }, NET_TIMEOUT);
    fetch(req).then((res) => {
      clearTimeout(timer);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      finish(res);
    }).catch(async () => { clearTimeout(timer); finish((await fromCache()) || Response.error()); });
  }));
});
