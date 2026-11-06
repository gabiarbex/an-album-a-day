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
    if "async function load()" not in js or "load();" not in js:
        fail("Catalog bootstrap loader is missing or never called")
    if "resetButton.onclick" not in js:
        fail("Clear-all button must have an explicit reset handler")
    if "localStorage.removeItem('albumaday.dailyPick')" not in js:
        fail("Reset/input changes must be able to invalidate the saved daily pick")
    if "state[id]===value?null:value" not in js:
        fail("Single-select filter chips must toggle off when clicked twice")
    if "['any length',null]" in js or '["any length",null]' in js:
        fail("A null-valued time chip conflicts with the cleared picker state")
    if "restorePickerState();" not in js:
        fail("Picker request should persist across visits")
    load_start=js.find("async function load()")
    load_end=js.find("function score(",load_start)
    load_block=js[load_start:load_end] if load_start>=0 and load_end>load_start else ""
    if "restoreDailyPick()" in load_block:
        fail("Fresh visits must not auto-render the previous album")
    if "albumaday.seenKeys.v1" not in js or "albumWasSeen(" not in js:
        fail("Seen-album history must persist across visits")
    if "sessionStorage.setItem(PICKER_STORAGE_KEY" not in js or "sessionStorage.getItem(PICKER_STORAGE_KEY" not in js:
        fail("Free-text note and picker controls must be session-only, not persistent browser history")
    if "pulledRecordCount()" not in js or "statPulled" not in html or "pulledCount" not in html:
        fail("UI must distinguish pulled no-repeat history from saved diary history")
    if "MEANING MATCH" not in html or "not just the exact words" not in html:
        fail("Semantic matching must be explained without generic AI-product language")
    if "query:pickerSnapshot()" in js:
        fail("Feedback must not send the raw free-text picker snapshot")
    feedback_js=(ROOT/"api"/"feedback.js").read_text(encoding="utf-8")
    taste_store_js=(ROOT/"api"/"_taste-store.js").read_text(encoding="utf-8")
    supporter_core=(ROOT/"supporter-core.js").read_text(encoding="utf-8")
    analytics_js=(ROOT/"analytics.js").read_text(encoding="utf-8")
    if "note: cleanText(body.query?.note" in feedback_js:
        fail("Backend feedback must never persist raw free-text notes")
    if "note_used: Boolean(body.query?.note_used)" not in feedback_js:
        fail("Feedback may retain only whether a free-text note was used")
    if "data-account-label>log in" not in html:
        fail("Account sign-in must be a discoverable release affordance")
    auth_js=(ROOT/"auth-sync.js").read_text(encoding="utf-8")
    auth_refs=set(re.findall(r"\\$\\('([^']+)'\\)",auth_js))
    missing_auth=sorted(auth_refs-set(ids))
    if missing_auth:
        fail(f"Account/billing JS references missing DOM ids: {missing_auth}")
    if "SUPPORTER_CHECKOUT='https://buy.stripe.com/" not in auth_js:
        fail("Supporter checkout must be wired through the account layer")
    if "client_reference_id" not in auth_js or "locked_prefilled_email" not in auth_js:
        fail("Supporter checkout must reconcile Stripe to the logged-in account")
    if "SUPPORTER_PORTAL='https://billing.stripe.com/p/login/" not in auth_js or "prefilled_email" not in auth_js:
        fail("Active Supporters must have a Stripe-hosted self-service billing path")
    if 'id="supporterManage"' not in html:
        fail("Supporter account UI must expose billing management")
    if "const SUPPORTER_TABLE='supporter_entitlements'" not in auth_js:
        fail("Supporter entitlement table must be queried by the account layer")
    if "if(!supporterLoaded)await refreshSupporterStatus({silent:true});" not in auth_js or "if(!isSupporter()){" not in auth_js:
        fail("Cloud sync must be gated by server-backed Supporter status")
    if "if(!session?.user||!isSupporter())return;" not in auth_js:
        fail("Background cloud sync must stay off for free accounts")
    if 'id="supporterSubscribe"' not in html or 'id="supporterFooter"' not in html:
        fail("Supporter must be discoverable from both account UI and footer")
    if 'href="https://buy.stripe.com/' in html:
        fail("Guest-visible HTML must not expose a direct checkout link without account reconciliation")
    privacy=(ROOT/"privacy.html").read_text(encoding="utf-8")
    terms=(ROOT/"terms.html").read_text(encoding="utf-8")
    if "Stripe" not in privacy or "$3/month Supporter" not in privacy:
        fail("Privacy policy must disclose Stripe and Supporter billing")
    if "US$3 per month" not in terms or "Stripe" not in terms:
        fail("Terms must disclose recurring Supporter billing")
    if "product analytics" not in privacy.lower() or "Do Not Track" not in privacy or "Global Privacy Control" not in privacy:
        fail("Privacy policy must disclose first-party funnel analytics and browser privacy controls")
    if "navigator.doNotTrack==='1'" not in analytics_js or "navigator.globalPrivacyControl===true" not in analytics_js:
        fail("Product analytics must honor DNT and Global Privacy Control")
    if "Authorization" in analytics_js or "'apikey':target.key" not in analytics_js:
        fail("Supabase publishable analytics key must be sent only through the apikey header")
    forbidden_analytics=("feelingInput","diary notes","account_id","user_id","accountEmail")
    leaked=[term for term in forbidden_analytics if term in analytics_js]
    if leaked:
        fail(f"Product analytics must not collect private content/account identifiers: {leaked}")
    analytics_migration=(ROOT/"supabase"/"migrations"/"003_product_events.sql").read_text(encoding="utf-8")
    if "enable row level security" not in analytics_migration.lower() or "grant insert" not in analytics_migration.lower() or "grant select" in analytics_migration.lower():
        fail("Product analytics table must remain insert-only behind RLS")
    supporter_js=(ROOT/"supporter.js").read_text(encoding="utf-8")
    supporter_refs=set(re.findall(r"\\$\\('([^']+)'\\)",supporter_js))
    missing_supporter=sorted(supporter_refs-set(ids))
    if missing_supporter:
        fail(f"Supporter Studio JS references missing DOM ids: {missing_supporter}")
    if "supporter-core.js?v=" not in html or "supporter.js?v=" not in html:
        fail("Supporter Studio scripts must be loaded by the release page")
    if 'id="appMain"' not in html or "document.body.classList.add('has-record')" not in js:
        fail("Homepage must switch from picker-first to result-first after a recommendation")
    if 'id="whySignals"' not in html or "signals.replaceChildren()" not in js:
        fail("Recommendation rationale must render as scannable evidence signals")
    if '> pulled<' in html or ' pulled</small>' in html:
        fail("Listener-facing no-repeat terminology must use seen, not pulled")
    if 'class="diary-extras"' not in html or 'id="supporterShelfTeaser"' not in html:
        fail("Diary hierarchy must keep utilities secondary and Supporter value visible")
    if html.find('id="history"') > html.find('id="supporterShelfTeaser"'):
        fail("Diary entries must appear before the Supporter upsell")
    if "min-height:44px!important" not in css or "env(safe-area-inset-bottom)" not in css:
        fail("Mobile controls must preserve comfortable tap targets and safe-area spacing")
    if ".drawer-head{" not in css or "position:sticky" not in css:
        fail("Long diary drawers must keep their close/header controls reachable")
    if 'id="studioFiveStarShelf"' not in html or 'id="studioTasteSentence"' not in html:
        fail("Supporter profile must feel like a music identity page, not only analytics")
    if 'id="storyWrapped"' not in html or "function storyWrapped()" not in supporter_js:
        fail("Wrapped must support a shareable story-card export")
    if 'id="pickProgress"' not in html or "function setPickProgress(busy)" not in js:
        fail("Recommendation waits must have visible progress feedback")
    if not re.search(r'<button[^>]+id="recommend"[^>]+disabled',html) or not re.search(r'<button[^>]+id="surpriseMe"[^>]+disabled',html):
        fail("Pick controls must start disabled until the catalog is ready")
    if "setCatalogReady(true);" not in load_block or "busy||!catalogReady" not in js:
        fail("Catalog readiness must control recommendation availability")
    if 'id="moodToggleMore"' not in html or "classList.toggle('is-expanded')" not in js:
        fail("Long mood controls must use progressive disclosure")
    if "diaryHasAlbum(pick)" not in js or "saved for later ✓ · add note" not in js or "listened ✓ · rate / note" not in js:
        fail("Diary action must distinguish saved-later from listened records")
    if "function buildDiaryEntryFromPick(ratingValue=0,favoriteTrack='',noteText='',completed=false)" not in js or "const newEntry=buildDiaryEntryFromPick();" not in js or "editDiaryEntry(existingIndex)" not in js:
        fail("Primary save must bookmark in one click without falsely marking the album listened")
    if "Saved for later. Finish it when you’re ready." not in js:
        fail("Quick-save feedback must explain the saved-later state")
    if "document.body.classList.toggle('has-diary',listenedRows.length>0)" not in js or "body:not(.has-diary) .recent-shelf" not in css:
        fail("Recent listens must stay hidden until the user actually finishes an album")
    if "confirm(" in js:
        fail("Diary deletion must not use a browser-native confirm dialog")
    if "wrapped-empty" not in supporter_js or "story.disabled=!stats.listened" not in supporter_js:
        fail("Empty Wrapped must be based on completed listens, not bookmarks")
    if 'id="resultBrief"' not in html or "function renderResultBrief()" not in js or "editing-brief" not in css:
        fail("Post-pick controls must collapse into a compact editable brief")
    if 'id="resumeLastPick"' not in html or 'id="recentSeenList"' not in html:
        fail("Seen recommendations must remain recoverable after refresh")
    if "RECENT_PICKS_STORAGE_KEY='albumaday.recentPicks.v1'" not in js or "rememberRecentPick(a);" not in js:
        fail("Recommendation memory must persist lightweight recent album snapshots")
    if "metadata:{" not in js or "note:" in js[js.find("function recentPickSnapshot"):js.find("function persistRecentPicks")]:
        fail("Recent-pick memory must not persist the user's free-text note")
    if "context.mode==='history'" not in js or "reopened from recent picks" not in js:
        fail("Reopening a recent pick must be distinct from generating a new recommendation")
    if 'id="meaningMatchNote" class="ai-match-note" hidden' not in html or "meaning.hidden=!hasText" not in js:
        fail("Semantic-match helper should stay out of the way until a note exists")
    if "syncButton.hidden=!active" not in auth_js:
        fail("Free accounts must not show a dead manual-sync control")
    if 'id="diarySearch"' not in html or "searchableDiary=logs.length>=6" not in js:
        fail("Larger saved diaries must be searchable without cluttering small diaries")
    if "function reopenDiaryEntry(entry)" not in js or "mode:'diary'" not in js:
        fail("Saved diary entries must be reopenable as records")
    if "recent-card-open" not in js or "open.textContent='open ↗'" not in js:
        fail("Recent saved-listen cards must be actionable")
    if "['shared','history','diary'].includes(context.mode)?'':explainPick" not in js:
        fail("Reopened/shared records must not show fabricated recommendation rationale")
    if "Free sign-in does not upload your local diary" not in html or "account + supporter" not in html:
        fail("Account UI must clearly distinguish free sign-in from paid cloud sync")
    if 'id="listenCheckin"' not in html or "function completeCurrentPick(options={})" not in js or "function setQuickRating(value)" not in js:
        fail("Daily recommendations must have a post-listen completion and rating loop")
    if "COMPLETED_DAYS_KEY='albumaday.completedDays.v1'" not in js or "markTodayComplete()" not in js:
        fail("Daily streaks must be driven by completed listening days")
    choose_daily=js[js.find("async function chooseDaily"):js.find("async function chooseAnother")]
    if "markTodayPicked" in js or "markTodayComplete()" in choose_daily:
        fail("Generating a recommendation must never complete the daily streak")
    if 'id="dailyHome"' not in html or "function renderDailyHome()" not in js:
        fail("Returning users need a dedicated today/continue state")
    if 'data-diary-view="grid"' not in html or 'data-diary-filter="later"' not in html or "history history-'+diaryView" not in js:
        fail("Diary must support cover-grid browsing and listened/saved-later filters")
    if "completed!==false" not in supporter_core or "completed===false" not in supporter_core or "savedLater" not in supporter_core:
        fail("Supporter stats and Wrapped must separate listened records from saved-later bookmarks")
    if "albumaday.completedDays.v1" not in supporter_js or "albumaday.completedDays.v1" not in auth_js:
        fail("Supporter/cloud streak state must read completed-listening days")
    if 'data-learn="more_like_this"' not in html or 'data-learn="less_artist"' not in html or "artistSuppressions" not in js:
        fail("Post-listen recommender learning controls are missing")
    if "'less_artist'" not in feedback_js or "event === 'less_artist'" not in taste_store_js:
        fail("Explicit less-artist feedback must be accepted and learned server-side")
    if 'id="recordStamp"' not in html or "BONUS / NO REPEAT" not in js:
        fail("Album reveal must distinguish the daily record from bonus/reopened records")
    if 'class="listener-flow"' not in html:
        fail("First-time listeners need a lightweight describe → pick → save explanation")
    if 'id="supporterStudioDialog"' not in html or 'data-studio-tab="wrapped"' not in html:
        fail("Supporter Studio profile/stats/Wrapped UI is missing")
    if 'id="supporterStudioOpen"' not in html or 'id="supporterStudioDrawer"' not in html:
        fail("Supporter Studio must be discoverable from account and diary surfaces")
    if "window.AlbumAuth?.isSupporter?.()" not in supporter_js:
        fail("Supporter Studio must verify active entitlement before opening")
    if "window.AlbumAuth?.user?.()" not in supporter_js:
        fail("Supporter profile must use the authenticated account identity")
    if "release_year:" not in js or "duration_min:" not in js:
        fail("New diary saves must capture release year and runtime for richer analytics")
    if "albumaday:datachange" not in js or "albumaday:supporterchange" not in auth_js:
        fail("Supporter Studio must react to diary/cloud/entitlement changes")
    webhook=(ROOT/"supabase"/"functions"/"stripe-supporter-webhook"/"index.ts").read_text(encoding="utf-8")
    if 'object?.payment_status === "paid"' not in webhook or 'status: checkoutPaid ? "active" : "pending"' not in webhook:
        fail("Supporter entitlement must not activate before Checkout payment settles")
    if "if(!a||albumWasSeen(a)||logged.has(key(a)))return;" not in js:
        fail("Backend recall must not reintroduce seen or diary-saved albums")
    if ".filter(row=>!albumWasSeen(row.album)&&!logged.has(key(row.album)))" not in js:
        fail("Semantic fallback must use the normalized no-repeat guard")
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
                    str(ROOT/"scripts/check_semantic_quality.py"),
                    str(ROOT/"scripts/build_vector_index.py")],check=True)
    subprocess.run(["node",str(ROOT/"scripts/intent_test.js")],check=True)
    subprocess.run(["node",str(ROOT/"scripts/tracklist_test.js")],check=True)
    subprocess.run(["node",str(ROOT/"scripts/ranking_test.js")],check=True)
    subprocess.run(["node",str(ROOT/"scripts/recommender_matrix_test.js")],check=True)
    subprocess.run(["node","--check",str(ROOT/"analytics.js")],check=True)
    subprocess.run(["node","--check",str(ROOT/"auth-sync.js")],check=True)
    subprocess.run(["node","--check",str(ROOT/"auth-config.js")],check=True)
    subprocess.run(["node","--check",str(ROOT/"supporter-core.js")],check=True)
    subprocess.run(["node","--check",str(ROOT/"supporter.js")],check=True)
    subprocess.run(["node",str(ROOT/"scripts/supporter_stats_test.js")],check=True)
    for api_file in [
        "api/recommend.js",
        "api/feedback.js",
        "api/health.js",
        "api/_embedding.js",
        "api/_vector-store.js",
        "api/_taste-store.js",
        "api/_catalog-indexer.js",
        "api/index-catalog.js",
        "api/index-status.js",
        "api/taste-bootstrap.js",
        "api/artist-neighbors.js",
        "api/_ranking-core.js",
        "api/neural-retrieve.js",
    ]:
        subprocess.run(["node","--check",str(ROOT/api_file)],check=True)

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
