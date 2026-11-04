#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "vectors" / "v3"
OUT = ROOT / "data" / "neural-retrieval" / "v1"

SOURCE_DIM = 384
TARGET_DIM = 64
SEED = 20261104
SCALE = 127.0


def load_source_manifest():
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    if int(manifest.get("dimensions") or 0) != SOURCE_DIM:
        raise RuntimeError(f"Expected {SOURCE_DIM}D source vectors, got {manifest.get('dimensions')}")
    if int(manifest.get("totalAlbums") or 0) != 100000:
        raise RuntimeError(f"Expected 100000 albums, got {manifest.get('totalAlbums')}")
    return manifest


def orthonormal_projection():
    rng = np.random.default_rng(SEED)
    matrix = rng.normal(0.0, 1.0, size=(SOURCE_DIM, TARGET_DIM)).astype(np.float32)
    q, _ = np.linalg.qr(matrix, mode="reduced")
    return q.astype(np.float32)


def main():
    source_manifest = load_source_manifest()
    OUT.mkdir(parents=True, exist_ok=True)
    for path in OUT.iterdir():
        if path.is_file():
            path.unlink()

    projection = orthonormal_projection()
    projection.tofile(OUT / "projection.f32.bin")

    all_ids: list[str] = []
    vector_path = OUT / "vectors.i8.bin"

    with vector_path.open("wb") as sink:
        for index, chunk in enumerate(source_manifest.get("chunks", []), start=1):
            ids_path = SOURCE / chunk["ids"]
            vectors_path = SOURCE / chunk["vectors"]
            ids = json.loads(ids_path.read_text(encoding="utf-8"))
            raw = np.fromfile(vectors_path, dtype=np.int8)

            if raw.size != len(ids) * SOURCE_DIM:
                raise RuntimeError(
                    f"Shape mismatch for {vectors_path.name}: {raw.size} != {len(ids)}*{SOURCE_DIM}"
                )

            vectors = raw.reshape(len(ids), SOURCE_DIM).astype(np.float32) / SCALE
            projected = vectors @ projection
            norms = np.linalg.norm(projected, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            projected /= norms

            quantized = np.clip(np.rint(projected * SCALE), -127, 127).astype(np.int8)
            sink.write(quantized.tobytes())
            all_ids.extend(str(value) for value in ids)

            if index % 10 == 0:
                print(f"Projected {len(all_ids):,} / {source_manifest['totalAlbums']:,} albums")

    if len(all_ids) != int(source_manifest["totalAlbums"]):
        raise RuntimeError(f"Expected {source_manifest['totalAlbums']} ids, got {len(all_ids)}")

    (OUT / "ids.json").write_text(
        json.dumps(all_ids, separators=(",", ":")),
        encoding="utf-8",
    )

    manifest = {
        "version": 1,
        "sourceProfileVersion": source_manifest.get("profileVersion"),
        "sourceModel": source_manifest.get("model"),
        "sourceDimensions": SOURCE_DIM,
        "dimensions": TARGET_DIM,
        "quantization": {"type": "int8", "scale": SCALE},
        "projection": {
            "type": "seeded-gaussian-qr",
            "seed": SEED,
            "file": "projection.f32.bin",
        },
        "vectors": "vectors.i8.bin",
        "ids": "ids.json",
        "totalAlbums": len(all_ids),
        "catalogBlobSha": source_manifest.get("catalogBlobSha"),
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, separators=(",", ":")),
        encoding="utf-8",
    )

    size_mb = vector_path.stat().st_size / (1024 * 1024)
    print(f"Wrote {len(all_ids):,} projected vectors ({size_mb:.2f} MiB)")


if __name__ == "__main__":
    main()
