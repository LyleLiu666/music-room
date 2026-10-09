import test from 'node:test';
import assert from 'node:assert/strict';
import {newCreationDraft,versionCreationDraft} from './creation.ts';
import {displayedEmotionStrength,emotionAlpha} from '../../service/tts/emotion.ts';
test('new creations default to normal while editing legacy versions keeps the old rule',()=>{
 assert.equal(newCreationDraft('sound','voice').emotionStrength,'normal');
 for(const emotion of ['开心',undefined]){
  const input={soundId:'sound',text:'原文',voiceId:'voice',emotion};
  const draft=versionCreationDraft('sound','version',input);draft.text='改了正文';
  assert.equal(Object.hasOwn(draft,'emotionStrength'),false);
  assert.equal(displayedEmotionStrength(draft),emotion?'normal':'strong');
  assert.equal(emotionAlpha(draft.emotion,draft.emotionStrength),emotion?.trim()? .6 : 1);
 }
 for(const emotionStrength of ['flat','normal','strong'] as const){const draft=versionCreationDraft('sound','version',{soundId:'sound',text:'原文',emotionStrength});assert.equal(draft.emotionStrength,emotionStrength);}
});
