import test from 'node:test';
import assert from 'node:assert/strict';
import {generationWithEnding} from './input.ts';
import {operations} from '../operations.ts';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {musicRuntimeHashes,yueServeProgramHash} from './worker.ts';
import {yueProfile} from '../resources/profiles.ts';
import {durationWithinTarget} from './duration.ts';

test('original three-failure regression keeps the historical model input and automatic duration',()=>{
 const fixture=JSON.parse(readFileSync('tests/quality/music-planning-regression.json','utf8'));
 const native=generationWithEnding(fixture.request);
 assert.equal(createHash('sha256').update(JSON.stringify(native)).digest('hex'),fixture.nativeInputSha256);
 assert.equal(fixture.nativeInputSha256,'336e59f5bbb3ae19e071e92637a6d9aeef3bb1cb268d4d1b242a8ca089ed2ec7');
 assert.equal(fixture.request.seed,42);assert.equal(fixture.request.preset,'fast');
 assert.equal(fixture.request.targetDuration,undefined);assert.equal(fixture.request.abc,undefined);
});

test('duration guidance plans musical structure without changing lyrics or instrumental routing',()=>{
 for(const instrumental of [true,false]){
  const lyrics=instrumental?'[Intro]\n[Verse]\n[Outro]':'[Verse]\n晚风吹过窗边\n[Chorus]\n灯火留在心间';
  const result=generationWithEnding({style:'warm folk, 80 BPM',lyrics,instrumental,targetDuration:180});
  assert.equal(result.lyrics,lyrics);assert.match(result.style,/180 seconds/);
  assert.match(result.style,/quarter.note beats/);assert.match(result.style,instrumental?/No vocals/:/Do not add, delete, repeat or rewrite/);
 }
});
test('packaged duration runtime matches the resource profile and bounded planner regression cases pass',()=>{
 assert.equal(yueServeProgramHash,yueProfile.program);
 for(const [name,digest] of Object.entries(musicRuntimeHashes)){
  const path=['duration.py','recovery.py'].includes(name)?'public/yue2-runtime/'+name:'public/yue2-score/vendor/'+name;
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),digest);
 }
 execFileSync('python3',['-B','src/service/yue2/duration_runtime_test.py'],{stdio:'pipe'});
});
test('target duration is an explicit bounded option, with auto preserved for old requests',()=>{
 assert.equal(generationWithEnding({style:'piano',lyrics:'[verse]',instrumental:false,ending:'as-described'}).style,'piano');
 for(const targetDuration of [0,61,NaN,600])assert.throws(()=>generationWithEnding({style:'piano',lyrics:'[instrumental]',instrumental:true,targetDuration}));
 for(const targetDuration of [60,120,180,240,300])assert.equal(operations.studio_generate.schema.parse({soundId:'s',text:'piano',targetDuration}).targetDuration,targetDuration);
});
test('exact tolerance boundaries match the engine without ratio-rounding rejection',()=>{
 for(const target of [60,120,180,240,300]){
  const low=target*.85,high=target*1.15;
  assert.equal(durationWithinTarget(low,target),true);assert.equal(durationWithinTarget(high,target),true);
  assert.equal(durationWithinTarget(low-.001,target),false);assert.equal(durationWithinTarget(high+.001,target),false);
 }
 assert.equal(durationWithinTarget(NaN,180),false);
});
