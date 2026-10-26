/* ServeBiz service worker: lets the point of sale open without a connection.
 * - /_next/static files and icons: cache first (they never change for a given URL)
 * - the /pos page: network first, the last good copy is used when offline
 * - every other page: network only, with a small "you are offline" page as a fallback
 * Nothing else is stored: no API calls, no other pages. */
const VERSION = "v1";
const STATIC = `servebiz-static-${VERSION}`;
const PAGES = "servebiz-pages";
const POS_PATH = "/pos";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC).then((c) => c.addAll(["/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("servebiz-static-") && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "precache" && Array.isArray(data.urls)) {
    // The page tells us which script/style files it loaded, so they are available offline too.
    const urls = data.urls.filter((u) => typeof u === "string" && u.startsWith(self.location.origin + "/_next/static/")).slice(0, 200);
    event.waitUntil(caches.open(STATIC).then((c) => Promise.all(urls.map((u) => c.match(u).then((hit) => hit || c.add(u).catch(() => {}))))));
  } else if (data.type === "clear-pages") {
    event.waitUntil(caches.delete(PAGES));   // on log out, so the next person on this device never sees the last user's page
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (req.mode === "navigate") {
    const isPos = url.pathname === POS_PATH;
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Keep a copy of the POS page (only a normal, non-redirected answer) for offline use.
          if (isPos && res.ok && !res.redirected && res.type === "basic") {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(POS_PATH, copy));
          }
          return res;
        })
        .catch(async () => {
          if (isPos) {
            const page = await caches.open(PAGES).then((c) => c.match(POS_PATH));
            if (page) return page;
          }
          return (await caches.match("/offline.html")) || new Response("Offline", { status: 503 });
        })
    );
  }
});
