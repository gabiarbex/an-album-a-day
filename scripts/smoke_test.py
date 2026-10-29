#!/usr/bin/env python3
"""Fast repository smoke tests for An Album a Day."""
from __future__ import annotations
import json, re, subprocess, sys, tarfile, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def fail(msg):
    raise AssertionError(msg)

def test_frontend_contract():
    html=(ROOT/"index.html").read_text(encoding="utf-8")
    js=(ROOT/"selector.js").read_text(encoding="utf-8")
    css=(ROOT/"style.css").read_text(encoding="utf-8")

    ids=re.findall(r'id="([^"]+)"',html)
    if len(ids)!=len(set(ids)): fail("Duplicate HTML ids found")

    refs=set(re.findall(r"\$\('([^']+)'\)",js))
    missing=sorted(refs-set(ids))
    if missing: fail(f"JavaScript references missing DOM ids: {missing}")

    if css.count("{")!=css.count("}"): fail("CSS braces are unbalanced")
    if "selector.js?v=" not in html or "style.css?v=" not in html:
        fail("Cache-busted CSS/JS references missing")

    subprocess.run(["node","--check",str(ROOT/"selector.js")],check=True)

def test_base_catalog():
    raw=json.loads((ROOT/"data/albums.json").read_text(encoding="utf-8"))
    albums=raw if isinstance(raw,list) else raw.get("albums",[])
    if len(albums)<9500: fail(f"Editorial base unexpectedly small: {len(albums)}")
    keys={(str(a.get("artist","")).lower(),str(a.get("title","")).lower()) for a in albums}
    if len(keys)<9000: fail("Editorial base contains too many duplicate artist/title pairs")

def test_sharder():
    with tempfile.TemporaryDirectory() as td:
        td=Path(td)
        source=td/"catalog.json"; out=td/"catalog"
        source.write_text(json.dumps({"albums":[
            {"artist":"A","title":"One"},
            {"artist":"B","title":"Two"},
            {"artist":"C","title":"Three"},
        ]}),encoding="utf-8")
        subprocess.run([sys.executable,str(ROOT/"scripts/shard_catalog.py"),
                        "--input",str(source),"--out-dir",str(out),"--shard-size","2"],check=True)
        manifest=json.loads((out/"manifest.json").read_text())
        lookup=json.loads((out/"lookup.json").read_text())
        assert manifest["total_albums"]==3
        assert len(manifest["shards"])==2
        assert len(lookup)==3
        ids=[]
        for shard in manifest["shards"]:
            rows=json.loads((out/shard["file"]).read_text())["albums"]
            ids.extend(a["lookup_id"] for a in rows)
        assert len(ids)==len(set(ids))==3

def test_dump_builder():
    with tempfile.TemporaryDirectory() as td:
        td=Path(td)
        base=td/"base.json"
        base.write_text(json.dumps([{"artist":"Existing Artist","title":"Great Existing Album","moods":[],"energy_level":None,"comfort_vs_exploration":None,"length_min":None,"metadata":{}}]),encoding="utf-8")
        records=[
          {"id":"00000000-0000-0000-0000-000000000000","title":"Great Existing Album","first-release-date":"2004-02-17","primary-type":"Album",
           "artist-credit":[{"name":"Existing Artist"}],"genres":[{"name":"indie rock","count":9}],"tags":[{"name":"reflective","count":4}]},
          {"id":"00000000-0000-0000-0000-000000000001","title":"Dream Record","first-release-date":"1997-01-01","primary-type":"Album",
           "artist-credit":[{"name":"Test Artist"}],"genres":[{"name":"shoegaze","count":8}],"tags":[{"name":"dream pop","count":5}]},
          {"id":"00000000-0000-0000-0000-000000000002","title":"Noise Record","first-release-date":"1982","primary-type":"Album",
           "artist-credit":[{"name":"Other Artist"}],"tags":[{"name":"post-punk","count":6}]},
          {"id":"00000000-0000-0000-0000-000000000003","title":"Not an Album","primary-type":"EP","artist-credit":[{"name":"Skip Me"}]},
        ]
        payload=td/"release-group"
        payload.write_text("\n".join(json.dumps(x) for x in records)+"\n",encoding="utf-8")
        dump=td/"release-group.tar.xz"
        with tarfile.open(dump,"w:xz") as tf: tf.add(payload,arcname="release-group")
        output=td/"expanded.json"
        subprocess.run([sys.executable,str(ROOT/"scripts/build_catalog_from_dump.py"),
                        "--dump",str(dump),"--base-catalog",str(base),"--target","3","--output",str(output)],check=True)
        albums=json.loads(output.read_text())["albums"]
        assert len(albums)==3
        assert albums[0]["title"]=="Great Existing Album"
        assert albums[0].get("_catalog_source")=="original"
        assert albums[0].get("_enriched_from")=="musicbrainz_dump"
        assert albums[0].get("genres")
        assert albums[0].get("metadata",{}).get("musicbrainz_id")
        assert any(a.get("genres") for a in albums[1:])
        assert any(a.get("moods") for a in albums[1:])
        assert all(a["title"]!="Not an Album" for a in albums)

def main():
    tests=[test_frontend_contract,test_base_catalog,test_sharder,test_dump_builder]
    for test in tests:
        test()
        print("PASS",test.__name__)
    print(f"All {len(tests)} smoke tests passed.")

if __name__=="__main__":
    main()
