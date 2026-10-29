'use strict';

let albums=[],logs=[],pick=null,rating=0,catalogManifest=null,catalogTotal=0;
let rankingFeaturesAvailable=false;
let featureCoverage={genre:0,mood:0,energy:0,duration:0};
const liveMetadataRankingAvailable=true;
const ENGINE_VERSION='live-metadata-v1';
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
 if($('statListened'))$('statListened').textContent=logs.length;
 const rated=logs.filter(x=>Number(x.rating)>0);
 if($('statAverage'))$('statAverage').textContent=rated.length?(rated.reduce((n,x)=>n+Number(x.rating),0)/rated.length).toFixed(1)+'★':'—';
 const genreCounts={};
 for(const x of logs){if(x.genre)genreCounts[x.genre]=(genreCounts[x.genre]||0)+1}
 const topGenre=Object.entries(genreCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
 if($('statGenre'))$('statGenre').textContent=topGenre;
 if($('statTraining'))$('statTraining').textContent=logs.filter(x=>Number(x.rating)>0&&x.signal_snapshot).length;
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
  node.textContent='LIVE / FULL CATALOG: these controls steer the ranking using stored album features. Missing fields are treated as unknown, never as zero.';
 }else if(liveMetadataRankingAvailable){
  const pct=v=>Math.round((v||0)*100);
  node.textContent=`LIVE / FIELD DESK: these controls steer a candidate set using verified store genre, release and track data. Full P1 gates are not all met yet (genre ${pct(featureCoverage.genre)}% · mood ${pct(featureCoverage.mood)}% · energy ${pct(featureCoverage.energy)}% · duration ${pct(featureCoverage.duration)}%). After 8 rated records, your diary also nudges the ranking locally.`;
 }else{
  node.textContent='PREVIEW ONLY: recommendation metadata is unavailable, so these controls are disabled.';
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
 if(rankingFeaturesAvailable)return `${total} albums in the universe · full recommendation metadata is live ✳`;
 if(liveMetadataRankingAvailable)return `${total} albums in the universe · live genre-aware recommendation fallback is active ✳`;
 return `${total} albums in the universe · discovery draw mode ✳`;
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
   const indexResponse=await fetch('./data/catalog/'+catalogManifest.lookup_index,{cache:'force-cache'});
   if(indexResponse.ok){
    const index=await indexResponse.json();
    const shard=index[wanted];
    if(shard){await loadSpecificShard(shard);found=albums.find(a=>lookupId(a)===wanted)}
   }
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
   // The original editorial 10k is always active, even after the global 100k lands.
   try{
    const baseResponse=await fetch('./data/albums.json',{cache:'force-cache'});
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
 let s=0;
 const am=(a.moods||[]).map(x=>String(x).toLowerCase());
 for(const m of state.moods)if(am.includes(m))s+=4;
 for(const [m,w] of Object.entries(intent.moods))if(am.includes(m))s+=w*2.8;
 for(const [m,w] of Object.entries(intent.avoidMoods||{}))if(am.includes(m))s-=w*3.2;
 const albumGenres=[...(a.genres||[]),...(a.tags||[])].map(x=>String(typeof x==='string'?x:x?.name||'').toLowerCase());
 for(const g of intent.genres||[])if(albumGenres.some(x=>x.includes(g)||g.includes(x)))s+=3.2;
 for(const g of intent.avoidGenres||[])if(albumGenres.some(x=>x.includes(g)||g.includes(x)))s-=4;
 const en=a.energy_level==null?NaN:Number(a.energy_level);
 if(state.energy!==null&&Number.isFinite(en))s+=Math.max(0,5-Math.abs(en-state.energy));
 else if(intent.energy!==null&&Number.isFinite(en))s+=Math.max(0,4-Math.abs(en-intent.energy));
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
   result=rankingFeaturesAvailable
    ? rankFromStoredFeatures(pool,seed,true)
    : await rankWithLiveMetadata(pool,seed,true);
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
   result=rankingFeaturesAvailable
    ? rankFromStoredFeatures(pool,seed,false)
    : await rankWithLiveMetadata(pool,seed,false);
  }
  pick=result.album;
  seenAlbums.add(hash32(key(pick)));persistSeen();
  show(pick,{mode:'bonus',featuresUsed:result.featuresUsed,rankingMode:result.mode});
 }finally{setPickBusy(false)}
}
function rankFromStoredFeatures(pool,seed,daily){
 const intent=interpretFeeling($('feelingInput')?.value||'');
 const candidates=sampleCandidates(pool,seed,Math.min(250,pool.length),daily);
 let best=null,bestValue=-Infinity;
 for(const a of candidates){
  const value=score(a,intent)+(daily?seededUnit(seed+'|'+key(a))*.8:Math.random()*.8);
  if(value>bestValue){best=a;bestValue=value}
 }
 return {album:best||candidates[0],featuresUsed:true,mode:'stored'};
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
function diaryArtistSet(){return new Set(logs.map(x=>String(x.artist||'').toLowerCase()))}
function diaryTasteProfile(){
 const rated=logs.filter(x=>Number(x.rating)>0&&x.signal_snapshot);
 const profile={count:rated.length,moods:{},genres:{},energySum:0,energyWeight:0};
 for(const entry of rated){
  const preference=(Number(entry.rating)-3)/2;
  const snap=entry.signal_snapshot||{};
  for(const [m,v] of Object.entries(snap.moods||{}))profile.moods[m]=(profile.moods[m]||0)+preference*Number(v||0);
  if(snap.genre)profile.genres[String(snap.genre).toLowerCase()]=(profile.genres[String(snap.genre).toLowerCase()]||0)+preference;
  if(snap.energy!==null&&snap.energy!==undefined&&preference>0){profile.energySum+=Number(snap.energy)*preference;profile.energyWeight+=preference}
 }
 return profile;
}
function diaryTasteScore(candidate){
 const profile=diaryTasteProfile();
 if(profile.count<8)return {active:false,score:.5,count:profile.count};
 const sig=candidate._live?.signals||{};
 let total=0,weight=0;
 for(const [m,v] of Object.entries(sig.moods||{})){
  const pref=profile.moods[m];
  if(pref===undefined)continue;
  const normalized=.5+.5*Math.tanh(pref/3);
  total+=normalized*Number(v||0);weight+=Number(v||0);
 }
 const genre=String(candidate._live?.genre||'').toLowerCase();
 if(genre&&profile.genres[genre]!==undefined){
  total+=(.5+.5*Math.tanh(profile.genres[genre]/2))*1.2;weight+=1.2;
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
 const known=diaryArtistSet().has(String(candidate.artist||'').toLowerCase());
 if(state.comfort==='comfort'){const ww=.8;weighted+=ww*(known?1:.35);weight+=ww}
 if(state.comfort==='exploration'||intent.exploration>0){const ww=.8;weighted+=ww*(known?.05:1);weight+=ww}
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
async function rankWithLiveMetadata(pool,seed,daily){
 const intent=interpretFeeling($('feelingInput')?.value||'');
 const sample=sampleCandidates(pool,seed,12,daily);
 $('status').textContent='Reading the spines and checking the catalogue…';
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
 const group=await findMusicBrainzGroup(a);
 if(!group?.id)return null;
 if(musicBrainzDetailCache.has(group.id))return musicBrainzDetailCache.get(group.id);
 const promise=musicBrainzJson('https://musicbrainz.org/ws/2/release-group/'+group.id+'?inc=genres+tags+url-rels&fmt=json')
  .catch(e=>{console.info('MusicBrainz detail lookup unavailable',e);return null});
 musicBrainzDetailCache.set(group.id,promise);
 return promise;
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
 const source=$('metadataSource');
 if(source&&source.textContent.includes('ITUNES'))source.textContent='MUSICBRAINZ + ITUNES STORE';
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
 const panel=$('recordFile');if(!panel)return;
 panel.hidden=false;
 $('metadataSource').textContent='LOOKING IT UP…';
 $('catalogNumber').textContent=internalCatalogNumber(a);
 $('eraStamp').textContent=eraLabel(a.year);
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
 updateTrackOptions([]);
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
 $('catalogNumber').textContent=internalCatalogNumber(a);
 $('eraStamp').textContent=eraLabel(releaseYear);
 const runtime=tracks.reduce((sum,t)=>sum+(Number(t.trackTimeMillis)||0),0);
 addFact('Released',releaseYear);
 addFact('Tracks',tracks.length||album?.trackCount||'');
 addFact('Runtime',runtime?formatRuntime(runtime):a.length_min?`${Math.round(Number(a.length_min))} min`:'');
 addFact('Format','LP / album');
 if(album?.collectionExplicitness==='explicit')addFact('Advisory','Explicit');

 const list=$('tracklist');list.replaceChildren();
 $('trackCountLabel').textContent=tracks.length?`${tracks.length} TRACK${tracks.length===1?'':'S'}`:'UNAVAILABLE';
 if(!tracks.length){
  updateTrackOptions([]);
  $('tracklistStatus').hidden=false;
  $('tracklistStatus').textContent='No verified tracklist found for this edition.';
  return;
 }
 $('tracklistStatus').hidden=true;
 updateTrackOptions(tracks);
 tracks
  .slice()
  .sort((x,y)=>(x.discNumber||1)-(y.discNumber||1)||(x.trackNumber||0)-(y.trackNumber||0))
  .forEach(track=>{
   const li=document.createElement('li');
   const num=document.createElement('span');num.className='track-no';
   num.textContent=(track.discCount||1)>1?`${track.discNumber||1}.${String(track.trackNumber||0).padStart(2,'0')}`:String(track.trackNumber||'').padStart(2,'0');
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
   const promise=fetch(`https://itunes.apple.com/lookup?id=${album.collectionId}&entity=song&limit=200`)
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
 const tag=document.createElement('div');tag.className='eyebrow';tag.textContent=context.mode==='bonus'?'BONUS DRAW ✳':context.mode==='shared'?'SHARED FROM THE CRATE ✳':'TODAY’S RECORD ✳';
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
 $('status').textContent=context.mode==='bonus'?`${unseen} unseen albums remaining · bonus draw ✳`:context.mode==='shared'?'shared record loaded from the catalog ✳':`${unseen} unseen albums remaining · today’s record is locked to this date ✳`;
 loadArtwork(a,cover);
 loadRecordFile(a);
 enhanceSelectedMetadata(a);
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
 $('track').placeholder=activeTracklist.length?'Choose from the tracklist or type your own':'The one you replayed';
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
 const live=pick._live||{};
 const staticMoods=Array.isArray(pick.moods)?Object.fromEntries(pick.moods.map(m=>[m,1])):{};
 logs.push({
  date:getDate(),artist:pick.artist,album:pick.title,rating,
  favorite_track:$('track').value.trim(),notes:$('notes').value.trim(),
  cover_art:pick.metadata?.cover_art||'',
  genre:live.genre||(Array.isArray(pick.genres)?(typeof pick.genres[0]==='string'?pick.genres[0]:pick.genres[0]?.name):'')||'',
  signal_snapshot:{
   genre:live.genre||'',
   moods:live.signals?.moods||staticMoods,
   energy:live.signals?.energy??pick.energy_level??null
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
 const title=wrap(a.title,17).map((v,i)=>'<text x="52" y="'+(330+i*62)+'" font-size="52" font-weight="800">'+safe(v)+'</text>').join('');
 const coverColor=labelColor(a);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="'+coverColor+'"/><stop offset="1" stop-color="#171411"/></linearGradient></defs><rect width="720" height="720" fill="url(#g)"/><circle cx="640" cy="100" r="240" fill="none" stroke="#f3eadb" stroke-opacity=".16" stroke-width="1"/><circle cx="640" cy="100" r="180" fill="none" stroke="#f3eadb" stroke-opacity=".12"/><g fill="#f3eadb" font-family="Arial, sans-serif"><text x="52" y="95" font-size="21" letter-spacing="6">AN ALBUM A DAY / DISCOVERY</text>'+title+'<text x="52" y="635" font-size="27">'+safe(a.artist).slice(0,37)+'</text><text x="52" y="680" font-size="18" letter-spacing="4">✳ LISTEN CLOSELY</text></g></svg>';
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}

function explainPick(a,context={}){
 if(context.rankingMode==='shared')return 'Someone sent you this record from An Album a Day. The catalog metadata below is factual; no recommendation rationale is being invented for a shared link.';
 if(context.rankingMode==='surprise')return 'You asked for no clues, so this is a true date-seeded surprise from the unseen catalog. Your note and fine-tune controls were deliberately ignored.';
 if(context.rankingMode==='live'&&a._live?.matched){
  const bits=[];
  const genre=a._live.genre||'available store genre';
  bits.push(`This pick came from a live candidate set, using ${genre} as a low-confidence musical signal.`);
  const intent=interpretFeeling($('feelingInput')?.value||'');
  const requested=[...state.moods,...Object.keys(intent.moods)];
  const overlaps=[...new Set(requested.filter(m=>a._live.signals?.moods?.[m]!==undefined))];
  if(overlaps.length)bits.push(`Your request overlapped with the genre-derived ${overlaps.slice(0,2).join(' / ')} profile.`);
  if(state.energy!==null||intent.energy!==null)bits.push('Energy also contributed through the genre-derived fallback.');
  if(state.comfort)bits.push(state.comfort==='exploration'?'The ranking favored artists not already present in your diary.':'The ranking gave a small familiarity preference to artists already in your diary.');
  if(state.time!==null&&a._live.runtimeMin)bits.push(`The verified tracklist runtime is about ${Math.round(a._live.runtimeMin)} minutes and was used in the final rerank.`);
  const personal=diaryTasteScore(a);
  if(personal.active)bits.push(`Your ${personal.count} rated diary records also contributed a local taste nudge.`);
  bits.push('This is an honest fallback, not the finished acoustic/semantic P1 model.');
  return bits.join(' ');
 }
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
function termIsNegated(text,index){
 const prefix=text.slice(Math.max(0,index-48),index).replace(/[^a-z0-9' ]+/g,' ');
 return /\b(?:don't|dont|do not|not|without|avoid|avoiding|anything but|no)\b(?:\s+\w+){0,5}\s*$/.test(prefix);
}
const genreLexicon=[
 'alternative','indie','rock','pop','electronic','house','techno','ambient','jazz','classical','metal','punk',
 'hip hop','rap','r&b','soul','folk','country','reggae','ska','latin','bossa nova','samba','mpb','shoegaze',
 'dream pop','post-punk','post punk','goth','darkwave','experimental','psychedelic','soundtrack','afrobeat'
];
function interpretFeeling(text){
 const t=String(text||'').toLocaleLowerCase().replace(/[’‘]/g,"'").normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 const moods={},avoidMoods={};
 for(const [m,terms] of Object.entries(feelingLexicon)){
  let pos=0,neg=0;
  for(const raw of terms){
   const term=raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
   let from=0;
   while(true){
    const i=t.indexOf(term,from);if(i<0)break;
    if(termIsNegated(t,i))neg++;else pos++;
    from=i+Math.max(1,term.length);
   }
  }
  if(pos)moods[m]=Math.min(pos,3);
  if(neg)avoidMoods[m]=Math.min(neg,3);
 }
 // Longing for a person is usually more intimate than generic nostalgia.
 if(/\bmiss(?:ing)?\b/.test(t)&&/\b(girlfriend|boyfriend|partner|wife|husband|her|him|them|someone|amor|namorada|namorado)\b/.test(t)){
  moods.nostalgic=Math.max(moods.nostalgic||0,1);
  moods.warm=Math.max(moods.warm||0,1);
  if(!avoidMoods.melancholic)moods.melancholic=Math.max(moods.melancholic||0,1);
 }
 const genres=[],avoidGenres=[];
 for(const g of genreLexicon){
  let from=0,positive=false,negative=false;
  while(true){
   const i=t.indexOf(g,from);if(i<0)break;
   if(termIsNegated(t,i))negative=true;else positive=true;
   from=i+g.length;
  }
  if(positive)genres.push(g);
  if(negative)avoidGenres.push(g);
 }
 const ranked=Object.entries(moods).sort((a,b)=>b[1]-a[1]);
 const avoided=Object.entries(avoidMoods).sort((a,b)=>b[1]-a[1]);
 const energy=/dance|party|run|scream|rage|festa|dancar|gritar|alive|full blast/.test(t)?8:/quiet|slow|soft|gentle|sleep|calm|silencio|devagar/.test(t)?3:null;
 const exploration=/weird|strange|left turn|surprise|unexpected|obscure|unknown|new to me|experimental|esquisit|diferente/.test(t)?1:0;
 const parts=[];
 if(ranked.length)parts.push(ranked.slice(0,2).map(([m])=>m).join(' + '));
 if(genres.length)parts.push(genres.slice(0,2).join(' / '));
 if(avoided.length)parts.push('not '+avoided.slice(0,2).map(([m])=>m).join(' / '));
 return {moods,avoidMoods,genres,avoidGenres,energy,exploration,summary:parts.join(' · ')};
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
  if(feelingInput.value.trim())$('feelingInsight').textContent=p.summary?'✳ reading: '+p.summary:'✳ note received — no obvious labels, which is allowed';
  else $('feelingInsight').textContent='✳ your words, your soundtrack';
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
