import test from 'node:test';import assert from 'node:assert/strict';
import {queueSummary} from './task-queue.ts';
test('global queue distinguishes running, waiting, paused, idle and disconnected',()=>{
 assert.equal(queueSummary(undefined,false),'正在连接后台…');assert.equal(queueSummary(undefined,true),'后台连接中断 · 队列状态未知');
 assert.equal(queueSummary({active:undefined,queued:[],paused:false},false),'后台空闲 · 无排队任务');
 assert.equal(queueSummary({active:{},queued:[{},{}],paused:false},false),'正在处理 1 项 · 排队 2 项');
 assert.equal(queueSummary({active:undefined,queued:[{}],paused:true},false),'队列已暂停 · 等待 1 项');
});
