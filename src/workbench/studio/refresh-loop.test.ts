import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshDelay} from './refresh-loop.ts';

test('idle and hidden workspaces keep eventual sync without active-task polling cost',()=>{
 assert.equal(refreshDelay({hidden:false,active:true}),1800);
 assert.equal(refreshDelay({hidden:false,active:false}),10000);
 assert.equal(refreshDelay({hidden:true,active:true}),30000);
 assert.equal(refreshDelay({hidden:true,active:false}),30000);
});

test('a completed task with a failed render keeps fast recovery instead of waiting idle cadence',()=>{
 assert.equal(refreshDelay({hidden:false,active:false,recovering:true}),1800);
 assert.equal(refreshDelay({hidden:true,active:false,recovering:true}),30000);
});

test('refresh coordinator never overlaps ticks, keeps earlier deadlines and stops after disposal',async t=>{
 const {RefreshLoop}=await import('./refresh-loop.ts');t.mock.timers.enable({apis:['setTimeout','Date']});
 let active=true,calls=0,finish!:()=>void;
 const loop=new RefreshLoop(()=>({hidden:false,active}),async()=>{calls++;await new Promise<void>(resolve=>finish=resolve);});
 loop.reschedule();t.mock.timers.tick(1800);assert.equal(calls,1);
 loop.reschedule();t.mock.timers.tick(30000);assert.equal(calls,1);
 active=false;finish();await Promise.resolve();await Promise.resolve();
 t.mock.timers.tick(9000);assert.equal(calls,1);loop.reschedule(true);t.mock.timers.tick(1000);assert.equal(calls,2);
 loop.dispose();finish();await Promise.resolve();await Promise.resolve();t.mock.timers.tick(60000);assert.equal(calls,2);
});
