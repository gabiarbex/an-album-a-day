'use strict';

let albums=[],logs=[],pick=null,rating=0,editingLogIndex=null,catalogManifest=null,catalogTotal=0;
let rankingFeaturesAvailable=false;
let featureCoverage={genre:0,mood:0,energy:0,duration:0};
const liveMetadataRankingAvailable=true;
const ENGINE_VERSION='semantic-100k-v4';
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
function lookupId(a){
 if(a?.lookup_id)return a.lookup_id;
 const text=String(a?.artist||'').trim().toLowerCase()+'\0'+String(a?.title||'').trim().toLowerCase();
 let h=14695981039346656037n,p=1099511628211n,mask=(1n<<64n)-1n;
 for(const ch of text){h^=BigInt(ch.codePointAt(0));h=(h*p)&mask}
 return h.toString(16).padStart(16,'0');
}
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
function readLastfmTaste(){try{return JSON.parse(localStorage.getItem('albumaday.lastfmTaste')||'null')}catch{return null}}
logs=readLogs();
let lastfmTaste=readLastfmTaste();
let lastfmTasteMap=new Map(lastfmTaste?.artists||[]);
let diaryArtistCache=null,diaryTasteCache=null;
function invalidateTasteCaches(){diaryArtistCache=null;diaryTasteCache=null}
function persist(){localStorage.setItem('albumaday.logs',JSON.stringify(logs));invalidateTasteCaches();renderHistory();renderRecentPulls()}

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
function renderRecentPulls(){
 const area=$('recentPulls');if(!area)return;
 area.replaceChildren();
 const recent=[...logs].reverse().slice(0,6);
 if(!recent.length){
  const p=document.createElement('p');p.className='recent-empty';p.textContent='Nothing filed yet. Your shelf will grow as you listen.';area.append(p);return;
 }
 for(const entry of recent){
  const card=document.createElement('article');card.className='recent-card';
  const art=document.createElement('div');art.className='recent-art';
  if(entry.cover_art){
   const img=document.createElement('img');img.src=entry.cover_art;img.alt='';img.loading='lazy';
   img.onerror=()=>{img.remove();art.classList.add('fallback')};art.append(img);
  }else art.classList.add('fallback');
  const copy=document.createElement('div');copy.className='recent-card-copy';
  const date=document.createElement('small');date.textContent=entry.date||'';
  const title=document.createElement('strong');title.textContent=entry.album||'Untitled';
  const artist=document.createElement('span');artist.textContent=entry.artist||'Unknown artist';
  const rating=document.createElement('em');rating.textContent=entry.rating?('★'.repeat(entry.rating)+'☆'.repeat(5-entry.rating)):'unrated';
  copy.append(date,title,artist,rating);card.append(art,copy);area.append(card);
 }
}
function renderHistory(){
 $('count').textContent=logs.length;
 renderStreak();
 if($('statListened'))$('statListened').textContent=logs.length;
 const rated=logs.filter(x=>Number(x.rating)>0);
 if($('statAverage'))$('statAverage').textContent=rated.length?(rated.reduce((n,x)=>n+Number(x.rating),0)/rated.length).toFixed(1)+'★':'—';
 const genreCounts={};
 for(const x of logs){if(x.genre)genreCounts[x.genre]=(genreCounts[x.genre]||0)+1}
 const topGenre=Object.entries(genreCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
 if($('statGenre'))$('statGenre').textContent=topGenre;
 if($('statTraining'))$('statTraining').textContent=logs.filter(x=>Number(x.rating)>0&&x.signal_snapshot).length;
 if($('statLastfm'))$('statLastfm').textContent=lastfmTaste?.unique_artists?Number(lastfmTaste.unique_artists).toLocaleString():'—';
 if($('clearLastfm'))$('clearLastfm').hidden=!lastfmTaste;
 const area=$('history');area.replaceChildren();
 if(!logs.length){
  const empty=document.createElement('div');empty.className='history-empty';
  empty.innerHTML='<b>no records filed yet.</b><span>listen to something, then leave yourself a note.</span>';
  area.append(empty);return;
 }
 for(const row of logs.map((entry,index)=>({entry,index})).reverse()){
  const {entry,index}=row;
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
  const actions=document.createElement('div');actions.className='history-entry-actions';
  const edit=document.createElement('button');edit.type='button';edit.textContent='edit';edit.onclick=()=>editDiaryEntry(index);
  const remove=document.createElement('button');remove.type='button';remove.textContent='remove';remove.onclick=()=>removeDiaryEntry(index);
  actions.append(edit,remove);copy.append(actions);
  item.append(copy);area.append(item);
 }
}
renderHistory();
renderRecentPulls();

function albumHasGenre(a){
 return Array.isArray(a.genres)&&a.genres.some(g=>Boolean(typeof g==='string'?g:g?.name));
}
function albumHasMood(a){
 return (Array.isArray(a.moods)&&a.moods.length>0) ||
        Boolean(a.features?.moods&&Object.keys(a.features.moods).length);
}
function albumHasEnergy(a){
 return (a.energy_level!==null&&a.energy_level!==undefined&&Number.isFinite(Number(a.energy_level))) ||
        (a.features?.energy!==null&&a.features?.energy!==undefined&&Number.isFinite(Number(a.features.energy)));
}
function albumHasDuration(a){
 return (a.length_min!==null&&a.length_min!==undefined&&Number.isFinite(Number(a.length_min))) ||
        (a.features?.duration_min!==null&&a.features?.duration_min!==undefined&&Number.isFinite(Number(a.features.duration_min)));
}
function updateSignalNote(){
 const node=$('signalNote');if(!node)return;
 const active=rankingFeaturesAvailable||liveMetadataRankingAvailable;
 document.querySelectorAll('.fine-tune .chip').forEach(button=>{
  button.disabled=!active;
  button.setAttribute('aria-disabled',String(!active));
 });
 $('fineTune')?.classList.toggle('unavailable',!active);
 node.classList.toggle('live',active);
 if(rankingFeaturesAvailable){
  node.textContent='these choices affect the pick.';
 }else if(liveMetadataRankingAvailable){
  node.textContent='these choices help narrow the shelf.';
 }else{
  node.textContent='these choices are unavailable right now.';
 }
}
function refreshFeatureCoverage(){
 if(!albums.length){
  featureCoverage={genre:0,mood:0,energy:0,duration:0};
  rankingFeaturesAvailable=false;
  updateSignalNote();
  return;
 }
 const n=albums.length;
 const counts=albums.reduce((acc,a)=>{
  acc.genre+=albumHasGenre(a)?1:0;
  acc.mood+=albumHasMood(a)?1:0;
  acc.energy+=albumHasEnergy(a)?1:0;
  acc.duration+=albumHasDuration(a)?1:0;
  return acc;
 },{genre:0,mood:0,energy:0,duration:0});
 featureCoverage={
  genre:counts.genre/n,
  mood:counts.mood/n,
  energy:counts.energy/n,
  duration:counts.duration/n
 };
 // P1 launch gates: a tag-only catalog must never masquerade as the full recommender.
 rankingFeaturesAvailable=
  featureCoverage.genre>=0.85 &&
  featureCoverage.mood>=0.80 &&
  featureCoverage.energy>=0.75 &&
  featureCoverage.duration>=0.90;
 updateSignalNote();
}
function libraryStatus(){
 const total=(catalogTotal||albums.length).toLocaleString();
 if(rankingFeaturesAvailable)return `${total} records on the shelf.`;
 if(liveMetadataRankingAvailable)return `${total} records on the shelf.`;
 return `${total} records in the room.`;
}

function mergeAlbumRecord(existing,incoming){
 if(!existing||!incoming)return existing;
 const fillArray=name=>{
  if((!Array.isArray(existing[name])||!existing[name].length)&&Array.isArray(incoming[name])&&incoming[name].length)existing[name]=incoming[name];
 };
 if(!existing.year&&incoming.year)existing.year=incoming.year;
 fillArray('genres');fillArray('tags');fillArray('moods');
 if(existing.energy_level===null||existing.energy_level===undefined)existing.energy_level=incoming.energy_level;
 if(existing.length_min===null||existing.length_min===undefined)existing.length_min=incoming.length_min;
 if(!existing.lookup_id&&incoming.lookup_id)existing.lookup_id=incoming.lookup_id;
 existing.features={...(incoming.features||{}),...(existing.features||{})};
 existing.provenance={...(incoming.provenance||{}),...(existing.provenance||{})};
 existing.metadata={...(incoming.metadata||{}),...(existing.metadata||{})};
 if(incoming._enriched_from&&!existing._enriched_from)existing._enriched_from=incoming._enriched_from;
 return existing;
}
function mergeAlbums(items){
 const byKey=new Map(albums.map(a=>[key(a),a]));
 for(const a of items||[]){
  if(!a?.title||!a?.artist)continue;
  const k=key(a),existing=byKey.get(k);
  if(existing){mergeAlbumRecord(existing,a);continue}
  byKey.set(k,a);albums.push(a);
 }
 refreshFeatureCoverage();
}
let catalogLookupPromise=null;
async function getCatalogLookupIndex(){
 if(!catalogManifest?.lookup_index)return null;
 if(catalogLookupPromise)return catalogLookupPromise;
 catalogLookupPromise=fetch('./data/catalog/'+catalogManifest.lookup_index,{cache:'force-cache'})
  .then(r=>{if(!r.ok)throw Error('lookup HTTP '+r.status);return r.json()})
  .catch(e=>{catalogLookupPromise=null;console.info('Catalog lookup unavailable',e);return null});
 return catalogLookupPromise;
}
async function resolveSemanticResults(results,maxNewShards=6){
 if(!results?.length)return [];
 const byId=new Map(albums.map(a=>[lookupId(a),a]));
 const missing=results.filter(row=>!byId.has(row.id));
 if(missing.length&&catalogManifest){
  const index=await getCatalogLookupIndex();
  if(index){
   const files=[];
   for(const row of missing){
    const file=index[row.id];
    if(file&&!files.includes(file)){
     files.push(file);
     if(files.length>=maxNewShards)break;
    }
   }
   await Promise.all(files.map(loadSpecificShard));
  }
 }
 const refreshed=new Map(albums.map(a=>[lookupId(a),a]));
 return results.map(row=>({album:refreshed.get(row.id),semanticScore:row.score})).filter(row=>row.album);
}
async function loadSpecificShard(file){
 if(!catalogManifest||!file||loadedShardFiles.has(file))return;
 try{
  const r=await fetch('./data/catalog/'+file,{cache:'force-cache'});
  if(!r.ok)throw Error('HTTP '+r.status);
  const data=await r.json();loadedShardFiles.add(file);
  mergeAlbums(Array.isArray(data)?data:data.albums||[]);
 }catch(e){console.warn('Could not load requested catalog shard',file,e)}
}
async function loadMoreShards(count=6){
 if(!catalogManifest)return;
 const seed=`${getDate()}|${getUserSalt()}|catalog-shards`;
 const remaining=catalogManifest.shards
  .filter(s=>!loadedShardFiles.has(s.file))
  .slice()
  .sort((a,b)=>seededUnit(seed+'|'+b.file)-seededUnit(seed+'|'+a.file));
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
  return value&&value.date===getDate()&&value.album&&value.engineVersion===ENGINE_VERSION?value:null;
 }catch{return null}
}
function saveDailyPick(album,featuresUsed,rankingMode){
 try{localStorage.setItem('albumaday.dailyPick',JSON.stringify({date:getDate(),album,featuresUsed:Boolean(featuresUsed),rankingMode:rankingMode||'draw',engineVersion:ENGINE_VERSION}))}catch(e){console.warn('Could not save daily pick',e)}
}
async function restoreSharedPick(){
 const wanted=new URLSearchParams(location.search).get('a');
 if(!wanted)return false;
 let found=albums.find(a=>lookupId(a)===wanted);
 if(!found&&catalogManifest?.lookup_index){
  try{
   const index=await getCatalogLookupIndex();
   const shard=index?.[wanted];
   if(shard){await loadSpecificShard(shard);found=albums.find(a=>lookupId(a)===wanted)}
  }catch(e){console.info('Shared-pick lookup unavailable',e)}
 }
 if(!found){
  showToast('That shared record is not in the loaded catalog.');
  return false;
 }
 pick=found;
 show(pick,{mode:'shared',featuresUsed:false,rankingMode:'shared'});
 $('reroll').hidden=false;
 return true;
}
function restoreDailyPick(){
 const daily=readDailyPick();
 if(!daily)return false;
 pick=daily.album;
 show(pick,{mode:'daily',featuresUsed:Boolean(daily.featuresUsed),rankingMode:daily.rankingMode||'draw',restored:true});
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
   // The original editorial catalog is always active. Once the global build
   // exists, prefer its MusicBrainz-enriched base over legacy albums.json.
   try{
    const basePath=catalogManifest.base_file?'./data/catalog/'+catalogManifest.base_file:'./data/albums.json';
    const baseResponse=await fetch(basePath,{cache:'force-cache'});
    if(baseResponse.ok){
     const base=await baseResponse.json();
     mergeAlbums(Array.isArray(base)?base:base.albums||[]);
    }
   }catch(e){console.info('Editorial base could not be preloaded',e)}
   await loadMoreShards(6);
   if(!albums.length)throw Error('Catalog manifest exists but no albums loaded');
   refreshFeatureCoverage();
   $('status').textContent=libraryStatus();
   if(!(await restoreSharedPick()))restoreDailyPick();
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
  if(!(await restoreSharedPick()))restoreDailyPick();
 }catch(e){
  $('status').textContent='Could not load the music library.';
  console.error(e);
 }
}
load();

function score(a,intent){
 let weighted=0,totalWeight=0;
 const confidence=(name,fallback=.7)=>{
  const value=Number(a.provenance?.[name]?.confidence);
  return Number.isFinite(value)?Math.max(.1,Math.min(1,value)):fallback;
 };
 const moodVector=a.features?.moods&&Object.keys(a.features.moods).length
  ? a.features.moods
  : Object.fromEntries((a.moods||[]).map(m=>[String(m).toLowerCase(),1]));
 const requested={...Object.fromEntries(state.moods.map(m=>[m,1])),...intent.moods};
 for(const [m,w] of Object.entries(requested)){
  if(moodVector[m]===undefined)continue;
  const ww=2.6*confidence('moods',.65)*Math.max(1,Number(w)||1);
  weighted+=ww*Number(moodVector[m]);totalWeight+=ww;
 }
 for(const [m,w] of Object.entries(intent.avoidMoods||{})){
  if(moodVector[m]===undefined)continue;
  const ww=2.8*confidence('moods',.65)*Math.max(1,Number(w)||1);
  weighted+=ww*(1-Number(moodVector[m]));totalWeight+=ww;
 }

 const albumGenres=[...(a.genres||[]),...(a.tags||[])].map(x=>String(typeof x==='string'?x:x?.name||'').toLowerCase());
 for(const g of intent.genres||[]){
  const ww=1.8*confidence('genres',.65);
  weighted+=ww*(albumGenres.some(x=>x.includes(g)||g.includes(x))?1:.15);totalWeight+=ww;
 }
 for(const g of intent.avoidGenres||[]){
  const ww=2*confidence('genres',.65);
  weighted+=ww*(albumGenres.some(x=>x.includes(g)||g.includes(x))?0:1);totalWeight+=ww;
 }

 const rawEnergy=a.features?.energy!==null&&a.features?.energy!==undefined
  ? Number(a.features.energy)*10
  : Number(a.energy_level);
 const targetEnergy=state.energy!==null?Number(state.energy):intent.energy;
 if(targetEnergy!==null&&targetEnergy!==undefined&&Number.isFinite(rawEnergy)){
  const ww=1.8*confidence('energy',.75);
  weighted+=ww*Math.max(0,1-Math.abs(rawEnergy-targetEnergy)/10);totalWeight+=ww;
 }

 const rawDuration=a.features?.duration_min??a.length_min;
 if(state.time!==null&&Number.isFinite(Number(rawDuration))){
  const runtime=Number(rawDuration),limit=Number(state.time);
  const ww=1.8*confidence('duration_min',.9);
  weighted+=ww*(runtime<=limit?1:Math.max(0,1-(runtime-limit)/30));totalWeight+=ww;
 }

 const familiarity=artistFamiliarity(a.artist);
 if(state.comfort==='comfort'){
  const ww=.75;weighted+=ww*(.2+.8*familiarity);totalWeight+=ww;
 }
 if(state.comfort==='exploration'||intent.exploration>0){
  const ww=.75;weighted+=ww*(1-.95*familiarity);totalWeight+=ww;
 }

 return totalWeight?weighted/totalWeight:.5;
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
function hasRecommendationIntent(){
 return Boolean(
  $('feelingInput')?.value.trim() ||
  state.moods.length ||
  state.energy!==null ||
  state.comfort!==null ||
  state.time!==null ||
  logs.filter(x=>Number(x.rating)>0&&x.signal_snapshot).length>=8
 );
}
async function chooseDaily(options={}){
 const surprise=Boolean(options.surprise);
 if(!albums.length){$('status').textContent='Still loading albums. Check your connection if this persists.';return}
 setPickBusy(true);
 try{
  const existing=readDailyPick();
  if(existing){
   pick=existing.album;
   show(pick,{mode:'daily',featuresUsed:Boolean(existing.featuresUsed),rankingMode:existing.rankingMode||'draw',restored:true});
   $('reroll').hidden=false;
   markTodayPicked();
   return;
  }
  const pool=await eligiblePool();
  if(!pool.length){$('status').textContent='Every available album has already been recommended.';return}
  const seed=`${getDate()}|${getUserSalt()}`;
  let result;
  if(surprise||!hasRecommendationIntent()){
   const suffix=surprise?'surprise':'clean-draw';
   const candidates=sampleCandidates(pool,seed+'|'+suffix,Math.min(250,pool.length),true);
   const album=candidates[Math.floor(seededUnit(seed+'|'+suffix+'-final')*candidates.length)]||pool[0];
   result={album,featuresUsed:false,mode:surprise?'surprise':'draw'};
  }else{
   const hasNote=Boolean($('feelingInput')?.value.trim());
   result=hasNote?await rankWithSemantic(seed,true):null;
   if(!result){
    result=rankingFeaturesAvailable
     ? rankFromStoredFeatures(pool,seed,true)
     : await rankWithLiveMetadata(pool,seed,true);
   }
  }
  pick=result.album;
  seenAlbums.add(hash32(key(pick)));persistSeen();
  saveDailyPick(pick,result.featuresUsed,result.mode);
  markTodayPicked();
  show(pick,{mode:'daily',featuresUsed:result.featuresUsed,rankingMode:result.mode});
  $('reroll').hidden=false;
 }finally{setPickBusy(false)}
}
async function chooseAnother(){
 if(!albums.length)return;
 setPickBusy(true);
 try{
  const pool=await eligiblePool();
  if(!pool.length){$('status').textContent='Every available album has already been recommended.';return}
  const seed=`bonus|${Date.now()}|${Math.random()}`;
  let result;
  if(!hasRecommendationIntent()){
   const candidates=sampleCandidates(pool,seed,Math.min(250,pool.length),false);
   result={album:candidates[Math.floor(Math.random()*candidates.length)]||pool[0],featuresUsed:false,mode:'draw'};
  }else{
   const hasNote=Boolean($('feelingInput')?.value.trim());
   result=hasNote?await rankWithSemantic(seed,false):null;
   if(!result){
    result=rankingFeaturesAvailable
     ? rankFromStoredFeatures(pool,seed,false)
     : await rankWithLiveMetadata(pool,seed,false);
   }
  }
  pick=result.album;
  seenAlbums.add(hash32(key(pick)));persistSeen();
  show(pick,{mode:'bonus',featuresUsed:result.featuresUsed,rankingMode:result.mode});
 }finally{setPickBusy(false)}
}
function rankFromStoredFeatures(pool,seed,daily){
 const intent=interpretFeeling($('feelingInput')?.value||'');
 const candidates=sampleCandidates(pool,seed,Math.min(1800,pool.length),daily)
  .map(a=>({a,v:score(a,intent)}))
  .sort((x,y)=>y.v-x.v);
 const top=candidates.slice(0,Math.min(200,candidates.length));
 if(!top.length)return {album:pool[0],featuresUsed:false,mode:'draw'};
 // Relevance-biased sampling keeps repeated prompts from collapsing to one argmax.
 const weights=top.map((row,i)=>Math.max(.02,(row.v+.08)*(1-i/(top.length*1.25))));
 const total=weights.reduce((n,v)=>n+v,0);
 let needle=(daily?seededUnit(seed+'|stored-final'):Math.random())*total;
 let chosen=top[0];
 for(let i=0;i<top.length;i++){needle-=weights[i];if(needle<=0){chosen=top[i];break}}
 return {album:chosen.a,featuresUsed:true,mode:'stored'};
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
$('recommend').addEventListener('click',()=>chooseDaily());
$('surpriseMe')?.addEventListener('click',()=>chooseDaily({surprise:true}));
$('reroll').addEventListener('click',chooseAnother);


const genreSignalRules=[
 {re:/metal|hard rock/i,energy:8.6,moods:{dark:.9,intense:.95,gritty:.85,energetic:.7}},
 {re:/punk|hardcore/i,energy:8.4,moods:{gritty:.95,intense:.85,energetic:.85,alienated:.55}},
 {re:/hip-hop|hip hop|rap/i,energy:7.2,moods:{gritty:.65,intense:.6,energetic:.72,reflective:.45}},
 {re:/electronic|dance|house|techno|trance/i,energy:7.8,moods:{energetic:.9,dreamy:.48,cold:.45,intense:.5}},
 {re:/ambient|new age/i,energy:2.4,moods:{dreamy:.95,reflective:.78,cold:.5,warm:.32}},
 {re:/alternative|indie|rock/i,energy:6.2,moods:{gritty:.55,intense:.5,reflective:.48,energetic:.55,alienated:.4}},
 {re:/r&b|soul/i,energy:5.2,moods:{warm:.85,reflective:.65,melancholic:.45,hopeful:.42}},
 {re:/singer\/songwriter|folk/i,energy:3.8,moods:{reflective:.9,warm:.62,melancholic:.58,nostalgic:.52}},
 {re:/jazz/i,energy:4.5,moods:{reflective:.78,warm:.58,dreamy:.48,intense:.28}},
 {re:/classical/i,energy:3.8,moods:{reflective:.86,dreamy:.62,cold:.38,intense:.35}},
 {re:/country|americana/i,energy:4.6,moods:{warm:.62,nostalgic:.7,reflective:.58,melancholic:.38}},
 {re:/reggae|ska/i,energy:5.8,moods:{warm:.78,hopeful:.72,energetic:.55}},
 {re:/latin|brazilian|samba|bossa|mpb/i,energy:5.7,moods:{warm:.74,reflective:.5,hopeful:.55,nostalgic:.38}},
 {re:/pop/i,energy:6.4,moods:{warm:.55,hopeful:.58,energetic:.72,dreamy:.28}},
 {re:/soundtrack|score/i,energy:4.3,moods:{dreamy:.68,reflective:.7,intense:.4}},
];
function genreSignals(genre){
 const out={moods:{},energy:null,confidence:.42};
 for(const rule of genreSignalRules){
  if(!rule.re.test(String(genre||'')))continue;
  out.energy=rule.energy;
  for(const [m,v] of Object.entries(rule.moods))out.moods[m]=Math.max(out.moods[m]||0,v);
  break;
 }
 return out;
}
function sampleCandidates(pool,seed,count,daily){
 if(pool.length<=count)return pool.slice();
 if(daily)return pool.slice().sort((a,b)=>seededUnit(seed+'|'+key(b))-seededUnit(seed+'|'+key(a))).slice(0,count);
 const copy=pool.slice();
 for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]]}
 return copy.slice(0,count);
}
async function mapConcurrent(items,limit,fn){
 const results=new Array(items.length);let next=0;
 async function worker(){while(next<items.length){const i=next++;results[i]=await fn(items[i],i)}}
 await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
 return results;
}
function diaryArtistSet(){
 if(diaryArtistCache)return diaryArtistCache;
 diaryArtistCache=new Set(logs.map(x=>String(x.artist||'').toLowerCase()));
 return diaryArtistCache;
}
function lastfmFamiliarity(artist){
 return Number(lastfmTasteMap.get(String(artist||'').trim().toLowerCase())||0);
}
function artistFamiliarity(artist){
 return Math.max(diaryArtistSet().has(String(artist||'').toLowerCase())?1:0,lastfmFamiliarity(artist));
}
function diaryTasteProfile(){
 if(diaryTasteCache)return diaryTasteCache;
 const rated=logs.filter(x=>Number(x.rating)>0&&x.signal_snapshot);
 const profile={count:rated.length,moods:{},genres:{},energySum:0,energyWeight:0};
 for(const entry of rated){
  const preference=(Number(entry.rating)-3)/2;
  const snap=entry.signal_snapshot||{};
  for(const [m,v] of Object.entries(snap.moods||{}))profile.moods[m]=(profile.moods[m]||0)+preference*Number(v||0);
  if(snap.genre)profile.genres[String(snap.genre).toLowerCase()]=(profile.genres[String(snap.genre).toLowerCase()]||0)+preference;
  if(snap.energy!==null&&snap.energy!==undefined&&preference>0){profile.energySum+=Number(snap.energy)*preference;profile.energyWeight+=preference}
 }
 diaryTasteCache=profile;
 return profile;
}
function candidateSignalBundle(candidate){
 if(candidate._live?.matched){
  return {
   moods:candidate._live.signals?.moods||{},
   energy:candidate._live.signals?.energy??null,
   genre:String(candidate._live.genre||'').toLowerCase()
  };
 }
 const moods=candidate.features?.moods&&Object.keys(candidate.features.moods).length
  ? candidate.features.moods
  : Object.fromEntries((candidate.moods||[]).map(m=>[String(m).toLowerCase(),1]));
 const energy=candidate.features?.energy!==null&&candidate.features?.energy!==undefined
  ? Number(candidate.features.energy)*10
  : candidate.energy_level;
 const firstGenre=(candidate.genres||[])[0];
 return {
  moods,
  energy:energy===null||energy===undefined?null:Number(energy),
  genre:String(typeof firstGenre==='string'?firstGenre:firstGenre?.name||'').toLowerCase()
 };
}
function diaryTasteScore(candidate){
 const profile=diaryTasteProfile();
 if(profile.count<8)return {active:false,score:.5,count:profile.count};
 const sig=candidateSignalBundle(candidate);
 let total=0,weight=0;
 for(const [m,v] of Object.entries(sig.moods||{})){
  const pref=profile.moods[m];
  if(pref===undefined)continue;
  const normalized=.5+.5*Math.tanh(pref/3);
  const strength=Math.max(.15,Number(v||0));
  total+=normalized*strength;weight+=strength;
 }
 if(sig.genre&&profile.genres[sig.genre]!==undefined){
  total+=(.5+.5*Math.tanh(profile.genres[sig.genre]/2))*1.2;weight+=1.2;
 }
 if(sig.energy!==null&&Number.isFinite(Number(sig.energy))&&profile.energyWeight>0){
  const preferred=profile.energySum/profile.energyWeight;
  total+=Math.max(0,1-Math.abs(Number(sig.energy)-preferred)/10)*.6;weight+=.6;
 }
 return {active:true,score:weight?total/weight:.5,count:profile.count};
}
function liveScore(candidate,intent){
 let weighted=0,weight=0;
 const signals=candidate._live?.signals||{moods:{},energy:null,confidence:.35};
 const confidence=signals.confidence||.35;
 const requested={...Object.fromEntries(state.moods.map(m=>[m,1])),...intent.moods};
 for(const [m,w] of Object.entries(requested)){
  if(signals.moods[m]===undefined)continue;
  const ww=2.4*confidence*Math.max(1,Number(w)||1);
  weighted+=ww*signals.moods[m];weight+=ww;
 }
 for(const [m,w] of Object.entries(intent.avoidMoods||{})){
  if(signals.moods[m]===undefined)continue;
  const ww=2.7*confidence*Math.max(1,Number(w)||1);
  weighted+=ww*(1-signals.moods[m]);weight+=ww;
 }
 const genre=String(candidate._live?.genre||'').toLowerCase();
 for(const wanted of intent.genres||[]){
  const ww=1.6;weighted+=ww*(genre.includes(wanted)||wanted.includes(genre)?1:.15);weight+=ww;
 }
 for(const avoided of intent.avoidGenres||[]){
  const ww=1.8;weighted+=ww*(genre.includes(avoided)||avoided.includes(genre)?0:1);weight+=ww;
 }
 const targetEnergy=state.energy!==null?Number(state.energy):intent.energy;
 if(targetEnergy!==null&&targetEnergy!==undefined&&signals.energy!==null){
  const similarity=Math.max(0,1-Math.abs(Number(signals.energy)-Number(targetEnergy))/10);
  const ww=1.8*confidence;weighted+=ww*similarity;weight+=ww;
 }
 const familiarity=artistFamiliarity(candidate.artist);
 if(state.comfort==='comfort'){const ww=.8;weighted+=ww*(.2+.8*familiarity);weight+=ww}
 if(state.comfort==='exploration'||intent.exploration>0){const ww=.8;weighted+=ww*(1-.95*familiarity);weight+=ww}
 if(intent.moods.nostalgic&&candidate._live?.year){
  const y=Number(candidate._live.year),age=Math.max(0,new Date().getFullYear()-y);
  const ww=.35;weighted+=ww*Math.min(1,age/35);weight+=ww;
 }
 if(candidate._live?.runtimeMin&&state.time!==null){
  const runtime=Number(candidate._live.runtimeMin),limit=Number(state.time);
  const fit=runtime<=limit?1:Math.max(0,1-(runtime-limit)/30);
  const ww=1.6;weighted+=ww*fit;weight+=ww;
 }
 const personal=diaryTasteScore(candidate);
 if(personal.active){const ww=.75;weighted+=ww*personal.score;weight+=ww}
 return weight?weighted/weight:0.5;
}
async function getAlbumTracks(album){
 if(!album?.collectionId)return [];
 if(tracklistCache.has(album.collectionId))return await tracklistCache.get(album.collectionId);
 const promise=fetch(`https://itunes.apple.com/lookup?id=${album.collectionId}&entity=song&limit=200`)
  .then(r=>{if(!r.ok)throw Error('Tracklist lookup unavailable');return r.json()})
  .then(data=>(data.results||[]).filter(x=>x.wrapperType==='track'&&x.kind==='song'&&Number(x.collectionId)===Number(album.collectionId)))
  .catch(()=>[]);
 tracklistCache.set(album.collectionId,promise);return await promise;
}
async function rankWithSemantic(seed,daily){
 const note=$('feelingInput')?.value.trim()||'';
 if(note.length<2||!globalThis.AlbumSemantic?.search||!catalogManifest)return null;
 $('status').textContent='looking through the shelves…';
 let raw;
 try{raw=await globalThis.AlbumSemantic.search(note,120)}
 catch(e){console.info('Semantic index unavailable; using live fallback.',e);return null}
 if(!raw.length)return null;

 const resolved=await resolveSemanticResults(raw,6);
 const logged=new Set(logs.map(l=>`${String(l.artist).toLowerCase()}::${String(l.album).toLowerCase()}`));
 const intent=interpretFeeling(note);
 let ranked=resolved
  .filter(row=>!seenAlbums.has(hash32(key(row.album)))&&!logged.has(key(row.album)))
  .map(row=>{
   const semantic=Math.max(0,Math.min(1,(Number(row.semanticScore)+1)/2));
   const controls=score(row.album,intent);
   const personal=diaryTasteScore(row.album);
   let relevance=.74*semantic+.18*controls;
   if(personal.active)relevance+=.08*personal.score;
   return {...row,v:relevance,semantic};
  })
  .sort((a,b)=>b.v-a.v);
 if(!ranked.length)return null;

 if(state.time!==null){
  const finalists=ranked.slice(0,3);
  await mapConcurrent(finalists,2,async row=>{
   const meta=await findItunesAlbum(row.album);
   if(!meta?.collectionId)return;
   const tracks=await getAlbumTracks(meta);
   const ms=tracks.reduce((n,t)=>n+(Number(t.trackTimeMillis)||0),0);
   if(!ms)return;
   const runtime=ms/60000,limit=Number(state.time);
   const fit=runtime<=limit?1:Math.max(0,1-(runtime-limit)/30);
   row.album._semantic={...(row.album._semantic||{}),runtimeMin:runtime};
   row.v=.88*row.v+.12*fit;
  });
  ranked.sort((a,b)=>b.v-a.v);
 }

 const top=ranked.slice(0,Math.min(50,ranked.length));
 const weights=top.map((row,i)=>Math.max(.01,(row.v+.04)*(1-i/(top.length*1.35))));
 const total=weights.reduce((n,v)=>n+v,0);
 let needle=(daily?seededUnit(seed+'|semantic-final'):Math.random())*total;
 let chosen=top[0];
 for(let i=0;i<top.length;i++){needle-=weights[i];if(needle<=0){chosen=top[i];break}}
 chosen.album._semantic={...(chosen.album._semantic||{}),score:chosen.semantic,method:'tfidf-svd-64'};
 return {album:chosen.album,featuresUsed:true,mode:'semantic'};
}

async function rankWithLiveMetadata(pool,seed,daily){
 const intent=interpretFeeling($('feelingInput')?.value||'');
 const sample=sampleCandidates(pool,seed,12,daily);
 $('status').textContent='checking the shelves…';
 const enriched=(await mapConcurrent(sample,4,async a=>{
  const meta=await findItunesAlbum(a);
  if(!meta)return {...a,_live:{matched:false}};
  const signals=genreSignals(meta.primaryGenreName);
  return {...a,year:(meta.releaseDate||'').slice(0,4)||a.year,_live:{matched:true,genre:meta.primaryGenreName||'',year:(meta.releaseDate||'').slice(0,4),signals,collectionId:meta.collectionId,trackCount:meta.trackCount}};
 })).filter(Boolean);
 let ranked=enriched.map(a=>({a,v:liveScore(a,intent)+(daily?seededUnit(seed+'|rank|'+key(a))*.12:Math.random()*.12)})).sort((x,y)=>y.v-x.v);
 if(state.time!==null){
  const finalists=ranked.slice(0,3);
  await mapConcurrent(finalists,2,async row=>{
   if(!row.a._live?.collectionId)return;
   const tracks=await getAlbumTracks({collectionId:row.a._live.collectionId});
   const ms=tracks.reduce((n,t)=>n+(Number(t.trackTimeMillis)||0),0);
   if(ms)row.a._live.runtimeMin=ms/60000;
   row.v=liveScore(row.a,intent)+(daily?seededUnit(seed+'|time|'+key(row.a))*.08:Math.random()*.08);
  });
  ranked=ranked.sort((x,y)=>y.v-x.v);
 }
 const viable=ranked.filter(x=>x.a._live?.matched);
 if(!viable.length){
  const fallback=sample[0]||pool[0];
  return {album:fallback,featuresUsed:false,mode:'draw'};
 }
 const top=viable.slice(0,Math.min(8,viable.length));
 const chosen=daily?top[Math.floor(seededUnit(seed+'|final')*top.length)]:top[Math.floor(Math.random()*top.length)];
 return {album:chosen.a,featuresUsed:true,mode:'live'};
}

const itunesAlbumCache=new Map();
const tracklistCache=new Map();
let recordFileRequest=0;
let activeTracklist=[];

function normalizeStoreText(value){
 return String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function formatRuntime(ms){
 const total=Math.max(0,Math.round(Number(ms||0)/1000));
 const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),sec=total%60;
 return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m}:${String(sec).padStart(2,'0')}`;
}
function catalogGenres(a){
 return (Array.isArray(a.genres)?a.genres:[])
  .map(g=>typeof g==='string'?g:g?.name)
  .filter(Boolean);
}
function internalCatalogNumber(a){
 return 'AAD-'+hash32(key(a)).toString(16).toUpperCase().padStart(8,'0');
}
function eraLabel(year){
 const y=Number.parseInt(year,10);
 if(!Number.isFinite(y))return 'UNFILED ERA';
 const decade=Math.floor(y/10)*10;
 return `${decade}s`;
}
function updateTrackOptions(tracks){
 activeTracklist=tracks||[];
 const list=$('trackOptions');if(!list)return;
 list.replaceChildren();
 for(const track of activeTracklist){
  const option=document.createElement('option');
  option.value=track.trackName||'';
  list.append(option);
 }
}
let musicBrainzLastRequest=0;
let musicBrainzChain=Promise.resolve();
const musicBrainzGroupCache=new Map();
const musicBrainzDetailCache=new Map();
const musicBrainzReleaseCache=new Map();
const acousticBrainzCache=new Map();
function musicBrainzJson(url){
 const job=musicBrainzChain.then(async()=>{
  const wait=Math.max(0,1100-(Date.now()-musicBrainzLastRequest));
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  const response=await fetch(url,{headers:{Accept:'application/json'}});
  musicBrainzLastRequest=Date.now();
  if(!response.ok)throw Error('MusicBrainz HTTP '+response.status);
  return response.json();
 });
 musicBrainzChain=job.catch(()=>{});
 return job;
}
async function findMusicBrainzGroup(a){
 const cacheKey=key(a);
 if(musicBrainzGroupCache.has(cacheKey))return musicBrainzGroupCache.get(cacheKey);
 const promise=(async()=>{
  const query=`artist:"${String(a.artist||'').replace(/"/g,'')}" AND releasegroup:"${String(a.title||'').replace(/"/g,'')}"`;
  const url='https://musicbrainz.org/ws/2/release-group/?query='+encodeURIComponent(query)+'&fmt=json&limit=8';
  const data=await musicBrainzJson(url);
  const artist=normalizeStoreText(a.artist),title=normalizeStoreText(a.title);
  const groups=data['release-groups']||[];
  const exact=groups.find(g=>normalizeStoreText(g.title)===title&&normalizeStoreText((g['artist-credit']||[]).map(c=>c.name||c.artist?.name||'').join(''))===artist);
  return exact||groups.find(g=>normalizeStoreText(g.title)===title)||null;
 })().catch(e=>{console.info('MusicBrainz cover lookup unavailable',a.artist,a.title,e);return null});
 musicBrainzGroupCache.set(cacheKey,promise);return promise;
}
async function getMusicBrainzGroupDetails(a){
 const known=String(a?.metadata?.musicbrainz_id||'').replace(/^mb:/,'');
 const group=known?{id:known}:await findMusicBrainzGroup(a);
 if(!group?.id)return null;
 if(musicBrainzDetailCache.has(group.id))return musicBrainzDetailCache.get(group.id);
 const promise=musicBrainzJson('https://musicbrainz.org/ws/2/release-group/'+group.id+'?inc=releases+genres+tags+url-rels&fmt=json')
  .catch(e=>{console.info('MusicBrainz detail lookup unavailable',e);return null});
 musicBrainzDetailCache.set(group.id,promise);
 return promise;
}
function releaseCandidates(details){
 const releases=(details?.releases||[]).filter(r=>r?.id);
 const official=releases.filter(r=>!r.status||String(r.status).toLowerCase()==='official');
 const pool=official.length?official:releases;
 return pool.slice().sort((a,b)=>{
  const ad=String(a.date||'9999-99-99'),bd=String(b.date||'9999-99-99');
  if(ad!==bd)return ad.localeCompare(bd);
  return String(a.country||'').localeCompare(String(b.country||''));
 });
}
function canonicalRelease(details){return releaseCandidates(details)[0]||null}
async function getReleaseWithRecordings(releaseId){
 if(!releaseId)return null;
 if(musicBrainzReleaseCache.has(releaseId))return musicBrainzReleaseCache.get(releaseId);
 const promise=musicBrainzJson('https://musicbrainz.org/ws/2/release/'+releaseId+'?inc=recordings+media&fmt=json')
  .catch(e=>{console.info('MusicBrainz recording lookup unavailable',e);return null});
 musicBrainzReleaseCache.set(releaseId,promise);return promise;
}
async function fetchAcousticHighLevel(mbid){
 if(acousticBrainzCache.has(mbid))return acousticBrainzCache.get(mbid);
 const promise=fetch('https://acousticbrainz.org/api/v1/'+mbid+'/high-level',{cache:'force-cache'})
  .then(r=>{if(!r.ok)throw Error('AcousticBrainz HTTP '+r.status);return r.json()})
  .catch(()=>null);
 acousticBrainzCache.set(mbid,promise);return promise;
}
function classifierProbability(highlevel,section,label){
 const value=Number(highlevel?.[section]?.all?.[label]);
 return Number.isFinite(value)?Math.max(0,Math.min(1,value)):null;
}
function aggregateAcoustic(rows){
 if(!rows.length)return null;
 const sums={sad:0,happy:0,aggressive:0,relaxed:0,party:0,danceable:0,dark:0,electronic:0};
 const counts=Object.fromEntries(Object.keys(sums).map(k=>[k,0]));
 const mappings=[
  ['sad','mood_sad','sad'],['happy','mood_happy','happy'],
  ['aggressive','mood_aggressive','aggressive'],['relaxed','mood_relaxed','relaxed'],
  ['party','mood_party','party'],['danceable','danceability','danceable'],
  ['dark','timbre','dark'],['electronic','mood_electronic','electronic']
 ];
 for(const row of rows){
  const high=row?.highlevel||row;
  for(const [name,section,label] of mappings){
   const p=classifierProbability(high,section,label);
   if(p===null)continue;sums[name]+=p;counts[name]++;
  }
 }
 const avg=name=>counts[name]?sums[name]/counts[name]:null;
 const sad=avg('sad'),happy=avg('happy'),aggressive=avg('aggressive'),relaxed=avg('relaxed');
 const party=avg('party'),dance=avg('danceable'),dark=avg('dark'),electronic=avg('electronic');
 const values=arr=>arr.filter(v=>v!==null&&Number.isFinite(v));
 const mean=arr=>{const v=values(arr);return v.length?v.reduce((n,x)=>n+x,0)/v.length:null};
 const moods={};
 const put=(name,value)=>{if(value!==null&&Number.isFinite(value))moods[name]=Math.max(0,Math.min(1,value))};
 put('melancholic',sad);
 put('hopeful',happy);
 put('intense',mean([aggressive,relaxed===null?null:1-relaxed]));
 put('energetic',mean([dance,party,aggressive]));
 put('warm',mean([relaxed,happy]));
 put('dreamy',relaxed===null?null:relaxed*(aggressive===null?1:1-aggressive*.55));
 put('dark',dark);
 put('gritty',aggressive);
 put('reflective',mean([sad,relaxed]));
 put('cold',mean([dark,electronic]));
 const energyParts=[
  [dance,.4],[aggressive,.25],[party,.2],[relaxed===null?null:1-relaxed,.15]
 ].filter(([v])=>v!==null&&Number.isFinite(v));
 const energy=energyParts.length
  ?10*energyParts.reduce((n,[v,w])=>n+v*w,0)/energyParts.reduce((n,[,w])=>n+w,0)
  :null;
 return {moods,energy,tracksAnalyzed:rows.length,confidence:Math.min(.9,.52+rows.length*.04)};
}
async function loadSelectedAcousticProfile(a,details){
 const release=canonicalRelease(details);if(!release?.id)return null;
 const full=await getReleaseWithRecordings(release.id);if(!full||!pick||key(pick)!==key(a))return null;
 const recordingIds=[];
 for(const medium of full.media||[]){
  for(const track of medium.tracks||[]){
   const id=track?.recording?.id;if(id&&!recordingIds.includes(id))recordingIds.push(id);
  }
 }
 if(!recordingIds.length)return null;
 // Bound network work: sample up to 8 evenly spread recordings from the album.
 const take=Math.min(8,recordingIds.length),sample=[];
 for(let i=0;i<take;i++)sample.push(recordingIds[Math.floor(i*(recordingIds.length-1)/Math.max(1,take-1))]);
 const rows=(await mapConcurrent([...new Set(sample)],4,fetchAcousticHighLevel)).filter(Boolean);
 if(!rows.length||!pick||key(pick)!==key(a))return null;
 const profile=aggregateAcoustic(rows);if(!profile)return null;
 a._acoustic=profile;
 a.features={...(a.features||{}),moods:{...(a.features?.moods||{}),...profile.moods},energy:profile.energy===null?a.features?.energy:profile.energy/10};
 a.provenance={...(a.provenance||{}),
  moods:{source:'acousticbrainz-selected-sample',confidence:profile.confidence},
  energy:{source:'acousticbrainz-selected-sample',confidence:profile.confidence}
 };
 const classification=$('classification');
 if(classification){
  const top=Object.entries(profile.moods).sort((x,y)=>y[1]-x[1]).filter(([,v])=>v>=.55).slice(0,2);
  for(const [m,v] of top){
   const tag=document.createElement('span');tag.className='audio-class';tag.textContent=m.toUpperCase();classification.append(tag);
  }
 }
 const facts=$('recordFacts');
 if(facts){
  const group=document.createElement('div');group.className='record-fact acoustic-fact';
  const dt=document.createElement('dt');dt.textContent='Audio sample';
  const dd=document.createElement('dd');dd.textContent=`${profile.tracksAnalyzed} track${profile.tracksAnalyzed===1?'':'s'} / AB`;
  group.append(dt,dd);facts.append(group);
 }
 return profile;
}

async function enhanceSelectedMetadata(a){
 const details=await getMusicBrainzGroupDetails(a);
 if(!details||!pick||key(pick)!==key(a))return;
 const genres=(details.genres||[]).slice().sort((x,y)=>(y.count||0)-(x.count||0)).map(x=>x.name).filter(Boolean);
 const tags=(details.tags||[]).slice().sort((x,y)=>(y.count||0)-(x.count||0)).map(x=>x.name).filter(Boolean);
 if(!Array.isArray(a.genres)||!a.genres.length)a.genres=genres.slice(0,6);
 if(!Array.isArray(a.tags)||!a.tags.length)a.tags=tags.slice(0,10);
 a.metadata={...(a.metadata||{}),musicbrainz_id:details.id,cover_art:'https://coverartarchive.org/release-group/'+details.id+'/front-500'};
 const spotify=(details.relations||[]).map(r=>r?.url?.resource).find(u=>typeof u==='string'&&/open\.spotify\.com\/album\//i.test(u));
 if(spotify){
  const src=Array.isArray(a.metadata.sources)?a.metadata.sources.slice():a.metadata.sources?[a.metadata.sources]:[];
  if(!src.includes(spotify))src.push(spotify);
  a.metadata.sources=src;
  if($('spotify'))$('spotify').href=spotify;
 }
 const box=$('classification');
 if(box&&genres.length){
  const existing=new Set([...box.querySelectorAll('span')].map(n=>n.textContent.toLowerCase()));
  for(const genre of genres.slice(0,5)){
   if(existing.has(genre.toLowerCase()))continue;
   const tag=document.createElement('span');tag.textContent=genre.toUpperCase();box.append(tag);existing.add(genre.toLowerCase());
   if(box.children.length>=5)break;
  }
 }
 loadSelectedAcousticProfile(a,details);
}
async function findItunesAlbum(a){
 const cacheKey=key(a);
 if(itunesAlbumCache.has(cacheKey))return itunesAlbumCache.get(cacheKey);
 const promise=(async()=>{
  const q=encodeURIComponent(`${a.artist} ${a.title}`);
  const response=await fetch(`https://itunes.apple.com/search?term=${q}&media=music&entity=album&limit=20`);
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
 const panel=$('recordFile'),trackPanel=$('tracklistPanel');
 if(panel)panel.hidden=false;
 if(trackPanel)trackPanel.hidden=false;
 $('metadataSource').textContent='catalogue';
 $('catalogNumber').textContent=internalCatalogNumber(a);
 $('eraStamp').textContent=eraLabel(a.year);
 $('classification').replaceChildren();
 const immediate=catalogGenres(a).slice(0,4);
 for(const genre of immediate){
  const tag=document.createElement('span');tag.textContent=String(genre).toUpperCase();$('classification').append(tag);
 }
 const facts=$('recordFacts');facts.replaceChildren();
 if(a.year){
  const group=document.createElement('div');group.className='record-fact';
  const dt=document.createElement('dt');dt.textContent='Released';
  const dd=document.createElement('dd');dd.textContent=a.year;group.append(dt,dd);facts.append(group);
 }
 $('tracklist').replaceChildren();
 $('trackCountLabel').textContent='—';
 $('tracklistStatus').hidden=false;
 $('tracklistStatus').textContent='pulling the tracklist…';
 updateTrackOptions([]);
}
function musicBrainzTracks(release){
 const media=Array.isArray(release?.media)?release.media:[];
 const discCount=media.length||1,tracks=[];
 media.forEach((medium,mi)=>{
  const discNumber=Number(medium.position)||mi+1;
  for(const [ti,track] of (medium.tracks||[]).entries()){
   tracks.push({
    discNumber,
    discCount,
    trackNumber:Number(track.position)||ti+1,
    trackName:track.title||track.recording?.title||'Untitled',
    trackTimeMillis:Number(track.length)||Number(track.recording?.length)||0,
    recordingId:track.recording?.id||''
   });
  }
 });
 return tracks;
}
function renderRecordFacts(a,album,tracks,sourceLabel='catalogue'){
 const panel=$('recordFile'),trackPanel=$('tracklistPanel');
 if(panel)panel.hidden=false;
 if(trackPanel)trackPanel.hidden=false;
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
  const group=document.createElement('div');group.className='record-fact';
  const dt=document.createElement('dt');dt.textContent=label;
  const dd=document.createElement('dd');dd.textContent=value;
  group.append(dt,dd);facts.append(group);
 };
 const releaseYear=(album?.releaseDate||album?.date||'').slice(0,4)||a.year||'';
 $('catalogNumber').textContent=internalCatalogNumber(a);
 $('eraStamp').textContent=eraLabel(releaseYear);
 const runtime=tracks.reduce((sum,t)=>sum+(Number(t.trackTimeMillis)||0),0);
 addFact('Released',releaseYear);
 addFact('Tracks',tracks.length||album?.trackCount||'');
 addFact('Runtime',runtime?formatRuntime(runtime):a.length_min?`${Math.round(Number(a.length_min))} min`:'');
 if(album?.collectionExplicitness==='explicit')addFact('Advisory','Explicit');

 const list=$('tracklist');list.replaceChildren();
 $('trackCountLabel').textContent=tracks.length?`${tracks.length} TRACK${tracks.length===1?'':'S'}`:'UNAVAILABLE';
 if(!tracks.length){
  updateTrackOptions([]);
  $('tracklistStatus').hidden=false;
  $('tracklistStatus').textContent='no verified tracklist found for this edition.';
  return;
 }
 $('tracklistStatus').hidden=true;
 updateTrackOptions(tracks);
 let lastDisc=null;
 tracks
  .slice()
  .sort((x,y)=>(x.discNumber||1)-(y.discNumber||1)||(x.trackNumber||0)-(y.trackNumber||0))
  .forEach(track=>{
   if((track.discCount||1)>1&&track.discNumber!==lastDisc){
    lastDisc=track.discNumber;
    const disc=document.createElement('li');disc.className='track-disc';
    disc.textContent=`disc ${track.discNumber}`;list.append(disc);
   }
   const li=document.createElement('li');
   const num=document.createElement('span');num.className='track-no';
   num.textContent=String(track.trackNumber||'').padStart(2,'0');
   const name=document.createElement('span');name.className='track-name';name.textContent=track.trackName||'Untitled';
   const time=document.createElement('span');time.className='track-time';time.textContent=track.trackTimeMillis?formatRuntime(track.trackTimeMillis):'';
   li.append(num,name,time);list.append(li);
  });
}
async function loadRecordFile(a){
 const request=++recordFileRequest;
 resetRecordFile(a);
 const cacheKey=key(a);
 const cacheId='albumaday.record.v3.'+hash32(cacheKey);
 try{
  let cached=null;
  try{cached=JSON.parse(sessionStorage.getItem(cacheId)||'null')}catch{}
  if(cached?.tracks?.length){
   if(request===recordFileRequest&&pick&&key(pick)===cacheKey)renderRecordFacts(a,cached.album,cached.tracks,cached.source||'catalogue');
   return;
  }

  // MusicBrainz is the primary tracklist source because it exposes every medium
  // and every track on the canonical release, rather than a storefront subset.
  const details=await getMusicBrainzGroupDetails(a);
  if(request!==recordFileRequest||!pick||key(pick)!==cacheKey)return;
  if(details){
   let best=null;
   for(const release of releaseCandidates(details).slice(0,4)){
    const full=await getReleaseWithRecordings(release.id);
    if(request!==recordFileRequest||!pick||key(pick)!==cacheKey)return;
    const tracks=musicBrainzTracks(full);
    if(!tracks.length)continue;
    const expected=(full?.media||[]).reduce((n,m)=>n+(Number(m['track-count'])||0),0);
    const candidate={release,full,tracks,complete:!expected||tracks.length>=expected};
    if(!best||candidate.tracks.length>best.tracks.length)best=candidate;
    if(candidate.complete){best=candidate;break}
   }
   if(best){
    const album={
     date:best.full?.date||best.release.date||details['first-release-date']||a.year||'',
     trackCount:best.tracks.length
    };
    const cache={album,tracks:best.tracks,source:'MusicBrainz'};
    try{sessionStorage.setItem(cacheId,JSON.stringify(cache))}catch{}
    renderRecordFacts(a,album,best.tracks,'MusicBrainz');
    return;
   }
  }

  // Store lookup remains a fallback for albums without a usable MusicBrainz release.
  const album=await findItunesAlbum(a);
  if(request!==recordFileRequest||!pick||key(pick)!==cacheKey)return;
  if(!album?.collectionId){
   renderRecordFacts(a,null,[],'catalogue');
   return;
  }
  const tracks=await getAlbumTracks(album);
  if(request!==recordFileRequest||!pick||key(pick)!==cacheKey)return;
  const cache={album,tracks,source:'store'};
  try{sessionStorage.setItem(cacheId,JSON.stringify(cache))}catch{}
  renderRecordFacts(a,album,tracks,'store');
 }catch(e){
  console.info('Record file unavailable',e);
  if(request===recordFileRequest)renderRecordFacts(a,null,[],'catalogue');
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
 const tag=document.createElement('div');tag.className='eyebrow';
 const modeLabels={
  shared:'SHARED RECORD',
  semantic:context.mode==='bonus'?'ANOTHER RECORD':'TODAY\'S RECORD',
  live:context.mode==='bonus'?'ANOTHER RECORD':'TODAY\'S RECORD',
  stored:context.mode==='bonus'?'ANOTHER RECORD':'TODAY\'S RECORD',
  surprise:'TODAY\'S RECORD',
  draw:context.mode==='bonus'?'ANOTHER RECORD':'TODAY\'S RECORD'
 };
 tag.textContent=context.mode==='shared'?modeLabels.shared:(modeLabels[context.rankingMode]||(context.mode==='bonus'?'ANOTHER RECORD':'TODAY\'S RECORD'));
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
 $('status').textContent=context.mode==='bonus'?`${unseen} still unheard.`:context.mode==='shared'?'shared record.':`${unseen} still unheard.`;
 loadArtwork(a,cover);
 loadRecordFile(a);
 enhanceSelectedMetadata(a);
}
function labelColor(a){
 const palette=['#c8432f','#2e5f76','#d5ad36','#65714b','#9a593f','#d9d0bc'];
 let n=0;for(const c of key(a))n=(n*31+c.charCodeAt(0))>>>0;
 return palette[n%palette.length];
}

function drawer(open){
 const panel=$('drawer'),toggle=$('historyToggle');
 panel.classList.toggle('open',open);
 panel.setAttribute('aria-hidden',String(!open));
 toggle?.setAttribute('aria-expanded',String(open));
 $('overlay').hidden=!open;
 document.body.classList.toggle('drawer-open',open);
 if(open)requestAnimationFrame(()=>panel.focus({preventScroll:true}));
 else toggle?.focus({preventScroll:true});
}
$('historyToggle').onclick=()=>drawer(true);
$('openDiaryFromShelf')?.addEventListener('click',()=>drawer(true));
$('closeDrawer').onclick=()=>drawer(false);
$('overlay').onclick=()=>drawer(false);
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&$('drawer')?.classList.contains('open')&&!$('logDialog')?.open)drawer(false);
});

function removeDiaryEntry(index){
 const entry=logs[index];if(!entry)return;
 if(!confirm(`Remove "${entry.album}" by ${entry.artist} from your diary?`))return;
 logs.splice(index,1);persist();showToast('Diary entry removed.');
}
function editDiaryEntry(index){
 const entry=logs[index];if(!entry)return;
 editingLogIndex=index;
 rating=Number(entry.rating)||0;
 $('track').value=entry.favorite_track||'';
 $('notes').value=entry.notes||'';
 $('track').placeholder='Favorite track';
 $('logAlbum').textContent=`${entry.artist} — ${entry.album}`;
 stars();
 $('logDialog').showModal();
}
$('log').onclick=()=>{
 if(!pick)return;
 editingLogIndex=null;
 rating=0;$('track').value='';$('notes').value='';
 $('track').placeholder=activeTracklist.length?'Choose from the tracklist or type your own':'The one you replayed';
 $('logAlbum').textContent=`${pick.artist} — ${pick.title}`;
 stars();$('logDialog').showModal();
};
$('closeDialog').onclick=()=>{editingLogIndex=null;$('logDialog').close()};
function stars(){
 const area=$('stars');area.replaceChildren();
 for(let i=1;i<=5;i++){
  const b=document.createElement('button');b.type='button';b.className='star'+(i<=rating?' active':'');b.textContent='★';
  b.setAttribute('aria-label',`${i} stars`);b.setAttribute('role','radio');b.setAttribute('aria-checked',String(i===rating));
  b.tabIndex=(rating===i||(rating===0&&i===1))?0:-1;
  b.onclick=()=>{rating=i;stars();area.querySelector('[aria-checked="true"]')?.focus()};
  area.append(b);
 }
 area.onkeydown=e=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
  e.preventDefault();
  const delta=(e.key==='ArrowRight'||e.key==='ArrowUp')?1:-1;
  rating=Math.max(1,Math.min(5,(rating||1)+delta));stars();area.querySelector('[aria-checked="true"]')?.focus();
 };
}
$('logForm').onsubmit=e=>{
 e.preventDefault();
 if(editingLogIndex!==null){
  const current=logs[editingLogIndex];if(!current)return;
  logs[editingLogIndex]={...current,rating,favorite_track:$('track').value.trim(),notes:$('notes').value.trim()};
  editingLogIndex=null;
  persist();$('logDialog').close();showToast('Diary entry updated.');return;
 }
 if(!pick)return;
 const live=pick._live||{};
 const staticMoods=Array.isArray(pick.moods)?Object.fromEntries(pick.moods.map(m=>[m,1])):{};
 logs.push({
  date:getDate(),artist:pick.artist,album:pick.title,rating,
  favorite_track:$('track').value.trim(),notes:$('notes').value.trim(),
  cover_art:pick.metadata?.cover_art||'',
  genre:live.genre||(Array.isArray(pick.genres)?(typeof pick.genres[0]==='string'?pick.genres[0]:pick.genres[0]?.name):'')||'',
  signal_snapshot:{
   genre:live.genre||'',
   moods:pick._acoustic?.moods||live.signals?.moods||pick.features?.moods||staticMoods,
   energy:pick._acoustic?.energy??live.signals?.energy??(pick.features?.energy!=null?Number(pick.features.energy)*10:null)??pick.energy_level??null
  }
 });
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
 const apply=url=>{
  if(request!==artworkRequest||!pick||key(pick)!==key(a))return;
  img.onerror=()=>{img.onerror=null;img.src=fallback};
  img.src=url;
 };
 const preferred=a.metadata?.cover_art;
 if(preferred&&/^https?:\/\//.test(preferred)){apply(preferred);return}
 try{
  const group=await findMusicBrainzGroup(a);
  if(group?.id)apply('https://coverartarchive.org/release-group/'+group.id+'/front-500');
  else apply(fallback);
 }catch{apply(fallback)}
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
 const lines=wrap(a.title,17);
 const title=lines.map((v,i)=>'<text x="48" y="'+(300+i*58)+'" font-size="50">'+safe(v)+'</text>').join('');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720"><rect width="720" height="720" fill="#ece3d4"/><rect x="34" y="34" width="652" height="652" fill="none" stroke="#171411" stroke-width="3"/><rect x="48" y="54" width="116" height="16" fill="#b9412f"/><g fill="#171411" font-family="Georgia, serif"><text x="48" y="118" font-family="Courier New, monospace" font-size="15" letter-spacing="3">AN ALBUM A DAY</text>'+title+'<text x="48" y="622" font-family="Courier New, monospace" font-size="17" letter-spacing="1">'+safe(a.artist).slice(0,44)+'</text><text x="48" y="662" font-family="Courier New, monospace" font-size="12" letter-spacing="2">MISSING SLEEVE / CATALOG COPY</text></g></svg>';
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
function explainPick(a,context={}){
 if(context.rankingMode==='shared')return 'someone sent you this one.';
 if(context.rankingMode==='surprise')return 'no clues. just a straight pull from the shelf.';
 if(context.rankingMode==='semantic'){
  const note=$('feelingInput')?.value.trim()||'';
  const intent=interpretFeeling(note);
  const bits=[];
  const cues=[
   ...Object.keys(intent.moods||{}).slice(0,2),
   ...(intent.genres||[]).slice(0,1)
  ];
  if(cues.length)bits.push(`your note leaned ${cues.join(' / ')}.`);
  else bits.push('your note pointed here.');
  if(state.time!==null&&a._semantic?.runtimeMin)bits.push(`it runs about ${Math.round(a._semantic.runtimeMin)} minutes.`);
  const personal=diaryTasteScore(a);
  if(personal.active)bits.push('your diary nudged it a little closer.');
  return bits.join(' ');
 }
 if(context.rankingMode==='live'&&a._live?.matched){
  const bits=[];
  const genre=a._live.genre;
  if(genre)bits.push(`filed near ${genre.toLowerCase()}.`);
  const intent=interpretFeeling($('feelingInput')?.value||'');
  const requested=[...state.moods,...Object.keys(intent.moods||{})];
  const overlaps=[...new Set(requested.filter(m=>a._live.signals?.moods?.[m]!==undefined))];
  if(overlaps.length)bits.push(`it sits close to ${overlaps.slice(0,2).join(' / ')}.`);
  if(state.time!==null&&a._live.runtimeMin)bits.push(`about ${Math.round(a._live.runtimeMin)} minutes.`);
  const personal=diaryTasteScore(a);
  if(personal.active)bits.push('your diary had a small say.');
  return bits.join(' ')||'this one came up closest to what you asked for.';
 }
 if(!context.featuresUsed){
  return context.mode==='bonus'?'another pull from the shelf.':'a straight pull from the shelf.';
 }
 const am=(a.moods||[]).map(x=>String(x).toLowerCase());
 const intent=interpretFeeling($('feelingInput')?.value||'');
 const matches=[...new Set([
  ...state.moods.filter(m=>am.includes(m)),
  ...Object.keys(intent.moods||{}).filter(m=>am.includes(m))
 ])].slice(0,2);
 const notes=[];
 if(matches.length)notes.push(`it matches ${matches.join(' / ')}.`);
 if(state.time!==null&&Number.isFinite(Number(a.length_min))&&Number(a.length_min)<=state.time)notes.push('it fits the time you gave me.');
 if(!notes.length)notes.push('this one came up closest to what you asked for.');
 return notes.join(' ');
}
const interpretFeeling=globalThis.AlbumIntent?.interpretFeeling||(()=>({moods:{},avoidMoods:{},genres:[],avoidGenres:[],energy:null,exploration:0,summary:''}));
if($('todayDate')){
 const d=new Date();
 $('todayDate').textContent=d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
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
  if(feelingInput.value.trim())$('feelingInsight').textContent=p.summary?'heard: '+p.summary:'got it.';
  else $('feelingInsight').textContent='your note stays here';
  savePickerState();
 });
 feelingInput.dispatchEvent(new Event('input'));
 $('clearFeeling').addEventListener('click',()=>{feelingInput.value='';feelingInput.dispatchEvent(new Event('input'));feelingInput.focus()});
 feelingInput.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();chooseDaily()}});
}
$('resetPicker')?.addEventListener('click',resetPicker);

$('sharePick')?.addEventListener('click',async()=>{
 if(!pick)return;
 const url=new URL(location.origin+location.pathname);
 url.searchParams.set('a',lookupId(pick));
 const text=`Today's record: ${pick.title} — ${pick.artist} · An Album a Day`;
 try{
  if(navigator.share)await navigator.share({title:`${pick.title} — ${pick.artist}`,text,url:url.toString()});
  else{await navigator.clipboard.writeText(text+'\n'+url.toString());showToast('Record link copied to clipboard.')}
 }catch(e){if(e?.name!=='AbortError')showToast('Could not share this record.')}
});

function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){
   if(ch==='"'&&text[i+1]==='"'){field+='"';i++}
   else if(ch==='"')quoted=false;
   else field+=ch;
  }else{
   if(ch==='"')quoted=true;
   else if(ch===','){row.push(field);field=''}
   else if(ch==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field=''}
   else field+=ch;
  }
 }
 if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}
 return rows;
}
function buildLastfmTaste(rows){
 const counts=new Map();let total=0;
 for(const row of rows){
  const artist=String(row?.[0]||'').trim();
  if(!artist||/^(artist|artist name)$/i.test(artist))continue;
  const key=artist.toLowerCase();counts.set(key,(counts.get(key)||0)+1);total++;
 }
 if(!counts.size)throw Error('No artists found');
 const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]);
 const max=ranked[0][1];
 const artists=ranked.slice(0,10000).map(([artist,count])=>[artist,Number((Math.log1p(count)/Math.log1p(max)).toFixed(6))]);
 return {version:1,total_scrobbles:total,unique_artists:counts.size,artists,imported_at:new Date().toISOString()};
}
$('importLastfm')?.addEventListener('click',()=>$('lastfmFile')?.click());
$('lastfmFile')?.addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  showToast('Reading Last.fm history locally…');
  const taste=buildLastfmTaste(parseCsv(await file.text()));
  localStorage.setItem('albumaday.lastfmTaste',JSON.stringify(taste));
  lastfmTaste=taste;lastfmTasteMap=new Map(taste.artists);invalidateTasteCaches();renderHistory();
  showToast(`Last.fm taste prior ready: ${taste.unique_artists.toLocaleString()} artists. Raw CSV was not uploaded.`);
 }catch(err){console.warn(err);showToast('Could not read that Last.fm CSV.')}
 e.target.value='';
});
$('clearLastfm')?.addEventListener('click',()=>{
 try{localStorage.removeItem('albumaday.lastfmTaste')}catch{}
 lastfmTaste=null;lastfmTasteMap=new Map();invalidateTasteCaches();renderHistory();showToast('Last.fm taste prior cleared.');
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
