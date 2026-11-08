#!/usr/bin/env python3
"""Index real catalog albums for verified-list artist-area discovery.

This is not a classifier for sung language, and does not infer a release
country from an artist's area. Country indexes only contain existing albums.
"""
import argparse
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

def normalized(value):
    value=unicodedata.normalize("NFKD",str(value or "").casefold())
    return re.sub(r"\s+"," ", "".join(ch for ch in value if not unicodedata.combining(ch))).strip()

def compilation(value):
    artist=normalized(value.get("artist"))
    title=normalized(value.get("title"))
    if artist in {"various artists", "various", "v/a", "v.a."}:
        return True
    return bool(re.search(r"\b(greatest hits|best of|anthology|compilation|box set|original albums)\b",title))

def compact(album,file,chunk,country):
    fields=("id","lookup_id","artist","title","year","genres","tags","moods",
            "features","provenance","metadata","length_min","energy_level")
    out={name:album[name] for name in fields if name in album}
    out["_catalogFile"]=file
    out["_catalogChunk"]=chunk
    out["_originCountry"]=country
    out["_originSource"]="curated-artist-area-v1"
    return out

def quality(record):
    has_genres=len(record.get("genres") or [])
    has_tags=len(record.get("tags") or [])
    year=str(record.get("year") or "")[:4]
    return (4 if not compilation(record) else -10)+min(5,has_genres)+min(6,has_tags)*.5+(1 if year.isdigit() else 0)

def build(catalog_dir,roster_path,out_dir,per_artist=6,per_country=250):
    roster=json.loads(Path(roster_path).read_text(encoding="utf-8"))
    countries=roster["countries"]
    cross={}
    for code,names in countries.items():
        for name in names:
            name=normalized(name)
            if name in cross and cross[name]!=code:
                raise ValueError(f"Conflicting artist-area assignments: {name}")
            cross[name]=code
    catalog_dir=Path(catalog_dir);out_dir=Path(out_dir)
    files=[catalog_dir/"base.json",*sorted(catalog_dir.glob("shard-*.json"))]
    groups=defaultdict(lambda:defaultdict(list))
    totals=defaultdict(int)
    for file in files:
        if not file.exists():
            raise FileNotFoundError(f"Missing catalog file: {file}")
        payload=json.loads(file.read_text(encoding="utf-8"))
        for idx,album in enumerate(payload.get("albums",[])):
            if not isinstance(album,dict) or not album.get("lookup_id"):
                continue
            artist=normalized(album.get("artist"))
            country=cross.get(artist)
            if not country:continue
            totals[country]+=1
            groups[country][artist].append(compact(album,file.name,idx//1000,country))
    manifest={"version":1,"source":"curated-artist-area-v1",
              "does_not_infer_vocal_language":True,"country_counts":{}}
    out_dir.mkdir(parents=True,exist_ok=True)
    for code,names in countries.items():
        artists=groups[code]
        selection=[]
        for name,records in artists.items():
            ranked=sorted(records,key=lambda a:(-quality(a),str(a.get("year") or ""),
                str(a.get("lookup_id"))))
            selection.extend(ranked[:per_artist])
        # Round-robin by artist to keep broad representation.
        by_artist=defaultdict(list)
        for row in selection:by_artist[normalized(row["artist"])].append(row)
        ordered=[]
        while len(ordered)<per_country:
            progressed=False
            for artist in sorted(by_artist):
                if by_artist[artist]:
                    ordered.append(by_artist[artist].pop(0));progressed=True
                    if len(ordered)>=per_country:break
            if not progressed:break
        payload={
            "version":1,"country":code,"kind":"artist_area",
            "source":"curated-artist-area-v1",
            "matched_artists":len(artists),
            "matched_albums":totals[code],
            "entries":ordered
        }
        (out_dir/f"{code}.json").write_text(
            json.dumps(payload,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8"
        )
        manifest["country_counts"][code]={
            "roster_artists":len(names),"matched_artists":len(artists),
            "catalog_albums":totals[code],"indexed_albums":len(ordered)
        }
    (out_dir/"manifest.json").write_text(
        json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"
    )
    return manifest

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--catalog-dir",default="data/catalog")
    ap.add_argument("--roster",default="data/geography/artist-roster.json")
    ap.add_argument("--out-dir",default="data/geography")
    args=ap.parse_args()
    result=build(args.catalog_dir,args.roster,args.out_dir)
    print(json.dumps(result["country_counts"],indent=2))
    if result["country_counts"]["BR"]["indexed_albums"]==0 or result["country_counts"]["NL"]["indexed_albums"]==0:
        raise SystemExit("Cannot ship geography discovery without real Brazilian and Dutch catalog entries")

if __name__=="__main__":
    main()
