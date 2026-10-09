// 更新任何檔案後，請把版本號加一，手機才會抓到新版。
var VERSION = "v16";
var SHELL = "ems-shell-" + VERSION;
var TILES = "ems-tiles";
var FILES = [
  "./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest",
  "leaflet.js", "leaflet.css",
  "layers.png", "layers-2x.png",
  "marker-icon.png", "marker-icon-2x.png", "marker-shadow.png",
  "firebase-app-compat.js", "firebase-firestore-compat.js",
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

  // 程式本體：先用已存的（離線可開），同時在背景更新
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(SHELL).then(function (cache) {
      var key = req.mode === "navigate" ? "index.html" : req;
      return cache.match(key, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req.url, { cache: "no-cache" }).then(function (res) {
          if (res && res.ok) cache.put(key, res.clone()).catch(function () {});
          return res;
        });
        if (hit) { net.catch(function () {}); return hit; }
        return net;
      });
    }));
  }
});
