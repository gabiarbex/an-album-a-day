import assert from 'node:assert/strict';
import {trainStudent} from '../scripts/train-student.mjs';
import {evaluateHuman} from '../scripts/evaluate-student-human.mjs';

// Only synthetic scores and judgments are used in this test.
const rows=[];
for(let i=0;i<12;i++){
 const id='h'+String(i).padStart(2,'0'),genre=i%2?'jazz':'ambient';
 const candidates=[
  ['exact',genre,3.0,3],
  ['near',genre+' fusion',2.0,2],
  ['off','noise rock',-2.0,0],
 ];
 candidates.forEach(([label,style,teacher,grade],j)=>rows.push({
  query_id:id,prompt:'I want '+genre,language:i%4===0?'pt':'en',category:'synthetic',
  query_intent:{genres:[genre],avoidGenres:[],moods:{},avoidMoods:{}},
  album_id:id+'-'+label,album:'Test '+label,artist:'Test '+label,
  genres:[style],tags:[style],rank:j+1,original_score:1-j*.3,
  teacher_score:teacher,grade,
 }));
}
const teacher={model:'unit-test-fake-teacher',results:rows};
const trained=trainStudent(teacher,{allowSmall:true,epochs:140});
const headers=['query_id','rank','artist','album','relevance','exclusion_violation','already_seen'];
const csv=[headers.join(','),...rows.map(r=>
 [r.query_id,r.rank,r.artist,r.album,r.grade,'0','0'].join(','))].join('\n');
const result=evaluateHuman(teacher,trained,csv,{k:3,minQueries:40});
assert.ok(result.fully_judged_queries>0);
assert.equal(result.fully_judged_queries,result.heldout_queries);
assert.equal(result.release_gate.enough_heldout_human_judgments,false);
assert.equal(result.eligible_for_production,false);
assert.ok(Number.isFinite(result.student_mean_ndcg));
assert.ok(Number.isFinite(result.baseline_mean_ndcg));
assert.ok(result.uplift_95pct_bootstrap_interval?.length===2);
const empty=headers.join(',')+'\n';
assert.equal(evaluateHuman(teacher,trained,empty,{k:3}).fully_judged_queries,0);
const duplicate=csv+'\n'+rows[0].query_id+',1,'+rows[0].artist+','+rows[0].album+',3,0,0';
assert.throws(()=>evaluateHuman(teacher,trained,duplicate,{k:3}),/Duplicate album judgments/);
console.log('Human evaluation requires genuine complete labels and cannot auto-promote a student.');
