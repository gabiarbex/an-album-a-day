#!/usr/bin/env python3
from __future__ import annotations

import json
import hashlib
import math
import re
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data" / "catalog"
OUT = ROOT / "data" / "vectors" / "v3"
MODEL_ID = "sentence-transformers/all-MiniLM-L6-v2"
PROFILE_VERSION = "album-profile-v4-minilm-clean"
DIMENSIONS = 384
SCALE = 127.0


def clean_array(values, limit=16):
    if not isinstance(values, list):
        return []
    out = []
    for value in values:
        if isinstance(value, dict):
            value = value.get("name")
        if not value:
            continue
        text = re.sub(r"\s+", " ", str(value).strip())[:100]
        if text:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def energy_label(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return ""
    if n <= 2.5:
        return "very low energy, hushed, restrained"
    if n <= 4:
        return "low energy, calm, restrained"
    if n >= 8.5:
        return "very high energy, forceful, lively"
    if n >= 6.5:
        return "high energy, driving, lively"
    return "medium energy"


def stable_album_id(album):
    if album.get("lookup_id"):
        return str(album["lookup_id"])
    text = f"{str(album.get('artist', '')).strip().lower()}\0{str(album.get('title', '')).strip().lower()}"
    h = 14695981039346656037
    p = 1099511628211
    mask = (1 << 64) - 1
    for ch in text:
        h ^= ord(ch)
        h = (h * p) & mask
    return f"{h:016x}"


def decade_label(year):
    try:
        n = int(str(year or "")[:4])
    except ValueError:
        return ""
    if not 1900 <= n <= 2100:
        return ""
    return f"{(n // 10) * 10}s"


def album_profile(album):
    genres = clean_array(album.get("genres"), 14)
    tags = clean_array(album.get("tags"), 24)
    provenance = album.get("provenance") if isinstance(album.get("provenance"), dict) else {}
    mood_provenance = provenance.get("moods") if isinstance(provenance.get("moods"), dict) else {}
    translated_mood_guess = str(mood_provenance.get("source") or "") == "musicbrainz-tag-translation"
    moods = [] if translated_mood_guess else clean_array(album.get("moods"), 16)

    features = album.get("features") if isinstance(album.get("features"), dict) else {}
    feature_moods = features.get("moods") if isinstance(features.get("moods"), dict) else {}
    feature_mood_names = [] if translated_mood_guess else [
        name
        for name, value in sorted(feature_moods.items(), key=lambda item: float(item[1] or 0), reverse=True)
        if float(value or 0) >= 0.35
    ][:12]

    metadata = album.get("metadata") if isinstance(album.get("metadata"), dict) else {}
    year = str(album.get("year") or metadata.get("year") or "")[:4]
    decade = decade_label(year)

    duration_candidates = [
        features.get("duration_min"),
        album.get("length_min"),
        album.get("duration"),
    ]
    duration = next((float(v) for v in duration_candidates if v is not None and _finite(v)), None)

    energy_provenance = provenance.get("energy") if isinstance(provenance.get("energy"), dict) else {}
    translated_energy_guess = str(energy_provenance.get("source") or "") == "musicbrainz-tag-translation"
    energy_candidates = [] if translated_energy_guess else [
        float(features.get("energy")) * 10 if features.get("energy") is not None and _finite(features.get("energy")) else None,
        album.get("energy_level"),
        album.get("energy"),
    ]
    energy = next((float(v) for v in energy_candidates if v is not None and _finite(v)), None)

    pieces = [
        f"artist: {str(album.get('artist', ''))[:140]}",
        f"album: {str(album.get('title', ''))[:180]}",
        f"released: {year}" if year else "",
        f"era: {decade}" if decade else "",
        f"genres and styles: {', '.join(genres)}" if genres else "",
        f"descriptive music tags: {', '.join(tags)}" if tags else "",
        f"catalog mood tags: {', '.join(moods)}" if moods else "",
        f"estimated emotional qualities: {', '.join(feature_mood_names)}" if feature_mood_names else "",
        energy_label(energy) if energy is not None else "",
        f"runtime: about {round(duration)} minutes" if duration is not None else "",
        "Represent the sound, emotional character, atmosphere, intensity, and listening context of this record.",
    ]
    return ". ".join(piece for piece in pieces if piece)[:900]


def _finite(value):
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def load_rows(path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, list) else payload.get("albums", [])


def safe_key(value):
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", str(value))[:180]


def write_chunk(model, file_name, chunk_index, albums):
    valid = [album for album in albums if album.get("artist") and album.get("title")]
    ids = [stable_album_id(album) for album in valid]
    profiles = [album_profile(album) for album in valid]

    embeddings = model.encode(
        profiles,
        batch_size=256,
        show_progress_bar=False,
        normalize_embeddings=True,
        convert_to_numpy=True,
    )
    if embeddings.shape[1] != DIMENSIONS:
        raise RuntimeError(f"Unexpected embedding width: {embeddings.shape}")

    quantized = np.clip(np.rint(embeddings * SCALE), -127, 127).astype(np.int8)
    stem = f"{safe_key(file_name)}__{chunk_index:03d}"
    (OUT / f"{stem}.ids.json").write_text(json.dumps(ids, separators=(",", ":")), encoding="utf-8")
    quantized.tofile(OUT / f"{stem}.i8.bin")
    return {
        "file": file_name,
        "chunk": chunk_index,
        "count": len(ids),
        "ids": f"{stem}.ids.json",
        "vectors": f"{stem}.i8.bin",
    }


def main():
    manifest = json.loads((CATALOG / "manifest.json").read_text(encoding="utf-8"))
    shard_size = int(manifest.get("shard_size") or 1000)
    OUT.mkdir(parents=True, exist_ok=True)

    # Clean only generated vector files; leave the folder itself.
    for path in OUT.iterdir():
        if path.is_file():
            path.unlink()

    print(f"Loading {MODEL_ID}")
    model = SentenceTransformer(MODEL_ID, device="cpu")

    chunks = []
    base_file = manifest.get("base_file") or "base.json"
    base_rows = load_rows(CATALOG / base_file)
    for chunk_index, offset in enumerate(range(0, len(base_rows), shard_size)):
        block = base_rows[offset : offset + shard_size]
        print(f"Embedding {base_file} chunk {chunk_index} ({len(block)} albums)")
        chunks.append(write_chunk(model, base_file, chunk_index, block))

    for i, shard in enumerate(manifest.get("shards", []), start=1):
        file_name = shard["file"]
        rows = load_rows(CATALOG / file_name)
        print(f"Embedding {file_name} ({len(rows)} albums) [{i}/{len(manifest.get('shards', []))}]")
        chunks.append(write_chunk(model, file_name, 0, rows))

    catalog_fingerprint = hashlib.sha256((CATALOG / "lookup.json").read_bytes()).hexdigest()

    vector_manifest = {
        "version": 3,
        "profileVersion": PROFILE_VERSION,
        "model": MODEL_ID,
        "dimensions": DIMENSIONS,
        "catalogFingerprint": catalog_fingerprint,
        "quantization": {"type": "int8", "scale": SCALE},
        "totalAlbums": sum(chunk["count"] for chunk in chunks),
        "chunks": chunks,
    }
    (OUT / "manifest.json").write_text(
        json.dumps(vector_manifest, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {vector_manifest['totalAlbums']} album vectors in {len(chunks)} chunks")


if __name__ == "__main__":
    main()
