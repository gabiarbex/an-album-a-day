import assert from 'node:assert/strict';
import {tasteWeights} from '../api/_taste-policy.js';

for(const event of [
 'reroll','save','spotify_open','wrong_vibe','too_upbeat','too_slow',
 'too_obvious','less_artist'
]){
 assert.deepEqual(tasteWeights(event,null),{positive:0,negative:0},
  event+' must not be misread as long-term enjoyment or dislike');
}
assert.ok(tasteWeights('love_this').positive>0);
assert.ok(tasteWeights('less_like_this').negative>0);
assert.ok(tasteWeights('rating',5).positive>tasteWeights('rating',4).positive);
assert.ok(tasteWeights('rating',1).negative>tasteWeights('rating',2).negative);
assert.deepEqual(tasteWeights('rating',3),{positive:0,negative:0});
assert.deepEqual(tasteWeights('rating',0),{positive:0,negative:0});
assert.deepEqual(tasteWeights('rating',undefined),{positive:0,negative:0});
console.log('Long-term taste only learns from explicitly evaluative feedback.');
