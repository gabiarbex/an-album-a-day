#!/usr/bin/env python3
"""Build the large An Album a Day catalog from the MusicBrainz release-group JSON dump.

Why this exists:
- preserves data/albums.json as the editorial base;
- avoids deep-paging the public search API;
- keeps MusicBrainz MBIDs, dates, genres/tags and provenance;
- derives only LOW-CONFIDENCE mood/energy hints from tags;
- never stores "comfort" as an album property.

The input is MusicBrainz's release-group.tar.xz JSON dump.
"""
from __future__ import annotations
import argparse, hashlib, heapq, json, math, re, tarfile
from pathlib import Path

EXCLUDED_SECONDARY={"Audiobook","Spokenword","Interview"}
TAG_RULES=[
 (re.compile(r"metal|hard rock",re.I),8.6,{"dark":.9,"intense":.95,"gritty":.85,"energetic":.7}),
 (re.compile(r"punk|hardcore|noise rock",re.I),8.4,{"gritty":.95,"intense":.85,"energetic":.85,"alienated":.55}),
 (re.compile(r"hip.?hop|rap|trap",re.I),7.2,{"gritty":.65,"intense":.6,"energetic":.72,"reflective":.45}),
 (re.compile(r"electronic|dance|house|techno|trance|drum and bass|dnb",re.I),7.8,{"energetic":.9,"dreamy":.48,"cold":.45,"intense":.5}),
 (re.compile(r"ambient|new age|drone",re.I),2.4,{"dreamy":.95,"reflective":.78,"cold":.5,"warm":.32}),
 (re.compile(r"shoegaze|dream pop|ethereal",re.I),4.2,{"dreamy":.96,"melancholic":.62,"reflective":.55,"cold":.35}),
 (re.compile(r"post.?punk|goth|darkwave",re.I),6.0,{"dark":.86,"cold":.67,"alienated":.66,"gritty":.55}),
 (re.compile(r"alternative|indie|rock",re.I),6.2,{"gritty":.55,"intense":.5,"reflective":.48,"energetic":.55,"alienated":.4}),
 (re.compile(r"r&b|rhythm and blues|soul|neo.?soul",re.I),5.2,{"warm":.85,"reflective":.65,"melancholic":.45,"hopeful":.42}),
 (re.compile(r"singer.?songwriter|folk|acoustic",re.I),3.8,{"reflective":.9,"warm":.62,"melancholic":.58,"nostalgic":.52}),
 (re.compile(r"jazz|bebop|fusion",re.I),4.5,{"reflective":.78,"warm":.58,"dreamy":.48,"intense":.28}),
 (re.compile(r"classical|baroque|romantic|orchestral|chamber",re.I),3.8,{"reflective":.86,"dreamy":.62,"cold":.38,"intense":.35}),
 (re.compile(r"country|americana|bluegrass",re.I),4.6,{"warm":.62,"nostalgic":.7,"reflective":.58,"melancholic":.38}),
 (re.compile(r"reggae|ska|dub",re.I),5.8,{"warm":.78,"hopeful":.72,"energetic":.55}),
 (re.compile(r"latin|brazil|samba|bossa|mpb|tropic",re.I),5.7,{"warm":.74,"reflective":.5,"hopeful":.55,"nostalgic":.38}),
 (re.compile(r"afrobeat|highlife|afropop",re.I),7.0,{"energetic":.78,"warm":.7,"hopeful":.62}),
 (re.compile(r"pop|synthpop",re.I),6.4,{"warm":.55,"hopeful":.58,"energetic":.72,"dreamy":.28}),
 (re.compile(r"soundtrack|score",re.I),4.3,{"dreamy":.68,"reflective":.7,"intense":.4}),
 (re.compile(r"sad|melanchol|depress",re.I),3.2,{"melancholic":.95,"reflective":.65}),
 (re.compile(r"psychedelic|psych",re.I),5.0,{"dreamy":.82,"intense":.42,"warm":.35}),
 (re.compile(r"experimental|avant",re.I),5.2,{"alienated":.72,"intense":.5,"reflective":.48}),
]

def norm_key(artist,title):
    return (" ".join(str(artist or "").lower().split())," ".join(str(title or "").lower().split()))

def credit_string(obj):
    parts=[]
    for c in obj.get("artist-credit") or []:
        if isinstance(c,str):
            parts.append(c); continue
        name=c.get("name") or (c.get("artist") or {}).get("name") or ""
        parts.append(name+(c.get("joinphrase") or ""))
    return "".join(parts).strip()

def named_list(obj,key):
    out=[]
    for x in obj.get(key) or []:
        if isinstance(x,str): out.append((x,1))
        elif isinstance(x,dict) and x.get("name"): out.append((x["name"],int(x.get("count") or 1)))
    return out

def derive_signals(names):
    moods={}; energy=[]; evidence=[]
    for name,count in names:
        weight=min(1.0,.35+.13*math.log1p(max(1,count)))
        for rx,e,mm in TAG_RULES:
            if not rx.search(name): continue
            energy.append((e,weight))
            evidence.append(name)
            for mood,val in mm.items():
                moods[mood]=max(moods.get(mood,0),round(val*weight,4))
    e=None
    if energy:
        e=round(sum(v*w for v,w in energy)/sum(w for _,w in energy),2)
    return moods,e,list(dict.fromkeys(evidence))[:8]

def quality_score(obj,tags,genres):
    rating=obj.get("rating") or {}
    rc=int(rating.get("votes-count") or rating.get("count") or 0) if isinstance(rating,dict) else 0
    tag_strength=sum(max(0,c) for _,c in tags[:15])
    genre_strength=sum(max(0,c) for _,c in genres[:10])
    return math.log1p(rc)*.55+math.log1p(tag_strength)*.5+math.log1p(genre_strength)*.6

def convert(obj):
    if str(obj.get("primary-type") or "").lower()!="album": return None
    secondary=set(obj.get("secondary-types") or [])
    if secondary & EXCLUDED_SECONDARY: return None
    artist=credit_string(obj); title=str(obj.get("title") or "").strip(); mbid=obj.get("id")
    if not (artist and title and mbid): return None
    tags=sorted(named_list(obj,"tags"),key=lambda x:x[1],reverse=True)
    genres=sorted(named_list(obj,"genres"),key=lambda x:x[1],reverse=True)
    source_names=genres+tags
    moods,energy,evidence=derive_signals(source_names)
    genre_names=[n for n,_ in genres[:6]] or [n for n,_ in tags[:6]]
    first=str(obj.get("first-release-date") or "")
    confidence=.58 if genres else (.48 if tags else 0.0)
    return {
      "id":"mb:"+mbid,
      "artist":artist,
      "title":title,
      "year":first[:4],
      "genres":genre_names,
      "tags":[n for n,_ in tags[:10]],
      "moods":[m for m,v in sorted(moods.items(),key=lambda kv:kv[1],reverse=True) if v>=.42],
      "energy_level":energy,
      "comfort_vs_exploration":None,
      "length_min":None,
      "features":{"moods":moods,"energy":None if energy is None else round(energy/10,4)},
      "provenance":{
        "genres":{"source":"musicbrainz-release-group-dump","confidence":confidence},
        "moods":{"source":"musicbrainz-tag-translation","confidence":min(confidence,.55) if moods else 0},
        "energy":{"source":"musicbrainz-tag-translation","confidence":min(confidence,.50) if energy is not None else 0}
      },
      "metadata":{
        "musicbrainz_id":mbid,
        "cover_art":"https://coverartarchive.org/release-group/"+mbid+"/front-500",
        "sources":["https://musicbrainz.org/release-group/"+mbid]
      },
      "_catalog_source":"musicbrainz_dump",
      "_tag_evidence":evidence
    }, quality_score(obj,tags,genres)

def iter_objects(dump_path):
    with tarfile.open(dump_path,"r:xz") as tf:
        for member in tf:
            if not member.isfile(): continue
            fh=tf.extractfile(member)
            if fh is None: continue
            for raw in fh:
                raw=raw.strip()
                if not raw or not raw.startswith(b"{"): continue
                try: yield json.loads(raw)
                except json.JSONDecodeError: continue

def load_base(path):
    raw=json.loads(Path(path).read_text(encoding="utf-8"))
    items=raw if isinstance(raw,list) else raw.get("albums",[])
    out=[]
    for i,a in enumerate(items):
        if not isinstance(a,dict) or not a.get("artist") or not a.get("title"): continue
        a=dict(a)
        a.setdefault("id",f"legacy:{i}")
        a["_catalog_source"]="original"
        out.append(a)
    return out

def deterministic_noise(mbid):
    return int(hashlib.sha1(str(mbid).encode()).hexdigest()[:12],16)/(16**12)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--dump",required=True)
    ap.add_argument("--base-catalog",default="data/albums.json")
    ap.add_argument("--target",type=int,default=100000)
    ap.add_argument("--output",default="data/catalog-expanded.json")
    args=ap.parse_args()

    base=load_base(args.base_catalog)
    base_by_key={norm_key(a["artist"],a["title"]):a for a in base}
    seen=set(base_by_key)
    need=max(0,args.target-len(base))
    heap=[]; seq=0; scanned=0; eligible=0; enriched_base=0
    for obj in iter_objects(args.dump):
        scanned+=1
        converted=convert(obj)
        if not converted: continue
        item,quality=converted; nk=norm_key(item["artist"],item["title"])
        if nk in base_by_key:
            original=base_by_key[nk]
            # Enrich the editorial record in place; never replace its identity/order.
            original["year"]=original.get("year") or item.get("year") or ""
            original["genres"]=original.get("genres") or item.get("genres") or []
            original["tags"]=original.get("tags") or item.get("tags") or []
            original["moods"]=original.get("moods") or item.get("moods") or []
            if original.get("energy_level") is None: original["energy_level"]=item.get("energy_level")
            original.setdefault("features",item.get("features") or {})
            original.setdefault("provenance",item.get("provenance") or {})
            meta=dict(item.get("metadata") or {})
            meta.update(original.get("metadata") or {})
            original["metadata"]=meta
            original["_catalog_source"]="original"
            original["_enriched_from"]="musicbrainz_dump"
            enriched_base+=1
            continue
        if nk in seen: continue
        eligible+=1
        # quality matters, but deterministic noise keeps the catalog broad.
        priority=deterministic_noise(item["id"])+min(1.5,quality/8)
        row=(priority,seq,item);seq+=1
        if len(heap)<need: heapq.heappush(heap,row)
        elif row[0]>heap[0][0]: heapq.heapreplace(heap,row)
        if scanned%250000==0: print(f"scanned={scanned:,} eligible={eligible:,} kept={len(heap):,}",flush=True)

    expansion=[row[2] for row in sorted(heap,key=lambda x:x[0],reverse=True)]
    catalog={"albums":(base+expansion)[:args.target],"meta":{
      "target":args.target,"base_count":len(base),"base_enriched":enriched_base,"expansion_count":len(expansion),
      "source":"MusicBrainz release-group JSON dump + preserved and enriched editorial base",
      "feature_policy":"genres/tags are source metadata; moods/energy are low-confidence tag translations"
    }}
    Path(args.output).write_text(json.dumps(catalog,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    print(f"Wrote {len(catalog['albums']):,} albums; enriched {enriched_base:,}/{len(base):,} editorial-base records",flush=True)

if __name__=="__main__": main()
