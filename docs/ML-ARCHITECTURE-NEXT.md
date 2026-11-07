# Album-a-Day: next ML architecture

**Decision (2026-11-07):** keep the existing MiniLM + SVD/neural-index retriever serving users while benchmarking stronger multilingual models offline. Do not replace a running recommender with an unmeasured model simply because it is larger. A production promotion requires quality and latency evidence.

## What exists now

- Full-catalog semantic recall over 100,000 albums and 64-dimensional quantized search vectors.
- Weighted reciprocal-rank fusion combines neural, lexical, control, and personalized candidate rankings, with minimum source coverage, per-artist caps and the older shortlist as a fallback. Backend responses label this as `hybrid-neural-reranker-v5-rrf` when the frontend has loaded the fusion helper.
- MiniLM-L6-v2, 384-dimensional vector reranking of a limited candidate set, combined with metadata, energy, familiarity and lightweight learned taste.
- Exclusion-aware retrieval text, explicit genre constraint checks, compilation deprioritization, artist-diverse alternatives via MMR, and provenance-based explanations.
- Reproducible 100-prompt English/Portuguese intent checks, plus real browser top-1/top-5 capture (when the backend responds).
- Local diary, explicit completion and rating signals. Unrated listens are **not** assumed disliked, and an unseen album is **not** a negative training sample.

## Phase A: better retrieval, experimentally (first)

**Candidate generation:** compare the current English-biased MiniLM baseline against multilingual-E5 and BGE-M3, with a smaller compatible multilingual model as a latency-focused alternative. Run tests on English, Portuguese, short mood phrases, long ambiguous notes, negation, genre requests, and genre exclusions.

**Retrieval fusion:** evaluate reciprocal rank fusion (RRF) of dense vector recall, lexical/SVD recall and structured genre evidence. No raw sum of incompatible neural and lexical scores.

**Representation:** use an album profile built from verified release/artist/genre/tag metadata and explicit provenance. Prefer reliability-weighted descriptions over made-up mood/energy labels.

**Quality gates:** frozen human-rated queries; compare NDCG@5, constraint violations, source and artist diversity, subgroup regressions, p95 latency, model memory and runtime costs. No cross-user logging of free text by default.

### Executable multilingual shadow test

The cross-encoder challenger is implemented as **offline experiment tooling**, not a deployed model. It tests [BAAI/bge-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3) on captured *actual* top-five candidates.

```bash
# Validate public candidate/prompt pairing; runs without downloading a model
python3 scripts/experiment-cross-encoder.py --observations benchmarks/production-top1-observed.json

# Optional heavy run, on a machine with sufficient RAM / GPU
pip install sentence-transformers
python3 scripts/experiment-cross-encoder.py --score \
  --observations benchmarks/production-top1-observed.json \
  --output cross-encoder-shadow.json
```

The script ranks the same candidate set independently and records both old and teacher ranks. It does **not** train a personalized model, establish higher real-world relevance, evaluate unseen catalog items, or write predictions into production. The model needs substantial memory; budget for an offline environment rather than dropping it into small Vercel functions.

For repeatable live comparisons, `benchmarks/2026-11-07-v4-reference.json` is immutable and `scripts/compare-production-baselines.mjs` compares it with live captures. Metadata proxies do not count as listening judgments.

## Phase B: trained cross-encoder teacher + fast student

Test a multilingual cross-encoder over 50-100 retrieved album profiles, pairing each user query with the full candidate metadata. Cross-encoders inspect query/candidate interactions more deeply than cosine similarity; their computational cost is significant.

The working production option is **distillation**: cross-encoder scores become training targets for a smaller student reranker, with constraints still enforced outside the model. Include hard negatives (e.g., requested bossa nova versus compilations with bossa tags but unclear fit), true mood conflicts, and counterfactual genre controls.

Never train on synthetic tags as if they were independently verified human mood labels. Track a label source and confidence for every training row.

## Phase C: personalization without feedback traps

Separate:
- immediate objective: discover a record relevant to the requested mood;
- later objectives: listen completion, explicit rating and repeat engagement;
- constraints: no repeated albums, explicitly excluded genres, consent to sync or personalization.

Once there is enough consented, informative feedback, evaluate a small contextual bandit against deterministic personalization. Record selection propensities in the experiment, respect a low exploration budget and keep a deterministic fallback. Offline inverse-propensity evaluation without valid propensities must **not** be claimed.

User-level taste vectors should remain opt-in and deletable, and must not be trained into a globally shared model without a separately documented consent policy.

## Phase D: multimodal/graph, only if data supports it

- Build a MusicBrainz artist–album–tag graph, evaluate graph-neighbor discovery for users with rich listening history.
- Add audio-aware embeddings only from appropriately licensed or independently authorized audio material. Do not scrape Apple/Spotify previews for model training.
- Use uncertainty calibration to express what is verified versus inferred. Keep explanations factual; a large language model may rewrite verified evidence but must never invent audio traits or mood labels.

## Evaluation protocol

1. Preserve original baseline `benchmarks/2026-11-07-before-ranking-v4.json`.
2. Capture production outputs using `scripts/capture-production-baseline.mjs`; include the actual backend alternatives when available.
3. Produce metadata checks using `scripts/analyze-production-baseline.mjs`. These are proxy diagnostics, **not** subjective relevance.
4. Rate genuine album outputs using `baseline-results/review-sheet.csv` and `scripts/score_recommendations.py`.
5. Run challenger algorithms in shadow mode on exactly the same input/candidate snapshot. Keep stable hash-based splits by listener so repeated observations do not leak between training and evaluation.
6. Choose a challenger only with better judged relevance and no regression in privacy, explicit exclusions, no-repeat behavior, latency, or client costs.

### Initial release gates (targets, not observed outcomes)

- Zero *known* excluded-genre violations in judged top-1; unknown metadata reported separately.
- NDCG@5 uplift with confidence intervals over a judged dataset, and no major language/subgenre regression.
- At least 95% successful cold-start browser recommendations under the test infrastructure; all failures logged.
- P95 recommendation latency measured on the real production device/network mix before locking a target.
- All history retention, sync and account privacy regressions pass.

## Research starting points

- Google ML recommendation reranking: https://developers.google.com/machine-learning/recommendation/dnn/re-ranking
- OpenSearch maximal marginal relevance: https://docs.opensearch.org/latest/vector-search/specialized-operations/vector-search-mmr/
- Hybrid music recommendations using GNNs (2024): https://link.springer.com/article/10.1007/s11257-024-09410-4
- Task-specific retrieval for discovery vs familiar listening (2026): https://doi.org/10.1145/3779211.3793165
- Delayed-reward contextual bandits (JMLR 2026): https://jmlr.org/papers/v27/25-0030.html

**Production principle:** the smartest model is the one that demonstrably picks better music. Larger, newer or more expensive is not sufficient evidence.
