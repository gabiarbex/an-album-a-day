# Recommendation quality benchmark

**Status:** automated intent and ranking-contract tests are implemented. Human-judged album relevance is **not yet measured**. Do not present the automated pass rate as recommendation accuracy.

## What is covered

`benchmarks/intent-100.json` contains 100 distinct English/Portuguese prompts in six categories: genre, genre exclusion, mood, mood exclusion, Portuguese, and mixed intent. Tests assert expected positive and negative intent fields and that explicitly excluded words do not leak into the lexical/neural retrieval text.

Run:

```bash
node tests/retrieval-intent.test.cjs
node tests/intent-100.test.cjs
node tests/ranking-contract.test.mjs
```

The last test uses controlled artificial candidates to check the real `api/_ranking-core.js` scoring function; it is **not** a substitute for evaluating actual music choices.

## Human album judgment (next quality gate)

1. Run each of the 100 benchmark prompts through the **deployed** app on a fresh test account/browser, with an empty seen history and consistent energy/comfort defaults. Capture the top ranked recommendations, including artist and album, the deployed commit SHA and the engine/mode that responded. Do not share a personal user diary.
2. Use at least 5 ranked candidates per prompt. Note that the standard UI may reveal only one picked album; a proper top-5 experiment therefore needs a development/export harness for candidate diagnostics. **Do not fabricate unseen ranks.**
3. Have a reviewer rate each album: **0** irrelevant, **1** weak, **2** reasonable, **3** very good. Mark exclusion violations and already-seen violations as 1, 0, or leave blank if not verifiable.
4. Store one row per judged result in a CSV with these headers:

```csv
query_id,rank,artist,album,relevance,exclusion_violation,already_seen
```

5. Score actual judgments with:

```bash
python3 scripts/score_recommendations.py --judgments path/to/real_judgments.csv --k 5 --output /tmp/recommender-report.json
```

This reports mean judged relevance, NDCG@5 (with relevance grades among the judged candidates; **not full-catalog recall**), exclusion-violation rate, repeat rate, and unique-artist diversity. Null values mean unknown; missing prompts remain explicitly unjudged. Scores based on only selected albums must be labeled top-1, not NDCG@5.

## Limits and release gates

- The 100 test prompts are **intent parsing expectations**, not a gold standard mapping from feelings to albums.
- Dataset has synthetic patterns and should be supplemented with natural diary-style prose, multilingual spelling, contradiction, metaphor, and hard queries. Blind review by more than one listener reduces single-reviewer taste bias.
- A future evaluation should record top-50 candidate recall, benchmark diversity by genre/era/geography, confidence/calibration, response latency and fallback frequency.
- Before claiming quality gains: capture a baseline report, evaluate the same fixed prompts on a candidate version, inspect differences by category, and ship only if major regressions are absent. Exclusion violations and history loss are higher-priority blockers than small NDCG improvements.
- No percentages or NDCG figures should be advertised until judged data exists.

## Known limitation of retrieval sanitization

Excluded phrases are removed before semantic search; the raw user note is still passed to the **intent interpreter**, so positive preferences and exclusions remain available to the reranker. This heuristic can trim meaningful context in complicated prose. The benchmark tests common patterns, but more natural-language negative examples must be evaluated before declaring it robust.
