'use strict';

let albums=[],logs=[],pick=null,rating=0,editingLogIndex=null,catalogManifest=null,catalogTotal=0;
let rankingFeaturesAvailable=false;
let featureCoverage={genre:0,mood:0,energy:0,duration:0};
const liveMetadataRankingAvailable=true;
const ENGINE_VERSION='hybrid-backend-v1';
const loadedShardFiles=new Set();
const state={moods:[],energy:null,comfort:null,time:null};
let nextPickCorrection=null;
const $=id=>document.getElementById(id);

function mergeUnique(values){
 return [...new Set((values||[]).filter(Boolean))];
}
function correctedIntent(base){
 const intent={
  ...(base||{}),
  moods:{...((base&&base.moods)||{})},
  avoidMoods:{...((base&&base.avoidMoods)||{})},
  genres:[...((base&&base.genres)||[])],
  avoidGenres:[...((base&&base.avoidGenres)||[])]
 };
 const correction=nextPickCorrection;
 if(!correction)return intent;
 for(const [name,value] of Object.entries(correction.avoidMoods||{})){
  intent.avoidMoods[name]=Math.max(Number(intent.avoidMoods[name])||0,Number(value)||1);
 }
 intent.avoidGenres=mergeUnique([...intent.avoidGenres,...(correction.avoidGenres||[])]);
 if(correction.forceExplore)intent.exploration=Math.max(Number(intent.exploration)||0,1);
 return intent;
}
function recommendationEnergy(intent){
 let value=state.energy!==null?Number(state.energy):Number(intent?.energy);
 if(!Number.isFinite(value))value=null;
 const delta=Number(nextPickCorrection?.energyDelta)||0;
 if(delta){
  if(value===null)value=5;
  value=Math.max(1,Math.min(10,value+delta));
 }
 return value;
}
function recommendationComfort(){
 return nextPickCorrection?.forceExplore?'exploration':state.comfort;
}
function clearNextPickCorrection(){nextPickCorrection=null}

let toastTimer=null;
function showToast(message){
 const node=$('toast');if(!node)return;
 clearTimeout(toastTimer);
 node.textContent=String(message||'');
 node.hidden=!message;
 if(message){
  toastTimer=setTimeout(()=>{
   node.hidden=true;
   node.textContent='';
  },2600);
 }
}
const moods=[
 ['anxious','anxious'],
 ['angry','angry'],
 ['bittersweet','bittersweet'],
 ['brooding','brooding'],
 ['cathartic','cathartic'],
 ['chaotic','chaotic'],
 ['cold','cold'],
 ['curious','curious'],
 ['dark','dark'],
 ['defiant','defiant'],
 ['detached','detached'],
 ['dreamy','dreamy'],
 ['euphoric','euphoric'],
 ['energetic','energetic'],
 ['fragile','fragile'],
 ['gritty','gritty'],
 ['heartbroken','heartbroken'],
 ['homesick','homesick'],
 ['hopeful','hopeful'],
 ['intense','intense'],
 ['lonely','lonely'],
 ['melancholic','melancholic'],
 ['nostalgic','nostalgic'],
 ['numb','numb'],
 ['playful','playful'],
 ['raw','raw'],
 ['reflective','reflective'],
 ['restless','restless'],
 ['romantic','romantic'],
 ['serene','serene'],
 ['sensual','sensual'],
 ['soft','soft'],
 ['tender','tender'],
 ['triumphant','triumphant'],
 ['vulnerable','vulnerable'],
 ['warm','warm'],
 ['yearning','yearning']
];

const MOOD_SIGNAL_MAP={
 anxious:{intense:1,cold:.55,alienated:.35},
 angry:{intense:1,gritty:.85,dark:.45},
 bittersweet:{melancholic:.9,nostalgic:.8,warm:.45},
 brooding:{dark:.95,reflective:.75,intense:.35},
 cathartic:{intense:.85,melancholic:.55,hopeful:.5},
 chaotic:{intense:1,energetic:.9,gritty:.55},
 cold:{cold:1},
 curious:{reflective:.65,hopeful:.5,dreamy:.25},
 dark:{dark:1},
 defiant:{intense:.8,gritty:.8,hopeful:.45},
 detached:{cold:.9,alienated:.9,reflective:.25},
 dreamy:{dreamy:1},
 euphoric:{energetic:1,hopeful:1,warm:.4},
 energetic:{energetic:1},
 fragile:{melancholic:.75,reflective:.8,warm:.35},
 gritty:{gritty:1},
 heartbroken:{melancholic:1,reflective:.75,alienated:.4},
 homesick:{nostalgic:1,melancholic:.8,warm:.5},
 hopeful:{hopeful:1},
 intense:{intense:1},
 lonely:{alienated:1,melancholic:.9,reflective:.4},
 melancholic:{melancholic:1},
 nostalgic:{nostalgic:1},
 numb:{cold:.9,alienated:.8,dark:.35},
 playful:{energetic:.8,hopeful:.8,warm:.45},
 raw:{gritty:.85,intense:.65,reflective:.35},
 reflective:{reflective:1},
 restless:{energetic:.8,intense:.65,alienated:.35},
 romantic:{warm:.85,dreamy:.7,hopeful:.45},
 serene:{warm:.7,dreamy:.65,reflective:.75},
 sensual:{warm:.8,dreamy:.55,intense:.3},
 soft:{warm:.8,dreamy:.6,reflective:.35},
 tender:{warm:1,reflective:.65,melancholic:.25},
 triumphant:{hopeful:1,energetic:.85,intense:.45},
 vulnerable:{melancholic:.65,reflective:.9,warm:.35},
 warm:{warm:1},
 yearning:{melancholic:.75,hopeful:.45,reflective:.8}
};
function selectedMoodSignals(){
 const out={};
 for(const mood of state.moods){
  const vector=MOOD_SIGNAL_MAP[mood]||{[mood]:1};
  for(const [name,value] of Object.entries(vector))out[name]=Math.max(out[name]||0,Number(value)||0);
 }
 return out;
}
const groups=[
 ['moods',moods],
 ['energy',[['low',2],['medium',5],['high',9]]],
 ['comfort',[['familiar','comfort'],['something new','exploration']]],
 ['time',[['up to 30 min',30],['up to 45 min',45],['up to 60 min',60]]]
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
   if(id==='moods'){
    state.moods=state.moods.includes(value)?state.moods.filter(x=>x!==value):[...state.moods,value];
   }else{
    state[id]=state[id]===value?null:value;
   }
   renderPickerControls();
   invalidateDailyPick();
   savePickerState();
  });
  parent.append(b);
 });
}

const PICKER_STORAGE_KEY='albumaday.picker.v2';
const SEEN_KEYS_STORAGE_KEY='albumaday.seenKeys.v1';
let recommendationRequest=0;

function pickerSnapshot(){
 return {
  note:$('feelingInput')?.value||'',
  moods:[...state.moods].sort(),
  energy:state.energy,
  comfort:state.comfort,
  time:state.time
 };
}
function criteriaSignature(){return JSON.stringify(pickerSnapshot())}
function pickerSelectionCount(){
 return state.moods.length+[state.energy,state.comfort,state.time].filter(v=>v!==null).length;
}
function updatePickerStateUI(){
 const count=pickerSelectionCount();
 const summary=$('filterSummary');
 if(summary)summary.textContent=count?(count+' selected'):'none selected';
 const hasText=Boolean($('feelingInput')?.value.trim());
 const reset=$('resetPicker');
 if(reset)reset.disabled=!(count||hasText);
 const clearText=$('clearFeeling');
 if(clearText)clearText.disabled=!hasText;
}
function renderPickerControls(){
 for(const [id] of groups){
  const parent=$(id);if(!parent)continue;
  parent.querySelectorAll('button').forEach(button=>{
   const active=id==='moods'?state.moods.includes(button._value):state[id]===button._value;
   button.classList.toggle('selected',active);
   button.setAttribute('aria-pressed',String(active));
  });
 }
 updatePickerStateUI();
}
function savePickerState(){
 try{localStorage.setItem(PICKER_STORAGE_KEY,JSON.stringify(pickerSnapshot()))}catch{}
}
function restorePickerState(){
 try{
  const saved=JSON.parse(localStorage.getItem(PICKER_STORAGE_KEY)||'null');
  if(!saved)return;
  state.moods=Array.isArray(saved.moods)?saved.moods:[];
  state.energy=saved.energy??null;
  state.comfort=saved.comfort??null;
  state.time=saved.time??null;
  const field=$('feelingInput');
  if(field&&typeof saved.note==='string')field.value=saved.note;
  renderPickerControls();
 }catch{}
}
function invalidateDailyPick(){
 recommendationRequest++;
 try{localStorage.removeItem('albumaday.dailyPick')}catch{}
}
function resetPicker(){
 state.moods=[];
 state.energy=null;
 state.comfort=null;
 state.time=null;
 const field=$('feelingInput');
 if(field){
  field.value='';
  field.dispatchEvent(new Event('input',{bubbles:true}));
 }
 renderPickerControls();
 invalidateDailyPick();
 try{
  localStorage.removeItem(PICKER_STORAGE_KEY);
  localStorage.removeItem('albumaday.picker');
  localStorage.removeItem('albumaday.dailyPick');
 }catch{}
 const url=new URL(location.href);
 if(url.searchParams.has('a')){
  url.searchParams.delete('a');
  history.replaceState({},'',url.pathname+url.search+url.hash);
 }
 const fine=$('fineTune');if(fine)fine.open=true;
 const insight=$('feelingInsight');if(insight)insight.textContent='';
 const status=$('status');if(status)status.textContent='ready for a new pick.';
 updatePickerStateUI();
 showToast('Cleared.');
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
function normalizeSeenKey(value){
 return String(value||'')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g,' ')
  .trim();
}
function seenKey(a){return normalizeSeenKey(a?.artist)+'::'+normalizeSeenKey(a?.title)}
function readSeenKeys(){
 try{
  const raw=JSON.parse(localStorage.getItem(SEEN_KEYS_STORAGE_KEY)||'[]');
  return new Set(Array.isArray(raw)?raw.map(String):[]);
 }catch{return new Set()}
}
const RECENT_RECOMMENDED_ARTISTS_KEY='albumaday.recentRecommendedArtists.v1';
function readRecentRecommendedArtists(){
 try{
  const raw=JSON.parse(localStorage.getItem(RECENT_RECOMMENDED_ARTISTS_KEY)||'[]');
  return Array.isArray(raw)?raw.map(normalizeArtistName).filter(Boolean).slice(-18):[];
 }catch{return []}
}
let seenAlbums=readSeen();
let seenAlbumKeys=readSeenKeys();
let recentRecommendedArtists=[];
function albumWasSeen(a){
 const k=key(a);
 return seenAlbumKeys.has(seenKey(a))||seenAlbums.has(hash32(k));
}
function persistSeen(){
 try{
  localStorage.setItem('albumaday.seen',JSON.stringify([...seenAlbums]));
  localStorage.setItem(SEEN_KEYS_STORAGE_KEY,JSON.stringify([...seenAlbumKeys]));
 }catch(e){showToast('Could not save seen-history on this browser.');console.warn('Seen history storage unavailable',e)}
}
function markAlbumSeen(a){
 if(!a)return;
 seenAlbums.add(hash32(key(a)));
 seenAlbumKeys.add(seenKey(a));
 rememberRecommendedArtist(a.artist);
 persistSeen();
}
function readLogs(){try{return JSON.parse(localStorage.getItem('albumaday.logs')||'[]')}catch{return []}}
function readLastfmTaste(){try{return JSON.parse(localStorage.getItem('albumaday.lastfmTaste')||'null')}catch{return null}}
function normalizeArtistName(value){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ')}
recentRecommendedArtists=readRecentRecommendedArtists();
function rememberRecommendedArtist(artist){
 const name=normalizeArtistName(artist);
 if(!name)return;
 recentRecommendedArtists=recentRecommendedArtists.filter(value=>value!==name);
 recentRecommendedArtists.push(name);
 recentRecommendedArtists=recentRecommendedArtists.slice(-18);
 try{localStorage.setItem(RECENT_RECOMMENDED_ARTISTS_KEY,JSON.stringify(recentRecommendedArtists))}catch{}
}
function recentArtistPenalty(artist){
 const name=normalizeArtistName(artist);
 if(!name)return 0;
 const reverse=[...recentRecommendedArtists].reverse();
 const index=reverse.indexOf(name);
 if(index<0)return 0;
 return Math.max(.18,.9-index*.08);
}
function buildLastfmTasteMap(taste){
 return new Map((taste?.artists||[]).map(([artist,weight])=>[normalizeArtistName(artist),Number(weight)||0]));
}
function buildLastfmNeighborMap(taste){
 return new Map((taste?.neighbors||[]).map(([artist,weight])=>[normalizeArtistName(artist),Number(weight)||0]));
}
logs=readLogs();
let lastfmTaste=readLastfmTaste();
let lastfmTasteMap=buildLastfmTasteMap(lastfmTaste);
let lastfmNeighborMap=buildLastfmNeighborMap(lastfmTaste);
let diaryArtistCache=null,diaryTasteCache=null,tasteTagContextCache=null;
function invalidateTasteCaches(){diaryArtistCache=null;diaryTasteCache=null;tasteTagContextCache=null}
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
  const p=document.createElement('p');p.className='recent-empty';p.textContent='Nothing saved yet. Albums you save will show up here.';area.append(p);return;
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
function renderTastePrint(){
 const box=$('tastePrint'),tagNode=$('tastePrintTags'),neighborNode=$('tastePrintNeighbors');
 if(!box||!tagNode||!neighborNode)return;
 const hasTaste=lastfmTasteMap.size>0||logs.some(entry=>Number(entry.rating)>3);
 if(!hasTaste){box.hidden=true;return}

 const noise=/^(seen live|favorites?|favourites?|albums i own|spotify|last\.fm|male vocalists?|female vocalists?)$/i;
 let tags=[];
 if(albums.length){
  const ctx=tasteTagContext();
  tags=[...ctx.weights.entries()]
   .filter(([name,weight])=>weight>0&&!noise.test(name))
   .sort((a,b)=>b[1]-a[1])
   .slice(0,6)
   .map(([name])=>name);
 }

 const neighbors=(lastfmTaste?.neighbors||[])
  .filter(([,weight])=>Number(weight)>0)
  .slice()
  .sort((a,b)=>Number(b[1])-Number(a[1]))
  .slice(0,5)
  .map(([name])=>String(name));

 tagNode.textContent=tags.length?tags.join(' / '):'building from your rated records';
 neighborNode.textContent=neighbors.length
  ? neighbors.join(' / ')
  : (lastfmTaste?'optional — deepen the Last.fm graph':'add Last.fm for behavioral neighbors');
 box.hidden=false;
}
function renderHistory(){
 $('count').textContent=logs.length;
 renderTastePrint();
 renderStreak();
 if($('statListened'))$('statListened').textContent=logs.length;
 const rated=logs.filter(x=>Number(x.rating)>0);
 if($('statAverage'))$('statAverage').textContent=rated.length?(rated.reduce((n,x)=>n+Number(x.rating),0)/rated.length).toFixed(1)+'★':'—';
 const genreCounts={};
 for(const x of logs){if(x.genre)genreCounts[x.genre]=(genreCounts[x.genre]||0)+1}
 const topGenre=Object.entries(genreCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—';
 if($('statGenre'))$('statGenre').textContent=topGenre;
 if($('statTraining'))$('statTraining').textContent=logs.filter(x=>Number(x.rating)>0&&x.signal_snapshot).length;
 if($('trainFromDiary'))$('trainFromDiary').disabled=!logs.some(x=>Number(x.rating)>0);
 if($('statLastfm'))$('statLastfm').textContent=lastfmTaste?.unique_artists?Number(lastfmTaste.unique_artists).toLocaleString():'—';
 if($('deepenLastfm')){
  $('deepenLastfm').hidden=!lastfmTaste;
  $('deepenLastfm').textContent=lastfmTaste?.neighbors?.length?'refresh Last.fm graph':'deepen Last.fm graph';
 }
 if($('clearLastfm'))$('clearLastfm').hidden=!lastfmTaste;
 const area=$('history');area.replaceChildren();
 if(!logs.length){
  const empty=document.createElement('div');empty.className='history-empty';
  empty.innerHTML='<b>nothing saved yet.</b><span>save an album after you listen.</span>';
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
 if(String(a.provenance?.moods?.source||'')==='musicbrainz-tag-translation')return false;
 return (Array.isArray(a.moods)&&a.moods.length>0) ||
        Boolean(a.features?.moods&&Object.keys(a.features.moods).length);
}
function albumHasEnergy(a){
 if(String(a.provenance?.energy?.source||'')==='musicbrainz-tag-translation')return false;
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
 if(rankingFeaturesAvailable||liveMetadataRankingAvailable){
  node.hidden=true;
  node.textContent='';
 }else{
  node.hidden=false;
  node.textContent='filters unavailable right now.';
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
 if(rankingFeaturesAvailable)return `${total} albums loaded.`;
 if(liveMetadataRankingAvailable)return `${total} albums loaded.`;
 return `${total} albums loaded.`;
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
function tagCatalogItems(items,file,chunkSize=1000,offset=0){
 return (items||[]).map((album,index)=>{
  if(!album||typeof album!=='object')return album;
  album._catalogFile=file||album._catalogFile||null;
  album._catalogChunk=Math.floor((offset+index)/Math.max(1,Number(chunkSize)||1000));
  return album;
 });
}
function mergeAlbums(items){
 const byKey=new Map(albums.map(a=>[key(a),a]));
 for(const a of items||[]){
  if(!a?.title||!a?.artist)continue;
  const k=key(a),existing=byKey.get(k);
  if(existing){mergeAlbumRecord(existing,a);continue}
  byKey.set(k,a);albums.push(a);
 }
 tasteTagContextCache=null;
 refreshFeatureCoverage();
 if($('drawer')?.getAttribute('aria-hidden')==='false')renderTastePrint();
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
  const rows=Array.isArray(data)?data:data.albums||[];
  mergeAlbums(tagCatalogItems(rows,file,catalogManifest?.shard_size||1000,0));
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
   const rows=Array.isArray(data)?data:data.albums||[];
   return tagCatalogItems(rows,shard.file,catalogManifest?.shard_size||1000,0);
  }catch(e){console.warn('Could not load catalog shard',shard.file,e);return []}
 }));
 for(const batch of batches)mergeAlbums(batch);
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
async function load(){
 try{
  const manifestResponse=await fetch('./data/catalog/manifest.json',{cache:'no-store'});
  if(manifestResponse.ok){
   catalogManifest=await manifestResponse.json();
   catalogTotal=Number(catalogManifest.total_albums)||0;
   try{
    const basePath=catalogManifest.base_file?'./data/catalog/'+catalogManifest.base_file:'./data/albums.json';
    const baseResponse=await fetch(basePath,{cache:'force-cache'});
    if(baseResponse.ok){
     const base=await baseResponse.json();
     const rows=Array.isArray(base)?base:base.albums||[];
     mergeAlbums(tagCatalogItems(rows,catalogManifest.base_file||'base.json',catalogManifest.shard_size||1000,0));
    }
   }catch(e){console.info('Editorial base could not be preloaded',e)}
   await loadMoreShards(2);
   const warmMore=()=>loadMoreShards(4).catch(()=>{});
   if('requestIdleCallback' in window)requestIdleCallback(warmMore,{timeout:3500});
   else setTimeout(warmMore,2200);
   if(!albums.length)throw Error('Catalog manifest exists but no albums loaded');
   refreshFeatureCoverage();
   $('status').textContent=libraryStatus();
   await restoreSharedPick();
   return;
  }
 }catch(e){console.info('Large catalog not deployed yet; using base catalog.',e)}
 try{
  const response=await fetch('./data/albums.json',{cache:'no-store'});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  const json=await response.json();
  albums=tagCatalogItems((Array.isArray(json)?json:json.albums||[]),'albums.json',1000,0).filter(a=>a.title&&a.artist);
  catalogTotal=albums.length;
  refreshFeatureCoverage();
  $('status').textContent=libraryStatus();
  if(!albums.length)throw Error('No albums found');
  await restoreSharedPick();
 }catch(e){
  $('status').textContent='Could not load the music library.';
  console.error(e);
 }
}
restorePickerState();
renderPickerControls();
load();

window.addEventListener('pageshow',()=>{
 renderHistory();
 renderRecentPulls();
});

function score(a,intent){
 intent=correctedIntent(intent);
 let weighted=0,totalWeight=0;
 const confidence=(name,fallback=.7)=>{
  const value=Number(a.provenance?.[name]?.confidence);
  return Number.isFinite(value)?Math.max(.1,Math.min(1,value)):fallback;
 };
 const translatedMoodGuess=String(a.provenance?.moods?.source||'')==='musicbrainz-tag-translation';
 const moodVector=translatedMoodGuess
  ? {}
  : (a.features?.moods&&Object.keys(a.features.moods).length
    ? a.features.moods
    : Object.fromEntries((a.moods||[]).map(m=>[String(m).toLowerCase(),1])));
 const requested={...selectedMoodSignals(),...intent.moods};
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

 const translatedEnergyGuess=String(a.provenance?.energy?.source||'')==='musicbrainz-tag-translation';
 const rawEnergy=translatedEnergyGuess
  ? NaN
  : (a.features?.energy!==null&&a.features?.energy!==undefined
    ? Number(a.features.energy)*10
    : Number(a.energy_level));
 const targetEnergy=recommendationEnergy(intent);
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
 const comfort=recommendationComfort();
 if(comfort==='comfort'){
  const ww=.75;weighted+=ww*(.2+.8*familiarity);totalWeight+=ww;
 }
 if(comfort==='exploration'||intent.exploration>0){
  const ww=.75;weighted+=ww*(1-.95*familiarity);totalWeight+=ww;
 }

 const repeatPenalty=recentArtistPenalty(a.artist);
 if(repeatPenalty>0){
  const ww=1.25*repeatPenalty;
  weighted+=ww*.05;totalWeight+=ww;
 }
 return totalWeight?weighted/totalWeight:.5;
}
async function eligiblePool(){
 const logged=new Set(logs.map(l=>`${String(l.artist).toLowerCase()}::${String(l.album).toLowerCase()}`));
 let pool=albums.filter(a=>!albumWasSeen(a)&&!logged.has(key(a)));
 if(catalogManifest&&pool.length<350&&loadedShardFiles.size<catalogManifest.shards.length){
  await loadMoreShards(6);
  pool=albums.filter(a=>!albumWasSeen(a)&&!logged.has(key(a)));
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
  Boolean(nextPickCorrection) ||
  logs.filter(x=>Number(x.rating)>0&&x.signal_snapshot).length>=8
 );
}

let backendUnavailableUntil=0;
function backendUrl(path){
 try{
  const override=localStorage.getItem('albumaday.apiBase');
  if(override)return override.replace(/\/$/,'')+path;
 }catch{}
 const host=location.hostname;
 if(host.endsWith('github.io'))return 'https://an-album-a-day.vercel.app'+path;
 if(host==='localhost'||host==='127.0.0.1')return null;
 return path;
}
function albumProfileQuality(a){
 let quality=.18;
 const genres=(a?.genres||[]).filter(Boolean).length;
 const tags=(a?.tags||[]).filter(Boolean).length;
 const translatedMood=String(a?.provenance?.moods?.source||'')==='musicbrainz-tag-translation';
 const reliableMoods=translatedMood
  ? 0
  : (a?.features?.moods&&Object.keys(a.features.moods).length
    ? Object.keys(a.features.moods).length
    : (a?.moods||[]).length);

 quality+=Math.min(.22,genres*.055);
 quality+=Math.min(.3,tags*.025);
 quality+=Math.min(.16,reliableMoods*.04);
 if(a?._acoustic)quality+=.22;
 else if(a?._live?.matched)quality+=.06;
 if(a?.year)quality+=.03;
 return Math.max(.18,Math.min(1,quality));
}
function backendCandidate(a,intent,semanticScore=0){
 const translatedMoodGuess=String(a.provenance?.moods?.source||'')==='musicbrainz-tag-translation';
 const translatedEnergyGuess=String(a.provenance?.energy?.source||'')==='musicbrainz-tag-translation';
 const featureMoods=translatedMoodGuess
  ? []
  : (a.features?.moods&&Object.keys(a.features.moods).length?Object.keys(a.features.moods):(a.moods||[]));
 const duration=[a._live?.runtimeMin,a._semantic?.runtimeMin,a.features?.duration_min,a.length_min]
  .find(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)));
 const energy=[
  a._acoustic?.energy,
  a._live?.signals?.energy,
  translatedEnergyGuess?null:(a.features?.energy!=null?Number(a.features.energy)*10:null),
  translatedEnergyGuess?null:a.energy_level
 ].find(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)));
 return {
  id:lookupId(a),
  artist:a.artist,
  title:a.title,
  year:a.year||'',
  genres:(a.genres||[]).slice(0,10),
  tags:[
   ...(a.tags||[]),
   ...(a._acoustic?.acoustic>=.68?['acoustic']:[]),
   ...(a._acoustic?.instrumental>=.68?['instrumental']:[]),
   ...(Number.isFinite(a._acoustic?.bpm)&&a._acoustic.bpm>=135?['fast tempo']:[]),
   ...(Number.isFinite(a._acoustic?.bpm)&&a._acoustic.bpm<=80?['slow tempo']:[])
  ].slice(0,22),
  moods:featureMoods.slice(0,12),
  energy:energy===undefined?null:Number(energy),
  duration:duration===undefined?null:Number(duration),
  familiarity:artistFamiliarity(a.artist),
  tasteAdjacency:tasteAdjacency(a),
  profileQuality:albumProfileQuality(a),
  localScore:score(a,intent),
  semanticScore:Number(semanticScore)||0,
  moodSource:String(a.provenance?.moods?.source||''),
  moodConfidence:Number(a.provenance?.moods?.confidence)||0,
  energySource:a._acoustic?.energy!=null?'audio':(a._live?.signals?.energy!=null?'live':String(a.provenance?.energy?.source||'')),
  energyConfidence:a._acoustic?.energy!=null||a._live?.signals?.energy!=null?1:(Number(a.provenance?.energy?.confidence)||0),
  catalogFile:a._catalogFile||null,
  catalogChunk:Number(a._catalogChunk)||0
 };
}
async function rankWithBackend(pool,seed,daily){
 const endpoint=backendUrl('/api/recommend');
 if(!endpoint||Date.now()<backendUnavailableUntil)return null;
 const note=$('feelingInput')?.value.trim()||'';
 const intent=correctedIntent(interpretFeeling(note));
 const comfort=recommendationComfort();
 const effectiveEnergy=recommendationEnergy(intent);
 const rows=new Map();
 let retrievalQueryVector=null;
 const sourceCounts={neural:0,semantic:0,controls:0,adjacent:0,familiar:0,explore:0};
 const add=(a,semanticScore=0,source='controls')=>{
  if(!a||albumWasSeen(a))return;
  const id=lookupId(a);
  const current=rows.get(id);
  if(!current){
   rows.set(id,{album:a,semanticScore:Number(semanticScore)||0,sources:new Set([source])});
   sourceCounts[source]=(sourceCounts[source]||0)+1;
   return;
  }
  current.sources.add(source);
  if(Math.abs(Number(semanticScore)||0)>Math.abs(Number(current.semanticScore)||0)){
   current.semanticScore=Number(semanticScore)||0;
  }
 };

 // Full-catalog MiniLM recall: search all 100k projected vectors before final reranking.
 const neuralQueryActive=Boolean(
  note.length>=2 ||
  state.moods.length ||
  effectiveEnergy!==null ||
  (intent.genres||[]).length ||
  Object.keys(intent.moods||{}).length
 );
 if(neuralQueryActive&&catalogManifest){
  const retrievalEndpoint=backendUrl('/api/neural-retrieve');
  if(retrievalEndpoint){
   try{
    $('status').textContent='searching 100,000 neural records…';
    const response=await fetch(retrievalEndpoint,{
     method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({
      note,
      moods:[...state.moods],
      energy:effectiveEnergy,
      comfort,
      time:state.time,
      intent,
      limit:64
     })
    });
    if(response.ok){
     const data=await response.json();
     const raw=(data.matches||[]).map(row=>({id:String(row.id),score:Number(row.score)||0}));
     const resolved=await resolveSemanticResults(raw,14);
     for(const row of resolved.slice(0,52))add(row.album,row.semanticScore,'neural');
     if(Array.isArray(data.queryVector)&&data.queryVector.length===384)retrievalQueryVector=data.queryVector;
    }
   }catch(e){console.info('Full-catalog neural retrieval unavailable; using mixed recall.',e)}
  }
 }

 // Lexical/SVD retrieval is useful for recall, but it no longer owns the shortlist.
 if(note.length>=2&&globalThis.AlbumSemantic?.search&&catalogManifest){
  try{
   const raw=await globalThis.AlbumSemantic.search(note,64);
   const resolved=await resolveSemanticResults(raw,6);
   for(const row of resolved.slice(0,36))add(row.album,row.semanticScore,'semantic');
  }catch(e){console.info('Candidate retrieval fallback',e)}
 }

 // Explicit controls and mood intent always get a substantial share.
 const local=sampleCandidates(pool,seed+'|backend-controls',Math.min(2600,pool.length),daily)
  .map(a=>({a,v:score(a,intent)}))
  .sort((x,y)=>y.v-x.v)
  .slice(0,42);
 for(const row of local)add(row.a,0,'controls');

 // Familiar records and adjacent-but-new artists are distinct signals.
 const familiarCandidates=pool
  .filter(a=>artistFamiliarity(a.artist)>=.25)
  .sort((a,b)=>artistFamiliarity(b.artist)-artistFamiliarity(a.artist))
  .slice(0,comfort==='comfort'?24:10);
 for(const a of familiarCandidates)add(a,0,'familiar');

 const adjacencySample=sampleCandidates(pool,seed+'|backend-adjacent',Math.min(3200,pool.length),daily)
  .filter(a=>artistFamiliarity(a.artist)<.25)
  .map(a=>({a,v:tasteAdjacency(a)}))
  .filter(row=>row.v>0)
  .sort((x,y)=>y.v-x.v)
  .slice(0,comfort==='exploration'?28:20);
 for(const row of adjacencySample)add(row.a,0,'adjacent');

 // Preserve true discovery outside the existing taste neighborhood.
 const exploration=sampleCandidates(
  pool,
  seed+'|backend-explore',
  Math.min(520,pool.length),
  daily
 ).filter(a=>artistFamiliarity(a.artist)<.2&&tasteAdjacency(a)<.25).slice(0,18);
 for(const a of exploration)add(a,0,'explore');

 const allRows=[...rows.values()];
 // Interleave sources so no retrieval method can monopolize the 96 slots.
 const buckets={
  neural:allRows.filter(row=>row.sources.has('neural')),
  semantic:allRows.filter(row=>row.sources.has('semantic')),
  controls:allRows.filter(row=>row.sources.has('controls')),
  adjacent:allRows.filter(row=>row.sources.has('adjacent')),
  familiar:allRows.filter(row=>row.sources.has('familiar')),
  explore:allRows.filter(row=>row.sources.has('explore'))
 };
 const shortlist=[];
 const used=new Set();
 const quotas=comfort==='exploration'
  ? {neural:30,semantic:16,controls:28,adjacent:16,familiar:2,explore:4}
  : comfort==='comfort'
    ? {neural:28,semantic:16,controls:28,adjacent:8,familiar:12,explore:4}
    : {neural:30,semantic:16,controls:28,adjacent:12,familiar:6,explore:4};
 for(const source of ['neural','semantic','controls','adjacent','familiar','explore']){
  let taken=0;
  for(const row of buckets[source]){
   const id=lookupId(row.album);
   if(used.has(id))continue;
   shortlist.push(row);used.add(id);taken++;
   if(taken>=quotas[source])break;
  }
 }
 for(const row of allRows){
  if(shortlist.length>=96)break;
  const id=lookupId(row.album);
  if(used.has(id))continue;
  shortlist.push(row);used.add(id);
 }
 if(shortlist.length<2)return null;

 const byId=new Map(shortlist.map(row=>[lookupId(row.album),row.album]));
 const candidates=shortlist.slice(0,96).map(row=>backendCandidate(row.album,intent,row.semanticScore));

 $('status').textContent='neural reranking…';
 try{
  const response=await fetch(endpoint,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({
    seed,
    client_id:clientFeedbackId(),
    note,
    moods:[...state.moods],
    energy:effectiveEnergy,
    comfort,
    time:state.time,
    intent,
    recentArtists:mergeUnique([
     ...recentRecommendedArtists.slice(-12),
     ...logs.slice(-8).map(x=>normalizeArtistName(x.artist))
    ]).slice(-16),
    queryVector:retrievalQueryVector,
    retrieval:{
     neural:sourceCounts.neural,
     semantic:sourceCounts.semantic,
     controls:sourceCounts.controls,
     adjacent:sourceCounts.adjacent,
     familiar:sourceCounts.familiar,
     exploration:sourceCounts.explore
    },
    candidates
   })
  });
  if(!response.ok)throw Error('backend HTTP '+response.status);
  const data=await response.json();
  const album=byId.get(String(data.albumId||''));
  if(!album)throw Error('backend returned unknown album');
  album._backendRank={
   engine:data.engine||'hybrid-neural-reranker-v3',
   score:Number(data.score)||0,
   neural:Number(data.diagnostics?.neural)||0,
   taste:Number(data.diagnostics?.taste)||0,
   tasteConfidence:Number(data.diagnostics?.tasteConfidence)||0,
   tasteAdjacency:Number(data.diagnostics?.tasteAdjacency)||0,
   reason:String(data.reason||'')
  };
  return {album,featuresUsed:true,mode:'backend'};
 }catch(e){
  console.info('Recommendation backend unavailable; using browser fallback.',e);
  backendUnavailableUntil=Date.now()+120000;
  return null;
 }
}
async function chooseDaily(options={}){
 const surprise=Boolean(options.surprise);
 const request=++recommendationRequest;
 if(!albums.length){$('status').textContent='Still loading albums. Check your connection if this persists.';return}
 setPickBusy(true);
 try{
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
   result=await rankWithBackend(pool,seed,true);
   if(!result){
    const hasNote=Boolean($('feelingInput')?.value.trim());
    result=hasNote?await rankWithSemantic(seed,true):null;
   }
   if(!result){
    result=rankingFeaturesAvailable
     ? rankFromStoredFeatures(pool,seed,true)
     : await rankWithLiveMetadata(pool,seed,true);
   }
  }
  if(request!==recommendationRequest)return;
  pick=result.album;
  markAlbumSeen(pick);
  markTodayPicked();
  show(pick,{mode:'daily',featuresUsed:result.featuresUsed,rankingMode:result.mode,userTriggered:true});
  clearNextPickCorrection();
  $('reroll').hidden=false;
 }finally{setPickBusy(false)}
}
async function chooseAnother(){
 if(!albums.length)return;
 if(pick)recordFeedback('reroll').catch(()=>{});
 const request=++recommendationRequest;
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
   result=await rankWithBackend(pool,seed,false);
   if(!result){
    const hasNote=Boolean($('feelingInput')?.value.trim());
    result=hasNote?await rankWithSemantic(seed,false):null;
   }
   if(!result){
    result=rankingFeaturesAvailable
     ? rankFromStoredFeatures(pool,seed,false)
     : await rankWithLiveMetadata(pool,seed,false);
   }
  }
  if(request!==recommendationRequest)return;
  pick=result.album;
  markAlbumSeen(pick);
  show(pick,{mode:'bonus',featuresUsed:result.featuresUsed,rankingMode:result.mode,userTriggered:true});
  clearNextPickCorrection();
 }finally{setPickBusy(false)}
}
function rankFromStoredFeatures(pool,seed,daily){
 const intent=correctedIntent(interpretFeeling($('feelingInput')?.value||''));
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
 $('feedbackBar')?.querySelectorAll('button').forEach(button=>{button.disabled=busy});
 if($('recommend')){
  $('recommend').classList.toggle('is-loading',busy);
  $('recommend').setAttribute('aria-busy',String(busy));
  $('recommend').querySelector('span:first-child').textContent=busy?'looking…':'pick an album';
 }
}
$('recommend').addEventListener('click',()=>chooseDaily());
$('surpriseMe')?.addEventListener('click',()=>chooseDaily({surprise:true}));
$('reroll').addEventListener('click',chooseAnother);


const genreSignalRules=[
 {re:/metal|hard rock/i,energy:8.2,moods:{dark:.78,intense:.82,gritty:.72,energetic:.62},confidence:.68},
 {re:/punk|hardcore/i,energy:8.1,moods:{gritty:.82,intense:.76,energetic:.76,alienated:.42},confidence:.68},
 {re:/hip-hop|hip hop|rap/i,energy:6.4,moods:{gritty:.38,intense:.32,energetic:.42,reflective:.3},confidence:.34},
 {re:/electronic|dance|house|techno|trance/i,energy:7.3,moods:{energetic:.7,dreamy:.3,cold:.22,intense:.3},confidence:.52},
 {re:/ambient|new age/i,energy:2.5,moods:{dreamy:.78,reflective:.62,cold:.3,warm:.2},confidence:.64},
 {re:/alternative|indie|rock/i,energy:5.2,moods:{reflective:.2},confidence:.14},
 {re:/r&b|soul/i,energy:4.9,moods:{warm:.58,reflective:.4,melancholic:.24},confidence:.38},
 {re:/singer\/songwriter|folk/i,energy:3.8,moods:{reflective:.68,warm:.4,melancholic:.36,nostalgic:.28},confidence:.5},
 {re:/jazz/i,energy:4.5,moods:{reflective:.48,warm:.34,dreamy:.28},confidence:.32},
 {re:/classical/i,energy:4.0,moods:{reflective:.58,dreamy:.38},confidence:.36},
 {re:/country|americana/i,energy:4.6,moods:{warm:.34,nostalgic:.42,reflective:.34},confidence:.3},
 {re:/reggae|ska/i,energy:5.8,moods:{warm:.5,hopeful:.42,energetic:.34},confidence:.4},
 {re:/latin|brazilian|samba|bossa|mpb/i,energy:5.2,moods:{warm:.4,reflective:.28,hopeful:.26,nostalgic:.22},confidence:.28},
 {re:/pop/i,energy:5.7,moods:{warm:.22,hopeful:.2,energetic:.28},confidence:.16},
 {re:/soundtrack|score/i,energy:4.3,moods:{dreamy:.42,reflective:.46,intense:.22},confidence:.28},
];
function genreSignals(genre){
 const out={moods:{},energy:null,confidence:.18};
 for(const rule of genreSignalRules){
  if(!rule.re.test(String(genre||'')))continue;
  out.energy=rule.energy;
  out.confidence=Number(rule.confidence)||.18;
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
 diaryArtistCache=new Set(logs.map(x=>normalizeArtistName(x.artist)).filter(Boolean));
 return diaryArtistCache;
}
function lastfmFamiliarity(artist){
 return Number(lastfmTasteMap.get(normalizeArtistName(artist))||0);
}
function artistFamiliarity(artist){
 return Math.max(diaryArtistSet().has(normalizeArtistName(artist))?1:0,lastfmFamiliarity(artist));
}
function albumTasteTokens(album){
 const values=[...(album?.genres||[]),...(album?.tags||[])];
 const out=new Set();
 for(const value of values){
  const token=String(typeof value==='string'?value:value?.name||'').trim().toLowerCase().replace(/\s+/g,' ');
  if(token.length>=2&&token.length<=80)out.add(token);
 }
 return [...out];
}
function positiveDiaryArtistWeights(){
 const weights=new Map();
 for(const entry of logs){
  const rating=Number(entry.rating);
  if(!Number.isFinite(rating)||rating<=3)continue;
  const artist=normalizeArtistName(entry.artist);
  if(!artist)continue;
  const weight=Math.min(1,(rating-3)/2);
  weights.set(artist,Math.max(weights.get(artist)||0,weight));
 }
 return weights;
}
function tasteTagContext(){
 if(tasteTagContextCache)return tasteTagContextCache;
 const df=new Map(),artistTokens=new Map();
 for(const album of albums){
  const tokens=albumTasteTokens(album);
  if(!tokens.length)continue;
  for(const token of tokens)df.set(token,(df.get(token)||0)+1);
  const artist=normalizeArtistName(album.artist);
  if(!artist)continue;
  let set=artistTokens.get(artist);
  if(!set){set=new Set();artistTokens.set(artist,set)}
  for(const token of tokens)set.add(token);
 }
 const diaryWeights=positiveDiaryArtistWeights();
 const tasteWeights=new Map();
 let seededArtists=0;
 const n=Math.max(1,albums.length);
 for(const [artist,tokens] of artistTokens){
  const seed=Math.max(Number(lastfmTasteMap.get(artist)||0),Number(diaryWeights.get(artist)||0));
  if(seed<=0)continue;
  seededArtists++;
  for(const token of tokens){
   const idf=Math.log((n+1)/(Number(df.get(token)||0)+1))+1;
   tasteWeights.set(token,(tasteWeights.get(token)||0)+seed*idf);
  }
 }
 let norm=0;
 for(const value of tasteWeights.values())norm+=value*value;
 tasteTagContextCache={weights:tasteWeights,df,n,norm:Math.sqrt(norm),seededArtists};
 return tasteTagContextCache;
}
function tasteAdjacency(album){
 if(!album||artistFamiliarity(album.artist)>=.25)return 0;
 const artist=normalizeArtistName(album.artist);
 const collaborative=Math.max(0,Math.min(1,Number(lastfmNeighborMap.get(artist)||0)));
 const ctx=tasteTagContext();
 let tagScore=0;
 if(ctx.seededArtists&&ctx.norm){
  let dot=0,norm=0;
  for(const token of albumTasteTokens(album)){
   const idf=Math.log((ctx.n+1)/(Number(ctx.df.get(token)||0)+1))+1;
   dot+=(ctx.weights.get(token)||0)*idf;
   norm+=idf*idf;
  }
  if(norm)tagScore=Math.max(0,Math.min(1,dot/(ctx.norm*Math.sqrt(norm))));
 }
 if(collaborative>0)return Math.max(tagScore,Math.min(1,.9*collaborative+.1*tagScore));
 return tagScore;
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
 const translatedMoodGuess=String(candidate.provenance?.moods?.source||'')==='musicbrainz-tag-translation';
 const translatedEnergyGuess=String(candidate.provenance?.energy?.source||'')==='musicbrainz-tag-translation';
 const moods=translatedMoodGuess
  ? {}
  : (candidate.features?.moods&&Object.keys(candidate.features.moods).length
    ? candidate.features.moods
    : Object.fromEntries((candidate.moods||[]).map(m=>[String(m).toLowerCase(),1])));
 const energy=translatedEnergyGuess
  ? null
  : (candidate.features?.energy!==null&&candidate.features?.energy!==undefined
    ? Number(candidate.features.energy)*10
    : candidate.energy_level);
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
 intent=correctedIntent(intent);
 let weighted=0,weight=0;
 const signals=candidate._live?.signals||{moods:{},energy:null,confidence:.35};
 const confidence=signals.confidence||.35;
 const requested={...selectedMoodSignals(),...intent.moods};
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
 const targetEnergy=recommendationEnergy(intent);
 if(targetEnergy!==null&&targetEnergy!==undefined&&signals.energy!==null){
  const similarity=Math.max(0,1-Math.abs(Number(signals.energy)-Number(targetEnergy))/10);
  const ww=1.8*confidence;weighted+=ww*similarity;weight+=ww;
 }
 const familiarity=artistFamiliarity(candidate.artist);
 const comfort=recommendationComfort();
 if(comfort==='comfort'){const ww=.8;weighted+=ww*(.2+.8*familiarity);weight+=ww}
 if(comfort==='exploration'||intent.exploration>0){const ww=.8;weighted+=ww*(1-.95*familiarity);weight+=ww}
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
 $('status').textContent='searching albums…';
 let raw;
 try{raw=await globalThis.AlbumSemantic.search(note,120)}
 catch(e){console.info('Semantic index unavailable; using live fallback.',e);return null}
 if(!raw.length)return null;

 const resolved=await resolveSemanticResults(raw,6);
 const logged=new Set(logs.map(l=>`${String(l.artist).toLowerCase()}::${String(l.album).toLowerCase()}`));
 const intent=correctedIntent(interpretFeeling(note));
 let ranked=resolved
  .filter(row=>!seenAlbums.has(hash32(key(row.album)))&&!logged.has(key(row.album)))
  .map(row=>{
   const semantic=Math.max(0,Math.min(1,(Number(row.semanticScore)+1)/2));
   const controls=score(row.album,intent);
   const personal=diaryTasteScore(row.album);
   const repeat=recentArtistPenalty(row.album.artist);
   let relevance=.74*semantic+.18*controls;
   if(personal.active)relevance+=.08*personal.score;
   if(repeat>0)relevance-=.16*repeat;
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
 const intent=correctedIntent(interpretFeeling($('feelingInput')?.value||''));
 const sample=sampleCandidates(pool,seed,12,daily);
 $('status').textContent='checking albums…';
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
const acousticBrainzLowCache=new Map();
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
 const promise=musicBrainzJson('https://musicbrainz.org/ws/2/release-group/'+group.id+'?inc=genres+tags+url-rels&fmt=json')
  .catch(e=>{console.info('MusicBrainz detail lookup unavailable',e);return null});
 musicBrainzDetailCache.set(group.id,promise);
 return promise;
}
const musicBrainzGroupReleaseCache=new Map();
async function browseGroupReleases(groupId){
 if(!groupId)return [];
 if(musicBrainzGroupReleaseCache.has(groupId))return musicBrainzGroupReleaseCache.get(groupId);
 const promise=(async()=>{
  const all=[];let offset=0;
  // MusicBrainz browse is paginated; releases are always returned whole.
  // Two pages is far more than a normal album needs while keeping UI latency bounded.
  for(let page=0;page<2;page++){
   const url='https://musicbrainz.org/ws/2/release?release-group='+encodeURIComponent(groupId)
    +'&status=official&inc=recordings+media&fmt=json&limit=100&offset='+offset;
   const data=await musicBrainzJson(url);
   const rows=(data?.releases||[]).filter(r=>r?.id);
   all.push(...rows);
   offset+=rows.length;
   const total=Number(data?.['release-count']||0);
   if(!rows.length||offset>=total)break;
  }
  return all;
 })().catch(e=>{console.info('MusicBrainz release browse unavailable',e);return []});
 musicBrainzGroupReleaseCache.set(groupId,promise);
 return promise;
}
function releaseTrackCount(release){
 const media=Array.isArray(release?.media)?release.media:[];
 const fromMedia=media.reduce((n,m)=>n+(Number(m?.['track-count'])||Number(m?.tracks?.length)||0),0);
 return fromMedia||Number(release?.['track-count'])||0;
}
function selectRepresentativeRelease(releases,firstReleaseDate=''){
 const pool=(releases||[]).filter(r=>r?.id&&releaseTrackCount(r)>0);
 if(!pool.length)return null;
 const firstYear=Number.parseInt(String(firstReleaseDate||'').slice(0,4),10);
 let eraPool=pool;
 if(Number.isFinite(firstYear)){
  const close=pool.filter(r=>{
   const y=Number.parseInt(String(r.date||'').slice(0,4),10);
   return Number.isFinite(y)&&y>=firstYear&&y<=firstYear+2;
  });
  if(close.length)eraPool=close;
 }
 const counts=new Map();
 for(const r of eraPool){
  const count=releaseTrackCount(r);
  counts.set(count,(counts.get(count)||0)+1);
 }
 const preferredCount=[...counts.entries()]
  .sort((a,b)=>b[1]-a[1]||b[0]-a[0])[0]?.[0];
 const sameCount=eraPool.filter(r=>releaseTrackCount(r)===preferredCount);
 const candidates=sameCount.length?sameCount:eraPool;
 return candidates.slice().sort((a,b)=>{
  const ad=String(a.date||'9999-99-99'),bd=String(b.date||'9999-99-99');
  if(ad!==bd)return ad.localeCompare(bd);
  const ac=String(a.country||''),bc=String(b.country||'');
  if(ac!==bc)return ac.localeCompare(bc);
  return String(a.id).localeCompare(String(b.id));
 })[0]||null;
}
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
async function fetchAcousticLowLevel(mbid){
 if(acousticBrainzLowCache.has(mbid))return acousticBrainzLowCache.get(mbid);
 const promise=fetch('https://acousticbrainz.org/api/v1/'+mbid+'/low-level',{cache:'force-cache'})
  .then(r=>{if(!r.ok)throw Error('AcousticBrainz low-level HTTP '+r.status);return r.json()})
  .catch(()=>null);
 acousticBrainzLowCache.set(mbid,promise);return promise;
}
async function fetchAcousticPair(mbid){
 const [high,low]=await Promise.all([fetchAcousticHighLevel(mbid),fetchAcousticLowLevel(mbid)]);
 return high||low?{high,low}:null;
}
function classifierProbability(highlevel,section,label){
 const value=Number(highlevel?.[section]?.all?.[label]);
 return Number.isFinite(value)?Math.max(0,Math.min(1,value)):null;
}
function aggregateAcoustic(rows){
 if(!rows.length)return null;
 const sums={
  sad:0,happy:0,aggressive:0,relaxed:0,party:0,danceable:0,
  dark:0,electronic:0,acoustic:0,instrumental:0
 };
 const counts=Object.fromEntries(Object.keys(sums).map(k=>[k,0]));
 const mappings=[
  ['sad','mood_sad','sad'],['happy','mood_happy','happy'],
  ['aggressive','mood_aggressive','aggressive'],['relaxed','mood_relaxed','relaxed'],
  ['party','mood_party','party'],['danceable','danceability','danceable'],
  ['dark','timbre','dark'],['electronic','mood_electronic','electronic'],
  ['acoustic','mood_acoustic','acoustic'],['instrumental','voice_instrumental','instrumental']
 ];
 const bpms=[],loudness=[],keys=[];
 for(const row of rows){
  const high=row?.high?.highlevel||row?.highlevel||row?.high||{};
  const low=row?.low||{};
  for(const [name,section,label] of mappings){
   const p=classifierProbability(high,section,label);
   if(p===null)continue;sums[name]+=p;counts[name]++;
  }
  const bpm=Number(low?.rhythm?.bpm);
  if(Number.isFinite(bpm)&&bpm>=30&&bpm<=300)bpms.push(bpm);
  const loud=Number(low?.lowlevel?.average_loudness);
  if(Number.isFinite(loud))loudness.push(Math.max(0,Math.min(1,loud)));
  const keyName=String(low?.tonal?.key_key||'').trim();
  const scale=String(low?.tonal?.key_scale||'').trim();
  if(keyName)keys.push(scale?keyName+' '+scale:keyName);
 }
 const avg=name=>counts[name]?sums[name]/counts[name]:null;
 const sad=avg('sad'),happy=avg('happy'),aggressive=avg('aggressive'),relaxed=avg('relaxed');
 const party=avg('party'),dance=avg('danceable'),dark=avg('dark'),electronic=avg('electronic');
 const acoustic=avg('acoustic'),instrumental=avg('instrumental');
 const values=arr=>arr.filter(v=>v!==null&&Number.isFinite(v));
 const mean=arr=>{const v=values(arr);return v.length?v.reduce((n,x)=>n+x,0)/v.length:null};
 const median=arr=>{
  const v=values(arr).slice().sort((a,b)=>a-b);
  if(!v.length)return null;
  const mid=Math.floor(v.length/2);
  return v.length%2?v[mid]:(v[mid-1]+v[mid])/2;
 };
 const modes=arr=>{
  const counts=new Map();
  for(const value of arr)counts.set(value,(counts.get(value)||0)+1);
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]||null;
 };
 const bpm=median(bpms),averageLoudness=mean(loudness),keyName=modes(keys);
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

 const tempoEnergy=bpm===null?null:Math.max(0,Math.min(1,(bpm-55)/115));
 const energyParts=[
  [dance,.28],[aggressive,.22],[party,.15],[relaxed===null?null:1-relaxed,.12],
  [tempoEnergy,.13],[averageLoudness,.10]
 ].filter(([v])=>v!==null&&Number.isFinite(v));
 const energy=energyParts.length
  ?10*energyParts.reduce((n,[v,w])=>n+v*w,0)/energyParts.reduce((n,[,w])=>n+w,0)
  :null;

 const highCoverage=rows.filter(row=>row?.high).length;
 const lowCoverage=rows.filter(row=>row?.low).length;
 const confidence=Math.min(.94,.5+highCoverage*.035+lowCoverage*.025);
 return {
  moods,energy,bpm,averageLoudness,key:keyName,acoustic,instrumental,
  tracksAnalyzed:rows.length,highLevelTracks:highCoverage,lowLevelTracks:lowCoverage,confidence
 };
}
async function loadSelectedAcousticProfile(a,details){
 let releaseId=a._selectedReleaseId;
 if(!releaseId&&details?.id){
  const releases=await browseGroupReleases(details.id);
  releaseId=selectRepresentativeRelease(releases,details['first-release-date']||a.year)?.id||null;
 }
 if(!releaseId)return null;
 const full=await getReleaseWithRecordings(releaseId);if(!full||!pick||key(pick)!==key(a))return null;
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
 const rows=(await mapConcurrent([...new Set(sample)],4,fetchAcousticPair)).filter(Boolean);
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
  if(profile.acoustic>=.68){
   const tag=document.createElement('span');tag.className='audio-class';tag.textContent='ACOUSTIC';classification.append(tag);
  }
  if(profile.instrumental>=.68){
   const tag=document.createElement('span');tag.className='audio-class';tag.textContent='INSTRUMENTAL';classification.append(tag);
  }
 }
 const facts=$('recordFacts');
 if(facts){
  const group=document.createElement('div');group.className='record-fact acoustic-fact';
  const dt=document.createElement('dt');dt.textContent='Audio profile';
  const dd=document.createElement('dd');
  const parts=[`${profile.tracksAnalyzed} track${profile.tracksAnalyzed===1?'':'s'} analyzed`];
  if(Number.isFinite(profile.bpm))parts.push(`${Math.round(profile.bpm)} BPM`);
  if(profile.key)parts.push(profile.key);
  dd.textContent=parts.join(' · ');
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
 list.classList.toggle('is-long',tracks.length>9);
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
 const cacheId='albumaday.record.v4.'+hash32(cacheKey);
 try{
  let cached=null;
  try{cached=JSON.parse(sessionStorage.getItem(cacheId)||'null')}catch{}
  if(cached?.tracks?.length){
   if(cached.releaseId)a._selectedReleaseId=cached.releaseId;
   if(request===recordFileRequest&&pick&&key(pick)===cacheKey)renderRecordFacts(a,cached.album,cached.tracks,cached.source||'catalogue');
   return;
  }

  // Browse official releases and choose a representative original-era edition.
  const details=await getMusicBrainzGroupDetails(a);
  if(request!==recordFileRequest||!pick||key(pick)!==cacheKey)return;
  if(details?.id){
   const releases=await browseGroupReleases(details.id);
   if(request!==recordFileRequest||!pick||key(pick)!==cacheKey)return;
   const chosen=selectRepresentativeRelease(releases,details['first-release-date']||a.year);
   if(chosen){
    // Browse responses already include recordings+media; only fall back to lookup
    // if an unusually sparse response has no actual track objects.
    const full=(chosen.media||[]).some(m=>Array.isArray(m.tracks)&&m.tracks.length)
      ? chosen
      : await getReleaseWithRecordings(chosen.id);
    if(request!==recordFileRequest||!pick||key(pick)!==cacheKey)return;
    const tracks=musicBrainzTracks(full);
    if(tracks.length){
     a._selectedReleaseId=chosen.id;
     musicBrainzReleaseCache.set(chosen.id,Promise.resolve(full));
     const album={
      date:full?.date||chosen.date||details['first-release-date']||a.year||'',
      trackCount:tracks.length
     };
     const cache={album,tracks,source:'MusicBrainz',releaseId:chosen.id};
     try{sessionStorage.setItem(cacheId,JSON.stringify(cache))}catch{}
     renderRecordFacts(a,album,tracks,'MusicBrainz');
     return;
    }
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
function handoffToResult(){
 if(window.matchMedia('(max-width:1100px)').matches){
  const behavior=window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
  requestAnimationFrame(()=>requestAnimationFrame(()=>$('stage')?.scrollIntoView({behavior,block:'start'})));
 }
}
function show(a,context={}){
 const stage=$('stage');stage.classList.remove('revealed');stage.style.setProperty('--mount-color',labelColor(a));void stage.offsetWidth;
 const cover=$('cover');cover.style.display='block';cover.alt=`${a.title} by ${a.artist} album cover`;
 $('emptyCover').style.display='none';
 cover.src=artPlaceholder(a);
 const info=$('details');info.replaceChildren();
 const tag=document.createElement('div');tag.className='eyebrow';
 const modeLabels={
  shared:'SHARED RECORD',
  backend:context.mode==='bonus'?'ANOTHER RECORD':'TODAY\'S RECORD',
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
 const explanation=explainPick(a,context);
 const whyPanel=$('whyPanel');if(whyPanel)whyPanel.hidden=!explanation;
 const why=$('whyText');if(why)why.textContent=explanation;
 resetRecordFile(a);
 const link=$('spotify');link.href=spotifyUrl(a);link.classList.remove('disabled');link.setAttribute('aria-disabled','false');
 $('log').disabled=false;
 $('sharePick').disabled=false;
 $('recordLabel').style.background=labelColor(a);
 requestAnimationFrame(()=>requestAnimationFrame(()=>stage.classList.add('revealed')));
 const unseen=Math.max(0,(catalogTotal||albums.length)-seenAlbums.size).toLocaleString();
 $('status').textContent=context.mode==='bonus'?`${unseen} still unheard.`:context.mode==='shared'?'shared record.':`${unseen} still unheard.`;
 loadArtwork(a,cover);
 loadRecordFile(a).finally(()=>enhanceSelectedMetadata(a));
 const feedback=$('feedbackBar');
 if(feedback){
  feedback.hidden=context.mode==='shared';
  feedback.querySelectorAll('button').forEach(button=>button.classList.remove('is-sent'));
 }
 if(context.userTriggered)handoffToResult();
}
function labelColor(a){
 const palette=['#c8432f','#2e5f76','#d5ad36','#65714b','#9a593f','#d9d0bc'];
 let n=0;for(const c of key(a))n=(n*31+c.charCodeAt(0))>>>0;
 return palette[n%palette.length];
}

const FEEDBACK_QUEUE_KEY='albumaday.feedback.v1';
function clientFeedbackId(){
 try{return localStorage.getItem('albumaday.salt')||getUserSalt()}catch{return getUserSalt()}
}
function feedbackPayload(event,ratingValue=null){
 if(!pick)return null;
 return {
  event,
  client_id:clientFeedbackId(),
  album:backendCandidate(pick,interpretFeeling($('feelingInput')?.value||''),0),
  rating:ratingValue,
  query:pickerSnapshot(),
  ranking:{
   engine:pick._backendRank?.engine||ENGINE_VERSION,
   score:pick._backendRank?.score??null,
   neural:pick._backendRank?.neural??null,
   mode:pick._backendRank?'backend':'browser'
  }
 };
}
function readFeedbackQueue(){
 try{
  const raw=JSON.parse(localStorage.getItem(FEEDBACK_QUEUE_KEY)||'[]');
  return Array.isArray(raw)?raw:[];
 }catch{return []}
}
function writeFeedbackQueue(rows){
 try{localStorage.setItem(FEEDBACK_QUEUE_KEY,JSON.stringify(rows.slice(-250)))}catch{}
}
async function flushFeedbackQueue(){
 const endpoint=backendUrl('/api/feedback');
 if(!endpoint)return;
 const queue=readFeedbackQueue();
 if(!queue.length)return;
 const remaining=[];
 for(const event of queue.slice(0,12)){
  try{
   const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)});
   if(!response.ok)throw Error('feedback HTTP '+response.status);
  }catch{
   remaining.push(event);
  }
 }
 writeFeedbackQueue([...remaining,...queue.slice(12)]);
}
async function recordFeedback(event,ratingValue=null){
 const payload=feedbackPayload(event,ratingValue);
 if(!payload)return;
 const queue=readFeedbackQueue();
 queue.push(payload);
 writeFeedbackQueue(queue);
 await flushFeedbackQueue();
}
function reliablePickMoods(album){
 if(!album||String(album.provenance?.moods?.source||'')==='musicbrainz-tag-translation')return [];
 const vector=album.features?.moods&&Object.keys(album.features.moods).length
  ? Object.entries(album.features.moods).sort((a,b)=>Number(b[1])-Number(a[1])).map(([name])=>name)
  : (album.moods||[]);
 return vector.map(x=>String(x).toLowerCase()).filter(Boolean).slice(0,2);
}
function correctionForFeedback(event,album){
 if(event==='too_upbeat')return {energyDelta:-2.5};
 if(event==='too_slow')return {energyDelta:2.5};
 if(event==='too_obvious')return {forceExplore:true};
 if(event==='wrong_vibe'){
  const avoidMoods=Object.fromEntries(reliablePickMoods(album).map(name=>[name,1]));
  const requestedGenres=correctedIntent(interpretFeeling($('feelingInput')?.value||'')).genres||[];
  const firstGenre=(album?.genres||[]).map(x=>String(typeof x==='string'?x:x?.name||'').toLowerCase()).find(Boolean);
  const avoidGenres=firstGenre&&!requestedGenres.some(g=>firstGenre.includes(g)||String(g).includes(firstGenre))
   ? [firstGenre]
   : [];
  return {avoidMoods,avoidGenres,forceExplore:!Object.keys(avoidMoods).length&&!avoidGenres.length};
 }
 return null;
}
function feedbackToast(event){
 if(event==='love_this')return 'noted — more like this.';
 if(event==='too_upbeat')return 'going calmer.';
 if(event==='too_slow')return 'going harder.';
 if(event==='too_obvious')return 'going further out.';
 return 'switching the angle.';
}
$('feedbackBar')?.querySelectorAll('[data-feedback]').forEach(button=>{
 button.addEventListener('click',()=>{
  const event=button.dataset.feedback;
  button.classList.add('is-sent');
  recordFeedback(event).catch(()=>{});
  if(event==='love_this'){
   showToast(feedbackToast(event));
   return;
  }
  nextPickCorrection=correctionForFeedback(event,pick);
  showToast(feedbackToast(event));
  chooseAnother().catch(err=>console.warn('Corrective reroll failed',err));
 });
});
$('spotify')?.addEventListener('click',()=>recordFeedback('spotify_open').catch(()=>{}));
if('requestIdleCallback' in window)requestIdleCallback(()=>flushFeedbackQueue(),{timeout:3000});
else setTimeout(()=>flushFeedbackQueue(),1800);

let drawerReturnFocus=null;
function drawer(open){
 const panel=$('drawer'),toggle=$('historyToggle');
 if(open&&document.activeElement instanceof HTMLElement)drawerReturnFocus=document.activeElement;
 panel.classList.toggle('open',open);
 panel.setAttribute('aria-hidden',String(!open));
 toggle?.setAttribute('aria-expanded',String(open));
 $('overlay').hidden=!open;
 document.body.classList.toggle('drawer-open',open);
 if(open){
  requestAnimationFrame(()=>panel.focus({preventScroll:true}));
 }else{
  const target=drawerReturnFocus&&document.contains(drawerReturnFocus)?drawerReturnFocus:toggle;
  target?.focus({preventScroll:true});
  drawerReturnFocus=null;
 }
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
 $('track').placeholder=activeTracklist.length?'Choose from the tracklist or type your own':'Favorite track';
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
 const translatedMoodGuess=String(pick.provenance?.moods?.source||'')==='musicbrainz-tag-translation';
 const translatedEnergyGuess=String(pick.provenance?.energy?.source||'')==='musicbrainz-tag-translation';
 const staticMoods=translatedMoodGuess
  ? {}
  : (Array.isArray(pick.moods)?Object.fromEntries(pick.moods.map(m=>[m,1])):{});
 const staticFeatureMoods=translatedMoodGuess?null:pick.features?.moods;
 const staticEnergy=translatedEnergyGuess
  ? null
  : ((pick.features?.energy!=null?Number(pick.features.energy)*10:null)??pick.energy_level??null);
 logs.push({
  date:getDate(),artist:pick.artist,album:pick.title,rating,
  favorite_track:$('track').value.trim(),notes:$('notes').value.trim(),
  cover_art:pick.metadata?.cover_art||(/^https?:/.test($('cover')?.src||'')?$('cover').src:''),
  genre:live.genre||(Array.isArray(pick.genres)?(typeof pick.genres[0]==='string'?pick.genres[0]:pick.genres[0]?.name):'')||'',
  signal_snapshot:{
   genre:live.genre||'',
   moods:pick._acoustic?.moods||live.signals?.moods||staticFeatureMoods||staticMoods,
   energy:pick._acoustic?.energy??live.signals?.energy??staticEnergy,
   bpm:Number.isFinite(pick._acoustic?.bpm)?Number(pick._acoustic.bpm):null,
   acoustic:Number.isFinite(pick._acoustic?.acoustic)?Number(pick._acoustic.acoustic):null,
   instrumental:Number.isFinite(pick._acoustic?.instrumental)?Number(pick._acoustic.instrumental):null,
   source:pick._acoustic?'acousticbrainz-selected-sample':(live.signals?'live-genre-prior':'catalog')
  }
 });
 persist();
 recordFeedback('save',rating||null).catch(()=>{});
 if(rating)recordFeedback('rating',rating).catch(()=>{});
 $('logDialog').close();$('status').textContent='saved.';
};
$('export').onclick=()=>{
 const blob=new Blob([JSON.stringify(logs,null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='album-a-day-diary.json';
 document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
};

let artworkRequest=0;
function coverArtUrls(a){
 const preferred=String(a.metadata?.cover_art||'');
 const mbid=String(a.metadata?.musicbrainz_id||a.id||'').replace(/^mb:/,'');
 let full='',preview='';
 if(/^https?:\/\/coverartarchive\.org\//i.test(preferred)){
  full=preferred.replace(/\/front-(?:250|500|1200)(?:\?.*)?$/i,'/front-500');
  preview=full.replace(/\/front-500(?:\?.*)?$/i,'/front-250');
 }else if(/^https?:\/\//i.test(preferred)){
  if(/mzstatic\.com|itunes\.apple\.com/i.test(preferred)){
   preview=preferred.replace(/\/\d+x\d+bb(?:-\d+)?\./i,'/300x300bb.');
   full=preferred.replace(/\/\d+x\d+bb(?:-\d+)?\./i,'/600x600bb.');
  }else{
   full=preview=preferred;
  }
 }else if(/^[0-9a-f-]{36}$/i.test(mbid)){
  preview='https://coverartarchive.org/release-group/'+mbid+'/front-250';
  full='https://coverartarchive.org/release-group/'+mbid+'/front-500';
 }
 return {preview,full};
}
function probeArtwork(url,request,timeout=4200){
 return new Promise(resolve=>{
  if(!url||request!==artworkRequest)return resolve(false);
  const probe=new Image();
  let settled=false;
  const finish=ok=>{
   if(settled)return;
   settled=true;
   clearTimeout(timer);
   probe.onload=null;probe.onerror=null;
   resolve(ok);
  };
  const timer=setTimeout(()=>finish(false),timeout);
  probe.onload=()=>finish(true);
  probe.onerror=()=>finish(false);
  probe.src=url;
 });
}
async function useArtwork(img,url,fallback,request){
 if(!url||request!==artworkRequest||!pick)return false;
 const ok=await probeArtwork(url,request);
 if(!ok||request!==artworkRequest||!pick)return false;
 img.onerror=()=>{
  if(request!==artworkRequest)return;
  img.onerror=null;
  img.classList.remove('cover-loaded');
  img.src=fallback;
 };
 img.onload=()=>{if(request===artworkRequest)img.classList.add('cover-loaded')};
 img.src=url;
 img.style.display='block';
 return true;
}

function storeArtworkUrl(album,size=300){
 const raw=String(album?.artworkUrl100||album?.artworkUrl60||'');
 if(!raw)return '';
 return raw
  .replace(/\/\d+x\d+bb(?:-\d+)?\./i,'/'+size+'x'+size+'bb.')
  .replace(/\/\d+x\d+bb\./i,'/'+size+'x'+size+'bb.');
}
async function loadArtwork(a,img){
 const request=++artworkRequest;
 const fallback=artPlaceholder(a);
 img.classList.remove('cover-loaded');
 img.onerror=null;
 img.onload=null;
 img.src=fallback;
 img.style.display='block';

 const {preview,full}=coverArtUrls(a);
 const candidateJobs=[];

 const candidate=(promise,source)=>promise.then(async value=>{
  const payload=typeof value==='string'?{url:value}:{...(value||{})};
  const url=payload.url||'';
  if(!url)throw Error('no artwork');
  if(!await probeArtwork(url,request))throw Error('artwork failed');
  return {...payload,url,source};
 });

 // Race independent sources. One slow API should never block a cover that is already available elsewhere.
 if(full||preview)candidateJobs.push(candidate(Promise.resolve(full||preview),'catalogue'));
 candidateJobs.push(candidate(
  findItunesAlbum(a).then(album=>({url:storeArtworkUrl(album,600)})),
  'store'
 ));
 candidateJobs.push(candidate(
  findMusicBrainzGroup(a).then(group=>group?.id?{
   url:'https://coverartarchive.org/release-group/'+group.id+'/front-500',
   musicbrainz_id:group.id
  }:null),
  'musicbrainz'
 ));

 let winner=null;
 try{
  if(Promise.any)winner=await Promise.any(candidateJobs);
  else{
   const settled=await Promise.allSettled(candidateJobs);
   winner=settled.find(x=>x.status==='fulfilled')?.value||null;
  }
 }catch{}

 if(request!==artworkRequest||!pick||key(pick)!==key(a))return;
 if(!winner?.url){
  img.classList.remove('cover-loaded');
  return;
 }

 img.onerror=()=>{
  if(request!==artworkRequest)return;
  img.onerror=null;
  img.classList.remove('cover-loaded');
  img.src=fallback;
 };
 img.onload=()=>{if(request===artworkRequest)img.classList.add('cover-loaded')};
 img.src=winner.url;
 if(winner.musicbrainz_id){
  a.metadata={...(a.metadata||{}),musicbrainz_id:winner.musicbrainz_id,cover_art:winner.url};
 }else if(winner.source==='store'){
  a.metadata={...(a.metadata||{}),cover_art:winner.url};
 }
}

function artPlaceholder(a){
 const safe=x=>String(x||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const wrap=(v,n=18)=>{
  const words=String(v||'').split(/\s+/),lines=[''];
  for(const word of words){
   const i=lines.length-1;
   if((lines[i]+' '+word).trim().length>n&&lines.length<4)lines.push(word);
   else lines[i]=(lines[i]+' '+word).trim();
  }
  return lines;
 };
 const lines=wrap(a.title,17);
 const title=lines.map((v,i)=>'<text x="54" y="'+(300+i*58)+'" font-size="50" font-weight="900">'+safe(v)+'</text>').join('');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720"><rect width="720" height="720" fill="#e9e3d7"/><path d="M0 112H720M0 118H720M0 610H720" stroke="#111" stroke-width="3"/><g fill="#111" font-family="Arial, Helvetica, sans-serif"><text x="54" y="73" font-family="Courier New, monospace" font-size="14" font-weight="700" letter-spacing="3">COVER NOT FILED</text>'+title+'<text x="54" y="565" font-family="Courier New, monospace" font-size="18" font-weight="700">'+safe(a.artist).slice(0,46)+'</text></g><g transform="translate(456 58) rotate(-4)"><rect width="205" height="58" fill="#e6442f"/><text x="16" y="37" fill="#fff" font-family="Courier New, monospace" font-size="15" font-weight="700">IMAGE MISSING</text></g><circle cx="603" cy="542" r="62" fill="none" stroke="#111" stroke-width="3"/><circle cx="603" cy="542" r="9" fill="#111"/></svg>';
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}

function explainPick(a,context={}){
 if(context.rankingMode==='shared')return '';
 if(context.rankingMode==='surprise')return 'random pick.';
 if(context.rankingMode==='backend'&&a._backendRank?.reason)return a._backendRank.reason+'.';

 const note=$('feelingInput')?.value.trim()||'';
 const intent=correctedIntent(interpretFeeling(note));
 const reasons=[];
 const translatedMoodGuess=String(a.provenance?.moods?.source||'')==='musicbrainz-tag-translation';
 const translatedEnergyGuess=String(a.provenance?.energy?.source||'')==='musicbrainz-tag-translation';

 const reliableMoods=translatedMoodGuess
  ? []
  : (a.features?.moods&&Object.keys(a.features.moods).length
    ? Object.keys(a.features.moods)
    : (a.moods||[]));
 const albumMoodSet=new Set(reliableMoods.map(x=>String(x).toLowerCase()));
 const selectedMoodMatches=state.moods.filter(m=>{
  const vector=MOOD_SIGNAL_MAP[m]||{[m]:1};
  return Object.keys(vector).some(base=>albumMoodSet.has(base));
 });
 if(selectedMoodMatches.length)reasons.push(selectedMoodMatches.slice(0,2).join(' / '));

 const energyCandidates=[
  a._acoustic?.energy,
  a._live?.signals?.energy,
  translatedEnergyGuess?null:(a.features?.energy!=null?Number(a.features.energy)*10:null),
  translatedEnergyGuess?null:a.energy_level
 ].filter(v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v)));
 const actualEnergy=energyCandidates.length?Number(energyCandidates[0]):null;
 const targetEnergy=recommendationEnergy(intent);
 if(targetEnergy!==null&&actualEnergy!==null&&Math.abs(actualEnergy-Number(targetEnergy))<=2.5){
  reasons.push(actualEnergy<=3?'low energy':actualEnergy>=7?'high energy':'medium energy');
 }

 const familiarity=artistFamiliarity(a.artist);
 const comfort=recommendationComfort();
 const adjacency=tasteAdjacency(a);
 if(adjacency>=.35&&familiarity<.25)reasons.push('taste-neighbor');
 else if(comfort==='comfort'&&familiarity>=.2)reasons.push('known artist');
 else if(comfort==='exploration'&&familiarity<=.15)reasons.push('new artist');

 if(state.time!==null){
  const rawMinutes=[a._live?.runtimeMin,a._semantic?.runtimeMin,a.features?.duration_min,a.length_min]
   .find(v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0);
  const minutes=rawMinutes===undefined?null:Number(rawMinutes);
  if(minutes!==null&&minutes<=Number(state.time)+3)reasons.push(Math.round(minutes)+' min');
 }

 if(note&&['semantic','live','stored'].includes(context.rankingMode)){
  const genre=(intent.genres||[])[0];
  if(genre)reasons.push(genre);
 }

 const personal=diaryTasteScore(a);
 if(personal.active&&personal.score>.65)reasons.push('diary overlap');

 const unique=[...new Set(reasons.filter(Boolean))];
 return unique.length?unique.slice(0,3).join(' · ')+'.':'';
}
const interpretFeeling=globalThis.AlbumIntent?.interpretFeeling||(()=>({moods:{},avoidMoods:{},genres:[],avoidGenres:[],energy:null,exploration:0,summary:''}));
if($('todayDate')){
 const d=new Date();
 $('todayDate').textContent=d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}).toUpperCase();
}
const feelingInput=$('feelingInput');
if(feelingInput){
 const updateInsight=()=>{
  const insight=$('feelingInsight');
  if(insight)insight.textContent='';
 };
 updateInsight();
 feelingInput.addEventListener('input',()=>{
  updateInsight();
  invalidateDailyPick();
  savePickerState();
  updatePickerStateUI();
 });
 $('clearFeeling').addEventListener('click',()=>{
  feelingInput.value='';
  updateInsight();
  invalidateDailyPick();
  savePickerState();
  updatePickerStateUI();
  feelingInput.focus();
 });
 feelingInput.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();chooseDaily()}});
}
const resetButton=$('resetPicker');
if(resetButton){
 resetButton.onclick=e=>{
  e.preventDefault();
  resetPicker();
 };
}

async function copyText(text){
 if(navigator.clipboard?.writeText){
  try{
   await navigator.clipboard.writeText(text);
   return true;
  }catch{}
 }
 const area=document.createElement('textarea');
 area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';
 document.body.append(area);area.select();
 const ok=document.execCommand('copy');
 area.remove();
 return ok;
}
$('sharePick')?.addEventListener('click',async()=>{
 if(!pick)return;
 const url=new URL(location.origin+location.pathname);
 url.searchParams.set('a',lookupId(pick));
 const text=`${pick.title} — ${pick.artist} · An Album a Day`;
 try{
  if(navigator.share)await navigator.share({title:`${pick.title} — ${pick.artist}`,text,url:url.toString()});
  else{
   const copied=await copyText(text+'\n'+url.toString());
   showToast(copied?'Record link copied.':'Could not copy the record link.');
  }
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
  showToast('reading Last.fm history…');
  const taste=buildLastfmTaste(parseCsv(await file.text()));
  localStorage.setItem('albumaday.lastfmTaste',JSON.stringify(taste));
  lastfmTaste=taste;
  lastfmTasteMap=buildLastfmTasteMap(taste);
  lastfmNeighborMap=buildLastfmNeighborMap(taste);
  invalidateTasteCaches();renderHistory();
  showToast(`Last.fm imported: ${taste.unique_artists.toLocaleString()} artists. The CSV stayed on this device.`);
 }catch(err){console.warn(err);showToast('Could not read that Last.fm CSV.')}
 e.target.value='';
});
$('clearLastfm')?.addEventListener('click',()=>{
 try{localStorage.removeItem('albumaday.lastfmTaste')}catch{}
 lastfmTaste=null;lastfmTasteMap=new Map();lastfmNeighborMap=new Map();invalidateTasteCaches();renderHistory();showToast('Last.fm data cleared.');
});

$('deepenLastfm')?.addEventListener('click',async()=>{
 if(!lastfmTaste?.artists?.length){showToast('Import Last.fm first.');return}
 const endpoint=backendUrl('/api/artist-neighbors');
 if(!endpoint){showToast('Collaborative graph is available on the live site.');return}
 const button=$('deepenLastfm');
 const original=button.textContent;
 button.disabled=true;button.textContent='building graph…';
 try{
  const artists=lastfmTaste.artists.slice(0,8).map(([name,weight])=>({name,weight}));
  const response=await fetch(endpoint,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({artists,mode:'medium'})
  });
  if(!response.ok)throw Error('artist neighbors HTTP '+response.status);
  const data=await response.json();
  const neighbors=Array.isArray(data.neighbors)?data.neighbors:[];
  lastfmTaste={
   ...lastfmTaste,
   neighbors,
   neighbor_source:String(data.source||'listenbrainz-artist-radio'),
   neighbor_seed_count:Number(data.resolvedSeeds)||0,
   neighbor_updated_at:new Date().toISOString()
  };
  localStorage.setItem('albumaday.lastfmTaste',JSON.stringify(lastfmTaste));
  lastfmNeighborMap=buildLastfmNeighborMap(lastfmTaste);
  invalidateTasteCaches();renderHistory();
  showToast(
   neighbors.length
    ? `added ${neighbors.length} listening-neighbors — raw CSV stayed local.`
    : 'No reliable listening-neighbors found for those seeds.'
  );
 }catch(err){
  console.warn('Last.fm graph enrichment failed',err);
  showToast('Could not deepen the Last.fm graph right now.');
 }finally{
  button.disabled=false;
  button.textContent=lastfmTaste?.neighbors?.length?'refresh Last.fm graph':original;
 }
});

async function diaryTasteTrainingRows(limit=60){
 const rated=[...logs].filter(entry=>Number(entry.rating)>0).slice(-limit);
 if(!rated.length)return [];

 const byId=new Map(albums.map(album=>[lookupId(album),album]));
 const lookup=await getCatalogLookupIndex();
 const files=[];
 for(const entry of rated){
  const id=lookupId({artist:entry.artist,title:entry.album});
  if(byId.has(id))continue;
  const file=lookup?.[id];
  if(file&&!files.includes(file))files.push(file);
 }
 if(files.length)await Promise.all(files.slice(0,24).map(loadSpecificShard));

 const refreshed=new Map(albums.map(album=>[lookupId(album),album]));
 return rated.map(entry=>{
  const id=lookupId({artist:entry.artist,title:entry.album});
  const album=refreshed.get(id);
  if(!album)return null;
  const candidate=backendCandidate(album,interpretFeeling(''),0);
  const snap=entry.signal_snapshot||{};
  const audioSnapshot=snap.source==='acousticbrainz-selected-sample';

  if(snap.moods&&typeof snap.moods==='object'&&Object.keys(snap.moods).length){
   candidate.moods=Object.entries(snap.moods)
    .sort((a,b)=>Number(b[1])-Number(a[1]))
    .map(([name])=>name)
    .slice(0,12);
   candidate.moodSource=audioSnapshot?'diary-acousticbrainz':'diary-snapshot';
   candidate.moodConfidence=audioSnapshot?.88:.62;
  }
  if(Number.isFinite(Number(snap.energy))){
   candidate.energy=Number(snap.energy);
   candidate.energySource=audioSnapshot?'diary-acousticbrainz':'diary-snapshot';
   candidate.energyConfidence=audioSnapshot?.9:.62;
  }

  const extraTags=[];
  if(Number(snap.acoustic)>=.68)extraTags.push('acoustic');
  if(Number(snap.instrumental)>=.68)extraTags.push('instrumental');
  if(Number.isFinite(Number(snap.bpm))&&Number(snap.bpm)>=135)extraTags.push('fast tempo');
  if(Number.isFinite(Number(snap.bpm))&&Number(snap.bpm)<=80)extraTags.push('slow tempo');
  candidate.tags=mergeUnique([...(candidate.tags||[]),...extraTags]).slice(0,24);

  return {rating:Number(entry.rating),album:candidate};
 }).filter(Boolean);
}

$('trainFromDiary')?.addEventListener('click',async()=>{
 const button=$('trainFromDiary');
 const endpoint=backendUrl('/api/taste-bootstrap');
 if(!endpoint){showToast('Taste training is available on the live site.');return}
 const original=button.textContent;
 button.disabled=true;button.textContent='training…';
 try{
  const ratings=await diaryTasteTrainingRows(60);
  if(!ratings.length){showToast('No rated catalog records to train from yet.');return}
  const response=await fetch(endpoint,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({client_id:clientFeedbackId(),ratings})
  });
  if(!response.ok)throw Error('taste bootstrap HTTP '+response.status);
  const data=await response.json();
  showToast(
   data.learned
    ? `trained on ${data.learned} rated record${data.learned===1?'':'s'} — notes stayed local.`
    : 'those ratings are already in the taste model.'
  );
 }catch(err){
  console.warn('Diary taste training failed',err);
  showToast('Could not train from the diary right now.');
 }finally{
  button.textContent=original;
  button.disabled=!logs.some(x=>Number(x.rating)>0);
 }
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
