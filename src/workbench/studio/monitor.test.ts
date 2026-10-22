import test from 'node:test';
import assert from 'node:assert/strict';
import {monitorMarkup} from './monitor.ts';

test('pressure and startup budget are primary; non-free bytes are labelled in expandable details',()=>{
 const html=monitorMarkup({sampledAt:Date.now(),system:{memoryUsed:31*2**30,memoryTotal:32*2**30},application:{memoryBytes:2**30,memoryKind:'footprint'},resources:{policy:{reserveFraction:.25,reserveMinimum:0,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8},hardware:{supported:true,topology:'unified',sampledAt:Date.now(),pressure:'normal',pools:[{id:'memory',capacity:32*2**30,available:18*2**30,owned:2**30}]}}});
 assert.match(html,/压力正常/);assert.match(html,/本程序可再用约 <strong>17.0 GiB<\/strong>/);assert.match(html,/<details/);assert.match(html,/非空闲.*31.0 GiB/);assert.match(html,/估计.*不保证/);
 assert.doesNotMatch(html,/<td>31.0 GiB<\/td>/);
 const failed=monitorMarkup(undefined,'failed');assert.match(failed,/暂不可用/);assert.doesNotMatch(failed,/压力正常|0.0 GiB/);
});
