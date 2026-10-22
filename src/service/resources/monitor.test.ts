import test from 'node:test';
import assert from 'node:assert/strict';
import {MachineMonitor,parseMonitorProcesses,ownedProcesses} from './monitor.ts';
const row=(pid:number,ppid:number,cpuMs=1000,start='first',rss=1024)=>({pid,ppid,cpuMs,start,rss,zombie:false});
test('process ownership follows descendants, not names or unrelated process groups',()=>{
 const rows=[row(1,0),row(9,4),row(4,1),row(8,0),{...row(10,4),zombie:true}];
 assert.deepEqual(ownedProcesses(rows,1).map(r=>r.pid).sort((a,b)=>a-b),[1,4,9]);
 assert.throws(()=>ownedProcesses(rows,11),/服务进程/);
 const parsed=parseMonitorProcesses(' 1 0 01:02.50 20 S Wed Oct 21 09:00:00 2026\n 4 1 1-02:03:04 30 Z Wed Oct 21 09:00:01 2026');
 assert.equal(parsed[0].cpuMs,62500);assert.equal(parsed[0].rss,20480);assert.equal(parsed[1].cpuMs,93784000);assert.equal(parsed[1].zombie,true);
 assert.throws(()=>parseMonitorProcesses('broken'),/进程/);
});
test('CPU uses interval deltas and total machine capacity; application memory includes descendants once',async()=>{
 let now=0,total=1000,idle=500,rows=[row(1,0),row(2,1),row(9,0,9000)],reads=0;
 const monitor=new MachineMonitor({pid:1,now:()=>now,readSystem:()=>({total,idle,cpuCount:4,memoryTotal:10000,memoryFree:4000}),readProcesses:async()=>{reads++;return rows;},measure:async pid=>pid===1?200:800});
 const a=await monitor.status();assert.equal(a.system.cpuPercent,undefined);assert.equal(a.application.memoryBytes,1000);assert.equal(a.application.processCount,2);assert.equal(a.system.memoryUsed,6000);
 await monitor.status();assert.equal(reads,1);
 now=2000;total+=8000;idle+=4000;rows=[row(1,0,2000),row(2,1,3000),row(9,0,19000)];
 const b=await monitor.status();assert.equal(b.system.cpuPercent,50);assert.equal(b.application.cpuPercent,37.5);
 now=4000;total+=8000;idle+=8000;rows=[row(1,0,2000),row(2,1,99999,'reused')];
 assert.equal((await monitor.status()).application.cpuPercent,0,'a reused PID must not inherit prior CPU counters');
 now=20000;assert.equal((await monitor.status()).application.cpuPercent,undefined,'returning after a long pause warms up again');
});
test('failed sampling never reports stale memory or zero as a successful reading and concurrent reads coalesce',async()=>{
 let now=0,fail=false,reads=0;
 const monitor=new MachineMonitor({pid:1,now:()=>now,readSystem:()=>({total:1000+now,idle:500,cpuCount:2,memoryTotal:1000,memoryFree:400}),readProcesses:async()=>{reads++;if(fail)throw Error('unavailable');return [row(1,0)];}});
 await Promise.all([monitor.status(),monitor.status()]);assert.equal(reads,1);
 now=2000;fail=true;const failed=await monitor.status();assert.equal(failed.application.memoryBytes,undefined);assert.equal(failed.application.cpuPercent,undefined);assert.ok(failed.application.error);assert.equal(failed.system.memoryUsed,600);
 now=4000;fail=false;assert.equal((await monitor.status()).application.cpuPercent,undefined);
 const partial=new MachineMonitor({pid:1,readProcesses:async()=>[row(1,0)],measure:async()=>{throw Error('no permission');}});
 const s=await partial.status();assert.equal(s.application.memoryBytes,undefined);assert.ok(s.application.memoryError);
});

test('monitor exposes pressure and the same admission inputs, rather than labelling non-free pages as exhaustion',async()=>{
 const policy={reserveFraction:.25,reserveMinimum:0,headroom:100,maxSnapshotAgeMs:3000,maxWaitMs:100,retryMs:1,maxQueue:8};
 const hardware={supported:true,topology:'unified' as const,sampledAt:Date.now(),pressure:'normal' as const,pools:[{id:'memory',capacity:10000,available:6000,owned:1000}]};
 const monitor=new MachineMonitor({pid:1,readSystem:()=>({total:1000,idle:500,cpuCount:2,memoryTotal:10000,memoryFree:100}),readProcesses:async()=>[row(1,0)],readResources:async()=>({hardware,policy,queued:[]})});
 const value=await monitor.status();assert.equal(value.system.memoryUsed,9900);assert.equal(value.resources?.hardware?.pressure,'normal');assert.equal(value.resources?.policy.headroom,100);
});
