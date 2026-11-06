(()=>{
'use strict';

const $=id=>document.getElementById(id);
const Core=window.AlbumSupporterCore;
const MONTHS=['','jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function readJSON(key,fallback){
 try{
  const value=JSON.parse(localStorage.getItem(key)||'null');
  return value??fallback;
 }catch{return fallback}
}
function state(){
 return {
  diary:readJSON('albumaday.logs',[]),
  seenKeys:readJSON('albumaday.seenKeys.v1',[]),
  pickDays:readJSON('albumaday.pickDays',[]),
  lastfmProfile:readJSON('albumaday.lastfmTaste',null)
 };
}
function isSupporter(){return Boolean(window.AlbumAuth?.isSupporter?.())}
function currentUser(){return window.AlbumAuth?.user?.()||null}
function clean(value){return String(value??'').trim()}
function number(value,fallback='—'){return Number.isFinite(Number(value))?Number(value).toLocaleString():fallback}
function rating(value){return Number.isFinite(value)?value.toFixed(1)+'★':'—'}
function energyLabel(value){
 if(!Number.isFinite(value))return 'building';
 if(value<3.5)return 'low';
 if(value<6.8)return 'mid';
 return 'high';
}
function clear(node){if(node)node.replaceChildren()}
function el(tag,className,text){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=String(text);
 return node;
}
function renderList(id,items,empty='not enough data yet'){
 const node=$(id);if(!node)return;
 clear(node);
 if(!items?.length){
  node.append(el('p','studio-empty',empty));return;
 }
 const max=Math.max(...items.map(item=>Number(item.count)||0),1);
 for(const item of items){
  const row=el('div','studio-rank-row');
  const copy=el('div','studio-rank-copy');
  copy.append(el('strong','',item.name),el('span','',Number(item.count).toFixed(Number(item.count)%1?1:0)));
  const meter=el('div','studio-meter');
  const fill=el('i','');
  fill.style.width=Math.max(7,Math.round((Number(item.count)||0)/max*100))+'%';
  meter.append(fill);row.append(copy,meter);node.append(row);
 }
}
function renderRatingDistribution(id,distribution){
 const node=$(id);if(!node)return;
 clear(node);
 const max=Math.max(...(distribution||[]),1);
 (distribution||[]).forEach((count,index)=>{
  const row=el('div','rating-dist-row');
  row.append(el('span','',String(index+1)+'★'));
  const meter=el('div','studio-meter');
  const fill=el('i','');fill.style.width=(count?Math.max(8,Math.round(count/max*100)):0)+'%';
  meter.append(fill);
  row.append(meter,el('b','',count||0));node.append(row);
 });
}
function metric(id,value,sub){
 const node=$(id);if(!node)return;
 const strong=node.querySelector('strong'),small=node.querySelector('small');
 if(strong)strong.textContent=value;
 if(small&&sub!==undefined)small.textContent=sub;
}
function identityName(email){
 const local=clean(email).split('@')[0].replace(/[._-]+/g,' ').replace(/\s+/g,' ').trim();
 return local||'listener';
}
function initials(email){
 return identityName(email).split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()||'AA';
}
function renderTasteTags(stats){
 const node=$('studioTasteTags');if(!node)return;
 clear(node);
 const names=[
  ...stats.topGenres.slice(0,5).map(x=>x.name),
  ...stats.topMoods.slice(0,5).map(x=>x.name)
 ].filter((name,index,array)=>name&&array.findIndex(x=>x.toLowerCase()===name.toLowerCase())===index).slice(0,10);
 if(!names.length){node.append(el('span','studio-chip muted','save + rate records to build this'));return}
 names.forEach(name=>node.append(el('span','studio-chip',name)));
}

function renderTasteSentence(stats){
 const node=$('studioTasteSentence');if(!node)return;
 const genre=stats.topGenres[0]?.name;
 const mood=stats.topMoods[0]?.name;
 const artist=stats.topArtists[0]?.name;
 const energy=energyLabel(stats.averageEnergy);
 if(!genre&&!mood&&!artist){
  node.textContent='save and rate a few records and this starts sounding like you.';
  return;
 }
 const pieces=[];
 if(genre&&mood)pieces.push(`your shelf leans ${genre} / ${mood}`);
 else if(genre)pieces.push(`your shelf leans ${genre}`);
 else if(mood)pieces.push(`your shelf leans ${mood}`);
 if(Number.isFinite(stats.averageEnergy))pieces.push(`${energy} energy overall`);
 if(artist)pieces.push(`${artist} appears most often`);
 node.textContent=pieces.join('. ')+'.';
}

function renderFiveStarShelf(diary){
 const node=$('studioFiveStarShelf');if(!node)return;
 clear(node);
 const rows=[...(diary||[])]
  .filter(entry=>Number(entry?.rating)>=5)
  .reverse()
  .slice(0,6);
 if(!rows.length){
  node.append(el('p','studio-empty','your 5★ records will live here.'));
  return;
 }
 for(const entry of rows){
  const card=el('article','studio-record-card');
  const art=el('div','studio-record-art');
  if(entry.cover_art){
   const img=document.createElement('img');
   img.src=entry.cover_art;img.alt='';img.loading='lazy';
   img.onerror=()=>{img.remove();art.classList.add('fallback')};
   art.append(img);
  }else art.classList.add('fallback');
  const copy=el('div','studio-record-copy');
  copy.append(
   el('strong','',entry.album||'Untitled'),
   el('span','',entry.artist||'Unknown artist'),
   el('small','','★★★★★')
  );
  card.append(art,copy);node.append(card);
 }
}
function renderProfile(s){
 const stats=Core.buildStats(s);
 const user=currentUser();
 const email=clean(user?.email);
 $('studioAvatar').textContent=initials(email);
 $('studioProfileName').textContent=identityName(email);
 $('studioProfileEmail').textContent=email||'supporter account';
 $('studioProfileLine').textContent=`${stats.listened} listened · ${stats.savedLater} saved later · ${stats.uniqueArtists} artists`;
 renderTasteTags(stats);
 renderTasteSentence(stats);
 renderFiveStarShelf(s.diary);
 renderList('studioTopArtists',stats.topArtists.slice(0,6),'your artist orbit appears after you save records');
 renderList('studioFavoriteTracks',stats.favoriteTracks.slice(0,6),'favorite tracks you log will collect here');

 const lastfm=$('studioLastfm');
 if(lastfm){
  clear(lastfm);
  if(stats.lastfmScrobbles||stats.lastfmArtists){
   lastfm.append(
    el('strong','',stats.lastfmScrobbles.toLocaleString()+' scrobbles'),
    el('span','',stats.lastfmArtists.toLocaleString()+' artists imported from Last.fm')
   );
   const neighbors=(s.lastfmProfile?.neighbors||[]).slice(0,5).map(row=>Array.isArray(row)?row[0]:row).filter(Boolean);
   if(neighbors.length)lastfm.append(el('small','','neighbors · '+neighbors.join(' / ')));
  }else{
   lastfm.append(el('strong','','no Last.fm layer yet'),el('span','','import your CSV from the diary to deepen the profile'));
  }
 }
}
function renderMonthActivity(stats){
 const node=$('studioMonths');if(!node)return;
 clear(node);
 const values=Array.from({length:12},(_,i)=>Number(stats.monthCounts[String(i+1)]||0));
 const max=Math.max(...values,1);
 values.forEach((count,index)=>{
  const col=el('div','month-col');
  const bar=el('i','');bar.style.height=(count?Math.max(8,Math.round(count/max*100)):2)+'%';
  col.append(el('b','',count||''),bar,el('span','',MONTHS[index+1]));
  node.append(col);
 });
}
function renderStats(s){
 const all=Core.buildStats(s);
 const year=new Date().getFullYear();
 const current=Core.buildStats(s,year);
 metric('studioMetricSaved',number(all.listened),'albums listened');
 metric('studioMetricPulled',number(all.savedLater),'saved for later');
 metric('studioMetricArtists',number(all.uniqueArtists),'unique artists');
 metric('studioMetricAverage',rating(all.averageRating),'average rating');
 metric('studioMetricFive',number(all.fiveStar),'five-star records');
 metric('studioMetricDays',number(all.daysPicked),'days picked');
 metric('studioMetricStreak',number(all.currentStreak),'current streak');
 metric('studioMetricLongest',number(all.longestStreak),'longest streak');
 metric('studioMetricTime',Core.hoursLabel(all.listeningMinutes),all.listeningMinutes===null?'runtime data starts with new saves':Math.round(all.durationCoverage*100)+'% runtime coverage');
 metric('studioMetricEnergy',Number.isFinite(all.averageEnergy)?all.averageEnergy.toFixed(1)+'/10':'—',energyLabel(all.averageEnergy)+' energy');

 $('studioActivityYear').textContent=String(year);
 renderMonthActivity(current);
 renderList('studioStatsArtists',all.topArtists.slice(0,8));
 renderList('studioStatsGenres',all.topGenres.slice(0,8));
 renderList('studioStatsMoods',all.topMoods.slice(0,8));
 renderRatingDistribution('studioRatings',all.ratingDistribution);
}
function wrappedCard(label,value,copy=''){
 const card=el('article','wrapped-card');
 card.append(el('small','',label),el('strong','',value),el('span','',copy));
 return card;
}
function renderWrapped(s,year){
 const stats=Core.buildStats(s,year);
 const grid=$('wrappedGrid');if(!grid)return;
 clear(grid);
 const share=$('shareWrapped'),story=$('storyWrapped');
 if(share)share.disabled=!stats.listened;
 if(story)story.disabled=!stats.listened;
 if(!stats.listened){
  const empty=el('div','wrapped-empty');
  empty.append(
   el('small','','ALBUM-A-DAY WRAPPED / '+year),
   el('strong','','nothing to wrap yet.'),
   el('p','','save your first record of the year and this page starts building itself.')
  );
  grid.append(empty);
  const summary=$('wrappedSummary');
  if(summary)summary.textContent='your '+year+' Wrapped is waiting for its first saved record.';
  return;
 }
 const topArtist=stats.topArtists[0]?.name||'still collecting';
 const topGenre=stats.topGenres[0]?.name||'still collecting';
 const topMood=stats.topMoods[0]?.name||'still collecting';
 const best=stats.topRated?stats.topRated.artist+' — '+stats.topRated.album:'still collecting';
 const fav=stats.favoriteTracks[0]?.name||'still collecting';
 const month=stats.biggestMonth?MONTHS[Number(stats.biggestMonth.name)]||stats.biggestMonth.name:'still collecting';

 grid.append(
  wrappedCard('records finished',stats.listened,'front to back'),
  wrappedCard('days you showed up',stats.daysPicked,'album days'),
  wrappedCard('artist of the year',topArtist,stats.topArtists[0]?Math.round(stats.topArtists[0].count)+' saved record'+(stats.topArtists[0].count===1?'':'s'):''),
  wrappedCard('genre orbit',topGenre,'your most-saved lane'),
  wrappedCard('average rating',stats.averageRating!==null?stats.averageRating.toFixed(1)+'★':'—',stats.fiveStar+' five-star record'+(stats.fiveStar===1?'':'s')),
  wrappedCard('record of the year',best,stats.topRated?.rating?stats.topRated.rating+'★':''),
  wrappedCard('favorite track',fav,'most logged favorite'),
  wrappedCard('mood of the year',topMood,'from your saved record signals'),
  wrappedCard('biggest month',month,stats.biggestMonth?Math.round(stats.biggestMonth.count)+' saved':''),
  wrappedCard('listening time',Core.hoursLabel(stats.listeningMinutes),stats.listeningMinutes===null?'starts accumulating with new saves':'known album runtimes')
 );
 const summary=$('wrappedSummary');
 if(summary)summary.textContent=Core.wrappedSummary(stats);
}
function renderYearOptions(s){
 const select=$('wrappedYear');if(!select)return;
 const chosen=Number(select.value)||new Date().getFullYear();
 clear(select);
 for(const year of Core.availableYears(s)){
  const option=document.createElement('option');
  option.value=String(year);option.textContent=String(year);
  if(year===chosen)option.selected=true;
  select.append(option);
 }
 if(!select.value)select.value=String(Core.availableYears(s)[0]);
}
function switchTab(name,focus=false){
 document.querySelectorAll('[data-studio-tab]').forEach(button=>{
  const active=button.dataset.studioTab===name;
  button.setAttribute('aria-selected',String(active));
  button.tabIndex=active?0:-1;
  if(active&&focus)button.focus();
 });
 document.querySelectorAll('[data-studio-panel]').forEach(panel=>panel.hidden=panel.dataset.studioPanel!==name);
}
function render(){
 if(!Core)return;
 const s=state();
 renderProfile(s);renderStats(s);renderYearOptions(s);
 renderWrapped(s,Number($('wrappedYear')?.value)||new Date().getFullYear());
}
function renderAccess(){
 const active=isSupporter();
 const signedIn=Boolean(window.AlbumAuth?.isSignedIn?.());
 const ready=Boolean(window.AlbumAuth?.supporterReady?.());
 const resolving=signedIn&&!ready;
 for(const id of ['supporterStudioOpen','supporterStudioDrawer'])if($(id))$(id).hidden=!active;
 for(const id of ['supporterStudioTeaser','supporterShelfTeaser'])if($(id))$(id).hidden=active||resolving;
}
function open(){
 if(!isSupporter()){
  window.AlbumAuth?.open?.();return;
 }
 render();
 const dialog=$('supporterStudioDialog');
 if(dialog&&!dialog.open)dialog.showModal();
}
async function shareWrapped(){
 const summary=clean($('wrappedSummary')?.textContent);
 if(!summary)return;
 try{
  if(navigator.share){
   await navigator.share({title:'My Album-a-Day Wrapped',text:summary,url:location.origin+location.pathname});
   return;
  }
  await navigator.clipboard.writeText(summary);
  window.showToast?.('Wrapped copied.');
 }catch(error){
  if(error?.name!=='AbortError')window.showToast?.('Could not share Wrapped.');
 }
}

function wrapCanvasText(ctx,text,x,y,maxWidth,lineHeight,maxLines=4){
 const words=String(text||'').split(/\s+/);
 const lines=[];let line='';
 for(const word of words){
  const test=line?line+' '+word:word;
  if(ctx.measureText(test).width>maxWidth&&line){
   lines.push(line);line=word;
   if(lines.length>=maxLines-1)break;
  }else line=test;
 }
 if(line&&lines.length<maxLines)lines.push(line);
 lines.forEach((value,index)=>ctx.fillText(value,x,y+index*lineHeight));
 return y+lines.length*lineHeight;
}
async function storyWrapped(){
 const year=Number($('wrappedYear')?.value)||new Date().getFullYear();
 const stats=Core.buildStats(state(),year);
 const canvas=document.createElement('canvas');
 canvas.width=1080;canvas.height=1920;
 const ctx=canvas.getContext('2d');
 if(!ctx)return;

 ctx.fillStyle='#eee7da';ctx.fillRect(0,0,1080,1920);
 ctx.fillStyle='#101010';ctx.fillRect(72,70,936,18);
 ctx.font='700 30px Courier New, monospace';ctx.fillText('AN ALBUM A DAY / '+year,72,142);
 ctx.fillStyle='#3156ed';ctx.fillRect(72,190,936,360);
 ctx.fillStyle='#ffffff';ctx.font='900 112px Arial Black, Arial, sans-serif';
 wrapCanvasText(ctx,'MY YEAR IN RECORDS',108,315,850,105,3);

 const items=[
  ['ALBUMS FINISHED',String(stats.listened)],
  ['ARTIST OF THE YEAR',stats.topArtists[0]?.name||'STILL COLLECTING'],
  ['RECORD OF THE YEAR',stats.topRated?stats.topRated.artist+' — '+stats.topRated.album:'STILL COLLECTING'],
  ['GENRE ORBIT',stats.topGenres[0]?.name||'STILL COLLECTING'],
  ['AVERAGE RATING',stats.averageRating!==null?stats.averageRating.toFixed(1)+'★':'—']
 ];
 let y=650;
 items.forEach((item,index)=>{
  const bg=['#d8ff4a','#f3b8c8','#f7df62','#ffffff','#d8ff4a'][index];
  ctx.fillStyle='#101010';ctx.fillRect(72,y,936,4);
  ctx.font='700 24px Courier New, monospace';ctx.fillText(item[0],72,y+52);
  ctx.fillStyle=bg;ctx.fillRect(72,y+78,936,178);
  ctx.fillStyle='#101010';ctx.font='900 54px Arial Black, Arial, sans-serif';
  wrapCanvasText(ctx,String(item[1]).toUpperCase(),102,y+148,870,56,2);
  y+=275;
 });
 ctx.fillStyle='#101010';ctx.font='700 24px Courier New, monospace';
 ctx.fillText('ONE RECORD. NO REPEATS. FRONT TO BACK.',72,1855);

 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 if(!blob)return;
 const file=new File([blob],`album-a-day-wrapped-${year}.png`,{type:'image/png'});
 try{
  if(navigator.canShare?.({files:[file]})&&navigator.share){
   await navigator.share({title:`My ${year} Album-a-Day Wrapped`,files:[file]});
   return;
  }
 }catch(error){
  if(error?.name==='AbortError')return;
 }
 const url=URL.createObjectURL(blob);
 const a=document.createElement('a');
 a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 window.showToast?.('Story card saved.');
}
function bind(){
 $('supporterStudioOpen')?.addEventListener('click',open);
 $('supporterStudioDrawer')?.addEventListener('click',open);
 $('supporterTeaserOpen')?.addEventListener('click',()=>{
  window.AlbumAnalytics?.track('supporter_teaser_opened',{surface:'diary'});
  window.AlbumAuth?.open?.();
 });
 $('closeSupporterStudio')?.addEventListener('click',()=>$('supporterStudioDialog')?.close());
 $('wrappedYear')?.addEventListener('change',()=>renderWrapped(state(),Number($('wrappedYear').value)));
 $('shareWrapped')?.addEventListener('click',shareWrapped);
 $('storyWrapped')?.addEventListener('click',storyWrapped);
 const tabs=[...document.querySelectorAll('[data-studio-tab]')];
 tabs.forEach((button,index)=>{
  button.addEventListener('click',()=>{
   switchTab(button.dataset.studioTab);
   if(button.dataset.studioTab==='wrapped')window.AlbumAnalytics?.track('wrapped_opened',{year:Number($('wrappedYear')?.value)||new Date().getFullYear()});
  });
  button.addEventListener('keydown',event=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   event.preventDefault();
   let next=index;
   if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;
   if(event.key==='ArrowRight')next=(index+1)%tabs.length;
   if(event.key==='Home')next=0;
   if(event.key==='End')next=tabs.length-1;
   switchTab(tabs[next].dataset.studioTab,true);
  });
 });
 window.addEventListener('albumaday:datachange',()=>{if($('supporterStudioDialog')?.open)render()});
 window.addEventListener('albumaday:supporterchange',()=>{renderAccess();if(!isSupporter()&&$('supporterStudioDialog')?.open)$('supporterStudioDialog').close()});
 window.addEventListener('pageshow',renderAccess);
 renderAccess();
 switchTab('profile');
}
window.AlbumSupporterStudio={open,render};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
else bind();
})();