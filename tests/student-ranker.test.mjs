import assert from 'node:assert/strict';
import {featureVector,studentScore,rankStudent,STUDENT_FEATURES} from '../api/_student-ranker.js';
import {prepareGroups,splitByQuery,trainStudent} from '../scripts/train-student.mjs';

// Every label below is explicitly synthetic and used only to exercise code.
const genres=['jazz','ambient','soul','rocksteady'];
const rows=[];
for(let i=0;i<16;i++){
 const q='q'+String(i).padStart(2,'0');
 const goal=genres[i%genres.length],avoid='metal';
 const source=i%4===0?'pt':'en';
 const original=[0.92,0.52,0.7,0.8];
 const choices=[
  {id:'mismatch',genre:'experimental',teacher:0.2},
  {id:'right',genre:goal,teacher:3.4},
  {id:'close',genre:goal+' fusion',teacher:2.7},
  {id:'forbidden',genre:'metal',teacher:9}
 ];
 choices.forEach((c,j)=>rows.push({
  query_id:q,prompt:source==='pt'?'quero ouvir '+goal:'I want '+goal,
  language:source,category:'test_synthetic',
  query_intent:{genres:[goal],avoidGenres:[avoid],moods:{},avoidMoods:{},goalShift:false},
  album_id:q+'-'+c.id,artist:'Synthetic '+c.id,album:'Synthetic '+c.id,
  genres:[c.genre],tags:[c.genre],moods:[],rank:j+1,
  original_score:original[j],neural_score:original[j]-.4,
  teacher_score:c.teacher,
 }));
}
const payload={model:'synthetic-test-only',mode:'scored',results:rows};
assert.equal(prepareGroups(payload).length,16);
assert.equal(prepareGroups(payload)[0].rows.length,3,'Excluded candidate must be removed before training');
assert.throws(()=>trainStudent(payload),/Insufficient distinct scored queries/);
const split=splitByQuery(prepareGroups(payload));
assert.ok(split.validation.length>=2);
assert.equal(new Set([...split.training,...split.validation].map(g=>g.id)).size,16);
assert.ok(split.validation.some(g=>g.language==='pt'));
const trained=trainStudent(payload,{allowSmall:true,epochs:160});
assert.equal(trained.model.eligible_for_production,false);
assert.equal(trained.model.provenance.human_relevance_evaluated,false);
assert.deepEqual(trained.model.features,STUDENT_FEATURES);
assert.equal(trained.model.weights.length,STUDENT_FEATURES.length);
assert.ok(trained.metrics.validation.pairs>0);
const t2=trainStudent(payload,{allowSmall:true,epochs:160});
assert.deepEqual(trained.model,t2.model,'fixed training data must yield deterministic weights');
const result=rankStudent(rows.filter(r=>r.query_id==='q00'),trained.model);
assert.equal(result.length,3,'Hard exclusion stays enforced even in shadow mode');
assert.ok(result.every(r=>!r.genres.includes('metal')));
assert.equal(typeof studentScore(rows[0],trained.model),'number');
assert.equal(featureVector(rows[0]).length,STUDENT_FEATURES.length);
const invalid={...trained.model,schema:'unknown'};
assert.equal(studentScore(rows[0],invalid),null,'Version mismatches must fail closed');
assert.ok(trained.metrics.validation.pairwise_teacher_agreement>=0.5,
 'Synthetic student should learn some teacher ordering on unseen queries');
assert.throws(()=>prepareGroups({results:[{...rows[0],teacher_score:null}]}),
 /Teacher score missing/);
console.log('Offline student distillation and query-grouped holdout safety contracts passed.');
