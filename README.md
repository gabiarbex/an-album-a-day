# An Album a Day

A daily music-discovery ritual, record-room interface, and local listening diary.

**Live:** https://gabiarbex.github.io/an-album-a-day/

The product deliberately separates three things that recommendation demos often blur together:

1. **catalog facts** — artist, album, year, genre, tracklist, runtime;
2. **recommendation signals** — mood, energy, familiarity, semantic relevance, with provenance/confidence;
3. **presentation** — the fanzine / record-store interface.

If a recommendation signal is missing, the UI does not invent one.

## What works now

- One deterministic daily record per browser/date, plus explicit bonus rerolls.
- A true **Surprise me** path that ignores the note and filters.
- Natural-language listening note with a transparent keyword fallback.
- Live candidate ranking using store genre/release metadata when the static P1 feature catalog is incomplete.
- Exact tracklist/runtime lookup for finalists and selected albums.
- Record classification card: year, genre, track count, runtime, AAD filing number.
- Cover Art Archive / MusicBrainz artwork fallback, then generated sleeve.
- Listening diary with 1–5 stars, favorite-track autocomplete, notes, import/export, streaks and stats.
- Local personalization: after 8 rated records with signal snapshots, diary taste begins nudging ranking.
- Exact shared-record deep links.
- Responsive static hosting on GitHub Pages.
- Automated smoke tests on every push.
- A reproducible 100k-catalog GitHub Actions pipeline.

## Catalog architecture

The original ~10k editorial catalog is **never discarded**. It is always loaded into the active recommendation pool.

The global target is 100,000 albums. Expansion is built from the current MusicBrainz release-group JSON dump rather than deep-paging the public search API:

```bash
python scripts/build_catalog_from_dump.py \
  --dump /path/to/release-group.tar.xz \
  --base-catalog data/albums.json \
  --target 100000 \
  --output data/catalog-expanded.json

python scripts/shard_catalog.py \
  --input data/catalog-expanded.json \
  --out-dir data/catalog \
  --shard-size 1000
```

The builder:

- preserves every original album;
- enriches matching base records from MusicBrainz rather than replacing them;
- adds global albums independent of one listener's history;
- stores MusicBrainz IDs, first-release year, genres/tags and provenance;
- translates tags into mood/energy only as **low-confidence weak supervision**;
- never stores comfort/exploration as an intrinsic album property;
- creates stable lookup IDs for shared links;
- writes browser-friendly static shards plus a lookup index.

## Recommendation modes

### 1. Stored-feature ranking

When enough albums have trustworthy P1 features, the picker ranks from those stored features.

Missing features are unknown, not zero.

### 2. Live metadata fallback

Until full P1 coverage is high enough, a small deterministic candidate set is resolved against the iTunes Search API for metadata such as primary genre/release information. Genre is translated into low-confidence mood/energy signals and the final few candidates can be checked for exact runtime.

This is explicitly labelled as a fallback in the UI. It is not presented as an acoustic or semantic ML model.

API usage is deliberately bounded and cached.

### 3. Local diary personalization

Rated diary entries store a compact signal snapshot locally. Once enough rated entries exist, the candidate score receives a small user-specific taste term.

No account or server-side listening profile is required.

## P1 / ML roadmap

The detailed design is in [docs/P1-RECOMMENDER-DESIGN.md](docs/P1-RECOMMENDER-DESIGN.md).

Planned source hierarchy:

- **MusicBrainz** — identity, release structure, genres/tags, dates.
- **AcousticBrainz** — historical recording-level acoustic descriptors and mood classifiers where coverage exists.
- **Last.fm tags** — optional weak supervision / private taste expansion, subject to API terms.
- **Diary ratings** — local labelled preference data.

Planned retrieval evaluation includes NDCG@10, Recall@50, intra-list diversity, catalog coverage, repeated-artist rate, source coverage and human satisfaction.

Semantic retrieval should only replace the lexical/tag baseline if it produces a measurable improvement.

## Private Last.fm expansion

A Last.fm export can be used as a **coverage prior**, never as the catalog boundary:

```bash
python scripts/mesh_lastfm.py \
  --lastfm-csv /path/to/lastfm.csv \
  --output private/taste_graph.json \
  --neighbors 5
```

Raw scrobbles, tracks and timestamps belong under `private/` and are git-ignored.

The public website does not require or expose the owner's raw listening history.

## Testing

```bash
python scripts/smoke_test.py
```

Smoke tests check:

- JavaScript syntax;
- HTML/JS DOM contract;
- duplicate IDs;
- CSS brace balance;
- editorial-base integrity;
- sharding + stable lookup IDs;
- MusicBrainz dump parsing;
- preservation **and enrichment** of matching base albums.

GitHub Actions runs the same suite on pushes and pull requests.

## Data / licensing notes

- MusicBrainz core data and AcousticBrainz data have their own published licensing terms; provenance is kept with derived features.
- AcousticBrainz stopped collecting new submissions in 2022, so coverage is historical and must be measured.
- Apple/iTunes metadata is used as a bounded live metadata fallback. Apple promotional artwork/previews are not treated as a generic downloadable media source.
- Missing artwork degrades to a generated local sleeve.

## Product principle

**Make the website feel handmade; make the recommendation system measurable.**

The listener's history can influence discovery. It never defines the entire musical universe.
