import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateResources,ttsProfile,yueProfile,referenceProfile,conversionProfile} from './profiles.ts';
import {admit} from './policy.ts';
const policy={reserveFraction:.3,reserveMinimum:2*2**30,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:60000,retryMs:1000,maxQueue:64};
test('pinned measured speech demand distinguishes 8 GiB and 16 GiB instead of assuming 32',()=>{
 const demand=estimateResources('tts',{text:'你好',resourceProfile:ttsProfile});assert.equal(demand.verified,true);
 for(const gib of [8,16,24,32,64]){const s={supported:true,topology:'unified' as const,sampledAt:Date.now(),pressure:'normal' as const,pools:[{id:'memory',capacity:gib*2**30,available:gib*2**30,owned:0}]};assert.equal(admit(s,demand,policy,Date.now()).allowed,gib>=16);}
 assert.equal(estimateResources('tts',{text:'你好',resourceProfile:{...ttsProfile,version:'changed'}}).verified,false);assert.equal(estimateResources('tts',{text:'文'.repeat(8001),resourceProfile:ttsProfile}).verified,false);
});
test('media estimates scale with actual length and rate; unknown model or input cannot become verified',()=>{
 const render=(duration:number)=>estimateResources('render',{composition:{score:{duration}}});assert.ok(render(600).peak.memory>render(1).peak.memory);assert.equal(render(Infinity).verified,false);
 assert.ok(estimateResources('speed',{duration:600,rate:.5}).peak.memory>estimateResources('speed',{duration:2,rate:2}).peak.memory);assert.equal(estimateResources('unknown',{}).verified,false);
 assert.equal(estimateResources('yue2',{resourceProfile:{...yueProfile,revision:'changed'}}).verified,false);
});

test('only matched versions and bounded input envelopes receive measured model reservations',()=>{
 assert.equal(estimateResources('reference',{resourceProfile:referenceProfile,duration:15}).peak.memory,8*2**30);assert.equal(estimateResources('reference',{resourceProfile:referenceProfile,duration:16}).verified,false);assert.equal(estimateResources('reference',{resourceProfile:{...referenceProfile,program:'changed'},duration:2}).verified,false);
 assert.equal(estimateResources('conversion',{resourceProfile:conversionProfile}).verified,true);assert.equal(estimateResources('conversion',{resourceProfile:{...conversionProfile,commit:'changed'}}).verified,false);
 const input={resourceProfile:yueProfile,style:'piano',lyrics:'[instrumental]',preset:'fast',instrumental:true,context:{prefixTokens:1357,planningTokens:4098,semanticTokens:9000,contextTokens:24576}};assert.equal(estimateResources('yue2',input).verified,true);assert.equal(estimateResources('yue2',{...input,context:undefined}).verified,false);assert.equal(estimateResources('yue2',{...input,context:{...input.context,prefixTokens:11479}}).verified,false);assert.equal(estimateResources('yue2',{...input,style:'a'.repeat(3937)}).verified,true);assert.equal(estimateResources('yue2',input).peak.memory,8*2**30);assert.equal(estimateResources('yue2',input).startup?.memory,8*2**30);assert.equal(estimateResources('yue2',{...input,preset:'unknown'}).verified,false);
});

test('long speech reserves the same model envelope with sequential bounded segments',()=>{assert.equal(estimateResources('tts',{text:'文'.repeat(8000),resourceProfile:ttsProfile}).verified,true);});

test('YuE2 budgets cover long BF16 music requests that still fit the model context',()=>{
 const input={resourceProfile:yueProfile,preset:'quality',instrumental:true,
  context:{prefixTokens:15560,planningTokens:0,semanticTokens:9000,contextTokens:24576}};
 const demand=estimateResources('yue2',input);
 // Pinned tokenizer and weight manifest, plus the two static semantic caches.
 const tensorBytes=9_954_000_000;
 assert.equal(demand.verified,true);
 assert.ok((demand.startup?.memory??0)>tensorBytes,'startup must cover weights, both caches and runtime overhead');
 assert.equal(demand.peak.memory,demand.startup?.memory);
 const now=Date.now(), hardware={supported:true,topology:'unified' as const,sampledAt:now,pressure:'normal' as const,
  pools:[{id:'memory',capacity:32*2**30,available:24*2**30,owned:2**30}]};
 assert.equal(admit(hardware,demand,{...policy,limits:{memory:8*2**30}},now).allowed,false);
 assert.equal(admit(hardware,demand,policy,now).allowed,true);
 const shorter={...input,context:{...input.context,prefixTokens:5000}};
 assert.ok(demand.peak.memory>estimateResources('yue2',shorter).peak.memory);
 assert.equal(estimateResources('yue2',{...shorter,instrumental:false}).peak.memory,8*2**30);
 assert.ok(estimateResources('yue2',{...input,preset:'fast',instrumental:false}).peak.memory>8*2**30,
  'long inputs also need room for acoustic chunks with a quantized AR model');
});

test('Breeze reservation requires the pinned streaming runtime, transcript and bounded reference',async()=>{
 const {breezeProfile}=await import('../tts/breeze-runtime.ts');
 const input={text:'正文',referenceText:'完整参考文字稿',referenceDuration:2.44,resourceProfile:breezeProfile};
 const demand=estimateResources('tts',input);assert.equal(demand.verified,true);assert.equal(demand.peak.memory,5_000_000_000);
 for(const patch of [{referenceText:''},{referenceDuration:16},{text:'字'.repeat(8001)},{resourceProfile:{...breezeProfile,program:'changed'}}])assert.equal(estimateResources('tts',{...input,...patch}).verified,false);
});

test('sound effect resource admission is limited to the verified fixed runtime and short bounded requests',async()=>{
 const {effectProfile}=await import('../studio/sound-effects-assets.ts');
 const valid={resourceProfile:effectProfile,seconds:3,prompt:'paper shredder'};
 assert.equal(estimateResources('sound-effects',valid).peak.memory,5_000_000_000);
 assert.equal(estimateResources('sound-effects',valid).verified,true);
 for(const bad of [{...valid,seconds:6},{...valid,seconds:0},{...valid,prompt:''},{...valid,resourceProfile:{...effectProfile,program:'changed'}}])assert.equal(estimateResources('sound-effects',bad).verified,false);
});
