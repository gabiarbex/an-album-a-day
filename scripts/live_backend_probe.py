#!/usr/bin/env python3
"""Behavioral probe for the deployed Album-a-Day neural recommender."""
import json
import os
import sys
import time
import urllib.error
import urllib.request

HEALTH_URL = "https://an-album-a-day.vercel.app/api/health"
RETRIEVE_URL = "https://an-album-a-day.vercel.app/api/neural-retrieve"
RECOMMEND_URL = "https://an-album-a-day.vercel.app/api/recommend"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "album-a-day-live-probe/2.0",
}


def post_json(url, payload, timeout=95):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=HEADERS,
        method="POST",
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")
        raise AssertionError(f"HTTP {error.code} from {url}: {body[:1600]}") from error
    except Exception as error:
        raise AssertionError(f"request failed for {url}: {error}") from error
    elapsed = time.monotonic() - started
    data = json.loads(body)
    assert status == 200, (status, data)
    assert data.get("ok") is True, data
    return data, elapsed


def get_json(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            status = response.status
    except Exception as error:
        raise AssertionError(f"GET failed for {url}: {error}") from error
    data = json.loads(body)
    assert status == 200, (status, data)
    assert data.get("ok") is True, data
    return data


def wait_for_expected_deployment():
    expected = os.environ.get("EXPECTED_COMMIT_SHA", "").strip()
    if not expected:
        return
    deadline = time.monotonic() + 300
    last_seen = None
    while time.monotonic() < deadline:
        try:
            health = get_json(HEALTH_URL)
            last_seen = str(health.get("commitSha") or "")
            if last_seen == expected:
                print(f"PASS deployment gate: {expected[:8]}")
                return
        except Exception as error:
            last_seen = f"health error: {error}"
        time.sleep(5)
    raise AssertionError(
        f"production did not reach expected commit {expected[:12]} within deployment gate; "
        f"last seen: {last_seen}"
    )


wait_for_expected_deployment()


def base_candidate(candidate_id, artist, title, **overrides):
    row = {
        "id": candidate_id,
        "artist": artist,
        "title": title,
        "year": "2024",
        "genres": ["indie"],
        "tags": ["reflective", "midtempo"],
        "moods": ["reflective"],
        "energy": 5,
        "duration": 40,
        "familiarity": 0,
        "tasteAdjacency": 0,
        "profileQuality": 1,
        "localScore": 0.6,
        "semanticScore": 0.2,
        "moodSource": "editorial",
        "moodConfidence": 0.95,
        "energySource": "editorial",
        "energyConfidence": 0.9,
        "catalogFile": None,
        "catalogChunk": 0,
    }
    row.update(overrides)
    return row


# 1) Full-catalog retrieval must search the deployed 100k index and return a reusable query vector.
retrieval_payload = {
    "note": "quiet, intimate, melancholy, a little homesick, not upbeat",
    "moods": ["melancholic", "tender", "reflective"],
    "energy": 2,
    "comfort": "exploration",
    "time": 55,
    "intent": {
        "moods": {"melancholic": 1, "reflective": 0.8, "warm": 0.35},
        "avoidMoods": {"energetic": 1},
        "genres": [],
        "avoidGenres": [],
    },
    "limit": 12,
}
retrieval, retrieval_elapsed = post_json(RETRIEVE_URL, retrieval_payload)
assert retrieval.get("engine") == "full-catalog-neural-retrieval-v1", retrieval
assert int(retrieval.get("totalAlbums") or 0) == 100000, retrieval
assert int(retrieval.get("dimensions") or 0) == 64, retrieval
matches = retrieval.get("matches") or []
assert len(matches) >= 10, retrieval
assert all(row.get("id") and isinstance(row.get("score"), (int, float)) for row in matches), matches
query_vector = retrieval.get("queryVector") or []
assert len(query_vector) == 384, len(query_vector)
print(f"PASS full-catalog retrieval ({retrieval_elapsed:.2f}s)")


def run_case(name, body, candidates, expected, query_vector_override=None):
    payload = {
        "client_id": "",
        "note": body.get("note", ""),
        "moods": body.get("moods", []),
        "energy": body.get("energy"),
        "comfort": body.get("comfort"),
        "time": body.get("time"),
        "intent": body.get(
            "intent",
            {"moods": {}, "avoidMoods": {}, "genres": [], "avoidGenres": []},
        ),
        "recentArtists": body.get("recentArtists", []),
        "candidates": candidates,
    }
    if query_vector_override is not None:
        payload["queryVector"] = query_vector_override
    data, elapsed = post_json(RECOMMEND_URL, payload)
    assert data.get("engine") == "hybrid-neural-reranker-v3", data
    assert data.get("albumId") == expected, (
        name,
        expected,
        data.get("albumId"),
        data.get("alternatives"),
        data.get("diagnostics"),
    )
    alternatives = data.get("alternatives") or []
    assert alternatives and alternatives[0].get("id") == expected, alternatives
    assert elapsed < 80, f"{name}: reranker took {elapsed:.2f}s"
    print(
        f"PASS {name}: {expected} ({elapsed:.2f}s, score={data.get('score')}, "
        f"neural={data.get('diagnostics', {}).get('neural')})"
    )
    return data


# 2) Original failure class: quiet/homesick/not-upbeat must not return party music.
quiet = base_candidate(
    "quiet-record",
    "Quiet Test Artist",
    "Letters at 2AM",
    genres=["ambient", "singer-songwriter"],
    tags=["intimate", "melancholic", "acoustic", "slow tempo", "reflective"],
    moods=["melancholic", "reflective", "warm", "tender"],
    energy=2,
    duration=41,
    tasteAdjacency=0.25,
    localScore=0.86,
    semanticScore=0.65,
)
party = base_candidate(
    "party-record",
    "Party Test Artist",
    "Neon Saturday",
    genres=["dance pop", "rock"],
    tags=["party", "euphoric", "fast tempo", "bright", "energetic", "upbeat"],
    moods=["energetic", "euphoric", "hopeful"],
    energy=9,
    duration=39,
    tasteAdjacency=0.25,
    localScore=0.62,
)
neutral = base_candidate(
    "neutral-record",
    "Neutral Test Artist",
    "Ordinary Afternoon",
    tags=["reflective", "midtempo"],
    moods=["reflective"],
    energy=5,
    duration=43,
    profileQuality=0.75,
    localScore=0.55,
)
first = run_case(
    "quiet homesick not-upbeat",
    retrieval_payload,
    [quiet, party, neutral],
    "quiet-record",
    query_vector_override=query_vector,
)
assert first.get("diagnostics", {}).get("queryVectorSource") == "retrieval-reuse", first
print("PASS retrieval query-vector reuse")


# 3) Opposite energy direction: upbeat/dance should prefer the party record.
run_case(
    "upbeat high energy",
    {
        "note": "upbeat, lively, euphoric, I want to dance",
        "moods": ["energetic", "euphoric"],
        "energy": 9,
        "comfort": None,
        "time": 60,
        "intent": {
            "moods": {"energetic": 1, "hopeful": 0.8},
            "avoidMoods": {},
            "genres": [],
            "avoidGenres": [],
        },
    },
    [quiet, party, neutral],
    "party-record",
)


# 4) Explicit genre avoidance must beat neural temptation.
dream_pop = base_candidate(
    "dream-pop-record",
    "Dream Test Artist",
    "Cloud Room",
    genres=["dream pop", "shoegaze"],
    tags=["dreamy", "ethereal", "hazy", "soft"],
    moods=["dreamy", "reflective"],
    energy=4,
    localScore=0.82,
)
metal = base_candidate(
    "metal-record",
    "Heavy Test Artist",
    "Iron Room",
    genres=["metal", "doom metal"],
    tags=["heavy", "dark", "aggressive", "loud"],
    moods=["dark", "intense"],
    energy=8,
    localScore=0.68,
)
run_case(
    "dreamy but no metal",
    {
        "note": "dreamy and hazy, but absolutely no metal",
        "moods": ["dreamy"],
        "energy": 4,
        "comfort": "exploration",
        "time": 60,
        "intent": {
            "moods": {"dreamy": 1},
            "avoidMoods": {},
            "genres": ["dream pop"],
            "avoidGenres": ["metal"],
        },
    },
    [dream_pop, metal],
    "dream-pop-record",
)


# 5) A strict runtime request must reject an overlong otherwise-similar record.
short = base_candidate(
    "short-record",
    "Runtime Test Artist A",
    "Short Form",
    tags=["reflective", "indie"],
    duration=26,
    localScore=0.62,
)
long = base_candidate(
    "long-record",
    "Runtime Test Artist B",
    "Long Form",
    tags=["reflective", "indie"],
    duration=94,
    localScore=0.68,
)
run_case(
    "runtime cap",
    {
        "note": "reflective indie, I only have half an hour",
        "moods": ["reflective"],
        "energy": 5,
        "comfort": None,
        "time": 30,
        "intent": {
            "moods": {"reflective": 1},
            "avoidMoods": {},
            "genres": ["indie"],
            "avoidGenres": [],
        },
    },
    [short, long],
    "short-record",
)


# 6) Comfort mode should prefer a familiar artist when sonic evidence is otherwise near-equal.
familiar = base_candidate(
    "familiar-record",
    "Known Test Artist",
    "Same Mood A",
    familiarity=0.95,
    localScore=0.62,
)
unknown = base_candidate(
    "unknown-record",
    "Unknown Test Artist",
    "Same Mood B",
    familiarity=0.02,
    localScore=0.62,
)
run_case(
    "comfort familiarity",
    {
        "note": "something familiar and comforting",
        "moods": ["warm"],
        "energy": 5,
        "comfort": "comfort",
        "time": 60,
        "intent": {
            "moods": {"warm": 1},
            "avoidMoods": {},
            "genres": [],
            "avoidGenres": [],
        },
    },
    [familiar, unknown],
    "familiar-record",
)


# 7) Exploration should prefer an adjacent new artist over an equally-new random one.
adjacent = base_candidate(
    "adjacent-record",
    "Adjacent Test Artist",
    "Same Mood C",
    familiarity=0,
    tasteAdjacency=0.92,
    localScore=0.62,
)
random_new = base_candidate(
    "random-new-record",
    "Random Test Artist",
    "Same Mood D",
    familiarity=0,
    tasteAdjacency=0,
    localScore=0.62,
)
run_case(
    "adjacent discovery",
    {
        "note": "something new to me but connected to what I like",
        "moods": ["reflective"],
        "energy": 5,
        "comfort": "exploration",
        "time": 60,
        "intent": {
            "moods": {"reflective": 1},
            "avoidMoods": {},
            "genres": [],
            "avoidGenres": [],
        },
    },
    [adjacent, random_new],
    "adjacent-record",
)


# 8) Recent-artist pressure should prevent immediate repetition.
fresh = base_candidate(
    "fresh-artist-record",
    "Fresh Test Artist",
    "Same Mood E",
    localScore=0.62,
)
repeated = base_candidate(
    "repeated-artist-record",
    "Repeated Test Artist",
    "Same Mood F",
    localScore=0.66,
)
run_case(
    "recent artist diversity",
    {
        "note": "reflective indie",
        "moods": ["reflective"],
        "energy": 5,
        "comfort": None,
        "time": 60,
        "recentArtists": ["repeated test artist"],
        "intent": {
            "moods": {"reflective": 1},
            "avoidMoods": {},
            "genres": ["indie"],
            "avoidGenres": [],
        },
    },
    [fresh, repeated],
    "fresh-artist-record",
)

print("live recommender behavioral suite passed (8 release gates)")
