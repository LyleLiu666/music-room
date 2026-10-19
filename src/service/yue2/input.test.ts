import test from 'node:test';
import assert from 'node:assert/strict';
import {musicContextStatus,generationWithEnding} from './input.ts';
test('context admits the real long prompt while reserving both planning and full music generation',()=>{
 const result=musicContextStatus({prefixTokens:1357,planningTokens:4098,semanticTokens:9000,contextTokens:24576});
 assert.equal(result.requiredTokens,14455);assert.equal(result.remainingTokens,10121);assert.equal(result.issue,undefined);
});
test('context accepts the exact boundary and rejects one token over without shrinking generation',()=>{
 const counts={prefixTokens:11478,planningTokens:4098,semanticTokens:9000,contextTokens:24576};
 assert.equal(musicContextStatus(counts).remainingTokens,0);
 assert.match(musicContextStatus({...counts,prefixTokens:11479}).issue!,/24577.*24576/);
 assert.equal(musicContextStatus({...counts,planningTokens:0}).requiredTokens,20478);
});
test('ending guidance preserves vocal words and explicit instrumental structures',()=>{
 const input={style:'piano',lyrics:'[Intro]\n[Verse]\n[Outro]',instrumental:true};
 assert.equal(generationWithEnding(input).lyrics,input.lyrics);
 assert.ok(generationWithEnding(input).style.length>input.style.length);
 assert.equal(generationWithEnding({...input,ending:'as-described'}).lyrics,input.lyrics);
});

test('explicit instrumental mode constrains vocals independently of ending without inventing song sections',()=>{
 for(const ending of ['natural','as-described'] as const){
  const input={style:'梦幻电子氛围',lyrics:'[instrumental]',instrumental:true,ending};
  const result=generationWithEnding(input);
  assert.equal(result.lyrics,'[instrumental]');
  assert.match(result.style,/No vocals, singing, humming, spoken words or vocal samples/);
  assert.ok(result.style.includes(input.style));
  assert.equal(result.style.includes('Ending arrangement'),ending==='natural');
 }
 const vocal=generationWithEnding({style:'Instrumental introduction then singing',lyrics:'唱出这句话',instrumental:false,ending:'as-described'});
 assert.equal(vocal.style,'Instrumental introduction then singing');
 assert.equal(vocal.lyrics,'唱出这句话');
});

test('instrumental section protocol rejects sung text before generation while vocal text remains intact',()=>{
 for(const lyrics of ['这是歌词','[Verse]\n这是歌词','[Verse 0:15-0:45]']){
  assert.throws(()=>generationWithEnding({style:'钢琴',lyrics,instrumental:true}),/纯音乐.*段落标签/);
  assert.equal(generationWithEnding({style:'钢琴',lyrics,instrumental:false}).lyrics,lyrics);
 }
 const lyrics='[Intro]\n\n[Verse 1]\n[Chorus]\n[Outro]';
 assert.equal(generationWithEnding({style:'钢琴',lyrics,instrumental:true}).lyrics,lyrics);
});
