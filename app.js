"use strict";

// ---------- Desament local (sempre dins de try/catch) ----------
const MAGATZEM = "audioguia-brussel-les";
function llegeixEstat() {
  try {
    return JSON.parse(localStorage.getItem(MAGATZEM)) || {};
  } catch (e) {
    return {};
  }
}
const estat = Object.assign({ escoltades: {}, posicions: {}, opcio10: "A", dia: "1" }, llegeixEstat());
function desaEstat() {
  try {
    localStorage.setItem(MAGATZEM, JSON.stringify(estat));
  } catch (e) {
    /* mode privat o emmagatzematge ple: l'app funciona igual */
  }
}

// ---------- Contingut ----------
let parades = [];        // tal com ve de parades.json
const guions = {};       // id -> { meta, paragrafs }

function parseGuio(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta = {};
  if (!m) return { meta, paragrafs: [text] };
  for (const linia of m[1].split("\n")) {
    if (linia.startsWith("#") || !linia.includes(":")) continue;
    const i = linia.indexOf(":");
    let valor = linia.slice(i + 1).trim();
    if (valor.startsWith('"') && valor.endsWith('"')) valor = valor.slice(1, -1);
    meta[linia.slice(0, i).trim()] = valor;
  }
  const paragrafs = m[2].trim().split(/\n\s*\n/).map((p) => p.replace(/\n/g, " "));
  return { meta, paragrafs };
}

async function carregaGuio(id) {
  if (guions[id]) return guions[id];
  const r = await fetch(`content/guions/${id}.md`);
  guions[id] = parseGuio(await r.text());
  return guions[id];
}

// Llista ordenada d'un dia, amb la parada 10 resolta segons l'opció triada.
function paradesDelDia(dia, resoldreOpcio = true) {
  return parades.filter((p) => String(p.dia) === String(dia) &&
    (!resoldreOpcio || !p.alternativa || p.alternativa === estat.opcio10));
}

function format(s) {
  if (!isFinite(s)) s = 0;
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const $ = (id) => document.getElementById(id);

// ---------- Vista llista ----------
function pintaLlista() {
  const dia = estat.dia;
  document.body.dataset.dia = dia;
  for (const b of document.querySelectorAll(".pestanyes button")) {
    b.setAttribute("aria-selected", String(b.dataset.dia === dia));
  }
  const ol = $("llista");
  ol.innerHTML = "";
  const vistes = new Set();
  for (const p of paradesDelDia(dia, false)) {
    if (vistes.has(p.ordre)) continue;   // la parada 10 només surt una vegada
    vistes.add(p.ordre);
    const alternatives = parades.filter((q) => q.dia === p.dia && q.ordre === p.ordre);
    const actual = alternatives.length > 1
      ? alternatives.find((q) => q.alternativa === estat.opcio10) || alternatives[0]
      : p;

    const li = document.createElement("li");
    const fila = document.createElement("div");
    fila.className = "fila" + (actual.tipus === "nota" ? " fila-nota" : "") +
      (estat.escoltades[actual.id] ? " escoltada" : "");

    const obrir = document.createElement("button");
    obrir.className = "fila-obrir";
    obrir.style.cssText = "display:grid;grid-template-columns:44px 1fr;gap:12px;align-items:center;background:none;border:0;padding:0;text-align:left;grid-column:1 / 3;min-height:48px";
    const durada = actual.durada_s ? format(actual.durada_s) : "–";
    obrir.innerHTML = `<span class="fila-num">${p.ordre}</span>
      <span><span class="fila-nom"></span>
      <span class="fila-meta">${p.hora} · ${actual.tipus === "nota" ? "Nota" : "Àudio"} ${durada}</span></span>`;
    obrir.querySelector(".fila-nom").textContent =
      alternatives.length > 1 ? `Opció ${actual.alternativa}: ${actual.nom}` : actual.nom;
    obrir.addEventListener("click", () => obreFitxa(actual.id));
    fila.appendChild(obrir);

    const marca = document.createElement("span");
    marca.className = "fila-marca";
    marca.textContent = estat.escoltades[actual.id] ? "✓ Escoltada" : "";
    fila.appendChild(marca);

    if (alternatives.length > 1) {
      const opc = document.createElement("div");
      opc.className = "opcions";
      opc.style.gridColumn = "1 / -1";
      for (const alt of alternatives) {
        const b = document.createElement("button");
        b.textContent = `Opció ${alt.alternativa}`;
        b.setAttribute("aria-pressed", String(alt.alternativa === estat.opcio10));
        b.addEventListener("click", () => { estat.opcio10 = alt.alternativa; desaEstat(); pintaLlista(); });
        opc.appendChild(b);
      }
      fila.appendChild(opc);
    }
    li.appendChild(fila);
    ol.appendChild(li);
  }
}

// ---------- Reproductor (un sol <audio> per a tota l'app) ----------
const audio = $("audio");
let paradaActual = null;
let ultimDesat = 0;

function actualitzaBotoPlay() {
  const sona = !audio.paused;
  $("ico-play").hidden = sona;
  $("ico-pausa").hidden = !sona;
  $("btn-play").setAttribute("aria-label", sona ? "Pausa" : "Reprodueix");
}

function carregaAudio(p) {
  const src = p.fitxer_audio;
  if (audio.dataset.id === p.id) return;
  audio.pause();
  audio.dataset.id = p.id;
  audio.src = src;
  audio.load();
  const pos = estat.posicions[p.id] || 0;
  audio.addEventListener("loadedmetadata", function posa() {
    audio.removeEventListener("loadedmetadata", posa);
    if (pos > 0 && pos < audio.duration - 2) audio.currentTime = pos;
    pintaTemps();
  });
  configuraMediaSession(p);
}

function pintaTemps() {
  const total = audio.duration || (paradaActual && paradaActual.durada_s) || 0;
  $("temps-actual").textContent = format(audio.currentTime);
  $("temps-total").textContent = format(total);
  const barra = $("barra-temps");
  barra.max = Math.max(1, Math.floor(total));
  if (!barra.dataset.arrossegant) barra.value = Math.floor(audio.currentTime);
}

function salta(segons) {
  const total = audio.duration || 0;
  audio.currentTime = Math.min(Math.max(0, audio.currentTime + segons), total || audio.currentTime + segons);
}

function configuraMediaSession(p) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: p.nom,
    artist: `Brussel·les · ${p.dia === 1 ? "Divendres" : "Diumenge"} · Parada ${p.ordre}`,
    album: "Audioguia de Brussel·les",
    artwork: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  });
  const accions = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    seekbackward: () => salta(-15),
    seekforward: () => salta(15),
    seekto: (d) => { audio.currentTime = d.seekTime; },
  };
  for (const [nom, fn] of Object.entries(accions)) {
    try { navigator.mediaSession.setActionHandler(nom, fn); } catch (e) { /* acció no suportada */ }
  }
}

audio.addEventListener("play", actualitzaBotoPlay);
audio.addEventListener("pause", () => {
  actualitzaBotoPlay();
  if (audio.dataset.id) { estat.posicions[audio.dataset.id] = audio.currentTime; desaEstat(); }
});
audio.addEventListener("timeupdate", () => {
  if (paradaActual && audio.dataset.id === paradaActual.id) pintaTemps();
  const ara = Date.now();
  if (audio.dataset.id && ara - ultimDesat > 5000) {
    ultimDesat = ara;
    estat.posicions[audio.dataset.id] = audio.currentTime;
    desaEstat();
  }
  if ("mediaSession" in navigator && audio.duration && navigator.mediaSession.setPositionState) {
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: 1 });
    } catch (e) { /* ignorar */ }
  }
});
audio.addEventListener("ended", () => {
  const id = audio.dataset.id;
  if (!id) return;
  estat.escoltades[id] = true;
  estat.posicions[id] = 0;
  desaEstat();
  actualitzaBotoPlay();
  // No saltem sols a la següent: només ho anunciem.
  const seg = veina(id, 1);
  const avis = $("seguent-avis");
  if (seg && paradaActual && paradaActual.id === id) {
    const cami = seg.com_arribar.split(".")[0];
    avis.textContent = `Següent: ${seg.nom}, ${cami.charAt(0).toLowerCase()}${cami.slice(1)}`;
    avis.hidden = false;
  }
});

$("btn-play").addEventListener("click", () => {
  if (audio.paused) {
    audio.play().catch(() => {});
    $("seguent-avis").hidden = true;
  } else {
    audio.pause();
  }
});
$("btn-enrere").addEventListener("click", () => salta(-15));
$("btn-endavant").addEventListener("click", () => salta(15));
const barra = $("barra-temps");
barra.addEventListener("input", () => { barra.dataset.arrossegant = "1"; $("temps-actual").textContent = format(barra.value); });
barra.addEventListener("change", () => { delete barra.dataset.arrossegant; audio.currentTime = Number(barra.value); });

// ---------- Vista fitxa ----------
function veina(id, pas) {
  const p = parades.find((q) => q.id === id);
  const llista = paradesDelDia(p.dia);
  const i = llista.findIndex((q) => q.id === id);
  return llista[i + pas] || null;
}

async function obreFitxa(id, desHistorial = false) {
  const p = parades.find((q) => q.id === id);
  if (!p) return mostraLlista();
  if (p.alternativa && p.alternativa !== estat.opcio10) { estat.opcio10 = p.alternativa; desaEstat(); }
  paradaActual = p;
  estat.dia = String(p.dia);
  document.body.dataset.dia = estat.dia;
  if (!desHistorial) history.pushState({ id }, "", `#${id}`);

  $("vista-llista").hidden = true;
  $("vista-fitxa").hidden = false;
  window.scrollTo(0, 0);

  $("fitxa-num").textContent = `${p.dia === 1 ? "Divendres" : "Diumenge"} · Parada ${p.ordre} · ${p.hora}`;
  $("fitxa-nom").textContent = p.nom;
  $("seguent-avis").hidden = true;

  // Selector A/B dins de la fitxa de la parada 10
  const alternatives = parades.filter((q) => q.dia === p.dia && q.ordre === p.ordre);
  const opc = $("fitxa-opcions");
  opc.innerHTML = "";
  opc.hidden = alternatives.length < 2;
  for (const alt of alternatives.length > 1 ? alternatives : []) {
    const b = document.createElement("button");
    b.textContent = `Opció ${alt.alternativa}`;
    b.setAttribute("aria-pressed", String(alt.id === p.id));
    b.addEventListener("click", () => { estat.opcio10 = alt.alternativa; desaEstat(); obreFitxa(alt.id, true); history.replaceState({ id: alt.id }, "", `#${alt.id}`); });
    opc.appendChild(b);
  }

  const mapa = $("btn-mapa");
  if (p.lat != null) {
    mapa.href = `https://maps.apple.com/?ll=${p.lat},${p.lon}&q=${encodeURIComponent(p.nom)}`;
    mapa.hidden = false;
  } else {
    mapa.hidden = true;
  }

  carregaAudio(p);
  pintaTemps();
  actualitzaBotoPlay();

  $("btn-anterior").disabled = !veina(p.id, -1);
  $("btn-seguent").disabled = !veina(p.id, 1);

  const g = await carregaGuio(p.id).catch(() => null);
  if (paradaActual !== p) return;
  $("fitxa-on").textContent = g ? g.meta.on_ets || "" : "";
  const practic = $("fitxa-practic");
  if (g && (g.meta.adreca || g.meta.que_demanar)) {
    $("fitxa-adreca").innerHTML = g.meta.adreca ? "<strong>On</strong>" : "";
    $("fitxa-adreca").append(g.meta.adreca || "");
    $("fitxa-demanar").innerHTML = g.meta.que_demanar ? "<strong>Què demanar</strong>" : "";
    $("fitxa-demanar").append(g.meta.que_demanar || "");
    practic.hidden = false;
  } else {
    practic.hidden = true;
  }
  const art = $("fitxa-text");
  art.innerHTML = "";
  for (const par of g ? g.paragrafs : ["No s'ha pogut carregar el text."]) {
    const el = document.createElement("p");
    el.textContent = par;
    art.appendChild(el);
  }
}

function mostraLlista(desHistorial = false) {
  paradaActual = null;
  $("vista-fitxa").hidden = true;
  $("vista-llista").hidden = false;
  if (!desHistorial) history.pushState({}, "", location.pathname);
  pintaLlista();
}

$("btn-tornar").addEventListener("click", () => mostraLlista());
$("btn-anterior").addEventListener("click", () => { const v = veina(paradaActual.id, -1); if (v) obreFitxa(v.id); });
$("btn-seguent").addEventListener("click", () => { const v = veina(paradaActual.id, 1); if (v) obreFitxa(v.id); });
for (const b of document.querySelectorAll(".pestanyes button")) {
  b.addEventListener("click", () => { estat.dia = b.dataset.dia; desaEstat(); pintaLlista(); });
}
function segueixHash() {
  const id = location.hash.slice(1);
  if (id) {
    if (!paradaActual || paradaActual.id !== id) obreFitxa(id, true);
  } else if (paradaActual) {
    mostraLlista(true);
  }
}
window.addEventListener("popstate", segueixHash);
window.addEventListener("hashchange", segueixHash);

// ---------- Descarrega-ho tot ----------
const CACHE_AUDIO = "audioguia-audio-v1";
async function descarregaTot() {
  const boto = $("btn-descarrega");
  const caixa = $("progres-descarrega");
  if (!("caches" in window)) {
    caixa.hidden = false;
    $("progres-text").textContent = "Aquest navegador no permet desar-ho per a fora de línia.";
    return;
  }
  boto.disabled = true;
  caixa.hidden = false;
  const urls = [
    ...parades.map((p) => p.fitxer_audio),
    ...parades.map((p) => `content/guions/${p.id}.md`),
  ];
  const cache = await caches.open(CACHE_AUDIO);
  let fets = 0, errors = 0;
  for (const url of urls) {
    try {
      const ja = await cache.match(url);
      if (!ja) {
        const r = await fetch(url, { cache: "no-cache" });
        if (!r.ok) throw new Error(r.status);
        await cache.put(url, r);
      }
    } catch (e) {
      errors++;
    }
    fets++;
    $("progres-ple").style.width = `${Math.round((fets / urls.length) * 100)}%`;
    $("progres-text").textContent = `${fets} de ${urls.length} fitxers`;
  }
  $("progres-text").textContent = errors
    ? `Fet, però ${errors} fitxers han fallat. Torneu-ho a provar amb wifi.`
    : "Fet. Ja podeu anar sense cobertura.";
  boto.disabled = false;
}
$("btn-descarrega").addEventListener("click", descarregaTot);

// ---------- Inici ----------
async function inici() {
  const r = await fetch("content/parades.json");
  parades = await r.json();
  const id = location.hash.slice(1);
  if (id && parades.some((p) => p.id === id)) {
    history.replaceState({ id }, "", `#${id}`);
    obreFitxa(id, true);
  } else {
    pintaLlista();
  }
}
inici();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
