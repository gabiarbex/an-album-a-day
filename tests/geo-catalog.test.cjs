const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const oldFetch=globalThis.fetch;
const root=path.resolve(__dirname,'..');
globalThis.fetch=async (url)=>{
 const p=path.join(root,String(url).replace(/^\.\//,''));
 try{
  const content=fs.readFileSync(p,'utf8');
  return {ok:true,json:async()=>JSON.parse(content)};
 }catch{return {ok:false,status:404}}
};
require('../geo-catalog.js');
(async()=>{
 try{
  await globalThis.AlbumGeo.ready();
  assert.equal(globalThis.AlbumGeo.countryForArtist('Elis Regina'),'BR');
  assert.equal(globalThis.AlbumGeo.countryForArtist('Froukje'),'NL');
  assert.equal(globalThis.AlbumGeo.countryForArtist('Unknown Festival Duo'),null);
  const {rows,coverage}=await globalThis.AlbumGeo.countryRecords(['BR','NL']);
  assert.ok(coverage.BR.indexed>=30);
  assert.ok(coverage.NL.indexed>=30);
  assert.ok(rows.some(a=>a._originCountry==='BR'));
  assert.ok(rows.some(a=>a._originCountry==='NL'));
  assert.ok(rows.every(a=>a.artist&&a.title&&a.lookup_id&&a._catalogFile));
  assert.ok(rows.every(a=>!a.vocalLanguages),'Artist country never establishes song language');
  assert.equal(globalThis.AlbumGeo.countryForAlbum({artist:'Doe Maar'}),'NL');
  const repeat=await globalThis.AlbumGeo.countryRecords(['BR','NL']);
  assert.equal(rows.length,repeat.rows.length);
  console.log('Global artist-origin index selects existing albums and never invents vocal language.');
 }finally{globalThis.fetch=oldFetch}
})().catch(e=>{console.error(e);process.exitCode=1});
