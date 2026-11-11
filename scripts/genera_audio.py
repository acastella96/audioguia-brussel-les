#!/usr/bin/env python3
"""Genera els MP3 de l'audioguia a partir de content/guions/*.md.

- Llegeix el text de cada guió (el que hi ha després del frontmatter).
- Aplica les substitucions de `pronuncia` (només per a l'àudio).
- Sintetitza amb edge-tts, passa a MP3 mono 64 kbps normalitzat a -16 LUFS amb ffmpeg (el del sistema o el d'imageio-ffmpeg).
- Mesura la durada real i l'escriu a content/parades.json (camp durada_s).
- Si el text i la veu no han canviat, no torna a generar el fitxer.

Ús:
    .venv/bin/python scripts/genera_audio.py --veu ca-ES-JoanaNeural
    .venv/bin/python scripts/genera_audio.py --veu ca-ES-EnricNeural --nomes d1-02-grand-place
"""
import argparse
import asyncio
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import edge_tts

ARREL = Path(__file__).resolve().parent.parent
GUIONS = ARREL / "content" / "guions"
PARADES = ARREL / "content" / "parades.json"
AUDIO = ARREL / "audio"
CACHE = ARREL / "content" / ".audio-cache.json"


def llegeix_guio(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        sys.exit(f"{path.name}: falta el frontmatter")
    cap, cos = m.groups()
    meta = {}
    for linia in cap.splitlines():
        if linia.startswith("#") or ":" not in linia:
            continue
        clau, valor = linia.split(":", 1)
        meta[clau.strip()] = valor.strip()
    pronuncia = json.loads(meta.get("pronuncia", "{}") or "{}")
    return meta, cos.strip(), pronuncia


def text_audio(cos, pronuncia):
    for original, substitut in pronuncia.items():
        cos = re.sub(rf"\b{re.escape(original)}\b", substitut, cos)
    return cos


def troba_ffmpeg():
    # ffmpeg del sistema si n'hi ha; si no, el que porta el paquet imageio-ffmpeg del .venv.
    if shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("Falta ffmpeg. Instal·la'l amb: brew install ffmpeg, o bé .venv/bin/pip install imageio-ffmpeg")


FFMPEG = troba_ffmpeg()


def durada(path):
    # ffmpeg -i escriu la durada a stderr: "Duration: 00:02:31.42"
    sortida = subprocess.run([FFMPEG, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", sortida.stderr).groups()
    return round(int(h) * 3600 + int(m) * 60 + float(s))


async def sintetitza(text, veu, desti, intents=4):
    # edge-tts falla de tant en tant (NoAudioReceived, talls de xarxa): ho tornem a provar.
    for intent in range(1, intents + 1):
        try:
            await edge_tts.Communicate(text, veu).save(str(desti))
            return
        except Exception as e:
            if intent == intents:
                raise
            print(f"  intent {intent} fallit ({type(e).__name__}), reintentant...")
            await asyncio.sleep(5 * intent)


def normalitza(origen, desti):
    subprocess.run(
        [FFMPEG, "-y", "-loglevel", "error", "-i", str(origen),
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "1", "-ar", "44100",
         "-codec:a", "libmp3lame", "-b:a", "64k", str(desti)],
        check=True,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--veu", required=True, help="p. ex. ca-ES-JoanaNeural")
    ap.add_argument("--nomes", nargs="*", help="ids concrets a generar")
    ap.add_argument("--força", action="store_true", help="regenera encara que no hagi canviat")
    args = ap.parse_args()

    AUDIO.mkdir(exist_ok=True)
    parades = json.loads(PARADES.read_text(encoding="utf-8"))
    per_id = {p["id"]: p for p in parades}
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}

    for path in sorted(GUIONS.glob("*.md")):
        meta, cos, pronuncia = llegeix_guio(path)
        ident = meta.get("id", path.stem)
        if args.nomes and ident not in args.nomes:
            continue
        if ident not in per_id:
            sys.exit(f"{ident}: no surt a parades.json")
        text = text_audio(cos, pronuncia)
        empremta = hashlib.sha256(f"{args.veu}\n{text}".encode()).hexdigest()
        desti = ARREL / per_id[ident]["fitxer_audio"]
        if ident not in cache and desti.exists() and desti.stat().st_mtime > path.stat().st_mtime:
            # MP3 generat en una execució interrompuda, posterior a l'últim canvi del guió: l'adoptem.
            cache[ident] = empremta
        if not args.força and cache.get(ident) == empremta and desti.exists():
            print(f"= {ident} (sense canvis)")
        else:
            with tempfile.TemporaryDirectory() as tmp:
                brut = Path(tmp) / "brut.mp3"
                asyncio.run(sintetitza(text, args.veu, brut))
                normalitza(brut, desti)
            cache[ident] = empremta
            print(f"+ {ident}")
        per_id[ident]["durada_s"] = durada(desti)
        # Desem després de cada parada perquè una interrupció no faci perdre la feina feta.
        PARADES.write_text(json.dumps(parades, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        CACHE.write_text(json.dumps(cache, indent=2) + "\n")

    print("\n| Parada | Durada |")
    print("| --- | --- |")
    for p in parades:
        if p["durada_s"] is not None:
            m, s = divmod(p["durada_s"], 60)
            print(f"| {p['id']} | {m}:{s:02d} |")


if __name__ == "__main__":
    main()
