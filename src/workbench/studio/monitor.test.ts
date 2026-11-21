import test from 'node:test';
import assert from 'node:assert/strict';
import {monitorMarkup} from './monitor.ts';

test('pressure and usable memory stay visible while details show only four key figures',()=>{
 const html=monitorMarkup({sampledAt:Date.now(),system:{memoryUsed:31*2**30,memoryTotal:32*2**30},application:{memoryBytes:2**30,memoryKind:'footprint'},resources:{policy:{reserveFraction:.25,reserveMinimum:0,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8},hardware:{supported:true,topology:'unified',sampledAt:Date.now(),pressure:'normal',memory:{capacity:32*2**30,free:2**30,purgeable:0,inactive:8*2**30,fileBacked:6*2**30,compressed:8*2**30,wired:3*2**30,swapUsed:2**30,swapInBytes:0,swapOutBytes:0,pressureAvailablePercent:56,estimatedReclaimable:17*2**30},pools:[{id:'memory',capacity:32*2**30,available:18*2**30,owned:2**30}]}}});
 assert.match(html,/压力正常/);assert.match(html,/本程序可再用约 <strong>17.0 GiB<\/strong>/);assert.match(html,/<details/);assert.match(html,/总内存/);assert.match(html,/程序上限/);assert.match(html,/压缩/);assert.match(html,/交换/);assert.equal((html.match(/<dt>/g)??[]).length,4);assert.doesNotMatch(html.slice(html.indexOf('<details')),/非空闲|非活动|文件后备|累计换入|可回收程度|不保证模型/);
 assert.doesNotMatch(html,/<td>31.0 GiB<\/td>/);
 const failed=monitorMarkup(undefined,'failed');assert.match(failed,/暂不可用/);assert.doesNotMatch(failed,/压力正常|0.0 GiB/);
 const warning=monitorMarkup({sampledAt:Date.now(),system:{memoryUsed:31*2**30,memoryTotal:32*2**30},application:{memoryBytes:2**30,memoryKind:'footprint'},resources:{policy:{reserveFraction:.25,reserveMinimum:0,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8},hardware:{supported:true,topology:'unified',sampledAt:Date.now(),pressure:'warning',pools:[{id:'memory',capacity:32*2**30,available:16*2**30,owned:2**30}]}}});
 assert.match(warning,/本程序可再用约 <strong>15\.0 GiB<\/strong>（含缓存粗估；因系统内存压力偏高已暂停新任务）/);
});

test('sidebar line answers whether new heavy work can start, without CPU tables',async()=>{
 const {monitorLine}=await import('./monitor.ts');
 const policy={reserveFraction:.25,reserveMinimum:0,headroom:2**30,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8};
 const snapshot=(pressure:string)=>({sampledAt:Date.now(),system:{},application:{},resources:{policy,hardware:{supported:true,topology:'unified',sampledAt:Date.now(),pressure,pools:[{id:'memory',capacity:64*2**30,available:32*2**30,owned:2*2**30}]}}}) as any;
 const normal=monitorLine(snapshot('normal'));assert.equal(normal.state,'');assert.match(normal.html,/内存 <b>正常<\/b> · 可用约 <b>31.0 GiB<\/b>/);assert.doesNotMatch(normal.html,/<table|CPU/);assert.equal((normal.html.match(/<i/g)??[]).length,5);
 assert.deepEqual([monitorLine(snapshot('warning')).state,monitorLine(snapshot('critical')).state,monitorLine(snapshot('unknown')).state],['warn','error','error']);
 assert.match(monitorLine(snapshot('warning')).html,/内存偏高 · 新任务会等待/);assert.match(monitorLine(snapshot('critical')).html,/已停止重型任务/);
 assert.match(monitorLine(undefined).html,/采样中/);assert.match(monitorLine(undefined,'offline').html,/暂时无法读取内存/);
});
