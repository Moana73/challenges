// シンプルな Service Worker。
// Workbox 等は使わず素の Cache API で書いている（アプリが小さく、
// キャッシュ戦略も「アプリシェルはキャッシュ優先・APIは常にネットワーク」の
// 2パターンだけで十分なため、依存を増やすメリットが薄い）。
const CACHE = "challenges-shell-v3";
const SHELL = ["/", "/style.css", "/app.js", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // API・認証はキャッシュ対象外（常に最新を取りに行く）
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      // アプリシェルはキャッシュ優先（即起動）。無ければネットワークへ。
      return cached || network;
    }),
  );
});
