import test from 'node:test';
import assert from 'node:assert/strict';
import {ResourceCoordinator} from './coordinator.ts';
import type {HardwareSnapshot} from './contracts.ts';
const hardware=():HardwareSnapshot=>({supported:true,topology:'cpu',sampledAt:Date.now(),pressure:'normal',pools:[{id:'memory',capacity:1000,available:1000,owned:0}]});
const policy={reserveFraction:.1,reserveMinimum:0,headroom:0,maxSnapshotAgeMs:1000,maxWaitMs:100,retryMs:1,maxQueue:10};
for(const mode of ['pressure','missing','failure'])test(`runtime ${mode} protection terminates and records an honest reason`,async()=>{
 const resources=new ResourceCoordinator({policy,probe:async()=>hardware(),monitorMs:1,observe:async()=>{if(mode==='failure')throw Error();return {usage:mode==='missing'?{} as Record<string,number>:{memory:1},pressure:mode==='pressure'?'critical':'normal'};}});resources.register('x',{resident:()=>undefined,unload:async()=>{}});
 await assert.rejects(resources.run({id:'x',engine:'x',demand:{verified:true,peak:{memory:100}},execute:async ctx=>{await new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}));ctx.signal.throwIfAborted();}}));assert.equal(resources.snapshot().history[0].reason,mode==='pressure'?'PRESSURE_PROTECTION':'RESOURCE_TELEMETRY_UNAVAILABLE');assert.deepEqual(resources.snapshot().reservations,{});await resources.close();
});

test('measured resource faults remain failures rather than masquerading as user cancellation',async()=>{
 const {userCancelled,ResourceError}=await import('./contracts.ts');const c=new AbortController();c.abort(new ResourceError('PEAK_EXCEEDED','budget'));assert.equal(userCancelled(c.signal),false);assert.equal(userCancelled(AbortSignal.abort()),true);
});
test('swap growth stops the current task without counting swap as available memory',async()=>{
 const resources=new ResourceCoordinator({policy,probe:async()=>({...hardware(),swapUsed:2**30}),observe:async()=>({usage:{memory:1},pressure:'normal',swapUsed:2**30+512*2**20})});resources.register('x',{resident:()=>undefined,unload:async()=>{}});await assert.rejects(resources.run({id:'swap',engine:'x',demand:{verified:true,peak:{memory:100}},execute:async ctx=>{await new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}));ctx.signal.throwIfAborted();}}),/交换空间/);assert.equal(resources.snapshot().history[0].reason,'PRESSURE_PROTECTION');await resources.close();
});
