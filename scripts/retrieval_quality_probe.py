#!/usr/bin/env python3
"""Audit semantic quality of live 100k neural retrieval against catalog metadata."""
import json
import re
import urllib.error
import urllib.request
from collections import defaultdict

RETRIEVE_URL = "https://an-album-a-day.vercel.app/api/neural-retrieve"
CATALOG_BASE = "https://gabiarbex.github.io/an-album-a-day/data/catalog/"
HEADERS = {"User-Agent": "album-a-day-retrieval-quality/1.0"}

CASES = [
    {
        "name": "dreamy shoegaze",
        "payload": {
            "note": "dreamy shoegaze, ethereal guitars, hazy and immersive",
            "moods": ["dreamy"],
            "energy": 4,
            "comfort": "exploration",
            "time": 60,
            "intent": {"moods": {"dreamy": 1}, "avoidMoods": {}, "genres": ["shoegaze", "dream pop"], "avoidGenres": []},
            "limit": 12,
        },
        "keywords": ["shoegaze", "dream pop", "ethereal", "dreamy", "ambient", "hazy"],
    },
    {
        "name": "late-night jazz",
        "payload": {
            "note": "late night smoky jazz, saxophone, intimate and reflective",
            "moods": ["reflective"],
            "energy": 3,
            "comfort": None,
            "time": 70,
            "intent": {"moods": {"reflective": 1}, "avoidMoods": {}, "genres": ["jazz"], "avoidGenres": []},
            "limit": 12,
        },
        "keywords": ["jazz", "sax", "bebop", "cool jazz", "modal", "fusion"],
    },
    {
        "name": "raw punk",
        "payload": {
            "note": "raw aggressive punk, fast loud guitars, confrontational",
            "moods": ["raw", "angry"],
            "energy": 9,
            "comfort": "exploration",
            "time": 45,
            "intent": {"moods": {"gritty": 1, "intense": 1}, "avoidMoods": {}, "genres": ["punk"], "avoidGenres": []},
            "limit": 12,
        },
        "keywords": ["punk", "hardcore", "garage", "noise", "post-punk", "grunge"],
    },
    {
        "name": "warm acoustic",
        "payload": {
            "note": "warm intimate acoustic singer-songwriter, gentle and close",
            "moods": ["warm", "tender"],
            "energy": 3,
            "comfort": None,
            "time": 55,
            "intent": {"moods": {"warm": 1, "reflective": 0.5}, "avoidMoods": {}, "genres": ["folk"], "avoidGenres": []},
            "limit": 12,
        },
        "keywords": ["folk", "acoustic", "singer-songwriter", "singer songwriter", "indie folk", "songwriter"],
    },
    {
        "name": "euphoric electronic",
        "payload": {
            "note": "euphoric electronic club music, dancefloor, bright and energetic",
            "moods": ["euphoric", "energetic"],
            "energy": 9,
            "comfort": "exploration",
            "time": 60,
            "intent": {"moods": {"energetic": 1, "hopeful": 0.7}, "avoidMoods": {}, "genres": ["electronic", "house"], "avoidGenres": []},
            "limit": 12,
        },
        "keywords": ["electronic", "dance", "house", "techno", "trance", "club", "edm"],
    },
]


def get_json(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**HEADERS, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=95) as response:
            body = json.loads(response.read().decode("utf-8"))
            assert response.status == 200, response.status
            return body
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise AssertionError(f"HTTP {error.code}: {detail[:1200]}") from error


def normalize(value):
    return re.sub(r"\s+", " ", str(value or "").lower()).strip()


def album_text(album):
    parts = [
        album.get("artist"),
        album.get("title"),
        album.get("year"),
        *(album.get("genres") or []),
        *(album.get("tags") or []),
        *(album.get("moods") or []),
    ]
    features = album.get("features") or {}
    if isinstance(features.get("moods"), dict):
        parts.extend(features["moods"].keys())
    return normalize(" ".join(
        str(item.get("name") if isinstance(item, dict) else item)
        for item in parts
        if item
    ))


lookup = get_json(CATALOG_BASE + "lookup.json")
assert isinstance(lookup, dict) and len(lookup) >= 99000, len(lookup)

overall_hits = 0
overall_rows = 0

for case in CASES:
    data = post_json(RETRIEVE_URL, case["payload"])
    assert data.get("ok") is True, data
    matches = (data.get("matches") or [])[:10]
    assert len(matches) == 10, (case["name"], len(matches))

    by_file = defaultdict(list)
    for row in matches:
        album_id = str(row.get("id") or "")
        file = lookup.get(album_id)
        assert file, (case["name"], "missing lookup", album_id)
        by_file[file].append(album_id)

    albums_by_id = {}
    for file, wanted in by_file.items():
        payload = get_json(CATALOG_BASE + file)
        albums = payload if isinstance(payload, list) else payload.get("albums", [])
        wanted_set = set(wanted)
        for album in albums:
            album_id = str(album.get("lookup_id") or "")
            if album_id in wanted_set:
                albums_by_id[album_id] = album

    rows = []
    hits = 0
    for row in matches:
        album_id = str(row["id"])
        album = albums_by_id.get(album_id)
        assert album, (case["name"], "album not resolved", album_id)
        text = album_text(album)
        matched = [keyword for keyword in case["keywords"] if keyword in text]
        if matched:
            hits += 1
        rows.append((album.get("artist"), album.get("title"), matched, row.get("score")))

    hit_rate = hits / len(rows)
    overall_hits += hits
    overall_rows += len(rows)

    print(f"\n{case['name']}: metadata-evidence hit rate {hits}/10")
    for i, (artist, title, matched, score) in enumerate(rows, 1):
        evidence = ", ".join(matched) if matched else "—"
        print(f"  {i:02d}. {artist} — {title} | {score:.4f} | {evidence}")

    # This is intentionally a floor, not a claim that exact-keyword matching defines relevance.
    # Neural retrieval can be semantically right without literal catalog tags, but fewer than 3/10
    # evidence-bearing hits is a strong warning that title/artist noise may be dominating.
    assert hits >= 3, f"{case['name']}: only {hits}/10 top neural hits have supporting catalog evidence"

overall_rate = overall_hits / overall_rows
assert overall_rate >= 0.45, f"overall metadata-evidence hit rate too low: {overall_hits}/{overall_rows}"
print(f"\nPASS retrieval quality audit: {overall_hits}/{overall_rows} top results carry expected catalog evidence")
