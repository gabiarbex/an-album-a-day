// Test against the exact production candidate-fusion implementation.
const assert=require('node:assert/strict');
require('../retrieval-fusion.js');
const {select}=globalThis.AlbumFusion;
const row=(id,artist)=>({album:{id,artist},id});
const shared=row('shared','A'),n1=row('n1','B'),s1=row('s1','C'),control=row('control','D'),near=row('near','E');
const buckets={
 neural:[n1,shared],semantic:[s1,shared],controls:[control,shared],adjacent:[near,shared],
 familiar:[],explore:[]
};
const chosen=select(buckets,{limit:5,idOf:r=>r.id,artistOf:r=>r.album.artist});
assert.equal(chosen.length,5);
assert.equal(new Set(chosen.map(r=>r.id)).size,5,'deduplicate shared retrieval results');
assert.ok(chosen.some(r=>r.id==='shared'),'multi-source agreement included');
assert.ok(chosen.some(r=>r.id==='control'),'explicit controls have recall quota');
assert.ok(chosen.some(r=>r.id==='n1'),'neural recall represented');
const second=select(buckets,{limit:5,idOf:r=>r.id,artistOf:r=>r.album.artist});
assert.deepEqual(chosen.map(r=>r.id),second.map(r=>r.id),'stable ranking');
const solo=Array.from({length:5},(_,i)=>row('solo'+i,'SAME ARTIST'));
assert.equal(select({controls:solo},{limit:5,idOf:r=>r.id,artistOf:r=>r.album.artist}).length,5,
 'small single-artist catalog must not dead-end');
const many={neural:Array.from({length:140},(_,i)=>row('n'+i,'artist'+Math.floor(i/3))),
 controls:Array.from({length:140},(_,i)=>row('c'+i,'control'+Math.floor(i/2))),
 semantic:Array.from({length:75},(_,i)=>row('s'+i,'semantic'+i))};
const picked=select(many,{limit:96,idOf:r=>r.id,artistOf:r=>r.album.artist});
assert.equal(picked.length,96);
assert.equal(new Set(picked.map(r=>r.id)).size,96);
assert.ok(picked.some(r=>r.id.startsWith('s')),'lexical recall represented at scale');
assert.ok(picked.some(r=>r.id.startsWith('c')),'controls represented at scale');
const empty=select({}, {limit:96});
assert.deepEqual(empty,[]);
console.log('RRF fusion: source coverage, determinism, de-duplication, and fallback passed.');
