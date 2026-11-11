# Brussel·les · Audioguia

PWA estàtica (HTML, CSS i JS sense framework) amb un àudio en català per parada, per a la ruta de PROTOCOL.md.

## Provar-la en local

```bash
python3 -m http.server 8765
```

i obrir http://localhost:8765. El servidor de Python no respon a peticions `Range`, així que la primera vegada que s'obre l'app (abans que el service worker en prengui el control) avançar dins d'un àudio pot fallar. A partir de la segona càrrega l'àudio el serveix el service worker i funciona bé. GitHub Pages sí que respon a `Range`.

## Regenerar els àudios

```bash
python3 -m venv .venv
.venv/bin/pip install edge-tts imageio-ffmpeg
.venv/bin/python scripts/genera_audio.py --veu ca-ES-EnricNeural
```

Només torna a generar els guions que han canviat. Escriu la durada real a `content/parades.json`.

Per corregir com la veu diu un nom, afegiu-lo al camp `pronuncia` del guió, en JSON. Per exemple: `pronuncia: {"Poelaert": "Pulaart"}`. Només afecta l'àudio; el text de pantalla no canvia.

## Publicar canvis

El service worker serveix l'app des de la memòria cau. Si canvieu `index.html`, `app.js`, `styles.css` o `content/parades.json`, pugeu el número de `CACHE_APP` a `sw.js` (`audioguia-app-v1` → `v2`). Si canvieu àudios o guions, pugeu `CACHE_AUDIO` (aquest número també és a `app.js`).

## Instal·lar a l'iPhone

1. Obrir l'URL publicada amb Safari.
2. Botó Compartir → "Afegir a la pantalla d'inici".
3. Obrir l'app des de la icona, amb wifi, i prémer "Descarrega-ho tot per anar sense cobertura".
4. Posar el mòbil en mode avió i comprovar que dues parades sonen.
5. Provar-ho amb la pantalla bloquejada i els auriculars. Si en mode app l'àudio s'atura en bloquejar la pantalla, fer servir la mateixa URL en una pestanya de Safari.
