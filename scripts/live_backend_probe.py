#!/usr/bin/env python3
import json
import sys
import time
import urllib.request
import urllib.error

URL = "https://an-album-a-day.vercel.app/api/neural-retrieve"
PAYLOAD = {
    "note": "quiet, intimate, melancholy, a little homesick, not upbeat",
    "moods": ["melancholic", "tender", "reflective"],
    "energy": 2,
    "comfort": "exploration",
    "time": 55,
    "intent": {
        "moods": {"melancholic": 1, "reflective": 0.8, "warm": 0.35},
        "avoidMoods": {"energetic": 1, "euphoric": 0.8},
        "genres": [],
        "avoidGenres": []
    },
    "limit": 12
}

request = urllib.request.Request(
    URL,
    data=json.dumps(PAYLOAD).encode("utf-8"),
    headers={"Content-Type": "application/json", "User-Agent": "album-a-day-live-probe/1.0"},
    method="POST",
)

started = time.monotonic()
try:
    with urllib.request.urlopen(request, timeout=95) as response:
        body = response.read().decode("utf-8")
        status = response.status
except urllib.error.HTTPError as error:
    body = error.read().decode("utf-8", "replace")
    print(f"HTTP {error.code}: {body}")
    sys.exit(1)
except Exception as error:
    print(f"request failed: {error}")
    sys.exit(1)

elapsed = time.monotonic() - started
print(f"status={status} elapsed={elapsed:.2f}s")
print(body[:5000])

data = json.loads(body)
assert status == 200, status
assert data.get("ok") is True, data
assert data.get("engine") == "full-catalog-neural-retrieval-v1", data
assert int(data.get("totalAlbums") or 0) == 100000, data
assert int(data.get("dimensions") or 0) == 64, data
matches = data.get("matches") or []
assert len(matches) >= 10, data
assert all(row.get("id") and isinstance(row.get("score"), (int, float)) for row in matches), matches
query_vector = data.get("queryVector") or []
assert len(query_vector) == 384, len(query_vector)

print("live neural retrieval probe passed")


RECOMMEND_URL = "https://an-album-a-day.vercel.app/api/recommend"
RECOMMEND_PAYLOAD = {
    "client_id": "",
    "note": "quiet, intimate, melancholy, a little homesick, not upbeat",
    "moods": ["melancholic", "tender", "reflective"],
    "energy": 2,
    "comfort": "exploration",
    "time": 55,
    "intent": {
        "moods": {"melancholic": 1, "reflective": 0.8, "warm": 0.35},
        "avoidMoods": {"energetic": 1, "euphoric": 0.8},
        "genres": [],
        "avoidGenres": []
    },
    "recentArtists": [],
    "candidates": [
        {
            "id": "quiet-record",
            "artist": "Quiet Test Artist",
            "title": "Letters at 2AM",
            "year": "2024",
            "genres": ["ambient", "singer-songwriter"],
            "tags": ["intimate", "melancholic", "acoustic", "slow tempo", "reflective"],
            "moods": ["melancholic", "reflective", "warm", "tender"],
            "energy": 2,
            "duration": 41,
            "familiarity": 0,
            "tasteAdjacency": 0.25,
            "profileQuality": 1,
            "localScore": 0.86,
            "semanticScore": 0.65,
            "moodSource": "editorial",
            "moodConfidence": 0.95,
            "energySource": "audio",
            "energyConfidence": 1,
            "catalogFile": None,
            "catalogChunk": 0
        },
        {
            "id": "party-record",
            "artist": "Party Test Artist",
            "title": "Neon Saturday",
            "year": "2024",
            "genres": ["dance pop", "rock"],
            "tags": ["party", "euphoric", "fast tempo", "bright", "energetic"],
            "moods": ["energetic", "euphoric", "hopeful"],
            "energy": 9,
            "duration": 39,
            "familiarity": 0,
            "tasteAdjacency": 0.25,
            "profileQuality": 1,
            "localScore": 0.62,
            "semanticScore": 0.2,
            "moodSource": "editorial",
            "moodConfidence": 0.95,
            "energySource": "audio",
            "energyConfidence": 1,
            "catalogFile": None,
            "catalogChunk": 0
        },
        {
            "id": "neutral-record",
            "artist": "Neutral Test Artist",
            "title": "Ordinary Afternoon",
            "year": "2024",
            "genres": ["indie"],
            "tags": ["reflective", "midtempo"],
            "moods": ["reflective"],
            "energy": 5,
            "duration": 43,
            "familiarity": 0,
            "tasteAdjacency": 0.1,
            "profileQuality": 0.75,
            "localScore": 0.55,
            "semanticScore": 0.25,
            "moodSource": "editorial",
            "moodConfidence": 0.8,
            "energySource": "editorial",
            "energyConfidence": 0.7,
            "catalogFile": None,
            "catalogChunk": 0
        }
    ]
}

recommend_request = urllib.request.Request(
    RECOMMEND_URL,
    data=json.dumps(RECOMMEND_PAYLOAD).encode("utf-8"),
    headers={"Content-Type": "application/json", "User-Agent": "album-a-day-live-probe/1.0"},
    method="POST",
)

recommend_started = time.monotonic()
try:
    with urllib.request.urlopen(recommend_request, timeout=95) as response:
        recommend_body = response.read().decode("utf-8")
        recommend_status = response.status
except urllib.error.HTTPError as error:
    recommend_body = error.read().decode("utf-8", "replace")
    print(f"recommend HTTP {error.code}: {recommend_body}")
    sys.exit(1)
except Exception as error:
    print(f"recommend request failed: {error}")
    sys.exit(1)

recommend_elapsed = time.monotonic() - recommend_started
print(f"recommend_status={recommend_status} recommend_elapsed={recommend_elapsed:.2f}s")
print(recommend_body[:5000])

recommend_data = json.loads(recommend_body)
assert recommend_status == 200, recommend_status
assert recommend_data.get("ok") is True, recommend_data
assert recommend_data.get("engine") == "hybrid-neural-reranker-v3", recommend_data
assert recommend_data.get("albumId") == "quiet-record", recommend_data
diagnostics = recommend_data.get("diagnostics") or {}
assert float(diagnostics.get("neural") or 0) > -1, diagnostics
alternatives = recommend_data.get("alternatives") or []
assert alternatives and alternatives[0].get("id") == "quiet-record", alternatives

print("live final reranker adversarial probe passed")
