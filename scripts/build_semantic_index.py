#!/usr/bin/env python3
"""Build a compact static semantic retrieval index from catalog shards.

Output:
- model.json: vocabulary, IDF and quantization scales
- components.bin: int8 SVD projection matrix
- album-vectors.bin: 100k x 64 int8 unit vectors
- ids.json: lookup ids aligned with album vector rows
- manifest.json: version/shape metadata

The browser replays the exact tokenizer/TF-IDF transform and scans the compact
album vectors locally. This is lexical latent-semantic retrieval, not a neural
embedding model.
"""
from __future__ import annotations
import argparse, json, math, re, unicodedata
from pathlib import Path

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

TOKEN_RE=re.compile(r"[a-z0-9][a-z0-9_'-]+")
DIMS=64

def clean(text):
    text=unicodedata.normalize("NFD",str(text or "").lower())
    return "".join(c for c in text if unicodedata.category(c)!="Mn")

def tokenize(text):
    return TOKEN_RE.findall(clean(text))

def read_catalog(catalog_dir):
    root=Path(catalog_dir)
    manifest=json.loads((root/"manifest.json").read_text())
    albums=[]
    base_file=manifest.get("base_file")
    if base_file:
        albums.extend(json.loads((root/base_file).read_text())["albums"])
    for shard in manifest["shards"]:
        albums.extend(json.loads((root/shard["file"]).read_text())["albums"])
    if len(albums)!=manifest["total_albums"]:
        raise ValueError(f"Catalog manifest says {manifest['total_albums']:,} albums but semantic builder loaded {len(albums):,}")
    return albums

def names(values):
    out=[]
    for value in values or []:
        if isinstance(value,str): out.append(value)
        elif isinstance(value,dict) and value.get("name"): out.append(value["name"])
    return out

def profile(album):
    genres=names(album.get("genres"))
    tags=names(album.get("tags"))
    moods=names(album.get("moods"))
    year=str(album.get("year") or "")
    decade=""
    if year[:4].isdigit():
        decade=f"{(int(year[:4])//10)*10}s"
    # Repetition gently weights descriptive terms above artist/title identity.
    pieces=[
      str(album.get("artist") or ""),
      str(album.get("title") or ""),
      decade,
      " ".join(genres),
      " ".join(genres),
      " ".join(tags),
      " ".join(tags),
      " ".join(moods),
      " ".join(moods),
    ]
    return " ".join(p for p in pieces if p)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--catalog-dir",default="data/catalog")
    ap.add_argument("--output-dir",default="data/semantic")
    ap.add_argument("--dimensions",type=int,default=DIMS)
    ap.add_argument("--max-features",type=int,default=18000)
    args=ap.parse_args()

    albums=read_catalog(args.catalog_dir)
    profiles=[profile(a) for a in albums]
    ids=[a["lookup_id"] for a in albums]

    vectorizer=TfidfVectorizer(
      tokenizer=tokenize, token_pattern=None, lowercase=False,
      ngram_range=(1,2), sublinear_tf=True, norm="l2",
      min_df=2, max_features=args.max_features, dtype=np.float32
    )
    X=vectorizer.fit_transform(profiles)
    dims=min(args.dimensions,max(2,X.shape[1]-1))
    svd=TruncatedSVD(n_components=dims,n_iter=7,random_state=42)
    Z=svd.fit_transform(X).astype(np.float32)
    Z=normalize(Z,norm="l2").astype(np.float32)

    # Album rows are unit vectors. One global scale is enough for cosine scans.
    album_q=np.clip(np.rint(Z*127),-127,127).astype(np.int8)

    components=svd.components_.astype(np.float32)
    scales=np.maximum(np.max(np.abs(components),axis=1)/127,np.float32(1e-8))
    comp_q=np.clip(np.rint(components/scales[:,None]),-127,127).astype(np.int8)

    vocab_size=len(vectorizer.vocabulary_)
    terms=[""]*vocab_size
    for term,idx in vectorizer.vocabulary_.items(): terms[idx]=term
    idf=vectorizer.idf_.astype(np.float32)

    out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
    (out/"album-vectors.bin").write_bytes(album_q.tobytes(order="C"))
    (out/"components.bin").write_bytes(comp_q.tobytes(order="C"))
    (out/"ids.json").write_text(json.dumps(ids,separators=(",",":")))
    model={
      "version":1,
      "tokenizer":"ascii-accent-stripped-v1",
      "ngram_range":[1,2],
      "sublinear_tf":True,
      "terms":terms,
      "idf":[round(float(x),6) for x in idf],
      "component_scales":[round(float(x),9) for x in scales],
      "explained_variance":round(float(svd.explained_variance_ratio_.sum()),6)
    }
    (out/"model.json").write_text(json.dumps(model,separators=(",",":")))
    manifest={
      "version":1,"method":"tfidf-truncated-svd",
      "albums":len(albums),"dimensions":dims,"vocab_size":vocab_size,
      "vectors":"album-vectors.bin","components":"components.bin",
      "ids":"ids.json","model":"model.json",
      "album_vector_bytes":int(album_q.nbytes),
      "component_bytes":int(comp_q.nbytes)
    }
    (out/"manifest.json").write_text(json.dumps(manifest,separators=(",",":")))
    print(json.dumps({
      "albums":len(albums),"dimensions":dims,"vocab_size":vocab_size,
      "explained_variance":model["explained_variance"],
      "album_vector_mb":round(album_q.nbytes/1_000_000,2),
      "component_mb":round(comp_q.nbytes/1_000_000,2)
    },indent=2))

if __name__=="__main__":
    main()
