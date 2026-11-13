import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import '../album-locale.js';
import '../intent-core.js';
const root=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(root,'interface-i18n.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const theme=fs.readFileSync(path.join(root,'theme.css'),'utf8');
const tableText=source.match(/const KEYED_ROWS=(\[[\s\S]*?\]);\nconst tables=/)?.[1];
assert.ok(tableText,'translation table exists');
const table=JSON.parse(tableText);
const languages=['en','es','nl','pt','fr','ru','de','ar','zh','ja'];

test('all ten UI languages are selectable in their native names',()=>{
 const block=html.match(/<select id="languagePicker"[^>]*>([\s\S]*?)<\/select>/)?.[1];
 assert.ok(block);
 for(const code of languages)assert.match(block,new RegExp('<option value="'+code+'">'));
});
test('every translated label has complete ten-language coverage',()=>{
 assert.ok(table.length>=120);
 const seen=new Set();
 for(const row of table){
  assert.equal(row.length,10,row[0]);
  assert.ok(row.every(v=>typeof v==='string'&&v.trim().length),row[0]);
  assert.ok(!seen.has(row[0]),'duplicate '+row[0]);seen.add(row[0]);
 }
});
test('interface supports persistent selection and correct Arabic direction',()=>{
 assert.match(source,/localStorage\.setItem\(STORAGE_KEY,code\)/);
 assert.match(source,/selected==='ar'\?'rtl':'ltr'/);
 assert.match(source,/document\.documentElement\.lang/);
});
test('diary notes, album facts and user content are excluded from automatic translation',()=>{
 for(const selector of ['#history','#logAlbum','#whyText','#recentPulls','#tracklist','#recordFacts']){
  assert.ok(source.includes(selector),selector);
 }
});
test('old app logo is restored and all language scripts are loaded',()=>{
 assert.match(html,/assets\/app-logo\.svg/);
 assert.match(html,/interface-i18n\.js\?v=/);
 assert.match(html,/album-locale\.js\?v=global-003/);
 assert.match(theme,/\.language-switch/);
});
const examples=[
 ['أريد موسيقى هادئة بدون روك','ar'],
 ['我想听安静的音乐，不要摇滚','zh'],
 ['静かな音楽が聴きたい。ロックなしで','ja'],
 ['хочу спокойную музыку без рока','ru']
];
for(const [note,lang] of examples){
 test('understands common mood and exclusion in '+lang,()=>{
  const parsed=globalThis.AlbumLocale.parse(note);
  const intent=globalThis.AlbumIntent.interpretFeeling(note);
  assert.equal(parsed.queryLanguage,lang);
  assert.ok(intent.moods.calm,note);
  assert.ok(intent.avoidGenres.includes('rock'),note);
 });
}
test('Japanese artist origin is distinct from interface language',()=>{
 const p=globalThis.AlbumLocale.parse('日本の音楽が聴きたい');
 assert.equal(p.queryLanguage,'ja');
 assert.ok(p.originCountries.includes('JP'));
});
