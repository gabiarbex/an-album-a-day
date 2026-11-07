#!/usr/bin/env python3
"""Score *human-judged* recommender outputs. No fabricated ground truth.

Input CSV required columns:
  query_id,rank,artist,album,relevance,exclusion_violation
Optional columns: already_seen, runtime_violation
Relevance rubric: 0=wrong, 1=weak, 2=reasonable, 3=excellent.
Exclusion fields: 1=yes, 0=no; blank=unknown, not a pass.

Every query must have at least one assessed result. Missing/unevaluated prompts
are reported separately and never counted as successful.
"""
import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

def truth(value):
    raw = str(value or "").strip().lower()
    if raw in ("1","true","yes","y"): return True
    if raw in ("0","false","no","n"): return False
    return None

def report(fixture, rows, k):
    known={c["id"]:c for c in fixture["cases"]}
    grouped=defaultdict(list)
    for row in rows:
        query=row["query_id"].strip()
        if query not in known: raise ValueError(f"Unknown query_id: {query}")
        rank=int(row["rank"])
        if rank<1: raise ValueError(f"Invalid rank for {query}")
        grade=str(row["relevance"]).strip()
        if grade and (not grade.isdigit() or int(grade)>3):
            raise ValueError(f"Invalid relevance {grade!r} for {query}")
        grouped[query].append({**row,"rank":rank,"grade":int(grade) if grade else None})
    evaluated=[]
    missing=[]
    for qid,case in known.items():
        entries=sorted(grouped.get(qid,[]),key=lambda row:row["rank"])
        if not entries or not any(row["grade"] is not None for row in entries):
            missing.append(qid)
            continue
        ranks=[row["rank"] for row in entries]
        if len(set(ranks))!=len(ranks): raise ValueError(f"Duplicate rank for {qid}")
        top=[row for row in entries if row["rank"]<=k]
        # Unknown grades are not silently treated as failed or successful.
        judged=[row for row in top if row["grade"] is not None]
        gains=[2**row["grade"]-1 for row in judged]
        dcg=sum((2**row["grade"]-1)/math.log2(row["rank"]+1) for row in judged)
        ideal=sorted((row["grade"] for row in entries if row["grade"] is not None),reverse=True)[:k]
        idcg=sum((2**v-1)/math.log2(i+2) for i,v in enumerate(ideal))
        flags=[truth(row.get("exclusion_violation")) for row in judged]
        seen=[truth(row.get("already_seen")) for row in judged]
        artist_ids=[str(row["artist"]).strip().casefold() for row in top if str(row["artist"]).strip()]
        evaluated.append({
            "id":qid,"category":case["category"],"judged":len(judged),
            "ndcg_at_k":round(dcg/idcg,4) if idcg else None,
            "mean_relevance":sum(row["grade"] for row in judged)/len(judged) if judged else None,
            "exclusion_violations":sum(v is True for v in flags),
            "known_exclusions":sum(v is not None for v in flags),
            "seen_violations":sum(v is True for v in seen),
            "known_seen":sum(v is not None for v in seen),
            "unique_artist_ratio":len(set(artist_ids))/len(artist_ids) if artist_ids else None
        })
    def avg(vals):
        vals=[v for v in vals if v is not None]
        return round(sum(vals)/len(vals),4) if vals else None
    graded=[r for r in evaluated if r["ndcg_at_k"] is not None]
    groups={}
    for category in sorted({c["category"] for c in known.values()}):
        subset=[r for r in evaluated if r["category"]==category]
        groups[category]={"evaluated_queries":len(subset),
                          "mean_ndcg_at_k":avg(r["ndcg_at_k"] for r in subset),
                          "mean_relevance":avg(r["mean_relevance"] for r in subset)}
    return {
      "note":"Human-judged outputs only; unknown flags excluded from denominators.",
      "k":k,"total_queries":len(known),"evaluated_queries":len(evaluated),
      "missing_queries":missing,
      "mean_ndcg_at_k":avg(r["ndcg_at_k"] for r in evaluated),
      "mean_relevance":avg(r["mean_relevance"] for r in evaluated),
      "exclusion_violation_rate":(
        round(sum(r["exclusion_violations"] for r in evaluated)/sum(r["known_exclusions"] for r in evaluated),4)
        if sum(r["known_exclusions"] for r in evaluated) else None),
      "already_seen_rate":(
        round(sum(r["seen_violations"] for r in evaluated)/sum(r["known_seen"] for r in evaluated),4)
        if sum(r["known_seen"] for r in evaluated) else None),
      "artist_diversity_at_k":avg(r["unique_artist_ratio"] for r in evaluated),
      "by_category":groups
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--judgments",required=True,help="CSV of genuine reviewer assessments")
    p.add_argument("--fixture",default="benchmarks/intent-100.json")
    p.add_argument("--k",type=int,default=5)
    p.add_argument("--output",default=None)
    a=p.parse_args()
    if a.k<1: p.error("--k must be positive")
    fixture=json.loads(Path(a.fixture).read_text(encoding="utf-8"))
    with open(a.judgments,newline="",encoding="utf-8") as f:
        reader=csv.DictReader(f)
        required={"query_id","rank","artist","album","relevance","exclusion_violation"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            p.error(f"Missing columns: {sorted(required-set(reader.fieldnames or []))}")
        result=report(fixture,list(reader),a.k)
    rendered=json.dumps(result,indent=2,ensure_ascii=False)
    print(rendered)
    if a.output:Path(a.output).write_text(rendered+"\n",encoding="utf-8")

if __name__=="__main__":
    main()
