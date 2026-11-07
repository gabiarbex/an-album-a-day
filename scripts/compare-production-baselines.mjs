#!/usr/bin/env node
// Compare factual metadata proxies. This does NOT score listener enjoyment.
import fs from 'node:fs/promises';
import {isCompilation} from '../api/_ranking-core.js';

const [beforeFile,afterFile]=process.argv.slice(2);
if(!beforeFile||!afterFile){
 console.error('Usage: node scripts/compare-production-baselines.mjs BEFORE.json AFTER.json');
 process.exit(2);
}
const [before,after]=await Promise.all([beforeFile,afterFile].map(async p=>JSON.parse(await fs.readFile(p,'utf8'))));
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
function getArtist(row) {
 return row.backend?.alternatives?.[0]?.artist
  ||(row.detail||'').split('\n').find(line=>line.includes(' · '))?.split(' · ')[0]||'';
}
function getGenres(row) {
 const c=row.backend?.alternatives?.[0]||{};
 return [...(c.genres||[]),...(c.tags||[]),
  ...(row.catalog?.catalogGenres||'').split(' | '),...(row.catalog?.catalogTags||'').split(' | ')]
  .map(norm).filter(Boolean);
}
function report(data) {
 const valid=(data.results||[]).filter(row=>row.ok);
 const actual=valid.map(row=>({...row,artist:getArtist(row),genres:getGenres(row)}));
 const explicit=actual.filter(row=>row.wantGenres?.length&&row.genres.length);
 const excluded=actual.filter(row=>row.avoidGenres?.length&&row.genres.length);
 return {
  captured_at:data.captured_at,
  successful:valid.length,
  total:(data.results||[]).length,
  backend_versions:[...new Set(valid.map(row=>row.backend?.engine||'no-backend'))],
  compilations:actual.filter(row=>isCompilation({artist:row.artist,title:row.title})).length,
  genre_matches:{n:explicit.filter(row=>row.wantGenres.some(g=>row.genres.some(label=>label.includes(norm(g))))).length,of:explicit.length},
  excluded_genre_violations:{n:excluded.filter(row=>row.avoidGenres.some(g=>row.genres.some(label=>label.includes(norm(g))))).length,of:excluded.length},
  unknown_or_weak_explanations:actual.filter(row=>!/catalog tags:|catalogued as|catalog includes|its catalog tags|mood tags|listed genres|verified|matched on/i.test(row.reason||'')&&
     !/^(?:jazz|soul|bossa nova)\.$/i.test(row.reason||'')).length,
  distinct_artists:new Set(actual.map(row=>norm(row.artist))).size,
 };
}
const a=report(before),b=report(after);
const old=new Map((before.results||[]).filter(row=>row.ok).map(row=>[row.id,row]));
const changes=(after.results||[]).filter(row=>row.ok&&old.has(row.id)).map(row=>({
  id:row.id,before:old.get(row.id).title,after:row.title,changed:row.title!==old.get(row.id).title
}));
console.log(JSON.stringify({before:a,after:b,changed_top1:changes.filter(x=>x.changed).length,
 paired_queries:changes.length,changes,
 note:'Metadata proxy comparison only. Relevance, mood accuracy and NDCG still require human ratings.'},null,2));
