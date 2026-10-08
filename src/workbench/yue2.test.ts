import test from 'node:test';
import assert from 'node:assert/strict';
import {describeYuE2Progress} from './yue2.ts';
test('generation progress shows musical stages without dumping internal score or token JSON',()=>{
  assert.equal(describeYuE2Progress({type:'abc',text:'X:1\nV: Vocal ...',tokens:100}),'编写音乐结构');
  assert.equal(describeYuE2Progress({type:'token',phase:'semantic',tokens:1800}),'生成演奏');
  assert.equal(describeYuE2Progress({type:'stage',stage:'decode',completed:2,total:4}),'导出音频 · 50%');
  assert.equal(describeYuE2Progress({type:'stage',stage:'synthesize',completed:0,total:null}),'合成声音');
  assert.equal(describeYuE2Progress(undefined),'');
  assert.equal(describeYuE2Progress({type:'unexpected',text:'private internal data'}),'');
});
