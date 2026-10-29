#!/usr/bin/env python3
"""Semantic retrieval sanity checks.

This is a regression guard, NOT a human relevance benchmark. It verifies that
obvious genre/scene queries retrieve a meaningful fraction of records whose
catalog metadata contains the expected concepts.
"""
from __future__ import annotations
import argparse, json, math, re, unicodedata
from pathlib import Path
import numpy as np

TOKEN_RE=re.compile(r"[a-z0-9][a-z0-9_'-]+")

CASES=[
  ("shoegaze dream pop", {"shoegaze","dream pop"}),
  ("jazz bebop", {"jazz","bebop"}),
  ("techno electronic dance", {"techno","electronic","house"}),
  ("bossa nova mpb samba brazil", {"bossa nova","mpb","samba","brazil"}),
  ("metal thrash heavy", {"metal","thrash metal","heavy metal"}),
  ("ambient drone", {"ambient","drone"}),
]

def clean(text):
    text=unicodedata.normalize("NFD",str(text or "").lower())
    return "".join(c for c in text if unicodedata.category(c)!="Mn")

def terms_for(text):
    tokens=TOKEN_RE.findall(clean(text))
    return tokens+[tokens[i]+" "+tokens[i+1] for i in range(len(tokens)-1)]

def load_catalog(root):
    manifest=json.loads((root/"manifest.json").read_text())
    by_id={}
    files=[]
    if manifest.get("base_file"): files.append(manifest["base_file"])
    files.extend(s["file"] for s in manifest["shards"])
    for filename in files:
        for album in json.loads((root/filename).read_text())["albums"]:
            by_id[album["lookup_id"]]=album
    return by_id

def query_vector(text,model,components):
    vocab={term:i for i,term in enumerate(model["terms"])}
    counts={}
    for term in terms_for(text):
        if term in vocab: counts[term]=counts.get(term,0)+1
    if not counts: return None
    sparse=[]
    norm=0.0
    for term,count in counts.items():
        idx=vocab[term]
        value=(1+math.log(count))*float(model["idf"][idx])
        sparse.append((idx,value));norm+=value*value
    norm=math.sqrt(norm)
    sparse=[(idx,value/norm) for idx,value in sparse]
    q=np.zeros(components.shape[0],dtype=np.float32)
    for idx,value in sparse: q += value*components[:,idx]
    qnorm=float(np.linalg.norm(q))
    return q/qnorm if qnorm else None

def metadata_text(album):
    vals=[album.get("artist",""),album.get("title",""),album.get("year","")]
    for key in ("genres","tags","moods"):
        for value in album.get(key) or []:
            vals.append(value if isinstance(value,str) else value.get("name",""))
    return clean(" ".join(str(x) for x in vals))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--catalog-dir",default="data/catalog")
    ap.add_argument("--semantic-dir",default="data/semantic")
    ap.add_argument("--top",type=int,default=20)
    ap.add_argument("--minimum-hit-rate",type=float,default=.15)
    args=ap.parse_args()

    catalog=load_catalog(Path(args.catalog_dir))
    root=Path(args.semantic_dir)
    manifest=json.loads((root/"manifest.json").read_text())
    model=json.loads((root/manifest["model"]).read_text())
    ids=json.loads((root/manifest["ids"]).read_text())

    vectors=np.fromfile(root/manifest["vectors"],dtype=np.int8).reshape(manifest["albums"],manifest["dimensions"]).astype(np.float32)/127.0
    qcomponents=np.fromfile(root/manifest["components"],dtype=np.int8).reshape(manifest["dimensions"],manifest["vocab_size"]).astype(np.float32)
    scales=np.asarray(model["component_scales"],dtype=np.float32)
    components=qcomponents*scales[:,None]

    failures=[]
    rows=[]
    for prompt,expected in CASES:
        q=query_vector(prompt,model,components)
        if q is None:
            failures.append(f"{prompt}: query vector empty")
            continue
        scores=vectors@q
        top_idx=np.argpartition(scores,-args.top)[-args.top:]
        top_idx=top_idx[np.argsort(scores[top_idx])[::-1]]
        albums=[catalog.get(ids[i]) for i in top_idx]
        albums=[a for a in albums if a]
        hits=sum(any(term in metadata_text(a) for term in expected) for a in albums)
        rate=hits/max(1,len(albums))
        rows.append((prompt,hits,len(albums),rate,[f"{a.get('artist')} — {a.get('title')}" for a in albums[:3]]))
        if rate<args.minimum_hit_rate:
            failures.append(f"{prompt}: {rate:.0%} expected-term hit rate < {args.minimum_hit_rate:.0%}")

    for prompt,hits,total,rate,examples in rows:
        print(f"{prompt!r}: {hits}/{total} = {rate:.0%}")
        for example in examples: print("  ",example)

    if failures:
        raise SystemExit("Semantic sanity failures:\n- "+"\n- ".join(failures))
    print(f"PASS: {len(rows)} semantic sanity cases")

if __name__=="__main__":
    main()
