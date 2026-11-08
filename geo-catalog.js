/* Browse actual catalog artists associated with a country.
   Country of an artist ≠ release country ≠ lyric language. */
(function(root){
'use strict';
const DIR='./data/geography/';
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/\s+/g,' ').trim();
const map=new Map();
const indexCache=new Map();
let readyPromise=null;
function ready(){
 if(readyPromise)return readyPromise;
 readyPromise=fetch(DIR+'artist-roster.json',{cache:'force-cache'}).then(async r=>{
  if(!r.ok)throw Error('Artist origins unavailable: '+r.status);
  const data=await r.json();
  for(const [country,artists] of Object.entries(data.countries||{})){
   for(const artist of artists){const name=norm(artist);if(name&&!map.has(name))map.set(name,country)}
  }
  return data;
 }).catch(error=>{readyPromise=null;throw error});
 return readyPromise;
}
function countryForArtist(artist){return map.get(norm(artist))||null}
function countryForAlbum(album){
 return (album?._originSource==='curated-artist-area-v1'&&album._originCountry)||
  countryForArtist(album?.artist)||null;
}
async function countryRecords(countries){
 await ready();
 const rows=[],seen=new Set(),coverage={};
 for(const country of [...new Set(countries||[])].slice(0,3)){
  const code=String(country||'').toUpperCase();
  if(!/^[A-Z]{2}$/.test(code))continue;
  if(!indexCache.has(code)){
   indexCache.set(code,fetch(DIR+code+'.json',{cache:'force-cache'}).then(async r=>{
    if(!r.ok)return {country:code,entries:[],missing:true};
    return r.json();
   }).catch(()=>({country:code,entries:[],missing:true})));
  }
  const data=await indexCache.get(code);
  coverage[code]={matchedArtists:Number(data.matched_artists)||0,
   catalogAlbums:Number(data.matched_albums)||0,indexed:Array.isArray(data.entries)?data.entries.length:0};
  for(const a of data.entries||[]){
   if(!a?.lookup_id||seen.has(a.lookup_id))continue;
   const assigned=countryForArtist(a.artist);
   if(assigned!==code)continue;
   seen.add(a.lookup_id);
   rows.push({...a,_originCountry:assigned,_originSource:'curated-artist-area-v1'});
  }
 }
 return {rows,coverage};
}
root.AlbumGeo={ready,countryRecords,countryForArtist,countryForAlbum};
})(globalThis);
