import assert from 'node:assert/strict';
import {selectReviewQueue} from '../scripts/select-active-review.mjs';

const observed={captured_at:'2026-11-07T00:00:00Z',results:[]};
const teacher={model:'synthetic-unit-test',results:[]};
for(let n=0;n<8;n++){
 const id='q'+n,language=n<4?'en':'pt';
 const albums=Array.from({length:3},(_,i)=>({
  rank:i+1,id:id+'-'+i,artist:'Artist '+i,title:'Record '+i,
  genres:['jazz'],tags:['jazz'],moods:[],score:0.9-i*.05
 }));
 observed.results.push({
  id,prompt:'Some listening request '+id,language,category:n%2?'mood':'genre',
  ok:true,backend:{alternatives:albums}
 });
 for(const album of albums)teacher.results.push({
  query_id:id,album_id:album.id,artist:album.artist,album:album.title,
  rank:album.rank,teacher_score:n%2?(album.rank===2?3:1):3-album.rank
 });
}
const queue=selectReviewQueue(observed,teacher,{limit:4});
assert.equal(queue.selected_queries,4);
assert.equal(queue.results.length,4);
assert.equal(queue.by_language.en,2);
assert.equal(queue.by_language.pt,2);
assert.ok(queue.teacher_baseline_disagreements>=1);
assert.ok(queue.results.every(x=>x.ok&&x.backend.alternatives.length===3));
assert.ok(!Object.hasOwn(queue,'human_relevance_score'));
const q2=selectReviewQueue(observed,teacher,{limit:4});
assert.deepEqual(queue,q2,'Active-review selection should be deterministic');
assert.throws(()=>selectReviewQueue({},teacher),/No real teacher/);
const broken={model:'invalid',results:[{...teacher.results[0],teacher_score:NaN}]};
assert.throws(()=>selectReviewQueue(observed,broken),/Teacher scores required/);
console.log('Active review prioritizes disagreements without inventing ratings.');
