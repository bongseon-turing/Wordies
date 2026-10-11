// 오프라인 캐시. 앱 파일이 바뀌면 VERSION을 올린다.
const VERSION = "wordies-v0.2.0";
const ASSETS = ["./", "index.html", "app.html", "css/landing.css", "js/landing.js", "data/curve.json", "css/app.css", "js/app.js", "js/engine.js", "js/vendor/ts-fsrs.mjs", "data/words.json", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 네트워크 우선, 실패하면 캐시 (글꼴은 캐시 우선)
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const font = /fonts\.(googleapis|gstatic)\.com/.test(req.url);
  if (font) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; })));
    return;
  }
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
});
