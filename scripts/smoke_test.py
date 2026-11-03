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

    button_ids=re.findall(r'<button[^>]*id="([^"]+)"',html)
    required_buttons={
        "historyToggle","log","sharePick","reroll","surpriseMe","resetPicker",
        "clearFeeling","recommend","openDiaryFromShelf","closeDrawer","export",
        "importDiary","importLastfm","clearLastfm","closeDialog"
    }
    missing_buttons=sorted(required_buttons-set(button_ids))
    if missing_buttons:
        fail(f"Required release buttons missing from HTML: {missing_buttons}")
    for button_id in required_buttons:
        match=re.search(rf'<button[^>]*id="{re.escape(button_id)}"[^>]*>',html)
        if not match or 'type="button"' not in match.group(0):
            fail(f"Non-submit release button must declare type=button: {button_id}")
    unwired=sorted(b for b in required_buttons if f"$('{b}')" not in js)
    if unwired:
        fail(f"Visible release buttons missing JS wiring: {unwired}")

    if css.count("{")!=css.count("}"): fail("CSS braces are unbalanced")

    # Critical desktop components must exist before responsive overrides.
    desktop_css=css.split("@media",1)[0]
    critical_selectors=(
        ".record-stage{",".sleeve{",".album-details{",
        ".tracklist-panel{",".tracklist-head{",".tracklist{",".tracklist li{",
        ".actions{",".primary,.secondary{",".why-panel{",".record-file{",
        ".picker{",".fine-tune{",".recent-pulls{",".drawer{","dialog{"
    )
    missing_css=[sel for sel in critical_selectors if sel not in desktop_css]
    if missing_css:
        fail(f"Critical desktop CSS selectors missing: {missing_css}")
    if 'list-style:none' not in desktop_css or '.tracklist li::marker{content:""}' not in desktop_css:
        fail("Tracklist must suppress native ordered-list markers")
    for name in ("resetPicker","savePickerState","criteriaSignature","showToast"):
        if f"function {name}(" not in js:
            fail(f"Required frontend helper missing: {name}")
    if "resetButton.onclick" not in js:
        fail("Clear-all button must have an explicit reset handler")
    if "localStorage.removeItem('albumaday.dailyPick')" not in js:
        fail("Reset/input changes must be able to invalidate the saved daily pick")
    if "state[id]===value?null:value" not in js:
        fail("Single-select filter chips must toggle off when clicked twice")
    if "['any length',null]" in js or '["any length",null]' in js:
        fail("A null-valued time chip conflicts with the cleared picker state")
    if "restorePickerState();" in js:
        fail("Fresh visits must not restore the previous picker request")
    load_start=js.find("async function load()")
    load_end=js.find("function score(",load_start)
    load_block=js[load_start:load_end] if load_start>=0 and load_end>load_start else ""
    if "restoreDailyPick()" in load_block:
        fail("Fresh visits must not auto-render the previous album")
    if "localStorage.removeItem(PICKER_STORAGE_KEY)" not in js or "localStorage.removeItem('albumaday.dailyPick')" not in js:
        fail("Fresh visits must clear persisted picker/daily-pick state")
    if "await restoreSharedPick();" not in load_block:
        fail("Explicit shared-record links must still restore their requested album")
    if "let recommendationRequest=0" not in js or "if(request!==recommendationRequest)return;" not in js:
        fail("Async recommendation results must be discarded after picker changes")
    if "albumaday.record.v4." not in js:
        fail("Tracklist cache version must invalidate stale pre-release results")
    if "Number(v)>0" not in js:
        fail("Recommendation rationale must reject zero/null runtimes")
    if "$('tracklistStatus').hidden=true" not in js:
        fail("Successful tracklist rendering must hide the loading status")
    if "PRODUCT PASS" in css or "EDITORIAL RESET" in css or "HUMAN EDITORIAL PASS" in css:
        fail("Legacy layered CSS markers returned; release stylesheet should stay consolidated")
    if "selector.js?v=" not in html or "style.css?v=" not in html:
        fail("Cache-busted CSS/JS references missing")
    feeling_pos=html.find('id="feelingInput"')
    filters_pos=html.find('class="fine-tune"')
    if feeling_pos < 0 or filters_pos < 0 or feeling_pos > filters_pos:
        fail("Descriptive music request must stay visible before optional filters")
    forbidden_copy=("open the strange door","warm hands","beautifully sad","low voltage","steady pulse","full blast","time is fake")
    present=[phrase for phrase in forbidden_copy if phrase in (html+" "+js).lower()]
    if present:
        fail(f"AI-style picker copy returned: {present}")
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
    subprocess.run(["node",str(ROOT/"scripts/tracklist_test.js")],check=True)

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
