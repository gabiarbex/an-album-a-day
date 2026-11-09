import assert from 'node:assert/strict';
import {relationshipStyleFit,scoreCandidate,explanation} from '../api/_ranking-core.js';
// Synthetic metadata for controlled ranking comparison, not a human quality claim.
const body={
 note:"My partner and I argued. Our relationship is difficult and I fear losing them.",
 retrievalNote:'intimate melancholic reflective heartbreak uncertainty',
 moods:['heartbroken','melancholic','reflective'],energy:2,comfort:'comfort',time:null,recentArtists:[],
 intent:{moods:{melancholic:2,reflective:2},avoidMoods:{},genres:[],avoidGenres:[],
   narrativeKind:'relationship-uncertainty',narrativeThemes:['conflict','uncertainty','fear of loss']}
};
const base={
 artist:'Fixture Artist',title:'Fixture',genres:[],tags:[],moods:[],
 moodSource:'musicbrainz-tag-translation',energy:null,energySource:'musicbrainz-tag-translation',
 energyConfidence:0,profileQuality:.85,localScore:.5,semanticScore:.3,familiarity:.4,
};
const exuberant={
 ...base,artist:'Dance Group',title:'A Record',genres:['disco','funk','jazz-funk','reggae','soul'],
 tags:['disco','funk','jazz-funk','reggae','soul']
};
const intimate={
 ...base,artist:'Intimate Singer',title:'A Different Record',
 genres:['singer-songwriter','indie folk','chamber pop'],
 tags:['acoustic','melancholic','introspective']
};
const transparent={...base,artist:'Unclassified Singer'};
const badEvidence=relationshipStyleFit(exuberant,body);
const goodEvidence=relationshipStyleFit(intimate,body);
assert.ok(badEvidence.penalty>.25,'Strongly dance-oriented album must face a mismatch penalty');
assert.ok(goodEvidence.bonus>.2,'Credibly quieter album must receive a modest style bonus');
assert.ok(scoreCandidate(intimate,.45,body)>scoreCandidate(exuberant,.85,body),
 'Intimate candidate must outrank higher-neural disco/funk record for low-energy relationship distress');
assert.equal(relationshipStyleFit(exuberant,{...body,intent:{...body.intent,narrativeKind:null}}).penalty,0);
assert.match(explanation({candidate:intimate,taste:{}},body),/not verified/);
assert.match(explanation({candidate:transparent,taste:{}},body),/tentative match/);
const energetic={...body,energy:9};
assert.equal(relationshipStyleFit(exuberant,energetic).penalty,0,
 'Explicitly high-energy request must override default style restraint');
const generic={...body,intent:{...body.intent,narrativeKind:null,moods:{},avoidMoods:{}},moods:[]};
assert.equal(relationshipStyleFit(intimate,generic).bonus,0,'Other requests must be unchanged');
console.log('Relationship-sensitive ranking and low-energy counterfactual passed.');
