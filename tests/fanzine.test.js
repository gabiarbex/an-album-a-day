import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../theme.css',import.meta.url),'utf8');
test('fanzine visual system ships as the single website CSS asset',()=>{
 assert.match(html,/theme\.css\?v=fanzine-01/);
 assert.equal((html.match(/<link rel="stylesheet"/g)||[]).length,1);
 assert.match(css,/THE LISTENING FANZINE/);
});
test('the original vinyl logo remains accessible, and grain is a local asset',()=>{
 assert.match(html,/<a class="app-logo" href="\.\/" aria-label="An Album a Day home"/);
 assert.match(css,/assets\/zine-grain\.svg/);
 assert.ok(fs.existsSync(new URL('../assets/zine-grain.svg',import.meta.url)));
});
test('cutout graphics are decorative and do not obscure form semantics',()=>{
 for(const cls of ['zine-signature','zine-record-edition','zine-blank-disc','zine-cover-sticker','zine-ticket-head']){
  assert.match(html,new RegExp('class="'+cls+'" aria-hidden="true"'));
 }
 for(const id of ['feelingInput','recommend','cover','moods','quickRating','languagePicker','accountDialog']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
});
test('zine layout keeps mood hit targets distinct and disables sticky submit overlap',()=>{
 assert.match(css,/details#fineTune \.filter-body/);
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
 assert.match(css,/position:static!important;top:auto!important;bottom:auto!important/);
});
