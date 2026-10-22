import test from 'node:test';
import assert from 'node:assert/strict';
import {ResourceCoordinator} from './coordinator.ts';
import type {HardwareSnapshot} from './contracts.ts';
const hardware=():HardwareSnapshot=>({supported:true,topology:'cpu',sampledAt:Date.now(),pressure:'normal',pools:[{id:'memory',capacity:1000,available:1000,owned:0}]});
const policy={reserveFraction:.1,reserveMinimum:0,headroom:0,maxSnapshotAgeMs:1000,maxWaitMs:100,retryMs:1,maxQueue:10};
for(const mode of ['pressure','missing','failure'])test(`runtime ${mode} protection terminates and records an honest reason`,async()=>{
 const resources=new ResourceCoordinator({policy,probe:async()=>hardware(),monitorMs:1,observe:async()=>{if(mode==='failure')throw Error('采样命令超时：测试证据');return {usage:mode==='missing'?{} as Record<string,number>:{memory:1},pressure:mode==='pressure'?'critical':'normal'};}});resources.register('x',{resident:()=>undefined,unload:async()=>{}});
 await assert.rejects(resources.run({id:'x',engine:'x',demand:{verified:true,peak:{memory:100}},execute:async ctx=>{await new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}));ctx.signal.throwIfAborted();}}));assert.equal(resources.snapshot().history[0].reason,mode==='pressure'?'PRESSURE_PROTECTION':'RESOURCE_TELEMETRY_UNAVAILABLE');if(mode==='failure')assert.equal(resources.snapshot().history[0].diagnostic,'采样命令超时：测试证据');assert.deepEqual(resources.snapshot().reservations,{});await resources.close();
});

test('measured resource faults remain failures rather than masquerading as user cancellation',async()=>{
 const {userCancelled,ResourceError}=await import('./contracts.ts');const c=new AbortController();c.abort(new ResourceError('PEAK_EXCEEDED','budget'));assert.equal(userCancelled(c.signal),false);assert.equal(userCancelled(AbortSignal.abort()),true);
});
test('swap growth stops the current task without counting swap as available memory',async()=>{
 const resources=new ResourceCoordinator({policy,probe:async()=>({...hardware(),swapUsed:2**30}),observe:async()=>({usage:{memory:1},pressure:'warning',swapUsed:2**30+512*2**20})});resources.register('x',{resident:()=>undefined,unload:async()=>{}});await assert.rejects(resources.run({id:'swap',engine:'x',demand:{verified:true,peak:{memory:100}},execute:async ctx=>{await new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}));ctx.signal.throwIfAborted();}}),/交换空间/);assert.equal(resources.snapshot().history[0].reason,'PRESSURE_PROTECTION');await resources.close();
});
test('system swap growth alone cannot attribute a failure to a healthy in-budget task',async()=>{
 const resources=new ResourceCoordinator({policy,probe:async()=>({...hardware(),swapUsed:2**30}),monitorMs:1,observe:async()=>({usage:{memory:1},pressure:'normal',swapUsed:2**30+512*2**20})});
 resources.register('x',{resident:()=>undefined,unload:async()=>{}});
 try{await resources.run({id:'normal-swap',engine:'x',demand:{verified:true,peak:{memory:100}},execute:async ctx=>{await new Promise(r=>setTimeout(r,20));ctx.signal.throwIfAborted();}});assert.equal(resources.snapshot().history[0].stage,'succeeded');}finally{await resources.close();}
});

test('ongoing swap-out under warning pressure stops even when swap occupancy stays stable',async()=>{
 const baseline={...hardware(),swapUsed:2**30,memory:{swapOutBytes:2**30}} as HardwareSnapshot;
 const resources=new ResourceCoordinator({policy,probe:async()=>baseline,observe:async()=>({usage:{memory:1},pressure:'warning',swapUsed:2**30,swapOutBytes:2**30+512*2**20})});
 resources.register('x',{resident:()=>undefined,unload:async()=>{}});
 try{await assert.rejects(resources.run({id:'churn',engine:'x',demand:{verified:true,peak:{memory:100}},execute:async ctx=>{if(!ctx.signal.aborted)await new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}));ctx.signal.throwIfAborted();}}),/交换/);}finally{await resources.close();}
});

test('stable pre-existing swap occupancy does not stop a task under a transient warning',async()=>{
 const resources=new ResourceCoordinator({policy,probe:async()=>({...hardware(),swapUsed:4*2**30}),monitorMs:1,observe:async()=>({usage:{memory:1},pressure:'warning',swapUsed:4*2**30})});
 resources.register('x',{resident:()=>undefined,unload:async()=>{}});
 try{await resources.run({id:'stable',engine:'x',demand:{verified:true,peak:{memory:100}},execute:async ctx=>{await new Promise(r=>setTimeout(r,15));ctx.signal.throwIfAborted();}});assert.equal(resources.snapshot().history[0].stage,'succeeded');}finally{await resources.close();}
});

test('sudden external pressure waits for the real model process to exit before granting the next task',async()=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events');
 let child:ReturnType<typeof spawn>|undefined,exited:Promise<unknown>|undefined,ready=false,cleanupStarted!:()=>void,releaseCleanup!:()=>void;
 const cleanupGate=new Promise<void>(r=>releaseCleanup=r),cleanupEntered=new Promise<void>(r=>cleanupStarted=r);
 const resources=new ResourceCoordinator({policy,probe:async()=>hardware(),monitorMs:1,observe:async()=>({usage:{memory:1},pressure:ready?'critical':'normal'})});
 resources.register('x',{resident:()=>undefined,unload:async()=>{cleanupStarted();await cleanupGate;child?.kill();await exited;}});
 resources.register('next',{resident:()=>undefined,unload:async()=>{}});
 const first=resources.run({id:'real-child',engine:'x',demand:{verified:true,peak:{memory:100}},execute:async ctx=>{
  child=spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});exited=once(child,'exit');await once(child.stdout!,'data');ctx.trackProcess(child.pid!);ready=true;
  if(!ctx.signal.aborted)await new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}));ctx.signal.throwIfAborted();
 }});
 const rejected=assert.rejects(first,{code:'PRESSURE_PROTECTION'});let nextStarted=false;
 const next=resources.run({id:'next',engine:'next',demand:{verified:true,peak:{memory:100}},execute:async()=>{nextStarted=true;assert.throws(()=>process.kill(child!.pid!,0),{code:'ESRCH'});}});
 try{await cleanupEntered;assert.equal(nextStarted,false);ready=false;releaseCleanup();await Promise.all([rejected,next]);assert.equal(nextStarted,true);}finally{releaseCleanup();child?.kill();await resources.close();}
});
