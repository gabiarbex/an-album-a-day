#!/usr/bin/env node
// Evaluates observable metadata, not subjective musical relevance.
import fs from 'node:fs/promises';
import {isCompilation,styleMatches} from '../api/_ranking-core.js';

const file=process.argv[2]||'benchmarks/production-top1-observed.json';
const data=JSON.parse(await fs.readFile(file,'utf8'));
const rows=(data.results||[]).filter(row=>row.ok);
const failures=(data.results||[]).filter(row=>!row.ok);
const withBackend=rows.filter(row=>row.backend?.ok);
function normalize(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function selected(row){
 const own=row.backend?.alternatives?.[0];
 const display=(row.detail||'').split('\n').find(line=>line.includes(' · '))||'';
 const artist=own?.artist||display.split(' · ')[0]||'';
 const genres=own?.genres||(row.catalog?.catalogGenres||'').split(' | ').filter(Boolean);
 const tags=own?.tags||(row.catalog?.catalogTags||'').split(' | ').filter(Boolean);
 return {artist,title:own?.title||row.title,genres,tags};
}
const picks=rows.map(selected);
function matches(words,hints){return hints.some(needle=>words.some(item=>styleMatches(item,needle)))}
let genreKnown=0,genreHits=0,excludedKnown=0,excludedViolations=0;
let compiled=0,emptyReasons=0;
for(const row of rows){
 const pick=selected(row);
 if(isCompilation(pick))compiled++;
 if(!row.reason||/overall match/i.test(row.reason))emptyReasons++;
 const words=[...pick.genres,...pick.tags];
 if(words.length && row.wantGenres?.length){genreKnown++;if(matches(words,row.wantGenres))genreHits++}
 if(words.length && row.avoidGenres?.length){excludedKnown++;if(matches(words,row.avoidGenres))excludedViolations++}
}
const observedIntent=rows.filter(row=>row.frontend?.intent);
const expectedFields=[
 ['wantGenres','genres'],['avoidGenres','avoidedGenres'],
 ['wantMoods','moods'],['avoidMoods','avoidedMoods']
];
const intentPassed=observedIntent.filter(row=>expectedFields.every(([expected,actual])=>
 (row[expected]||[]).every(item=>(row.frontend.intent[actual]||[]).includes(item))
));
const emotionGoalRows=observedIntent.filter(row=>row.category==='emotion_shift');

const result={
 source:file,captured_at:data.captured_at||null,
 prompts:(data.results||[]).length,successes:rows.length,failures:failures.map(row=>row.id),
 backend_capture:withBackend.length,
 compilations:{count:compiled,of:rows.length},
 distinct_artists:new Set(picks.map(row=>normalize(row.artist)).filter(Boolean)).size,
 genre_tag_match:{count:genreHits,of:genreKnown},
 intent_parsing:{count:intentPassed.length,of:observedIntent.length},
 emotional_goal_detected:{count:emotionGoalRows.filter(row=>row.frontend.intent.goalShift).length,of:emotionGoalRows.length},
 avoided_genre_tag_violations:{count:excludedViolations,of:excludedKnown},
 uninformative_explanations:{count:emptyReasons,of:rows.length},
 note:'Metadata match is not human-judged recommendation relevance. Unknown labels are excluded from denominators.'
};
console.log(JSON.stringify(result,null,2));
