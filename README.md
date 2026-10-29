# An Album a Day

**100,000 albums. One record a day. A recommendation engine that says what it actually knows.**

[Live site](https://gabiarbex.github.io/an-album-a-day/)

An Album a Day is a static-hosted music-discovery engine, tactile listening diary, and music-tech research project. The interface borrows from photocopied fanzines, record-store filing cards, LP back covers and handwritten listening notes; underneath it is a sharded global catalog, local semantic retrieval, provenance-aware recommendation logic and client-side personalization.

The product keeps three layers deliberately separate:

1. **catalog facts** — artist, album, date, genre, tracklist, runtime, identifiers;
2. **recommendation signals** — mood, energy, semantic similarity and familiarity, each with a source/confidence story;
3. **presentation** — the fanzine / record-room interface.

Missing evidence is treated as **unknown**, never silently converted to zero and never turned into a confident fake explanation.

## Current system

### Catalog

The production catalog contains **100,000 unique artist–album pairs**:

- **10,000** preserved editorial/base records
- **90,000** global expansion records
- **7,585 / 10,000** original records matched and enriched from MusicBrainz
- **97.4%** catalog genre coverage
- **17.9%** static mood-tag coverage
- **96.5%** static tag-derived energy coverage
- **0%** static duration coverage

The final two numbers require context: the energy values are mostly weak tag-derived signals, not full acoustic analysis, and duration is intentionally not fabricated when a canonical track runtime is unavailable. The full P1 feature gate therefore remains **off**.

The original catalog is always loaded into the active recommendation pool. Expansion never replaces it.

### Semantic retrieval

Natural-language requests can search the entire 100k catalog through a compact static semantic index:

- **TF-IDF + TruncatedSVD**
- **64 dimensions**
- **18,000-term vocabulary**
- **100,000 × 64 int8 album vectors**
- album-vector payload: **6.4 MB**
- component payload: **1.152 MB**

Album profiles contain artist, title, era, genres, tags and available mood labels. The browser rebuilds the same query transform and performs a local cosine-like scan over quantized vectors.

This is **latent semantic retrieval**, not a neural embedding model. The distinction is intentional.

The semantic path samples from a high-ranking candidate set rather than always returning the single argmax, keeping discovery varied while still relevant.

### Recommendation modes

The UI labels the engine path that actually produced a record.

- **semantic** — full-catalog TF-IDF/SVD retrieval from the natural-language note
- **live** — bounded live metadata fallback for genre/release intent when semantic retrieval cannot answer
- **stored** — provenance-aware catalog-feature ranking once the full P1 coverage gates are actually met
- **draw** — deterministic discovery when no ranking signal was supplied
- **surprise** — explicit no-input surprise; ignores the note and controls
- **shared** — exact record opened from a shared catalog link

The explanation panel is generated from the same mode. It does not invent a mood match for a random draw.

### Natural-language intent

The local intent layer understands more than literal positive keywords:

- mood cues in English and Portuguese
- genre requests
- genre avoidance
- clause-aware negation
- energy language
- exploration / “left turn” language
- relationship-longing cues
- explicit mood avoidance

For example, **“I miss someone but I don’t want a sad record”** does not treat “sad” as a positive melancholic request.

Semantic retrieval is tried for prose requests when the static semantic index is available; the lexical interpreter remains a transparent fallback and supplies explicit control signals.

### Selected-record facts

After a record is chosen, the app can enrich its display with factual metadata:

- release year
- genre classification
- track count
- full numbered tracklist
- total runtime from the resolved tracklist
- explicit advisory when available
- MusicBrainz release-group identity
- Cover Art Archive artwork
- direct Spotify album relation when MusicBrainz provides one
- generated local sleeve when artwork is unavailable

The record file is a display/facts layer. These facts are not automatically promoted into recommendation evidence.

### AcousticBrainz

For the selected album, the app can resolve a canonical MusicBrainz release, sample recording MBIDs, and request historical AcousticBrainz high-level classifiers where coverage exists.

Available classifier probabilities are aggregated into bounded album-level signals such as melancholic, energetic, intense, warm, dreamy, dark and reflective. Missing classifiers do not erase available ones.

This is intentionally a **bounded selected-record enrichment path**, not a claim that all 100,000 records have AcousticBrainz coverage.

### Diary + personalization

The listening diary lives locally in the browser:

- 1–5 star rating
- favorite track, with selected-album tracklist autocomplete
- free-form notes
- edit / remove
- JSON export + import
- recent-pulls shelf
- consecutive-day streak
- average rating
- top filed genre
- personalization-signal count

Rated records save compact recommendation-signal snapshots. Once enough rated history exists, the recommender adds a small local preference term.

No account is required.

### Local Last.fm prior

A Last.fm CSV export can be imported **entirely client-side**.

The app:

- parses the CSV locally
- builds log-compressed artist familiarity weights
- keeps up to **10,000 artists**
- stores only the derived taste prior in localStorage
- does not upload the raw CSV
- lets the user clear the prior at any time

Last.fm familiarity influences ranking; it never defines catalog eligibility.

The public catalog is global and independent of the owner's listening history.

## Catalog build

The 100k catalog is generated from the current MusicBrainz release-group JSON dump, not by deep-paging the public search API.

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

- preserves all original records
- enriches matching originals in place
- deduplicates normalized artist/title variants
- chooses stronger MusicBrainz release-group candidates
- stores MusicBrainz IDs, first-release year, genre/tag metadata and provenance
- keeps direct Spotify album relations when present
- translates tags into mood/energy only as low-confidence weak supervision
- never stores “comfort vs exploration” as an intrinsic album property

The browser catalog is split into:

- `base.json` — 10k editorial base
- 90 × 1,000-record expansion shards
- `manifest.json`
- `lookup.json` — stable album ID → shard mapping

Shared URLs can therefore reopen an exact album without loading all 100k JSON records.

## Semantic build

```bash
python scripts/build_semantic_index.py \
  --catalog-dir data/catalog \
  --output-dir data/semantic \
  --dimensions 64 \
  --max-features 18000
```

Output:

- `model.json`
- `components.bin`
- `album-vectors.bin`
- `ids.json`
- `manifest.json`

The semantic workflow runs after a successful catalog workflow and is also manually dispatchable.

## Testing and regression protection

Every push runs repository smoke tests covering:

- JavaScript syntax
- intent-core syntax and intent regression cases
- semantic-core syntax
- HTML ↔ JavaScript DOM contract
- duplicate element IDs
- CSS structural balance
- asset load ordering
- Python pipeline syntax
- base-catalog integrity
- sharding + stable lookup IDs
- MusicBrainz dump parsing
- preservation and enrichment of original records
- duplicate release-group handling
- semantic artifact shape/size when the index exists

The semantic build also runs **retrieval sanity checks** for obvious queries such as shoegaze, jazz, techno, bossa/MPB, metal and ambient. These are regression guards, **not a substitute for human relevance evaluation**.

## P1 feature gates

The app only calls the stored catalog “full recommendation metadata” when the loaded catalog reaches all of these thresholds:

- genre ≥ **85%**
- mood ≥ **80%**
- energy ≥ **75%**
- duration ≥ **90%**

Current global build does **not** meet those gates, principally because static mood and duration coverage remain incomplete. Until then, the engine uses semantic retrieval and transparent fallbacks rather than pretending otherwise.

The deeper design is documented in [docs/P1-RECOMMENDER-DESIGN.md](docs/P1-RECOMMENDER-DESIGN.md).

## Remaining research work

The app is functional; these are research-quality upgrades rather than hidden missing UI features:

- full offline MusicBrainz recording graph → AcousticBrainz dump join
- catalog-wide canonical duration aggregation
- judged multilingual query benchmark
- NDCG@10 / Recall@50 / diversity / coverage evaluation
- compare TF-IDF/SVD against a compact neural embedding model
- replace heuristic preference blending with an explicitly evaluated online learner if it improves results

Those upgrades should only ship when they beat the current baseline on measured quality.

## Automation

GitHub Actions provides three main workflows:

- **Smoke tests**
- **Build 100k album catalog**
- **Build semantic album index**

The catalog workflow streams the latest MusicBrainz release-group JSON dump, validates the generated 100k catalog, then commits the sharded data. The semantic workflow is triggered after successful catalog completion and validates its binary index before committing it.

## Privacy

- Diary stays in localStorage.
- Last.fm CSV parsing happens locally.
- The raw Last.fm export is not committed or uploaded by the app.
- Natural-language notes remain local unless a future explicitly documented remote semantic service is introduced.
- Current semantic query execution is in-browser.

## Data / provenance notes

- MusicBrainz is the catalog identity and release backbone.
- Cover Art Archive is used for compatible artwork lookup.
- AcousticBrainz is historical and stopped accepting new submissions in 2022; coverage is therefore measured, not assumed.
- Apple/iTunes metadata is used only as a bounded live metadata/tracklist fallback. Apple promotional artwork/previews are not treated as a generic downloadable analysis source.
- Recommendation provenance is kept distinct from display metadata.

## Product principle

> **Make the website feel handmade; make the recommendation system measurable.**

A listener's history can influence discovery. It never defines the musical universe.
