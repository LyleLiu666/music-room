import test from 'node:test';
import assert from 'node:assert/strict';
import {musicProgress} from './progress.ts';
import {musicProgressView} from '../../workbench/studio/music-progress.ts';
const now=Date.parse('2026-10-11T14:52:30Z');
const base={id:'a'.repeat(32),kind:'create',status:'running' as const,started_at:'2026-10-11T14:40:59Z',checkedAt:now};
test('real synthesis reports phase progress and a phase-only estimate',()=>{
 const p=musicProgress({...base,progress:{type:'stage',stage:'synthesize',completed:12,total:32,unit:'steps',seconds:333.312,ts:'2026-10-11T14:52:28Z'}})!;
 assert.equal(p.stage,'synthesize');assert.equal(p.completed,12);assert.equal(p.total,32);
 const v=musicProgressView(p,now);assert.equal(v.percent,37.5);assert.equal(v.remainingSeconds,555.52);assert.match(v.estimate,/本阶段.*9.*分钟/);assert.match(v.note,/导出/);assert.match(v.activity,/2 秒前/);assert.match(v.elapsed,/11 分/);
});
test('generation limits are not known song lengths and never become percent or ETA',()=>{
 for(const phase of ['abc','semantic']){
  const p=musicProgress({...base,progress:{type:'token',phase,tokens:900,seconds:90,ts:new Date(now).toISOString(),total:9000,unit:'tokens'}})!;
  const v=musicProgressView(p,now);assert.equal(v.percent,undefined);assert.equal(v.remainingSeconds,undefined);assert.match(v.estimate,/暂时无法估计/);assert.match(v.detail,/900/);
 }
});
test('missing, nonfinite and unknown fields fall back without bogus numbers',()=>{
 const p=musicProgress({...base,progress:{type:'stage',stage:'future-stage',completed:NaN,total:-3,seconds:Infinity,ts:'invalid'}})!;
 const v=musicProgressView(p,now);assert.equal(v.percent,undefined);assert.equal(v.remainingSeconds,undefined);assert.doesNotMatch(JSON.stringify(v),/NaN|Infinity/);
 assert.equal(musicProgress({...base,status:'done'}),undefined);
});
test('loading has no invented percentage; stale samples remove ETA but do not claim failure',()=>{
 const p=musicProgress({...base,progress:{type:'stage',stage:'synthesize',completed:12,total:32,unit:'steps',seconds:333.312,ts:'2026-10-11T14:52:28Z'}})!;
 const v=musicProgressView(p,now+180000);assert.equal(v.remainingSeconds,undefined);assert.equal(v.delayed,true);assert.match(v.activity,/未收到新进度/);assert.doesNotMatch(v.activity,/已卡死|失败/);
 const loading=musicProgress({...base,progress:{type:'status',stage:'load',ts:new Date(now).toISOString()}})!;
 assert.match(musicProgressView(loading,now).title,/加载/);assert.equal(musicProgressView(loading,now).percent,undefined);
});
test('completed phase is not completed song and elapsed includes no queue wait',()=>{
 const p=musicProgress({...base,progress:{type:'stage',stage:'synthesize',completed:32,total:32,unit:'steps',seconds:900,ts:new Date(now).toISOString()}})!;
 const v=musicProgressView(p,now);assert.equal(v.percent,100);assert.equal(v.remainingSeconds,undefined);assert.match(v.estimate,/本阶段已完成/);assert.match(v.note,/导出/);
 const queued=musicProgress({...base,status:'queued',started_at:null,created_at:'2026-10-11T14:20:00Z'})!;
 assert.equal(queued.startedAt,undefined);assert.match(musicProgressView(queued,now).title,/排队/);
});

test('admission loading is shown before the upstream song has started',()=>{
 const p=musicProgress({...base,status:'queued',started_at:null,resource:{stage:'loading'}})!;
 assert.equal(p.stage,'load');assert.equal(p.startedAt,undefined);assert.equal(musicProgressView(p,now).percent,undefined);
});

test('audio export chunk counts are real phase progress too',()=>{
 const p=musicProgress({...base,progress:{type:'stage',stage:'decode',completed:12,total:24,unit:'chunks',seconds:12,ts:new Date(now).toISOString()}})!;
 const v=musicProgressView(p,now);assert.equal(v.percent,50);assert.equal(v.remainingSeconds,12);assert.match(v.detail,/12 \/ 24 段/);assert.match(v.title,/导出/);
});

test('five major stages distinguish the fourth stage from its 32 synthesis steps and total time',()=>{
 const p=musicProgress({...base,progress:{type:'stage',stage:'synthesize',completed:4,total:32,unit:'steps',seconds:100,ts:new Date(now).toISOString()}})!;
 const v=musicProgressView(p,now);
 assert.match(v.title,/第 4 \/ 5 阶段.*合成声音/);
 assert.deepEqual(v.stages.map(s=>s.state),['complete','complete','complete','current','pending']);
 assert.deepEqual(v.stages.map(s=>s.title),['规划旋律与和弦','生成音乐内容','准备声音合成','合成声音','导出与保存']);
 assert.equal(v.detail,'已完成 4 / 32 小步');
 assert.match(v.elapsed,/总计已运行 11 分/);
 assert.equal(v.phaseElapsed,'当前环节已用 1 分 40 秒');
 const queued=musicProgressView({stage:'queued'},now);
 assert.ok(queued.stages.every(s=>s.state==='pending'));
 const unknown=musicProgressView({stage:'running'},now);
 assert.ok(unknown.stages.every(s=>s.state==='pending'));
});

test('engine model loading labels keep preparation and export in the correct major stage',()=>{
 for(const [label,stage,index] of [['Loading acoustic model','conditioning',3],['Loading MLX audio decoder','decode',5]] as const){
  const p=musicProgress({...base,progress:{type:'stage',stage:'load',label,seconds:0,ts:new Date(now).toISOString()}})!;
  assert.equal(p.stage,stage);
  assert.match(musicProgressView(p,now).title,new RegExp(`第 ${index} / 5 阶段`));
 }
 assert.ok(musicProgressView(musicProgress({...base,progress:{stage:'load',label:'Loading bf16 AR model'}})!,now).stages.every(s=>s.state==='pending'));
 assert.equal(musicProgressView({stage:'save'},now).stages[4].state,'current');
});
