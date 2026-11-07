# Teacher–student recommendation lab

**Current stage: experimental only. Production V5 is unchanged.** The student output explicitly contains `eligible_for_production: false` and cannot be activated by a site visitor.

## Why this approach

Album-a-Day ranks a pool of real candidate albums using neural similarity, verified genre evidence, cautious mood/energy hints, no-repeat history and taste feedback. A cross-encoder (teacher) reads a *query and whole album metadata profile together*. It can provide richer *text retrieval* supervision, but it cannot hear the music and is **not a human oracle for musical atmosphere**.

The lightweight student learns feature-weighted candidate ordering from teacher scores. The source of those scores is always recorded. Explicit genre exclusions remain a hard independent gate, not a penalty the student may learn to override.

## Components

- `scripts/experiment-cross-encoder.py`: Extract actual captured prompt–candidate metadata pairs, or optionally run BAAI/bge-reranker-v2-m3 using Python sentence-transformers. It never fabricates candidates.
- `scripts/score-teacher-onnx.mjs`: Quantized ONNX cross-encoder teacher pilot (`SugoLabs/mmarco-mMiniLMv2-L12-H384-v1`, Apache-2.0, 15-language model card); remote weights downloaded to the **offline CI runner**, not to visitors.
- `api/_student-ranker.js`: Shared deterministic student feature schema, scoring and hard-safe ordering.
- `scripts/train-student.mjs`: Query-disjoint, language-aware train/validation split; teacher pairwise soft-target distillation, regularization, early stopping and reproducible artifact export.
- `scripts/evaluate-student-human.mjs`: Paired baseline/student/teacher human-rated NDCG comparison with deterministic bootstrap confidence intervals and language/category reporting. The exporter never asserts success without human ratings.
- `tests/student-ranker.test.mjs`, `tests/student-human-eval.test.mjs`: Synthetic regression fixtures only.
- GitHub Actions: `student-pilot.yml` runs an isolated 14-query trial; `student-stress-pilot.yml` captures another 48 *synthetic prompts* against the actual public recommender, scores its real candidate albums and trains a student. Artifacts are not committed as deployed weights.

## First pilot (November 7, 2026)

Quantized multilingual teacher scored **70 actual candidates, 14 prompts**, with 9 top-one disagreements against V5.

Student trained on 11 groups; 3 held-out groups:

| Measure | Held-out result |
| --- | ---: |
| Student top-one agreement with teacher | 33.3% |
| V5 top-one agreement with teacher | 33.3% |
| Student pairwise teacher agreement | 46.7% |

**Outcome:** Pilot pipeline operational, *student rejected*. This is agreement with teacher rankings, **not musical relevance**. Three held-out prompts provide essentially no confidence about accuracy; no human grades yet.

## Reproduce locally (no model download for checks)

```bash
python3 scripts/experiment-cross-encoder.py --observations benchmarks/production-top1-observed.json --pairs-output /tmp/pairs.json
node scripts/score-teacher-onnx.mjs --pairs /tmp/pairs.json
node tests/student-ranker.test.mjs
node tests/student-human-eval.test.mjs
```

To execute the quantized CPU teacher, install a tested pinned version of `@huggingface/transformers`, then:

```bash
node scripts/score-teacher-onnx.mjs --pairs /tmp/pairs.json --score --output /tmp/teacher.json
node scripts/train-student.mjs --teacher /tmp/teacher.json --output /tmp/student.json --allow-small-experiment
```

The `--allow-small-experiment` flag is strictly for pilot demonstration. Default training **requires at least 40 distinct teacher-scored queries** with two or more *safe* candidates each.

## Human quality gate (mandatory before enabling a model)

1. Use `benchmarks/review.html` to rate real album outputs, not synthetic guesses. Export the private browser-local ratings CSV.
2. Evaluate the same fixed candidate sets using V5's rank, teacher score, and student score. Pass the genuine judgments CSV to:

```bash
node scripts/evaluate-student-human.mjs \
  --teacher /tmp/teacher.json \
  --model /tmp/student.json \
  --judgments /path/to/listening-lab-judgments.csv
```

3. The evaluator refuses to claim quality with incomplete labels: a query must have all candidates graded. Report by language and category and include paired bootstrap uncertainty.
4. Require a large enough, sufficiently diverse held-out human set (target at least 40 fully judged queries, preferably considerably more), a positive uncertainty-adjusted uplift, no exclusion/repetition regressions, acceptable production latency and privacy review.
5. **The scripted human evaluator always marks `eligible_for_production: false`.** Deployment or entitlement changes require a separate reviewed decision. Never promote on teacher agreement alone.

## Current limitations

- Top-five logging truncates the full 96-candidate pool. The student cannot learn to retrieve albums never shortlisted.
- Human-reviewed listening mood is scarce. A search cross-encoder can be fooled by genre, title or textual atmosphere.
- The current student is a small interpretable linear pairwise ranker, not a full neural audio model. This is intentional for testing the teacher signals before introducing larger model complexity.
- Some genre and mood tags are inferred from metadata, not measured from audio. Missing evidence is **unknown**, not evidence of mismatch or quality.
- Test prompts are synthetic and should be supplemented with naturally written, consented requests before production decisions.
- The multi-lingual teacher model is a pilot of a smaller quantized cross-encoder; a later BGE reranker v2 M3 comparison remains possible offline.

**Sources:** [BGE multilingual reranker](https://huggingface.co/BAAI/bge-reranker-v2-m3); [quantized multilingual MiniLM ONNX](https://huggingface.co/SugoLabs/mmarco-mMiniLMv2-L12-H384-v1).
