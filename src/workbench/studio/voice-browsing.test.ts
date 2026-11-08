import test from 'node:test';import assert from 'node:assert/strict';import {browsedVoices} from './voice-browsing.ts';
test('voice filters combine search, favorites and readiness without resurrecting deleted voices',()=>{
 const voices=[{name:'Alice',favorite:true},{name:'Bob',processing:{state:'running'}},{name:'Clean',processing:{state:'succeeded'}},{name:'Deleted',favorite:true,deleted:true}];
 assert.deepEqual(browsedVoices(voices,'','all').map(v=>v.name),['Alice','Bob','Clean']);
 assert.deepEqual(browsedVoices(voices,' ALI ','favorite').map(v=>v.name),['Alice']);
 assert.deepEqual(browsedVoices(voices,'','ready').map(v=>v.name),['Alice','Clean']);
 assert.equal(browsedVoices(voices,'bob','ready').length,0);
});
