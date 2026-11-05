/* =========================================================
   EXCELSO — APP HELPER (service worker)  —  v9.4
   Makes Excelso installable as an app and open fast.

   - The page itself always comes fresh from the server when
     online (so website updates show up at once); the saved copy
     is only used when there's no internet.
   - CSS / JS / images are reused from the phone and refreshed in
     the background. Their ?v= numbers change with each update.
   - Task data from Google Apps Script is never stored here; it
     always comes live.
========================================================= */

const CACHE = "excelso-app-v9.4";
const SHELL = ["./", "index.html", "manifest.webmanifest", "assets/app-icons/icon-192.png", "assets/app-icons/icon-512.png"];

self.addEventListener("install", function (event) {
    event.waitUntil(
        caches.open(CACHE).then(function (cache) { return cache.addAll(SHELL).catch(function () {}); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener("activate", function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
        }).then(function () { return self.clients.claim(); })
    );
});

self.addEventListener("fetch", function (event) {

    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;   // Apps Script, fonts etc. go straight to the internet

    // The page: fresh when online, saved copy when offline
    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).then(function (response) {
                const copy = response.clone();
                caches.open(CACHE).then(function (cache) { cache.put("index.html", copy); });
                return response;
            }).catch(function () {
                return caches.match("index.html").then(function (hit) { return hit || caches.match("./"); });
            })
        );
        return;
    }

    // Files: use the saved copy at once, refresh it in the background
    event.respondWith(
        caches.open(CACHE).then(function (cache) {
            return cache.match(request).then(function (hit) {
                const network = fetch(request).then(function (response) {
                    if (response && response.ok) cache.put(request, response.clone());
                    return response;
                }).catch(function () { return hit; });
                return hit || network;
            });
        })
    );

});
