import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateResources,ttsProfile,yueProfile,referenceProfile,conversionProfile} from './profiles.ts';
import {admit} from './policy.ts';
const policy={reserveFraction:.3,reserveMinimum:2*2**30,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:60000,retryMs:1000,maxQueue:64};
test('pinned measured speech demand distinguishes 8 GiB and 16 GiB instead of assuming 32',()=>{
 const demand=estimateResources('tts',{text:'你好',resourceProfile:ttsProfile});assert.equal(demand.verified,true);
 for(const gib of [8,16,24,32,64]){const s={supported:true,topology:'unified' as const,sampledAt:Date.now(),pressure:'normal' as const,pools:[{id:'memory',capacity:gib*2**30,available:gib*2**30,owned:0}]};assert.equal(admit(s,demand,policy,Date.now()).allowed,gib>=16);}
 assert.equal(estimateResources('tts',{text:'你好',resourceProfile:{...ttsProfile,version:'changed'}}).verified,false);assert.equal(estimateResources('tts',{text:'文'.repeat(141),resourceProfile:ttsProfile}).verified,false);
});
test('media estimates scale with actual length and rate; unknown model or input cannot become verified',()=>{
 const render=(duration:number)=>estimateResources('render',{composition:{score:{duration}}});assert.ok(render(600).peak.memory>render(1).peak.memory);assert.equal(render(Infinity).verified,false);
 assert.ok(estimateResources('speed',{duration:600,rate:.5}).peak.memory>estimateResources('speed',{duration:2,rate:2}).peak.memory);assert.equal(estimateResources('unknown',{}).verified,false);
 assert.equal(estimateResources('yue2',{resourceProfile:{...yueProfile,revision:'changed'}}).verified,false);
});

test('only matched versions and bounded input envelopes receive measured model reservations',()=>{
 assert.equal(estimateResources('reference',{resourceProfile:referenceProfile,duration:15}).peak.memory,8*2**30);assert.equal(estimateResources('reference',{resourceProfile:referenceProfile,duration:16}).verified,false);assert.equal(estimateResources('reference',{resourceProfile:{...referenceProfile,program:'changed'},duration:2}).verified,false);
 assert.equal(estimateResources('conversion',{resourceProfile:conversionProfile}).verified,true);assert.equal(estimateResources('conversion',{resourceProfile:{...conversionProfile,commit:'changed'}}).verified,false);
 const input={resourceProfile:yueProfile,style:'piano',lyrics:'[instrumental]',preset:'fast',instrumental:true};assert.equal(estimateResources('yue2',input).verified,true);assert.equal(estimateResources('yue2',{...input,lyrics:'a'.repeat(2001)}).verified,false);assert.equal(estimateResources('yue2',{...input,preset:'unknown'}).verified,false);
});
