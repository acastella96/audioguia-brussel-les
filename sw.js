"use strict";

// Versió de la closca de l'app: canvieu-la quan canviïn index.html, app.js o styles.css.
const CACHE_APP = "audioguia-app-v1";
// Àudios i guions: comparteix nom amb app.js ("Descarrega-ho tot").
const CACHE_AUDIO = "audioguia-audio-v1";

const CLOSCA = [
  "./",
  "index.html",
  "app.js",
  "styles.css",
  "manifest.webmanifest",
  "content/parades.json",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(CLOSCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE_APP && n !== CACHE_AUDIO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Safari demana els àudios amb capçalera Range: cal respondre amb un 206 tallat
// a partir del fitxer sencer desat a la memòria cau.
async function respostaRange(request, resposta) {
  const range = request.headers.get("range");
  const blob = await resposta.blob();
  const mida = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(range || "");
  let inici = m && m[1] ? Number(m[1]) : 0;
  let final = m && m[2] ? Number(m[2]) : mida - 1;
  if (m && !m[1] && m[2]) { inici = mida - Number(m[2]); final = mida - 1; }
  if (inici >= mida || inici > final) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${mida}` } });
  }
  final = Math.min(final, mida - 1);
  return new Response(blob.slice(inici, final + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": resposta.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${inici}-${final}/${mida}`,
      "Content-Length": String(final - inici + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

async function serveixAudio(request) {
  const url = new URL(request.url);
  // La clau és l'URL absolut sense query: app.js hi desa els mateixos URL (relatius a la pàgina).
  const clau = url.origin + url.pathname;
  const cache = await caches.open(CACHE_AUDIO);
  let desat = await cache.match(clau);
  if (!desat) {
    // Primer cop: el baixem sencer (sense Range), el desem i el servim.
    const r = await fetch(url.href);
    if (!r.ok) return r;
    await cache.put(clau, r.clone());
    desat = r;
  }
  if (request.headers.has("range")) return respostaRange(request, desat);
  return desat;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith(".mp3")) {
    e.respondWith(serveixAudio(req));
    return;
  }

  // Cache-first per a la resta (closca, guions, dades).
  e.respondWith(
    (async () => {
      const claus = [req, url.pathname.replace(/^.*?(content\/)/, "$1")];
      for (const nom of [CACHE_APP, CACHE_AUDIO]) {
        const c = await caches.open(nom);
        for (const k of claus) {
          const r = await c.match(k, { ignoreSearch: true });
          if (r) return r;
        }
      }
      try {
        const r = await fetch(req);
        if (r.ok && url.pathname.includes("/content/")) {
          const c = await caches.open(CACHE_AUDIO);
          c.put(req, r.clone());
        }
        return r;
      } catch (err) {
        if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
        return Response.error();
      }
    })()
  );
});
