// 更新任何檔案後，一定要把版本號加一，手機才會抓到新版（會整包一起換，不會新舊混用）。
var VERSION = "v34";
var SHELL = "ems-shell-" + VERSION;
var TILES = "ems-tiles";
var FILES = [
  "./", "index.html", "style.css", "app.js", "theme.js", "config.js", "manifest.webmanifest",
  "leaflet.js", "leaflet.css",
  "layers.png", "layers-2x.png",
  "marker-icon.png", "marker-icon-2x.png", "marker-shadow.png",
  "firebase-app-compat.js", "firebase-firestore-compat.js",
  "bc-600.woff2", "bc-700.woff2",
  "icon-180.png", "icon-192.png", "icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); })); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("ems-shell-") === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // 底圖：先用已存的，沒有才上網抓，抓到順便存起來
  if (url.hostname === "wmts.nlsc.gov.tw") {
    e.respondWith(caches.open(TILES).then(function (cache) {
      return cache.match(req.url).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && (res.ok || res.type === "opaque")) cache.put(req.url, res.clone()).catch(function () {});
          return res;
        });
      });
    }));
    return;
  }

  // 網址帶 fresh 參數時一律直接上網抓最新的，給頁面自己檢查與更新用
  if (url.origin === self.location.origin && url.searchParams.has("fresh")) {
    e.respondWith(fetch(req.url, { cache: "no-store" }));
    return;
  }

  // 程式本體：只用這個版本整包存好的檔案，避免新舊檔案混用。更新一律靠 VERSION 換版。
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(SHELL).then(function (cache) {
      var key = req.mode === "navigate" ? "index.html" : req;
      return cache.match(key, { ignoreSearch: true }).then(function (hit) {
        return hit || fetch(req);
      });
    }));
  }
});
