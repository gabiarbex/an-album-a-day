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
