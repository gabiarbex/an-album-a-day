#!/usr/bin/env node
// Evaluate observed artist-area matches; does not infer lyric language or enjoyment.
import fs from 'node:fs/promises';
const path=process.argv[2]||'baseline-results/production-top1.json';
const data=JSON.parse(await fs.readFile(path,'utf8'));
const rows=(data.results||[]).filter(r=>r.id?.startsWith('L'));
const cases=rows.filter(r=>r.wantCountries?.length);
const report={
 source:path,captured_at:data.captured_at,global_queries:rows.length,
 completed:rows.filter(r=>r.ok).length,
 artist_origin_cases:cases.length,
 parsed_origin_correct:0,verified_origin_match:0,
 excluded_country_violations:0,
 vocal_language_cases:rows.filter(r=>r.wantVocals?.length).length,
 verified_vocal_language_cases:0,
 unresolved:[]
};
for(const row of cases){
 const parsed=row.frontend?.intent?.originCountries||[];
 const country=row.backend?.diagnostics?.selectedOriginCountry||
   row.backend?.alternatives?.[0]?.originCountry||null;
 if((row.wantCountries||[]).every(x=>parsed.includes(x)))report.parsed_origin_correct++;
 if(country&&(row.wantCountries||[]).includes(country))report.verified_origin_match++;
 if(country&&(row.avoidCountries||[]).includes(country))report.excluded_country_violations++;
 if(!row.ok||!country||(row.wantCountries||[]).every(x=>x!==country))
  report.unresolved.push({id:row.id,requested:row.wantCountries||[],returned:country,
    album:row.title,reason:row.reason});
}
for(const row of rows.filter(r=>r.wantVocals?.length)){
 const vocals=row.backend?.alternatives?.[0]?.vocalLanguages||[];
 if(row.wantVocals.some(x=>vocals.includes(x)))report.verified_vocal_language_cases++;
}
report.note='Artist-area provenance is not lyric language. Unknown vocal language is not a confirmed match. These are catalog checks, not relevance ratings.';
console.log(JSON.stringify(report,null,2));
if(rows.length>=8&&cases.length>=6){
 if(report.parsed_origin_correct!==cases.length||
   report.excluded_country_violations>0||
   report.verified_origin_match<Math.ceil(cases.length*.7)){
  console.error('Country-origin contract regression; inspect unresolved cases.');
  process.exitCode=1;
 }
}
