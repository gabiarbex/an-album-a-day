/* Weighted reciprocal-rank fusion for hybrid album candidate retrieval.
   Intentionally independent of the neural model: rankings, not raw cosine /
   lexical / score scales, are combined. Safe in browsers and Node tests. */
(function(root){
 'use strict';
 const SOURCE_ORDER=['neural','semantic','controls','adjacent','familiar','explore'];
 const NORMAL={neural:1.15,semantic:0.8,controls:1.15,adjacent:0.45,familiar:0.25,explore:0.22};
 const COMFORT={...NORMAL,familiar:0.85,adjacent:0.22,explore:0.12};
 const EXPLORATION={...NORMAL,familiar:0.08,adjacent:0.82,explore:0.5};
 // Retain a minimum pool for each distinct recall method. Saturation is
 // prevented by per-artist caps rather than dropping an entire method.
 const MINIMUM={neural:16,semantic:10,controls:18,adjacent:6,familiar:3,explore:3};
 function select(buckets,options={}){
  const limit=Math.max(1,Math.min(256,Math.floor(Number(options.limit)||96)));
  const idOf=typeof options.idOf==='function'?options.idOf:(row=>row?.id);
  const artistOf=typeof options.artistOf==='function'?options.artistOf:(row=>row?.artist||'');
  const weights=options.comfort==='comfort'?COMFORT:options.comfort==='exploration'?EXPLORATION:NORMAL;
  const entries=new Map();
  const ranksBySource={};
  const k=60;
  for(const source of SOURCE_ORDER){
   const list=Array.isArray(buckets[source])?buckets[source]:[];
   const observed=new Set();
   ranksBySource[source]=[];
   for(const row of list){
    const id=String(idOf(row)||'');
    if(!id||observed.has(id))continue;
    observed.add(id);
    const position=ranksBySource[source].length+1;
    ranksBySource[source].push(id);
    const record=entries.get(id)||{id,row,score:0,sources:new Set(),bestRank:Infinity};
    record.score+=weights[source]/(k+position);
    record.sources.add(source);
    record.bestRank=Math.min(record.bestRank,position);
    entries.set(id,record);
   }
  }
  const ordered=[...entries.values()].sort((a,b)=>
   b.score-a.score||b.sources.size-a.sources.size||a.bestRank-b.bestRank||a.id.localeCompare(b.id)
  );
  const selected=[],used=new Set(),artists=new Map();
  const canAdd=(record,cap)=>{
   const artist=String(artistOf(record.row)||'').trim().toLowerCase();
   return !used.has(record.id)&&(!artist||(artists.get(artist)||0)<cap);
  };
  function add(record,cap){
   if(!record||selected.length>=limit||!canAdd(record,cap))return false;
   selected.push(record.row);
   used.add(record.id);
   const artist=String(artistOf(record.row)||'').trim().toLowerCase();
   if(artist)artists.set(artist,(artists.get(artist)||0)+1);
   return true;
  }
  // The minimums protect retrieval recall even when one source dominates
  // scores; we then fill by fusion rank, promoting multi-source consensus.
  for(const source of SOURCE_ORDER){
   let taken=0;
   for(const id of ranksBySource[source]){
    if(taken>=MINIMUM[source])break;
    if(add(entries.get(id),2))taken++;
   }
  }
  for(const record of ordered)add(record,2);
  // A small or single-artist catalog should not fail because of diversity.
  for(const record of ordered)add(record,Infinity);
  return selected;
 }
 root.AlbumFusion={select,sourceOrder:SOURCE_ORDER.slice()};
})(globalThis);
