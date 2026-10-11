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
 assert.deepEqual(generationWithEnding({...input,ending:'as-described'}),{style:input.style,lyrics:input.lyrics});
});
