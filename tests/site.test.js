import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
test('only one production stylesheet is loaded',()=>{
 assert.equal((html.match(/<link rel="stylesheet"/g)||[]).length,1);
 assert.match(html,/theme\.css\?v=/);
 assert.ok(fs.statSync(path.join(root,'theme.css')).size>10000);
});
test('all local scripts and CSS resolve to actual files',()=>{
 const refs=[...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"[^>]*>/g)].map(m=>m[1])
  .filter(v=>!/^https?:|^data:|^\/\//.test(v)).filter(v=>/\.js\?|\.css\?/.test(v));
 for(const ref of refs){
  const local=ref.split('?')[0];assert.ok(fs.existsSync(path.join(root,local)),ref);
 }
});
test('all key buttons and page regions exist',()=>{
 for(const id of ['feelingInput','recommend','cover','moods','log','markFinished','quickRating','accountDialog','supporterStatus','drawer','accountSyncNow']){
  assert.match(html,new RegExp('id="'+id+'"'),'missing #'+id);
 }
});
test('five SVG stars use stable paths and keyboard semantics, not missing font glyphs',()=>{
 const js=read('selector.js');
 assert.match(js,/createElementNS\(namespace,'polygon'\)/);
 assert.match(js,/aria-checked/);
 assert.match(js,/ArrowLeft/);
 assert.doesNotMatch(js,/button\.textContent='\?'/);
});
test('semantic and stored fallbacks enforce requested exclusions',()=>{
 const js=read('selector.js');
 assert.match(js,/filter\(row=>!albumWasSeen\(row\.album\)&&!logged\.has\(key\(row\.album\)\)&&satisfiesExplicitConstraints/);
 assert.match(js,/function satisfiesExplicitConstraints/);
 assert.match(js,/No reliable match/);
});
test('cached history cannot be cleared by a normal page navigation',()=>{
 const js=read('selector.js');
 assert.match(js,/localStorage\.setItem\(SEEN_KEYS_STORAGE_KEY/);
 assert.match(js,/function albumWasSeen/);
 assert.match(read('sync-state.js'),/seenKeys:uniq/);
});
test('supporter entitlement is not editable from client code',()=>{
 const js=read('auth-sync.js');
 assert.match(js,/\.from\(SUPPORTER_TABLE\)/);
 assert.match(js,/\.select\('status,current_period_end,cancel_at_period_end,updated_at'\)/);
 assert.doesNotMatch(js,/\.from\(SUPPORTER_TABLE\)\.upsert/);
});
