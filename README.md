# an-album-a-day
A personalized music discovery engine and interactive listening diary.

## Catalog expansion

The long-term catalog target is 100,000+ albums. The catalog is intentionally broader than any one listener's taste.

### Private Last.fm taste graph

A Last.fm export can be used as a **coverage prior**, never as a hard recommendation boundary.

```bash
python scripts/mesh_lastfm.py \
  --lastfm-csv /path/to/lastfm.csv \
  --output private/taste_graph.json \
  --neighbors 5
```

This resolves each unique Last.fm artist to MusicBrainz and asks ListenBrainz for up to five similar artists. The raw scrobbles, tracks and timestamps stay local and are ignored by git.

Then blend that private graph into the global catalog build:

```bash
python scripts/build_catalog.py \
  --target 100000 \
  --taste-graph private/taste_graph.json \
  --taste-share 0.30 \
  --output data/catalog-expanded.json
```

The remaining catalog comes from independent global genre, country and decade queries, so the listening-history seed expands discovery rather than trapping it inside one taste profile.

MusicBrainz release-group IDs are used for deduplication. Cover Art Archive URLs are stored when available, with the app's generated sleeve fallback for missing artwork.

