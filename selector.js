'use strict';

let albums=[],logs=[],pick=null,rating=0,catalogManifest=null,catalogTotal=0;
let rankingFeaturesAvailable=false,featureCoverage=0;
const loadedShardFiles=new Set();
const state={moods:[],energy:null,comfort:null,time:null};
const $=id=>document.getElementById(id);
const moods=[
 ['after dark','dark'],
 ['cold air','cold'],
 ['too much','intense'],
 ['inside my head','reflective'],
 ['moving','energetic'],
 ['beautifully sad','melancholic'],
 ['rough edges','gritty'],
 ['somewhere else','alienated'],
 ['memory lane','nostalgic'],
 ['warm hands','warm'],
 ['floaty','dreamy'],
 ['light coming in','hopeful']
];
const groups=[
 ['moods',moods],
 ['energy',[['low voltage',2],['steady pulse',5],['full blast',9]]],
 ['comfort',[['stay close','comfort'],['open the strange door','exploration']]],
 ['time',[['quick side',30],['proper sit-down',45],['long listen',60],['time is fake',null]]]
];

for(const [id,values] of groups){
 const parent=$(id);
 values.forEach(v=>{
  const label=Array.isArray(v)?v[0]:v;
  const value=Array.isArray(v)?v[1]:v;
  const b=document.createElement('button');
  b.className='chip';b.type='button';b.textContent=label;b._value=value;
  b.setAttribute('aria-pressed','false');
  b.addEventListener('click',()=>{
   if(id==='moods')state.moods=state.moods.includes(value)?state.moods.filter(x=>x!==value):[...state.moods,value];
   else state[id]=value;
   parent.querySelectorAll('button').forEach(x=>{
    const active=id==='moods'?state.moods.includes(x._value):x===b;
    x.classList.toggle('selected',active);
    x.setAttribute('aria-pressed',String(active));
   });
   savePickerState();
  });
  parent.append(b);
 });
}

function key(a){return `${String(a.artist||'').toLowerCase()}::${String(a.title||'').toLowerCase()}`}
function getDate(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function hash32(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function seededUnit(str){return hash32(str)/4294967296}
function getUserSalt(){
 try{
  let salt=localStorage.getItem('albumaday.salt');
  if(!salt){
   if(globalThis.crypto?.getRandomValues){const bytes=new Uint32Array(4);crypto.getRandomValues(bytes);salt=[...bytes].map(x=>x.toString(16).padStart(8,'0')).join('')}
   else salt=`${Math.random()}-${Date.now()}`;
   localStorage.setItem('albumaday.salt',salt);
  }
  return salt;
 }catch{return 'anonymous-listener'}
}
function readSeen(){
 try{
  const raw=JSON.parse(localStorage.getItem('albumaday.seen')||'[]');
  return new Set((Array.isArray(raw)?raw:[]).map(v=>typeof v==='number'?v:hash32(String(v))));
 }catch{return new Set()}
}
let seenAlbums=readSeen();
function persistSeen(){
 try{localStorage.setItem('albumaday.seen',JSON.stringify([...seenAlbums]))}
 catch(e){showToast('Could not save seen-history on this browser.');console.warn('Seen history storage unavailable',e)}
}
function readLogs(){try{return JSON.parse(localStorage.getItem('albumaday.logs')||'[]')}catch{return []}}
logs=readLogs();
function persist(){localStorage.setItem('albumaday.logs',JSON.stringify(logs));renderHistory()}

function readPickDays(){try{return JSON.parse(localStorage.getItem('albumaday.pickDays')||'[]')}catch{return []}}
function markTodayPicked(){
 try{
  const days=new Set(readPickDays());
  days.add(getDate());
  const trimmed=[...days].sort().slice(-730);
  localStorage.setItem('albumaday.pickDays',JSON.stringify(trimmed));
 }catch(e){console.warn('Could not save daily streak',e)}
 renderStreak();
}
function renderStreak(){
 const node=$('streak');if(!node)return;
 const days=new Set(readPickDays());
 let streak=0,d=new Date();
 while(days.has(getDate(d))){streak++;d.setDate(d.getDate()-1)}
 node.textContent=`${streak} day${streak===1?'':'s'} streak`;
}
function renderHistory(){
 $('count').textContent=logs.length;
 renderStreak();
 const area=$('history');area.replaceChildren();
 if(!logs.length){
  const empty=document.createElement('div');empty.className='history-empty';
  empty.innerHTML='<b>no records filed yet.</b><span>listen to something, then leave yourself a note.</span>';
  area.append(empty);return;
 }
 for(const entry of [...logs].reverse()){
  const item=document.createElement('article');item.className='history-item';
  if(entry.cover_art){
   const img=document.createElement('img');img.className='history-cover';img.src=entry.cover_art;img.alt='';
   img.onerror=()=>img.remove();item.append(img);
  }
  const copy=document.createElement('div');copy.className='history-copy';
  const date=document.createElement('small');date.textContent=entry.date;
  const name=document.createElement('strong');name.textContent=`${entry.artist} — ${entry.album}`;
  const sub=document.createElement('div');sub.className='history-rating';
  sub.textContent=`${'★'.repeat(entry.rating||0)}${'☆'.repeat(5-(entry.rating||0))}${entry.favorite_track?' · '+entry.favorite_track:''}`;
  copy.append(date,name,sub);
  if(entry.notes){const p=document.createElement('p');p.textContent=entry.notes;copy.append(p)}
  item.append(copy);area.append(item);
 }
}
renderHistory();

function hasRankingData(a){
 return (Array.isArray(a.moods)&&a.moods.length>0) ||
        (a.energy_level!==null&&a.energy_level!==undefined&&Number.isFinite(Number(a.energy_level))) ||
        Boolean(a.comfort_vs_exploration) ||
        (a.length_min!==null&&a.length_min!==undefined&&Number.isFinite(Number(a.length_min)));
}
function updateSignalNote(){
 const node=$('signalNote');if(!node)return;
 document.querySelectorAll('.fine-tune .chip').forEach(button=>{
  button.disabled=!rankingFeaturesAvailable;
  button.setAttribute('aria-disabled',String(!rankingFeaturesAvailable));
 });
 $('fineTune')?.classList.toggle('unavailable',!rankingFeaturesAvailable);
 if(rankingFeaturesAvailable){
  node.classList.add('live');
  node.textContent='LIVE: these controls now steer the ranking. Missing album fields are treated as unknown, never as zero.';
 }else{
  node.classList.remove('live');
  node.textContent='PREVIEW ONLY: the catalog is still being enriched. These controls stay disabled until there is enough real metadata to make them honest.';
 }
}
function refreshFeatureCoverage(){
 if(!albums.length){featureCoverage=0;rankingFeaturesAvailable=false;updateSignalNote();return}
 const enriched=albums.reduce((n,a)=>n+(hasRankingData(a)?1:0),0);
 featureCoverage=enriched/albums.length;
 // Until P1 normalises sparse records, do not pretend a partially enriched catalog is fair.
 rankingFeaturesAvailable=featureCoverage>=0.80;
 updateSignalNote();
}
function libraryStatus(){
 const total=(catalogTotal||albums.length).toLocaleString();
 if(rankingFeaturesAvailable)return `${total} albums in the universe · recommendation metadata is live ✳`;
 return `${total} albums in the universe · mood matching is not live yet, so today’s pick is a discovery draw ✳`;
}

function mergeAlbums(items){
 const known=new Set(albums.map(key));
 for(const a of items||[]){
  if(!a?.title||!a?.artist)continue;
  const k=key(a);if(known.has(k))continue;
  known.add(k);albums.push(a);
 }
 refreshFeatureCoverage();
}
async function loadMoreShards(count=6){
 if(!catalogManifest)return;
 const remaining=catalogManifest.shards.filter(s=>!loadedShardFiles.has(s.file));
 for(let i=remaining.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]]}
 const selected=remaining.slice(0,count);
 const batches=await Promise.all(selected.map(async shard=>{
  try{
   const r=await fetch('./data/catalog/'+shard.file,{cache:'force-cache'});
   if(!r.ok)throw Error('HTTP '+r.status);
   const data=await r.json();loadedShardFiles.add(shard.file);
   return Array.isArray(data)?data:data.albums||[];
  }catch(e){console.warn('Could not load catalog shard',shard.file,e);return []}
 }));
 for(const batch of batches)mergeAlbums(batch);
}
function readDailyPick(){
 try{
  const value=JSON.parse(localStorage.getItem('albumaday.dailyPick')||'null');
  return value&&value.date===getDate()&&value.album?value:null;
 }catch{return null}
}
function saveDailyPick(album,featuresUsed){
 try{localStorage.setItem('albumaday.dailyPick',JSON.stringify({date:getDate(),album,featuresUsed:Boolean(featuresUsed)}))}catch(e){console.warn('Could not save daily pick',e)}
}
function restoreDailyPick(){
 const daily=readDailyPick();
 if(!daily)return false;
 pick=daily.album;
 show(pick,{mode:'daily',featuresUsed:Boolean(daily.featuresUsed),restored:true});
 $('reroll').hidden=false;
 markTodayPicked();
 return true;
}
async function load(){
 try{
  const manifestResponse=await fetch('./data/catalog/manifest.json',{cache:'no-store'});
  if(manifestResponse.ok){
   catalogManifest=await manifestResponse.json();
   catalogTotal=Number(catalogManifest.total_albums)||0;
   await loadMoreShards(8);
   if(!albums.length)throw Error('Catalog manifest exists but shards were empty');
   refreshFeatureCoverage();
   $('status').textContent=libraryStatus();
   restoreDailyPick();
   return;
  }
 }catch(e){console.info('Large catalog not deployed yet; using base catalog.',e)}
 try{
  const response=await fetch('./data/albums.json',{cache:'no-store'});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const json=await response.json();
  albums=(Array.isArray(json)?json:json.albums||[]).filter(a=>a.title&&a.artist);
  catalogTotal=albums.length;
  refreshFeatureCoverage();
  $('status').textContent=libraryStatus();
  if(!albums.length)throw Error('No albums found');
  restoreDailyPick();
 }catch(e){
  $('status').textContent='Could not load the music library.';
  console.error(e);
 }
}
load();

function score(a,intent){
 let s=0;
 const am=(a.moods||[]).map(x=>String(x).toLowerCase());
 for(const m of state.moods)if(am.includes(m))s+=4;
 for(const [m,w] of Object.entries(intent.moods))if(am.includes(m))s+=w*2.8;
 const en=a.energy_level==null?NaN:Number(a.energy_level);
 if(state.energy!==null&&Number.isFinite(en))s+=Math.max(0,5-Math.abs(en-state.energy));
 else if(intent.energy!==null&&Number.isFinite(en))s+=Math.max(0,4-Math.abs(en-intent.energy));
 if(state.comfort&&a.comfort_vs_exploration===state.comfort)s+=3;
 const duration=a.length_min==null?NaN:Number(a.length_min);
 if(state.time!==null&&Number.isFinite(duration))s+=duration<=state.time?3:-Math.min(7,(duration-state.time)/6);
 return s;
}
async function eligiblePool(){
 const logged=new Set(logs.map(l=>`${String(l.artist).toLowerCase()}::${String(l.album).toLowerCase()}`));
 let pool=albums.filter(a=>!seenAlbums.has(hash32(key(a)))&&!logged.has(key(a)));
 if(catalogManifest&&pool.length<350&&loadedShardFiles.size<catalogManifest.shards.length){
  await loadMoreShards(6);
  pool=albums.filter(a=>!seenAlbums.has(hash32(key(a)))&&!logged.has(key(a)));
 }
 return pool;
}
async function chooseDaily(){
 if(!albums.length){$('status').textContent='Still loading albums. Check your connection if this persists.';return}
 setPickBusy(true);
 const existing=readDailyPick();
 if(existing){
  pick=existing.album;
  show(pick,{mode:'daily',featuresUsed:Boolean(existing.featuresUsed),restored:true});
  $('reroll').hidden=false;
  markTodayPicked();
  setPickBusy(false);
  return;
 }
 const pool=await eligiblePool();
 if(!pool.length){$('status').textContent='Every available album has already been recommended.';setPickBusy(false);return}
 const intent=interpretFeeling($('feelingInput')?.value||'');
 const seed=`${getDate()}|${getUserSalt()}`;
 let best=null,bestValue=-Infinity;
 for(const a of pool){
  const base=rankingFeaturesAvailable?score(a,intent):0;
  const jitter=seededUnit(seed+'|'+key(a))*8;
  const value=base+jitter;
  if(value>bestValue){best=a;bestValue=value}
 }
 pick=best;
 seenAlbums.add(hash32(key(best)));persistSeen();
 saveDailyPick(best,rankingFeaturesAvailable);
 markTodayPicked();
 show(best,{mode:'daily',featuresUsed:rankingFeaturesAvailable});
 $('reroll').hidden=false;
 setPickBusy(false);
}
async function chooseAnother(){
 if(!albums.length)return;
 setPickBusy(true);
 const pool=await eligiblePool();
 if(!pool.length){$('status').textContent='Every available album has already been recommended.';setPickBusy(false);return}
 const intent=interpretFeeling($('feelingInput')?.value||'');
 const sample=[];const n=Math.min(pool.length,1800);
 for(let i=0;i<n;i++)sample.push(pool[Math.floor(Math.random()*pool.length)]);
 let best=null,bestValue=-Infinity;
 for(const a of sample){
  const value=(rankingFeaturesAvailable?score(a,intent):0)+Math.random()*8;
  if(value>bestValue){best=a;bestValue=value}
 }
 pick=best;
 seenAlbums.add(hash32(key(best)));persistSeen();
 show(best,{mode:'bonus',featuresUsed:rankingFeaturesAvailable});
 setPickBusy(false);
}
function setPickBusy(busy){
 for(const id of ['recommend','surpriseMe','reroll']){
  const node=$(id);if(node)node.disabled=busy;
 }
 if($('recommend')){
  $('recommend').classList.toggle('is-loading',busy);
  $('recommend').querySelector('span:first-child').textContent=busy?'✳ digging through the crates…':'✳ hand me today’s record';
 }
}
$('recommend').addEventListener('click',chooseDaily);
$('surpriseMe')?.addEventListener('click',chooseDaily);
$('reroll').addEventListener('click',chooseAnother);


const itunesAlbumCache=new Map();
const tracklistCache=new Map();
let recordFileRequest=0;

function normalizeStoreText(value){
 return String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function formatRuntime(ms){
 const total=Math.max(0,Math.round(Number(ms||0)/1000));
 const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),sec=total%60;
 return h?\`${h}h ${String(m).padStart(2,'0')}m\`:\`${m}:${String(sec).padStart(2,'0')}\`;
}
function catalogGenres(a){
 return (Array.isArray(a.genres)?a.genres:[])
  .map(g=>typeof g==='string'?g:g?.name)
  .filter(Boolean);
}
async function findItunesAlbum(a){
 const cacheKey=key(a);
 if(itunesAlbumCache.has(cacheKey))return itunesAlbumCache.get(cacheKey);
 const promise=(async()=>{
  const q=encodeURIComponent(\`${a.artist} ${a.title}\`);
  const response=await fetch(\`https://itunes.apple.com/search?term=${q}&media=music&entity=album&attribute=albumTerm&limit=20\`);
  if(!response.ok)throw Error('Album metadata service unavailable');
  const data=await response.json();
  const artist=normalizeStoreText(a.artist),title=normalizeStoreText(a.title);
  const results=data.results||[];
  return results.find(x=>normalizeStoreText(x.artistName)===artist&&normalizeStoreText(x.collectionName)===title)
    ||results.find(x=>normalizeStoreText(x.artistName)===artist&&(
      normalizeStoreText(x.collectionName).includes(title)||title.includes(normalizeStoreText(x.collectionName))
    ))
    ||null;
 })().catch(e=>{console.info('Album metadata lookup unavailable',a.artist,a.title,e);return null});
 itunesAlbumCache.set(cacheKey,promise);
 return promise;
}
function resetRecordFile(a){
 const panel=$('recordFile');if(!panel)return;
 panel.hidden=false;
 $('metadataSource').textContent='LOOKING IT UP…';
 $('classification').replaceChildren();
 const immediate=catalogGenres(a).slice(0,4);
 for(const genre of immediate){
  const tag=document.createElement('span');tag.textContent=String(genre).toUpperCase();$('classification').append(tag);
 }
 const facts=$('recordFacts');facts.replaceChildren();
 if(a.year){
  const dt=document.createElement('dt');dt.textContent='Released';
  const dd=document.createElement('dd');dd.textContent=a.year;facts.append(dt,dd);
 }
 $('tracklist').replaceChildren();
 $('trackCountLabel').textContent='—';
 $('tracklistStatus').hidden=false;
 $('tracklistStatus').textContent='Pulling the sleeve notes…';
}
function renderRecordFacts(a,album,tracks,sourceLabel='CATALOG'){
 const panel=$('recordFile');if(!panel)return;
 panel.hidden=false;
 $('metadataSource').textContent=sourceLabel;

 const genreNames=[...catalogGenres(a),album?.primaryGenreName].filter(Boolean);
 const unique=[...new Set(genreNames.map(x=>String(x).trim()).filter(Boolean))].slice(0,5);
 const classification=$('classification');classification.replaceChildren();
 for(const genre of unique.length?unique:['UNCLASSIFIED']){
  const tag=document.createElement('span');tag.textContent=genre.toUpperCase();classification.append(tag);
 }

 const facts=$('recordFacts');facts.replaceChildren();
 const addFact=(label,value)=>{
  if(value===null||value===undefined||value==='')return;
  const dt=document.createElement('dt');dt.textContent=label;
  const dd=document.createElement('dd');dd.textContent=value;
  facts.append(dt,dd);
 };
 const releaseYear=(album?.releaseDate||'').slice(0,4)||a.year||'';
 const runtime=tracks.reduce((sum,t)=>sum+(Number(t.trackTimeMillis)||0),0);
 addFact('Released',releaseYear);
 addFact('Tracks',tracks.length||album?.trackCount||'');
 addFact('Runtime',runtime?formatRuntime(runtime):a.length_min?\`${Math.round(Number(a.length_min))} min\`:'');
 addFact('Format','LP / album');
 if(album?.collectionExplicitness==='explicit')addFact('Advisory','Explicit');

 const list=$('tracklist');list.replaceChildren();
 $('trackCountLabel').textContent=tracks.length?\`${tracks.length} TRACK${tracks.length===1?'':'S'}\`:'UNAVAILABLE';
 if(!tracks.length){
  $('tracklistStatus').hidden=false;
  $('tracklistStatus').textContent='No verified tracklist found for this edition.';
  return;
 }
 $('tracklistStatus').hidden=true;
 tracks
  .slice()
  .sort((x,y)=>(x.discNumber||1)-(y.discNumber||1)||(x.trackNumber||0)-(y.trackNumber||0))
  .forEach(track=>{
   const li=document.createElement('li');
   const num=document.createElement('span');num.className='track-no';
   num.textContent=(track.discCount||1)>1?\`${track.discNumber||1}.${String(track.trackNumber||0).padStart(2,'0')}\`:String(track.trackNumber||'').padStart(2,'0');
   const name=document.createElement('span');name.className='track-name';name.textContent=track.trackName||'Untitled';
   const time=document.createElement('span');time.className='track-time';time.textContent=track.trackTimeMillis?formatRuntime(track.trackTimeMillis):'';
   li.append(num,name,time);list.append(li);
  });
}
async function loadRecordFile(a){
 const request=++recordFileRequest;
 resetRecordFile(a);
 const cacheKey=key(a);
 try{
  let cached=null;
  try{cached=JSON.parse(sessionStorage.getItem('albumaday.record.'+hash32(cacheKey))||'null')}catch{}
  if(cached){
   if(request===recordFileRequest&&pick&&key(pick)===cacheKey)renderRecordFacts(a,cached.album,cached.tracks||[],'CATALOG DATA / ITUNES STORE');
   return;
  }
  const album=await findItunesAlbum(a);
  if(request!==recordFileRequest||!pick||key(pick)!==cacheKey)return;
  if(!album?.collectionId){
   renderRecordFacts(a,null,[],'CATALOG DATA');
   return;
  }
  let tracks=[];
  if(tracklistCache.has(album.collectionId)){
   tracks=await tracklistCache.get(album.collectionId);
  }else{
   const promise=fetch(\`https://itunes.apple.com/lookup?id=${album.collectionId}&entity=song&limit=200\`)
    .then(r=>{if(!r.ok)throw Error('Tracklist lookup unavailable');return r.json()})
    .then(data=>(data.results||[]).filter(x=>x.wrapperType==='track'&&x.kind==='song'&&Number(x.collectionId)===Number(album.collectionId)))
    .catch(e=>{console.info('Tracklist unavailable',e);return []});
   tracklistCache.set(album.collectionId,promise);
   tracks=await promise;
  }
  if(request!==recordFileRequest||!pick||key(pick)!==cacheKey)return;
  const cache={album,tracks};
  try{sessionStorage.setItem('albumaday.record.'+hash32(cacheKey),JSON.stringify(cache))}catch{}
  renderRecordFacts(a,album,tracks,'CATALOG DATA / ITUNES STORE');
 }catch(e){
  if(request===recordFileRequest)renderRecordFacts(a,null,[],'CATALOG DATA');
 }
}

function spotifyUrl(a){
 const source=a.metadata?.sources;
 const candidate=Array.isArray(source)?source.find(s=>typeof s==='string'&&s.includes('spotify.com')):source;
 if(typeof candidate==='string'&&/^https:\/\/open\.spotify\.com\//i.test(candidate))return candidate;
 return `https://open.spotify.com/search/${encodeURIComponent(`${a.artist} ${a.title}`)}`;
}
function show(a,context={}){
 const stage=$('stage');stage.classList.remove('revealed');void stage.offsetWidth;
 const cover=$('cover');cover.style.display='block';cover.alt=`${a.title} by ${a.artist} album cover`;
 $('emptyCover').style.display='none';
 cover.src=artPlaceholder(a);
 const info=$('details');info.replaceChildren();
 const tag=document.createElement('div');tag.className='eyebrow';tag.textContent=context.mode==='bonus'?'BONUS DRAW ✳':'TODAY’S RECORD ✳';
 const title=document.createElement('h2');title.textContent=a.title;
 const artist=document.createElement('p');artist.textContent=`${a.artist}${a.year?' · '+a.year:''}`;
 const meta=document.createElement('p');
 meta.textContent=[(a.moods||[]).join(' · '),a.length_min?`${Math.round(Number(a.length_min))} min`:null].filter(Boolean).join('  /  ');
 info.append(tag,title,artist,meta);
 const why=$('whyText');if(why)why.textContent=explainPick(a,context);
 resetRecordFile(a);
 const link=$('spotify');link.href=spotifyUrl(a);link.classList.remove('disabled');
 $('log').disabled=false;
 $('sharePick').disabled=false;
 $('recordLabel').style.background=labelColor(a);
 requestAnimationFrame(()=>requestAnimationFrame(()=>stage.classList.add('revealed')));
 const unseen=Math.max(0,(catalogTotal||albums.length)-seenAlbums.size).toLocaleString();
 $('status').textContent=context.mode==='bonus'?`${unseen} unseen albums remaining · bonus draw ✳`:`${unseen} unseen albums remaining · today’s record is locked to this date ✳`;
 loadArtwork(a,cover);
 loadRecordFile(a);
}
function labelColor(a){
 const palette=['#c8432f','#2e5f76','#d5ad36','#65714b','#9a593f','#d9d0bc'];
 let n=0;for(const c of key(a))n=(n*31+c.charCodeAt(0))>>>0;
 return palette[n%palette.length];
}

function drawer(open){$('drawer').classList.toggle('open',open);$('drawer').setAttribute('aria-hidden',String(!open));$('overlay').hidden=!open}
$('historyToggle').onclick=()=>drawer(true);
$('closeDrawer').onclick=()=>drawer(false);
$('overlay').onclick=()=>drawer(false);

$('log').onclick=()=>{
 if(!pick)return;
 rating=0;$('track').value='';$('notes').value='';
 $('logAlbum').textContent=`${pick.artist} — ${pick.title}`;
 stars();$('logDialog').showModal();
};
$('closeDialog').onclick=()=>$('logDialog').close();
function stars(){
 const area=$('stars');area.replaceChildren();
 for(let i=1;i<=5;i++){
  const b=document.createElement('button');b.type='button';b.className='star'+(i<=rating?' active':'');b.textContent='★';
  b.setAttribute('aria-label',`${i} stars`);b.setAttribute('role','radio');b.setAttribute('aria-checked',String(i===rating));b.onclick=()=>{rating=i;stars()};area.append(b);
 }
}
$('logForm').onsubmit=e=>{
 e.preventDefault();if(!pick)return;
 logs.push({date:getDate(),artist:pick.artist,album:pick.title,rating,favorite_track:$('track').value.trim(),notes:$('notes').value.trim(),cover_art:pick.metadata?.cover_art||''});
 persist();$('logDialog').close();$('status').textContent='Saved to your listening diary ♡';
};
$('export').onclick=()=>{
 const blob=new Blob([JSON.stringify(logs,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='listening_log.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

let artworkRequest=0;
async function loadArtwork(a,img){
 const request=++artworkRequest;
 const fallback=artPlaceholder(a);
 const tryItunes=async()=>{
  try{
   const album=await findItunesAlbum(a);
   if(request!==artworkRequest||!pick||key(pick)!==key(a))return;
   if(album?.artworkUrl100){
    img.onerror=()=>{img.onerror=null;img.src=fallback};
    img.src=album.artworkUrl100.replace(/100x100bb/,'600x600bb');
   }else img.src=fallback;
  }catch(e){img.src=fallback;console.info('Cover unavailable for',a.artist,a.title)}
 };
 const preferred=a.metadata?.cover_art;
 if(preferred&&/^https?:\/\//.test(preferred)){
  img.onerror=()=>{img.onerror=null;tryItunes()};
  img.src=preferred;
 }else{
  tryItunes();
 }
}

function artPlaceholder(a){
 const safe=x=>String(x||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const wrap=(v,n=19)=>{
  const words=String(v||'').split(/\s+/),lines=[''];
  for(const w of words){
   const i=lines.length-1;
   if((lines[i]+' '+w).trim().length>n&&lines.length<4)lines.push(w);
   else lines[i]=(lines[i]+' '+w).trim();
  }
  return lines;
 };
 const title=wrap(a.title,17).map((v,i)=>'<text x="52" y="'+(330+i*62)+'" font-size="52" font-weight="800">'+safe(v)+'</text>').join('');
 const coverColor=labelColor(a);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="'+coverColor+'"/><stop offset="1" stop-color="#171411"/></linearGradient></defs><rect width="720" height="720" fill="url(#g)"/><circle cx="640" cy="100" r="240" fill="none" stroke="#f3eadb" stroke-opacity=".16" stroke-width="1"/><circle cx="640" cy="100" r="180" fill="none" stroke="#f3eadb" stroke-opacity=".12"/><g fill="#f3eadb" font-family="Arial, sans-serif"><text x="52" y="95" font-size="21" letter-spacing="6">AN ALBUM A DAY / DISCOVERY</text>'+title+'<text x="52" y="635" font-size="27">'+safe(a.artist).slice(0,37)+'</text><text x="52" y="680" font-size="18" letter-spacing="4">✳ LISTEN CLOSELY</text></g></svg>';
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}

function explainPick(a,context={}){
 if(!context.featuresUsed){
  if(context.mode==='bonus')return 'This is a bonus discovery draw from the catalog. The current album data does not yet have enough mood, energy, duration, and familiarity features, so your note and filters did not influence this result.';
  return 'This is today’s date-seeded discovery draw. The current album data does not yet have enough mood, energy, duration, and familiarity features, so your note and filters did not influence this pick. On this browser, today’s record stays the same for the date.';
 }
 const am=(a.moods||[]).map(x=>String(x).toLowerCase());
 const intent=interpretFeeling($('feelingInput')?.value||'');
 const selectedMoodMatches=state.moods.filter(m=>am.includes(m));
 const textMoodMatches=Object.keys(intent.moods).filter(m=>am.includes(m));
 const notes=[];
 if(textMoodMatches.length)notes.push(`Your note and this record overlap on ${textMoodMatches.slice(0,2).join(' and ')}.`);
 if(selectedMoodMatches.length)notes.push(`Your selected mood matches ${selectedMoodMatches.slice(0,2).join(' and ')}.`);
 if(state.energy!==null&&a.energy_level!==null&&a.energy_level!==undefined)notes.push('Its available energy metadata also contributed to the ranking.');
 if(state.comfort&&a.comfort_vs_exploration===state.comfort)notes.push(`Its familiarity profile matches your ${state.comfort} setting.`);
 if(state.time!==null&&Number.isFinite(Number(a.length_min))&&Number(a.length_min)<=state.time)notes.push('Its recorded duration fits the time you chose.');
 if(!notes.length)notes.push('This album ranked from the metadata currently available, but none of your selected cues matched strongly enough for a more specific claim.');
 return notes.join(' ');
}

const feelingLexicon={
 nostalgic:['nostalg','saudade','miss ','remember','memories','memory','childhood','past','used to','back then','homesick','lembrança','lembrar'],
 melancholic:['sad','cry','heartbreak','lonely','alone','grief','empty','devastat','blue','triste','chorar','solidão','luto','broken'],
 reflective:['think','thought','quiet','introspect','confus','uncertain','meaning','question','ponder','overthink','thinking','pensando','pensar'],
 dreamy:['dream','float','ethereal','cloud','surreal','distant','escape','space','sonho','sonhar','dreaming'],
 warm:['warm','safe','hug','home','soft','gentle','cozy','love','tender','carinho','abraço','amor','aconchego'],
 intense:['angry','rage','scream','furious','chaos','loud','explode','restless','raiva','gritar','intense'],
 energetic:['dance','party','run','drive fast','excited','alive','movement','move','dançar','festa','energia'],
 dark:['dark','night','midnight','shadow','goth','haunt','noite','escuro','sombrio'],
 hopeful:['hope','better','healing','beginning','tomorrow','future','optimis','esperança','recomeçar'],
 alienated:['stranger','disconnected','out of place','belong','unreal','estranha','deslocad'],
 cold:['winter','cold','rain','fog','frost','inverno','frio','chuva'],
 gritty:['raw','dirty','grunge','rough','punk','noise','sujo','bruto']
};
function interpretFeeling(text){
 const t=String(text||'').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const moods={};
 for(const [m,terms] of Object.entries(feelingLexicon)){
  const hits=terms.filter(term=>t.includes(term.normalize('NFD').replace(/[\u0300-\u036f]/g,''))).length;
  if(hits)moods[m]=Math.min(hits,3);
 }
 const ranked=Object.entries(moods).sort((a,b)=>b[1]-a[1]);
 const energy=/dance|party|run|scream|rage|festa|dancar|gritar|alive/.test(t)?8:/quiet|slow|soft|gentle|sleep|calm|silencio|devagar/.test(t)?3:null;
 return {moods,energy,summary:ranked.length?ranked.slice(0,2).map(([m])=>m).join(' and ')+' feelings':''};
}
function savePickerState(){
 try{localStorage.setItem('albumaday.picker',JSON.stringify({note:$('feelingInput')?.value||'',state}))}catch{}
}
function restorePickerState(){
 try{
  const saved=JSON.parse(localStorage.getItem('albumaday.picker')||'null');if(!saved)return;
  if($('feelingInput')&&typeof saved.note==='string')$('feelingInput').value=saved.note;
  if(saved.state){
   state.moods=Array.isArray(saved.state.moods)?saved.state.moods:[];
   state.energy=saved.state.energy??null;state.comfort=saved.state.comfort??null;state.time=saved.state.time??null;
   for(const [id] of groups){
    const parent=$(id);if(!parent)continue;
    parent.querySelectorAll('button').forEach(b=>{
     const active=id==='moods'?state.moods.includes(b._value):state[id]===b._value;
     b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));
    });
   }
  }
 }catch{}
}
function resetPicker(){
 state.moods=[];state.energy=null;state.comfort=null;state.time=null;
 if($('feelingInput'))$('feelingInput').value='';
 for(const [id] of groups)$(id)?.querySelectorAll('button').forEach(b=>{b.classList.remove('selected');b.setAttribute('aria-pressed','false')});
 try{localStorage.removeItem('albumaday.picker')}catch{}
 $('feelingInput')?.dispatchEvent(new Event('input'));
 showToast('Counter cleared.');
}
function showToast(message){
 const toast=$('toast');if(!toast)return;
 toast.textContent=message;toast.hidden=false;clearTimeout(showToast.timer);
 showToast.timer=setTimeout(()=>{toast.hidden=true},2400);
}
const feelingInput=$('feelingInput');
document.querySelectorAll('.prompt-chip').forEach(button=>{
 button.addEventListener('click',()=>{
  if(!feelingInput)return;
  const prompt=button.dataset.prompt||'';
  const current=feelingInput.value.trim();
  feelingInput.value=current ? current.replace(/[.!?]?$/,'')+', '+prompt : prompt;
  feelingInput.dispatchEvent(new Event('input'));
  feelingInput.focus();
 });
});
if(feelingInput){
 restorePickerState();
 feelingInput.addEventListener('input',()=>{
  const p=interpretFeeling(feelingInput.value);
  if(feelingInput.value.trim()&&!rankingFeaturesAvailable)$('feelingInsight').textContent='✳ note received — catalog mood matching is not live yet';
  else $('feelingInsight').textContent=p.summary?'✳ reading: '+p.summary:'✳ your words, your soundtrack';
  savePickerState();
 });
 feelingInput.dispatchEvent(new Event('input'));
 $('clearFeeling').addEventListener('click',()=>{feelingInput.value='';feelingInput.dispatchEvent(new Event('input'));feelingInput.focus()});
 feelingInput.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();chooseDaily()}});
}
$('resetPicker')?.addEventListener('click',resetPicker);

$('sharePick')?.addEventListener('click',async()=>{
 if(!pick)return;
 const text=`Today's record: ${pick.title} — ${pick.artist} · An Album a Day`;
 try{
  if(navigator.share)await navigator.share({title:'An Album a Day',text,url:location.origin+location.pathname});
  else{await navigator.clipboard.writeText(text+'\n'+location.origin+location.pathname);showToast('Record copied to clipboard.')}
 }catch(e){if(e?.name!=='AbortError')showToast('Could not share this record.')}
});

$('importDiary')?.addEventListener('click',()=>$('importFile')?.click());
$('importFile')?.addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  const parsed=JSON.parse(await file.text());
  if(!Array.isArray(parsed))throw Error('Diary must be a JSON array');
  const valid=parsed.filter(x=>x&&typeof x.artist==='string'&&typeof x.album==='string');
  const existing=new Set(logs.map(x=>`${x.date||''}|${x.artist}|${x.album}`));
  let added=0;
  for(const entry of valid){
   const k=`${entry.date||''}|${entry.artist}|${entry.album}`;
   if(existing.has(k))continue;
   logs.push(entry);existing.add(k);added++;
  }
  persist();showToast(`Imported ${added} diary entr${added===1?'y':'ies'}.`);
 }catch(err){showToast('That file does not look like an Album a Day diary.')}
 e.target.value='';
});
