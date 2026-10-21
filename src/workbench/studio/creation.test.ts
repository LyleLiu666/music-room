import test from 'node:test';
import assert from 'node:assert/strict';
import {newCreationDraft,versionCreationDraft,clearFailedMusicSeed} from './creation.ts';
import type {StudioVersion} from '../../service/studio/studio.ts';
import {displayedEmotionStrength,emotionAlpha} from '../../service/tts/emotion.ts';
test('new creations default to the former flat strength while editing legacy versions keeps the old rule',()=>{
 assert.equal(newCreationDraft('sound','voice').emotionStrength,'flat');
 for(const emotion of ['开心',undefined]){
  const input={soundId:'sound',text:'原文',voiceId:'voice',emotion};
  const draft=versionCreationDraft('sound','version',input);draft.text='改了正文';
  assert.equal(Object.hasOwn(draft,'emotionStrength'),false);
  assert.equal(displayedEmotionStrength(draft),emotion?'normal':'strong');
  assert.equal(emotionAlpha(draft.emotion,draft.emotionStrength),emotion?.trim()? .6 : 1);
 }
 for(const emotionStrength of ['minimal','subtle','flat','normal','strong'] as const){const draft=versionCreationDraft('sound','version',{soundId:'sound',text:'原文',emotionStrength});assert.equal(draft.emotionStrength,emotionStrength);}
});
test('unfinished music without recovery clears inherited planning seeds without modifying history or creative requirements',()=>{
 for(const seed of [0,42,2147483647])for(const state of ['failed','cancelled','interrupted'] as const){
  const input={soundId:'s',text:'flute',seed,instrumental:true,lyrics:'原歌词',structure:'[Intro]',targetDuration:180};
  const source={id:'v',soundId:'s',state,input,source:{kind:'music',id:'job'}} as StudioVersion;
  for(let attempt=0;attempt<3;attempt++){
   const draft={...input,seed:(seed+attempt)%2147483648};
   assert.equal(clearFailedMusicSeed(draft,source),(seed+attempt)%2147483648);
   const {seed:_,...rest}=input;assert.deepEqual(draft,rest);assert.equal(source.input?.seed,seed);
   assert.equal(clearFailedMusicSeed(draft,source),undefined);
  }
  const changed={...input,seed:(seed+3)%2147483648};assert.equal(clearFailedMusicSeed(changed,source),undefined);assert.equal(changed.seed,(seed+3)%2147483648);
 }
});
test('seed clearing preserves successful versions, recoverable versions, other sounds and new creations',()=>{
 const input={soundId:'s',text:'piano',seed:42};
 const source={id:'v',soundId:'s',state:'failed',input,source:{kind:'music',id:'job'}} as StudioVersion;
 for(const candidate of [undefined,{...source,state:'succeeded'},{...source,state:'running'},{...source,state:'queued'},{...source,soundId:'other'},{...source,musicRecovery:{jobId:'job',stage:'plan'}},{...source,source:{kind:'speech',id:'job'}}] as (StudioVersion|undefined)[]){
  const draft={...input};assert.equal(clearFailedMusicSeed(draft,candidate),undefined);assert.equal(draft.seed,42);
 }
});
