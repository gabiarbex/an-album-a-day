# Global listening: countries are not languages

Album-a-Day now interprets short music requests in English, Portuguese,
Dutch, Spanish, German, French, Ukrainian and Russian (common phrases). The first production iteration targets
country-specific discovery without pretending that an artist's home country
determines the language they sing.

## Distinct metadata

| Field | Means | Source | Rules |
| --- | --- | --- | --- |
| `queryLanguage` | Language used in a listener's prompt | Lightweight multilingual phrase parser | Only advisory, not a personal preference |
| `originCountries` | Country associated with an artist | Explicit country request + reviewed artist roster | Constrains origin discovery, not genre |
| `avoidOriginCountries` | Explicit country avoidance | Listener's negative words | Never reward a known excluded origin |
| `vocalLanguages` | Requested *lyric/sung* language | Explicit wording, e.g. "sung in Dutch" | Only a confirmed album-level tag can verify |
| Album `originCountry` | Curated artist-area match | `artist-roster.json` → actual catalog albums | Not birth, release country or lyrics |
| Album `vocalLanguages` | Verified sung language | Not populated by the first origin index | Unknown remains unknown |

MusicBrainz release-language fields describe the language of release and
track titles, **not** necessarily the language of the lyrics:
https://musicbrainz.org/doc/Style/Release

For the artist area concept, see:
https://musicbrainz.org/doc/Artist

## Live data and coverage

`scripts/build_geography_index.py` uses only real artist–album records
from `data/catalog/base.json` and the 90 global shards. Generated
`data/geography/{country}.json` files preserve the original lookup IDs,
MusicBrainz metadata and catalog-file provenance; no albums are invented.

The build's manifest reports original matched totals, distinct artists and
the smaller indexed discovery subset for each country. The current
verified build matched 221 Brazil-associated records and 165 Netherlands-associated
records from the 100k catalog; 200 and 143 are indexed for direct discovery.
Other indexes cover Portugal, Belgium, Germany, France, Spain,
Japan, Argentina, Nigeria and Ukraine. The 11 indexed countries collectively
expose 582 actual catalog records, not 100,000 verified country assignments.
Ukraine currently has only three indexed albums; the catalog and attribution
pipeline need more coverage before international recommendations can be called comprehensive.

## Search pipeline

1. Parse the request, its negation scope and cultural scope with `album-locale.js`.
2. Translate common mood/genre words to canonical positive search terms.
3. Query a curated origin index when a country is requested, and recall
   its existing catalog records.
4. Combine regional, neural, lexical, mood, taste and exploration recall,
   preserving provenance, no-repeat and user exclusions.
5. Neural reranking prioritizes verified artist-area matches when a country
   was explicitly requested.
6. If sung-language evidence is unknown, explain the limitation rather than
   claiming a match.

The free-text parser is useful for common phrases; it is not a fully fledged
multilingual linguistic model, and no lyrical-language or audio-language
model has been trained. When a requested vocal language cannot be verified,
the recommender returns a no-match result rather than treating artist origin
as evidence of the language sung.

## Validation

```bash
node tests/intent-100.test.cjs
node tests/global-requests.test.cjs
node tests/geo-catalog.test.cjs
node tests/geography-ranking.test.mjs
python3 scripts/build_geography_index.py \
  --catalog-dir data/catalog --roster data/geography/artist-roster.json \
  --out-dir /tmp/albumaday-geo-audit
```

The browser capture adds live Portuguese, Dutch, Spanish, German and French
queries and records the requested country alongside the selected album's
actual source fields. `scripts/verify-global-baseline.mjs` reports observed
origin matches and how many vocal-language requests remain unverified.

## Next catalog expansion

The country indexes prove *discovery functionality*, not global
representativeness. Priorities for a future MusicBrainz release-group dump
rebuild are:

1. Reserve minimum catalog slots per country or musical scene without
   replacing the preserved editorial records.
2. Source additional country artists and discographies with stable MusicBrainz
   IDs and transparent area provenance; avoid trying to infer country from
   the location where a release was sold.
3. Incorporate album/recording-level lyric languages only from authoritative,
   track-specific sources with explicit licensing and confidence.
4. Extend genuine user-judged multilingual recommendations (especially
   Portuguese and Dutch) before treating accuracy as proven.
5. Track long-tail regional coverage, exclusions, artist variety and search
   quality separately from model's native-language detection.

**Production principle:** global music discovery must not quietly become
Anglo-American recommendations dressed in translated prompts.

## Release hardening checks (November 2026)

Run `node --test tests/*.test.js` for strict constraints, multilingual language and geography requests, diary conflict merging, asset references and UI control smoke tests.
The CI workflow also runs the existing intent, ranking and 22-gate stress matrix.
Production browser checks additionally verify loaded cover art, responsive overflow,
SVG star ratings, account dialog and no-repeat history. Logged-in cross-device
behavior still requires testing with two authenticated browsers.
