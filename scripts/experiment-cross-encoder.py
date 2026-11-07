#!/usr/bin/env python3
"""Offline multilingual cross-encoder challenger; NOT used by the live site.

Default dry-run checks the captured public benchmark and pair construction.
Opt-in --score downloads/runs a large multilingual model; use a local machine
with sufficient RAM/GPU. Never use user notes or private diaries as fixtures.
"""
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path

DEFAULT_MODEL="BAAI/bge-reranker-v2-m3"

def normalize(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()

def format_candidate(row):
    # The cross-encoder sees provenance-grounded public metadata only.
    genres=(", ".join(normalize(x) for x in row.get("genres",[]) if normalize(x)))[:300]
    tags=(", ".join(normalize(x) for x in row.get("tags",[]) if normalize(x)))[:300]
    moods=(", ".join(normalize(x) for x in row.get("moods",[]) if normalize(x)))[:160]
    return ". ".join(x for x in [
        "Album: "+normalize(row.get("title")),
        "Artist: "+normalize(row.get("artist")),
        "Genres: "+genres if genres else "",
        "Tags: "+tags if tags else "",
        "Mood tags (if available): "+moods if moods else "",
    ] if x)+"."

def load_pairs(file):
    payload=json.loads(Path(file).read_text(encoding="utf-8"))
    pairs=[]
    for record in payload.get("results",[]):
        if not record.get("ok"): continue
        results=(record.get("backend") or {}).get("alternatives") or []
        # Never fake absent candidates or substitute a different listening query.
        for alt in results:
            if not alt.get("title") or not alt.get("artist"): continue
            frontend_intent=(record.get("frontend") or {}).get("intent") or {}
            query_intent={
                "genres":list(frontend_intent.get("genres") or record.get("wantGenres") or []),
                "avoidGenres":list(frontend_intent.get("avoidedGenres") or record.get("avoidGenres") or []),
                "moods":{str(mood):1 for mood in (frontend_intent.get("moods") or record.get("wantMoods") or [])},
                "avoidMoods":{str(mood):1 for mood in (frontend_intent.get("avoidedMoods") or record.get("avoidMoods") or [])},
                "goalShift":bool(frontend_intent.get("goalShift",False)),
            }
            pairs.append({
                "query_id":record["id"],
                "prompt":normalize(record["prompt"]),
                "language":normalize(record.get("language")),
                "category":normalize(record.get("category")),
                "query_intent":query_intent,
                "rank":int(alt.get("rank",0)),
                "artist":normalize(alt["artist"]),
                "album":normalize(alt["title"]),
                "album_id":normalize(alt.get("id")),
                "genres":list(alt.get("genres") or []),
                "tags":list(alt.get("tags") or []),
                "moods":list(alt.get("moods") or []),
                "original_score":alt.get("score"),
                "neural_score":alt.get("neural"),
                "passage":format_candidate(alt),
            })
    return pairs

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--observations",default="benchmarks/production-top1-observed.json")
    parser.add_argument("--score",action="store_true",help="run the actual model (downloads weights)")
    parser.add_argument("--model",default=DEFAULT_MODEL)
    parser.add_argument("--batch-size",type=int,default=8)
    parser.add_argument("--output",default=None)
    parser.add_argument("--pairs-output",default=None,help="export actual public candidate pairs for an external ONNX teacher")
    args=parser.parse_args()
    rows=load_pairs(args.observations)
    if not rows: raise SystemExit("No actual top-k backend candidates were captured")
    if args.batch_size<1:parser.error("batch-size must be positive")
    if args.pairs_output:
        Path(args.pairs_output).write_text(json.dumps({"source":args.observations,"mode":"unscored-pairs","results":rows},indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    summary={"model":args.model if args.score else "not run",
             "mode":"scored" if args.score else "dry-run",
             "source":args.observations,
             "queries":len(set(x["query_id"] for x in rows)),
             "pairs":len(rows),
             "note":"Shadow reranking cannot measure relevance or full-catalog recall without judged labels."}
    if args.score:
        try:
            from sentence_transformers import CrossEncoder
        except ImportError as exc:
            raise SystemExit("Install optional dependency: pip install sentence-transformers") from exc
        reranker=CrossEncoder(args.model,max_length=384)
        scores=reranker.predict([(row["prompt"],row["passage"]) for row in rows],
                                batch_size=args.batch_size,show_progress_bar=False)
        for row,score in zip(rows,scores):
            row["teacher_score"]=float(score)
        # Scores are only comparable within each query.
        for query_id in sorted({row["query_id"] for row in rows}):
            group=sorted((x for x in rows if x["query_id"]==query_id),
                         key=lambda x:(-x["teacher_score"],x["rank"]))
            for index,row in enumerate(group,1):
                row["teacher_rank"]=index
        summary["results"]=[{key:value for key,value in row.items() if key!="passage"} for row in rows]
    else:
        summary["sample_pairs"]=[{"query":row["prompt"],"candidate":row["passage"]}
                                for row in rows[:3]]
    encoded=json.dumps(summary,indent=2,ensure_ascii=False)
    if args.output:Path(args.output).write_text(encoded+"\n",encoding="utf-8")
    print(encoded)

if __name__=="__main__":
    main()
