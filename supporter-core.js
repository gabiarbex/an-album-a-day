(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AlbumSupporterCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

function clean(value){return String(value??'').trim()}
function yearOf(value){
 const match=clean(value).match(/^(\d{4})/);
 return match?Number(match[1]):null;
}
function monthOf(value){
 const match=clean(value).match(/^\d{4}-(\d{2})/);
 return match?Number(match[1]):null;
}
function normalizeArtist(value){return clean(value).toLowerCase().replace(/\s+/g,' ')}
function normalizeEnergy(value){
 const n=Number(value);
 if(!Number.isFinite(n))return null;
 return Math.max(0,Math.min(10,n<=1?n*10:n));
}
function positiveNumber(value){
 const n=Number(value);
 return Number.isFinite(n)&&n>0?n:null;
}
function increment(map,key,weight=1){
 const name=clean(key);
 const amount=Number(weight);
 if(!name||!Number.isFinite(amount)||amount<=0)return;
 map.set(name,(map.get(name)||0)+amount);
}
function ranked(map,limit=8){
 return [...map.entries()]
  .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
  .slice(0,limit)
  .map(([name,count])=>({name,count}));
}
function moodsFrom(snapshot){
 const moods=snapshot?.moods;
 if(Array.isArray(moods))return moods.map(name=>[clean(name),1]).filter(([name])=>name);
 if(moods&&typeof moods==='object')return Object.entries(moods)
  .map(([name,weight])=>[clean(name),Number(weight)||0])
  .filter(([name,weight])=>name&&weight>0);
 return [];
}
function longestStreak(days){
 const sorted=[...new Set((days||[]).map(clean).filter(Boolean))].sort();
 if(!sorted.length)return 0;
 let best=1,current=1;
 for(let i=1;i<sorted.length;i+=1){
  const a=new Date(sorted[i-1]+'T12:00:00Z');
  const b=new Date(sorted[i]+'T12:00:00Z');
  const delta=Math.round((b-a)/86400000);
  if(delta===1){current+=1;best=Math.max(best,current)}
  else if(delta>1)current=1;
 }
 return best;
}
function currentStreak(days,now=new Date()){
 const set=new Set((days||[]).map(clean).filter(Boolean));
 let streak=0;
 const d=new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate(),12));
 const iso=x=>x.toISOString().slice(0,10);
 while(set.has(iso(d))){
  streak+=1;
  d.setUTCDate(d.getUTCDate()-1);
 }
 return streak;
}
function topRated(diary){
 return [...diary]
  .filter(entry=>Number(entry?.rating)>0)
  .sort((a,b)=>{
   const rating=Number(b.rating)-Number(a.rating);
   if(rating)return rating;
   const notes=clean(b.notes).length-clean(a.notes).length;
   if(notes)return notes;
   return clean(b.date).localeCompare(clean(a.date));
  })[0]||null;
}
function stateSlice(state,year=null){
 const diary=Array.isArray(state?.diary)?state.diary.filter(Boolean):[];
 const pickDays=Array.isArray(state?.pickDays)?state.pickDays:[];
 if(!year)return {diary,pickDays};
 return {
  diary:diary.filter(entry=>yearOf(entry?.date)===Number(year)),
  pickDays:pickDays.filter(day=>yearOf(day)===Number(year))
 };
}
function buildStats(state={},year=null,now=new Date()){
 const sliced=stateSlice(state,year);
 const diary=sliced.diary;
 const pickDays=sliced.pickDays;
 const artistCounts=new Map(),genreCounts=new Map(),moodCounts=new Map(),trackCounts=new Map(),monthCounts=new Map();
 const ratings=[0,0,0,0,0,0];
 let ratingSum=0,rated=0,energySum=0,energyCount=0,minutes=0,minutesKnown=0;

 for(const entry of diary){
  increment(artistCounts,entry.artist);
  increment(genreCounts,entry.genre);
  const rating=Number(entry.rating);
  if(Number.isFinite(rating)&&rating>=1&&rating<=5){
   ratings[Math.round(rating)]+=1;
   ratingSum+=rating;rated+=1;
  }
  for(const [name,weight] of moodsFrom(entry.signal_snapshot))increment(moodCounts,name,weight);
  const energy=normalizeEnergy(entry.signal_snapshot?.energy);
  if(energy!==null){energySum+=energy;energyCount+=1}
  const duration=positiveNumber(entry.duration_min);
  if(duration){minutes+=duration;minutesKnown+=1}
  increment(trackCounts,entry.favorite_track);
  const month=monthOf(entry.date);
  if(month)increment(monthCounts,String(month),1);
 }

 const uniqueArtists=new Set(diary.map(entry=>normalizeArtist(entry.artist)).filter(Boolean)).size;
 const lastfm=state?.lastfmProfile&&typeof state.lastfmProfile==='object'?state.lastfmProfile:null;
 const pulled=Array.isArray(state?.seenKeys)?state.seenKeys.length:0;
 const allDays=Array.isArray(state?.pickDays)?state.pickDays:[];

 return {
  year:year?Number(year):null,
  saved:diary.length,
  pulled,
  uniqueArtists,
  rated,
  averageRating:rated?ratingSum/rated:null,
  fiveStar:ratings[5]||0,
  ratingDistribution:ratings.slice(1),
  topArtists:ranked(artistCounts,8),
  topGenres:ranked(genreCounts,8),
  topMoods:ranked(moodCounts,8),
  favoriteTracks:ranked(trackCounts,8),
  averageEnergy:energyCount?energySum/energyCount:null,
  listeningMinutes:minutesKnown?Math.round(minutes):null,
  durationCoverage:diary.length?minutesKnown/diary.length:0,
  daysPicked:pickDays.length,
  currentStreak:year?null:currentStreak(allDays,now),
  longestStreak:longestStreak(year?pickDays:allDays),
  monthCounts:Object.fromEntries(monthCounts),
  biggestMonth:ranked(monthCounts,1)[0]||null,
  topRated:topRated(diary),
  lastfmScrobbles:Number(lastfm?.total_scrobbles)||0,
  lastfmArtists:Number(lastfm?.unique_artists)||0,
  lastfmNeighbors:Array.isArray(lastfm?.neighbors)?lastfm.neighbors.slice(0,8):[]
 };
}
function availableYears(state={},now=new Date()){
 const years=new Set([now.getFullYear()]);
 for(const entry of state.diary||[]){
  const y=yearOf(entry?.date);if(y)years.add(y);
 }
 for(const day of state.pickDays||[]){
  const y=yearOf(day);if(y)years.add(y);
 }
 return [...years].sort((a,b)=>b-a);
}
function hoursLabel(minutes){
 if(!Number.isFinite(minutes)||minutes<=0)return 'building';
 if(minutes<60)return Math.round(minutes)+' min';
 const hours=minutes/60;
 return (hours>=10?Math.round(hours):hours.toFixed(1))+' hr';
}
function wrappedSummary(stats){
 const year=stats.year||new Date().getFullYear();
 const parts=[`my ${year} in records: ${stats.saved} album${stats.saved===1?'':'s'} saved`];
 if(stats.topArtists[0])parts.push(`top artist: ${stats.topArtists[0].name}`);
 if(stats.topGenres[0])parts.push(`top genre: ${stats.topGenres[0].name}`);
 if(stats.averageRating!==null)parts.push(`avg rating: ${stats.averageRating.toFixed(1)}★`);
 if(stats.topRated)parts.push(`record of the year: ${stats.topRated.artist} — ${stats.topRated.album}`);
 return parts.join(' · ')+' · An Album a Day';
}
return {buildStats,availableYears,hoursLabel,wrappedSummary,yearOf,longestStreak,currentStreak};
});