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
    if html.find("intent-core.js")<0 or html.find("semantic-core.js")<0:
        fail("Intent/semantic browser cores are missing from index.html")
    if not (html.find("intent-core.js") < html.find("selector.js") and html.find("semantic-core.js") < html.find("selector.js")):
        fail("Core recommendation scripts must load before selector.js")

    subprocess.run(["node","--check",str(ROOT/"intent-core.js")],check=True)
    subprocess.run(["node","--check",str(ROOT/"semantic-core.js")],check=True)
    subprocess.run(["node","--check",str(ROOT/"selector.js")],check=True)
    subprocess.run([sys.executable,"-m","py_compile",
                    str(ROOT/"scripts/build_catalog_from_dump.py"),
                    str(ROOT/"scripts/shard_catalog.py"),
                    str(ROOT/"scripts/build_semantic_index.py"),
                    str(ROOT/"scripts/check_semantic_quality.py")],check=True)
    subprocess.run(["node",str(ROOT/"scripts/intent_test.js")],check=True)

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
            {"artist":"A","title":"One","_catalog_source":"original","genres":["indie"]},
            {"artist":"B","title":"Two","_catalog_source":"musicbrainz_dump"},
            {"artist":"C","title":"Three","_catalog_source":"musicbrainz_dump"},
        ]}),encoding="utf-8")
        subprocess.run([sys.executable,str(ROOT/"scripts/shard_catalog.py"),
                        "--input",str(source),"--out-dir",str(out),"--shard-size","2"],check=True)
        manifest=json.loads((out/"manifest.json").read_text())
        lookup=json.loads((out/"lookup.json").read_text())
        assert manifest["total_albums"]==3
        assert manifest["base_count"]==1
        assert manifest["expansion_count"]==2
        assert len(manifest["shards"])==1
        assert len(lookup)==3
        base_rows=json.loads((out/manifest["base_file"]).read_text())["albums"]
        assert len(base_rows)==1 and base_rows[0]["title"]=="One"
        ids=[a["lookup_id"] for a in base_rows]
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
          {"id":"00000000-0000-0000-0000-000000000004","title":"Dream Record","first-release-date":"1998","primary-type":"Album",
           "artist-credit":[{"name":"Test Artist"}],"tags":[{"name":"rock","count":1}]},
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
        keys={(a["artist"].lower(),a["title"].lower()) for a in albums}
        assert len(keys)==len(albums), "global builder must dedupe artist/title release-group variants"
        assert all(a["title"]!="Not an Album" for a in albums)

def test_semantic_artifacts_if_present():
    root=ROOT/"data/semantic"
    manifest_path=root/"manifest.json"
    if not manifest_path.exists():
        return
    m=json.loads(manifest_path.read_text())
    assert m["albums"]==100000
    assert 32 <= m["dimensions"] <= 64
    assert m["vocab_size"] >= 1000
    assert (root/m["vectors"]).stat().st_size == m["albums"]*m["dimensions"]
    assert (root/m["components"]).stat().st_size == m["vocab_size"]*m["dimensions"]

def main():
    tests=[test_frontend_contract,test_base_catalog,test_sharder,test_dump_builder,test_semantic_artifacts_if_present]
    for test in tests:
        test()
        print("PASS",test.__name__)
    print(f"All {len(tests)} smoke tests passed.")

if __name__=="__main__":
    main()
