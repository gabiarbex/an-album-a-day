(function(root){
'use strict';

const BASE='./data/semantic/';
let loadPromise=null;

function clean(value){
 return String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function tokens(value){
 return clean(value).match(/[a-z0-9][a-z0-9_'-]+/g)||[];
}
function termsFor(value){
 const t=tokens(value),terms=t.slice();
 for(let i=0;i<t.length-1;i++)terms.push(t[i]+' '+t[i+1]);
 return terms;
}
async function fetchJson(name){
 const r=await fetch(BASE+name,{cache:'force-cache'});
 if(!r.ok)throw Error('semantic '+name+' HTTP '+r.status);
 return r.json();
}
async function fetchBuffer(name){
 const r=await fetch(BASE+name,{cache:'force-cache'});
 if(!r.ok)throw Error('semantic '+name+' HTTP '+r.status);
 return r.arrayBuffer();
}
async function load(){
 if(loadPromise)return loadPromise;
 loadPromise=(async()=>{
  const manifest=await fetchJson('manifest.json');
  const [model,ids,vectorsBuffer,componentsBuffer]=await Promise.all([
   fetchJson(manifest.model),fetchJson(manifest.ids),
   fetchBuffer(manifest.vectors),fetchBuffer(manifest.components)
  ]);
  const vocab=new Map();
  model.terms.forEach((term,index)=>vocab.set(term,index));
  return {
   manifest,model,ids,vocab,
   idf:Float32Array.from(model.idf),
   scales:Float32Array.from(model.component_scales),
   vectors:new Int8Array(vectorsBuffer),
   components:new Int8Array(componentsBuffer)
  };
 })().catch(err=>{loadPromise=null;throw err});
 return loadPromise;
}
function queryVector(text,data){
 const counts=new Map();
 for(const term of termsFor(text))counts.set(term,(counts.get(term)||0)+1);
 const sparse=[];
 let norm=0;
 for(const [term,count] of counts){
  const idx=data.vocab.get(term);if(idx===undefined)continue;
  const value=(1+Math.log(count))*data.idf[idx];
  sparse.push([idx,value]);norm+=value*value;
 }
 if(!sparse.length||norm<=0)return null;
 norm=Math.sqrt(norm);
 for(const row of sparse)row[1]/=norm;

 const dims=data.manifest.dimensions,vocabSize=data.manifest.vocab_size;
 const q=new Float32Array(dims);
 for(const [idx,value] of sparse){
  for(let d=0;d<dims;d++)q[d]+=value*data.components[d*vocabSize+idx]*data.scales[d];
 }
 let qnorm=0;for(let d=0;d<dims;d++)qnorm+=q[d]*q[d];
 qnorm=Math.sqrt(qnorm);
 if(!qnorm)return null;
 for(let d=0;d<dims;d++)q[d]/=qnorm;
 return q;
}
function heapPush(heap,item,limit){
 if(heap.length<limit){
  heap.push(item);
  let i=heap.length-1;
  while(i>0){const p=(i-1)>>1;if(heap[p].score<=heap[i].score)break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p}
  return;
 }
 if(item.score<=heap[0].score)return;
 heap[0]=item;
 let i=0;
 while(true){
  let l=i*2+1,r=l+1,m=i;
  if(l<heap.length&&heap[l].score<heap[m].score)m=l;
  if(r<heap.length&&heap[r].score<heap[m].score)m=r;
  if(m===i)break;
  [heap[m],heap[i]]=[heap[i],heap[m]];i=m;
 }
}
async function search(text,limit=200){
 const data=await load();
 const q=queryVector(text,data);
 if(!q)return [];
 const dims=data.manifest.dimensions,count=data.manifest.albums;
 const heap=[];
 for(let row=0;row<count;row++){
  const offset=row*dims;let dot=0;
  for(let d=0;d<dims;d++)dot+=q[d]*(data.vectors[offset+d]/127);
  heapPush(heap,{id:data.ids[row],score:dot},limit);
 }
 return heap.sort((a,b)=>b.score-a.score);
}
async function info(){
 try{const data=await load();return data.manifest}catch{return null}
}
root.AlbumSemantic={search,info,reset:()=>{loadPromise=null}};
})(globalThis);
