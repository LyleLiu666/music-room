import test from 'node:test';import assert from 'node:assert/strict';
import {queueSummary,taskQueueRows} from './task-queue.ts';
test('global queue distinguishes running, waiting, paused, idle and disconnected',()=>{
 assert.equal(queueSummary(undefined,false),'正在连接后台…');assert.equal(queueSummary(undefined,true),'后台连接中断 · 队列状态未知');
 assert.equal(queueSummary({active:undefined,queued:[],paused:false},false),'后台空闲 · 无排队任务');
 assert.equal(queueSummary({active:{},queued:[{},{}],paused:false},false),'正在处理 1 项 · 排队 2 项');
 assert.equal(queueSummary({active:undefined,queued:[{}],paused:true},false),'队列已暂停 · 等待 1 项');
});
test('lyrics queue shows owner, actual progress, elapsed time and queue position',()=>{
 const now=180000,active={id:'lyrics-one',engine:'lyrics',stage:'running',submittedAt:10000},queued={id:'lyrics-two',engine:'lyrics',stage:'queued',submittedAt:20000};
 const library={projects:[{id:'p',title:'歌曲项目'}],sounds:[{id:'s',projectId:'p',title:'春风 <demo>'}],backgroundLyrics:[
  {soundId:'s',number:9,job:{taskId:active.id,versionId:'v9',state:'running',message:'正在定位每句起止时间 · 已完成 2 / 5 段',progress:74,startedAt:60000,updatedAt:175000}},
  {soundId:'s',number:8,job:{taskId:queued.id,versionId:'v8',state:'queued',message:'等待生成同步歌词',progress:0}}
 ]} as any;
 const html=taskQueueRows({active,queued:[queued],paused:false} as any,library,now);
 assert.match(html,/歌曲项目 \/ 春风 &lt;demo&gt; · V9 · 同步歌词/);assert.match(html,/value="74"/);assert.match(html,/已运行 2 分 0 秒/);assert.match(html,/最近推进：5 秒前/);assert.match(html,/排队中 · 前面还有 1 项/);assert.equal((html.match(/<progress/g)??[]).length,1);
 const delayed=taskQueueRows({active,queued:[],paused:false} as any,library,310000);
 assert.match(delayed,/135 秒内未收到新进度；仍在等待处理结果/);
});
test('loading has indeterminate progress and resource waiting keeps its reason',()=>{
 const task={id:'lyrics-one',engine:'lyrics',stage:'running',submittedAt:10000};
 const library={sounds:[],projects:[],backgroundLyrics:[{job:{taskId:task.id,state:'running',message:'正在加载歌词模型',progress:0}}]} as any;
 const loading=taskQueueRows({active:task,queued:[],paused:false} as any,library);
 assert.match(loading,/<progress aria-label="同步歌词处理进度"[^>]*><\/progress>/);assert.doesNotMatch(loading,/value=|0%/);
 const waiting=taskQueueRows({active:{...task,stage:'waiting_resources',message:'等待可用内存'},queued:[],paused:false} as any,library);
 assert.match(waiting,/等待可用内存/);assert.doesNotMatch(waiting,/<progress/);
});
test('task titles navigate to the owned version, including queued music, lyrics and score renders',()=>{
 const active={id:'native-job',engine:'yue2',stage:'running'},queued={id:'render-job',engine:'render',stage:'queued'};
 const library={sounds:[{id:'s',projectId:'p',title:'音乐 <demo>'}],projects:[{id:'p',title:'项目'}],backgroundVersions:[
  {id:'v1',soundId:'s',number:1,stage:'写谱',source:{kind:'music',id:'native-job'}},
  {id:'v2',soundId:'s',number:2,renderJobId:'render-job',source:{kind:'score',id:'score'}}
 ],backgroundLyrics:[{soundId:'s',number:3,job:{taskId:'lyrics-job',versionId:'v3'}}]} as any;
 const html=taskQueueRows({active,queued:[queued,{id:'lyrics-job',engine:'lyrics',stage:'queued'},{id:'install-job',engine:'installation',stage:'queued'}]} as any,library);
 for(const id of ['v1','v2','v3'])assert.match(html,new RegExp(`data-action="task-version" data-id="${id}" data-sound="s"`));
 assert.match(html,/音乐 &lt;demo&gt;/);assert.equal((html.match(/data-action="task-version"/g)??[]).length,3);assert.match(html,/<strong>安装准备<\/strong>/);
});
