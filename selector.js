'use strict';
let albums=[],logs=[],pick=null,rating=0;const state={moods:[],energy:null,comfort:null,time:null};const $=id=>document.getElementById(id);const moods=['dark','cold','intense','reflective','energetic','melancholic','gritty','alienated','nostalgic','warm','dreamy','hopeful'];const groups=[['moods',moods],['energy',[['low',2],['medium',5],['high',9]]],['comfort',['comfort','exploration']],['time',[['30 min',30],['45 min',45],['60 min',60],['any length',null]]]];
for(const [id,values] of groups){const parent=$(id);values.forEach(v=>{const label=Array.isArray(v)?v[0]:v,value=Array.isArray(v)?v[1]:v,b=document.createElement('button');b.className='chip';b.type='button';b.textContent=label;b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{if(id==='moods'){state.moods=state.moods.includes(value)?state.moods.filter(x=>x!==value):[...state.moods,value]}else state[id]=value;parent.querySelectorAll('button').forEach(x=>{const active=id==='moods'?state.moods.includes(x._value):x===b;x.classList.toggle('selected',active);x.setAttribute('aria-pressed',String(active))})});b._value=value;parent.append(b)})}
function key(a){return `${String(a.artist||'').toLowerCase()}::${String(a.title||'').toLowerCase()}`}
function getDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function readSeen(){try{return new Set(JSON.parse(localStorage.getItem('albumaday.seen')||'[]'))}catch{return new Set()}}
let seenAlbums=readSeen();
function readLogs(){try{return JSON.parse(localStorage.getItem('albumaday.logs')||'[]')}catch{return []}}
logs=readLogs();function persist(){localStorage.setItem('albumaday.logs',JSON.stringify(logs));renderHistory()}
function renderHistory(){$('count').textContent=logs.length;const area=$('history');area.replaceChildren();if(!logs.length){area.textContent='Your listening story starts here. ✳';return}for(const entry of [...logs].reverse()){const item=document.createElement('div');item.className='history-item';const date=document.createElement('small');date.textContent=entry.date;const name=document.createElement('strong');name.textContent=`${entry.artist} — ${entry.album}`;const sub=document.createElement('div');sub.textContent=`${'★'.repeat(entry.rating||0)}${'☆'.repeat(5-(entry.rating||0))}${entry.favorite_track?' · '+entry.favorite_track:''}`;item.append(date,name,sub);if(entry.notes){const p=document.createElement('p');p.textContent=entry.notes;item.append(p)}area.append(item)}}renderHistory();
async function load(){try{const response=await fetch('./data/albums.json',{cache:'no-store'});if(!response.ok)throw Error(`HTTP ${response.status}`);const json=await response.json();albums=(Array.isArray(json)?json:json.albums||[]).filter(a=>a.title&&a.artist);$('status').textContent=`${albums.length} albums ready to discover ✳`;if(!albums.length)throw Error('No albums found')}catch(e){$('status').textContent='Could not load albums. Run with Live Server and check data/albums.json.';console.error(e)}}load();
function score(a){let s=0;const am=(a.moods||[]).map(x=>String(x).toLowerCase());for(const m of state.moods)if(am.includes(m))s+=4;const en=a.energy_level==null?NaN:Number(a.energy_level);if(state.energy!==null&&Number.isFinite(en))s+=Math.max(0,5-Math.abs(en-state.energy));if(state.comfort&&a.comfort_vs_exploration===state.comfort)s+=3;const duration=a.length_min==null?NaN:Number(a.length_min);if(state.time!==null&&Number.isFinite(duration))s+=duration<=state.time?3:-Math.min(7,(duration-state.time)/6);return s}
function choose(){
 if(!albums.length){$('status').textContent='Still loading albums. Check your server if this persists.';return}
 const logged=new Set(logs.map(l=>`${String(l.artist).toLowerCase()}::${String(l.album).toLowerCase()}`));
 const pool=albums.filter(a=>!seenAlbums.has(key(a))&&!logged.has(key(a)));
 if(!pool.length){$('status').textContent='Every album in the library has been recommended! Export your diary before starting over.';return}
 // Sample across the full eligible catalog, rather than repeatedly choosing from a tiny top-ranked list.
 const sample=[];const n=Math.min(pool.length,500);
 for(let i=0;i<n;i++)sample.push(pool[Math.floor(Math.random()*pool.length)]);
 let best=null,bestScore=-Infinity;
 for(const a of sample){const value=score(a)+Math.random()*8;if(value>bestScore){best=a;bestScore=value}}
 pick=best;seenAlbums.add(key(best));
 try{localStorage.setItem('albumaday.seen',JSON.stringify([...seenAlbums]))}catch(e){console.warn('Seen history storage unavailable',e)}
 show(best)
}
$('recommend').addEventListener('click',choose);
function spotifyUrl(a){const source=a.metadata?.sources;const candidate=Array.isArray(source)?source.find(s=>typeof s==='string'&&s.includes('spotify.com')):source;if(typeof candidate==='string'&&/^https:\/\/open\.spotify\.com\//i.test(candidate))return candidate;return `https://open.spotify.com/search/${encodeURIComponent(`${a.artist} ${a.title}`)}`}
function show(a){const stage=$('stage');stage.classList.remove('revealed');void stage.offsetWidth;const url=a.metadata?.cover_art||artPlaceholder(a);const cover=$('cover');cover.style.display='block';$('emptyCover').style.display='none';cover.onerror=()=>{cover.onerror=null;cover.src=artPlaceholder(a)};cover.src=url;const info=$('details');info.replaceChildren();const tag=document.createElement('div');tag.className='eyebrow';tag.textContent='YOUR NEXT LISTEN ✳';const title=document.createElement('h2');title.textContent=a.title;const artist=document.createElement('p');artist.textContent=`${a.artist}${a.year?' · '+a.year:''}`;const meta=document.createElement('p');meta.textContent=[(a.moods||[]).join(' · '),a.length_min?`${Math.round(Number(a.length_min))} min`:null].filter(Boolean).join('  /  ');info.append(tag,title,artist,meta);const link=$('spotify');link.href=spotifyUrl(a);link.classList.remove('disabled');$('log').disabled=false;$('recordLabel').style.background=labelColor(a);requestAnimationFrame(()=>requestAnimationFrame(()=>stage.classList.add('revealed')));$('status').textContent=`${albums.length-seenAlbums.size} unseen albums remaining ✳`;loadArtwork(a,cover)}
function labelColor(a){let n=0;for(const c of key(a))n=(n*31+c.charCodeAt(0))>>>0;return `hsl(${n%360} 58% 62%)`}
function drawer(open){$('drawer').classList.toggle('open',open);$('drawer').setAttribute('aria-hidden',String(!open));$('overlay').hidden=!open} $('historyToggle').onclick=()=>drawer(true);$('closeDrawer').onclick=()=>drawer(false);$('overlay').onclick=()=>drawer(false);
$('log').onclick=()=>{if(!pick)return;rating=0;$('track').value='';$('notes').value='';$('logAlbum').textContent=`${pick.artist} — ${pick.title}`;stars();$('logDialog').showModal()};$('closeDialog').onclick=()=>$('logDialog').close();function stars(){const area=$('stars');area.replaceChildren();for(let i=1;i<=5;i++){const b=document.createElement('button');b.type='button';b.className='star'+(i<=rating?' active':'');b.textContent='★';b.setAttribute('aria-label',`${i} stars`);b.onclick=()=>{rating=i;stars()};area.append(b)}}$('logForm').onsubmit=e=>{e.preventDefault();if(!pick)return;logs.push({date:getDate(),artist:pick.artist,album:pick.title,rating,favorite_track:$('track').value.trim(),notes:$('notes').value.trim(),cover_art:pick.metadata?.cover_art||''});persist();$('logDialog').close();$('status').textContent='Saved to your listening diary ♡'};$('export').onclick=()=>{const blob=new Blob([JSON.stringify(logs,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='listening_log.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};

// Fetch artwork only for the currently selected album; avoid 10,000 API requests.
let artworkRequest=0;
async function loadArtwork(a,img){
 if(a.metadata?.cover_art && /^https?:\/\//.test(a.metadata.cover_art))return;
 const request=++artworkRequest;
 try{
  const q=encodeURIComponent(`${a.artist} ${a.title}`);
  const r=await fetch(`https://itunes.apple.com/search?term=${q}&entity=album&limit=15`);
  if(!r.ok)throw Error('Artwork service unavailable');
  const data=await r.json();
  const norm=x=>String(x||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const match=(data.results||[]).find(x=>norm(x.artistName)===norm(a.artist)&&norm(x.collectionName)===norm(a.title));
  if(request!==artworkRequest||!pick||key(pick)!==key(a))return;
  if(match?.artworkUrl100){img.src=match.artworkUrl100.replace(/100x100bb/,'600x600bb');}else{const loose=(data.results||[]).find(x=>norm(x.artistName)===norm(a.artist)&&norm(x.collectionName).includes(norm(a.title)));if(loose?.artworkUrl100)img.src=loose.artworkUrl100.replace(/100x100bb/,'600x600bb');}
 }catch(e){console.info('Cover unavailable for',a.artist,a.title)}
}

// Always render a beautiful, readable sleeve even when a catalog has no cover image.
function artPlaceholder(a){
 const safe=x=>String(x||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const wrap=(v,n=19)=>{const words=String(v||'').split(/\\s+/),lines=[''];for(const w of words){const i=lines.length-1;if((lines[i]+' '+w).trim().length>n&&lines.length<4)lines.push(w);else lines[i]=(lines[i]+' '+w).trim()}return lines};
 const title=wrap(a.title,17).map((v,i)=>'<text x="52" y="'+(330+i*62)+'" font-size="52" font-weight="800">'+safe(v)+'</text>').join('');
 const hue=Number.parseInt(labelColor(a).match(/\\d+/)?.[0]||'270',10);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl('+hue+',55%,37%)"/><stop offset="1" stop-color="#150e22"/></linearGradient></defs><rect width="720" height="720" fill="url(#g)"/><circle cx="640" cy="100" r="240" fill="none" stroke="#ffffff" stroke-opacity=".14" stroke-width="1"/><circle cx="640" cy="100" r="180" fill="none" stroke="#ffffff" stroke-opacity=".12"/><g fill="#fff5f4" font-family="Arial, sans-serif"><text x="52" y="95" font-size="21" letter-spacing="6">AN ALBUM A DAY / DISCOVERY</text>'+title+'<text x="52" y="635" font-size="27">'+safe(a.artist).slice(0,37)+'</text><text x="52" y="680" font-size="18" letter-spacing="4">✳ LISTEN CLOSELY</text></g></svg>';
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
}
