# P1 recommender design — album features, provenance, and ranking

Status: design only. Do not implement until this document is reviewed.

## 1. Principle

The recommender must never claim a feature match unless that feature exists for the album and its provenance is known.

Every recommendation feature has:
- a value,
- a source,
- a confidence,
- a coverage flag.

Sparse albums remain eligible. Missing data is treated as unknown, not zero.

## 2. Album feature schema

Each album keeps its current identity fields, plus:

```json
{
  "id": "mb:release-group-mbid",
  "artist": "Artist",
  "title": "Album",
  "year": 1997,
  "genres": [
    {"name": "shoegaze", "weight": 0.86, "source": "musicbrainz+lastfm"}
  ],
  "features": {
    "moods": {
      "dark": 0.12,
      "cold": 0.33,
      "intense": 0.58,
      "reflective": 0.76,
      "energetic": 0.44,
      "melancholic": 0.81,
      "gritty": 0.21,
      "alienated": 0.65,
      "nostalgic": 0.49,
      "warm": 0.18,
      "dreamy": 0.91,
      "hopeful": 0.24
    },
    "energy": 0.46,
    "duration_min": 47.2,
    "bpm": 102.0,
    "global_popularity": 0.38,
    "obscurity": 0.62
  },
  "provenance": {
    "moods": {"source": "acousticbrainz+tags", "confidence": 0.81},
    "energy": {"source": "acousticbrainz", "confidence": 0.88},
    "duration_min": {"source": "musicbrainz", "confidence": 0.98},
    "genres": {"source": "musicbrainz+lastfm", "confidence": 0.84},
    "global_popularity": {"source": "lastfm", "confidence": 0.72}
  }
}
```

Internal numeric features should use 0–1. The UI can display energy as 0–10 if useful.

## 3. Source hierarchy

### Identity, release structure, duration
Primary source: MusicBrainz.

Choose one canonical release per release group:
1. official release,
2. complete tracklist,
3. reliable recording links and durations,
4. prefer original/non-deluxe editions,
5. then earliest release date as deterministic tie-breaker.

Album duration = sum of canonical-release recording/track durations.

### Acoustic features
Primary source: AcousticBrainz, joined through recording MBIDs.

Use high-level probabilities rather than only classifier labels. Aggregate recording-level values to album level with robust statistics. Duration-weighted means are preferred for track-level classifiers; median is preferred for BPM-like quantities when outliers are plausible.

AcousticBrainz is historical, not comprehensive: its final full dump contains about 29.46M submissions, indexed by MusicBrainz recording MBID. Coverage must be measured rather than assumed.

### Genre and weak mood supervision
MusicBrainz genres/tags and Last.fm top tags can supplement audio-derived features.

Tag mappings into the 12-mood vocabulary must be versioned and inspectable. Tags are weak labels, never ground truth.

Examples:
- "ethereal", "dream pop" -> dreamy
- "sad", "melancholia" -> melancholic
- "noise rock", "hardcore" -> gritty/intense
- "chill", "soft" -> reflective/warm/low energy

Store the original top tags as well as the mapped mood vector.

### Popularity
Use a global popularity proxy only when a permitted data source is available, e.g. Last.fm listeners/playcount or comparable catalog statistics.

This is **not** the same thing as comfort.

## 4. Comfort vs exploration is user-relative

Do not store `comfort_vs_exploration` as a fixed album field.

Instead compute, at ranking time:

```
familiarity(user, album) =
  artist_known_to_user
  + semantic_similarity_to_high_rated_history
  + same-scene/neighbor proximity
  + weak global-popularity prior
```

```
novelty(user, album) = 1 - familiarity(user, album)
```

Before a user has enough diary history, global popularity and distance from the current query act only as weak priors.

After ~15 ratings, diary data should matter more than global popularity.

The UI control should therefore mean:
- comfort = rank closer to the user's emerging taste centroid
- balanced = mix familiar and novel clusters
- exploration = deliberately increase distance and cluster novelty

## 5. Mood model

The 12 current interface moods remain the human-facing vocabulary.

AcousticBrainz high-level fields include classifiers such as mood_aggressive and related semantic models. We should inspect actual sample dump files before finalizing a deterministic mapping.

Album mood vectors should combine:
1. acoustic classifier probabilities,
2. Last.fm/MusicBrainz tag evidence,
3. source confidence.

Never turn missing evidence into a literal zero probability.

## 6. Energy

Energy is a latent composite, not just BPM.

Proposed first version:

```
energy =
  0.35 * normalized_bpm
  + 0.25 * aggressive_probability
  + 0.20 * danceability
  + 0.20 * energetic_tag_signal
```

Weights are provisional and should be calibrated against a manually labelled evaluation set before release.

If only tags exist, use a lower-confidence fallback rather than pretending the same quality.

## 7. Recommendation scoring before semantic ML

For each user request:

1. Build a query intent once.
2. Score only features that exist on both the request and album.
3. Normalize by the total available weight so albums with more metadata do not automatically win.
4. Add diversity penalties for artist/genre repetition.
5. Take the top ~200.
6. Sample from that candidate set rather than argmax.

Conceptually:

```
score = sum(weight_i * similarity_i * confidence_i)
        / sum(weight_i * confidence_i)

final = relevance
        + exploration_bonus
        - recent_artist_penalty
        - recent_genre_penalty
```

Missing features are excluded from numerator and denominator.

## 8. Source confidence

Suggested initial confidence bands:

- MusicBrainz identity / canonical duration: 0.95–1.00
- AcousticBrainz direct classifier values: 0.80–0.95
- MusicBrainz genre/tag evidence: 0.65–0.85
- Last.fm top-tag mapping: 0.55–0.80
- popularity-derived novelty prior: 0.45–0.70
- heuristic fallback: <= 0.50

These are engineering confidence weights, not scientific probabilities.

## 9. Coverage gates

The app should expose feature coverage honestly.

Suggested launch gates:
- duration: >= 90%
- genre: >= 85%
- at least one mood signal: >= 80%
- energy: >= 75%

Until a gate is reached, the UI says that filter is approximate or unavailable.

## 10. Evaluation

Before semantic embeddings, build a manually judged test set of at least 200 prompts across:
- obvious moods,
- ambiguous prose,
- nostalgia,
- anger,
- romance,
- calm,
- energy requests,
- genre-plus-mood requests,
- multilingual English/Portuguese prompts.

For each prompt, collect top-10 relevance judgments.

Metrics:
- NDCG@10 for ranking quality
- Recall@50 for broad retrieval
- intra-list diversity
- catalog coverage
- repeated-artist rate
- source-coverage rate
- human satisfaction rating

The cheap lexical/tag model is "good enough" only if semantic embedding produces a small and inconsistent lift on these tests.

## 11. Semantic layer: recommended architecture

When P1 features are stable, build album profile strings and embeddings offline.

Start with TF-IDF + TruncatedSVD to 64 dimensions because:
- reproducible,
- fast,
- tiny to ship,
- easy to evaluate,
- no model download in the browser.

Only move to neural embeddings if they materially improve the evaluation set.

For the later query embedding path, prefer a small Cloudflare Worker over a ~20MB in-browser transformer model. The tradeoff is one lightweight network dependency in exchange for much better mobile performance. If the worker fails, degrade to the local lexical/tag interpreter.

## 12. Data-source notes

- Spotify Audio Features, Audio Analysis, Recommendations and Related Artists are not available to new/development-mode apps under Spotify's 2024-11-27 Web API changes. Do not build P1 around them.
- AcousticBrainz stopped collecting new data in 2022, but provides public CC0 dumps of its historical recording-level features.
- MusicBrainz core catalog data is CC0. Its derived/tag dump has different licensing; preserve source provenance.
- Last.fm album top tags and album metadata endpoints require an API key; large-scale or commercial/research usage should be checked against their usage terms.
- Apple's Search API exposes preview URLs for track results, but Apple states previews are promotional content that must be streamed, not downloaded/cached for unrelated analysis. Therefore do **not** use iTunes previews as an offline Essentia training/backfill source without a separate legal review.

## 13. P1 implementation order

1. canonical release selection + duration
2. MusicBrainz genre/tag normalization
3. AcousticBrainz sample-dump join on real data
4. album-level mood/energy aggregation
5. Last.fm weak-label backfill
6. provenance + coverage report
7. normalized ranking
8. evaluation harness
9. only then semantic ML

No code should claim semantic understanding before steps 1–8 are measurable.
