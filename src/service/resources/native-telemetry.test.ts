import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {nativeFootprint,parseNativeFootprint} from './native-telemetry.ts';
import {physicalBytes} from './telemetry.ts';
test('native telemetry validates identity and byte counts rather than accepting missing metrics',()=>{
 assert.equal(parseNativeFootprint('{"pid":1,"bytes":123}',1),123);
 for(const text of ['{}','{"pid":2,"bytes":123}','{"pid":1,"bytes":-1}','{"pid":1,"bytes":1.5}'])assert.throws(()=>parseNativeFootprint(text,1));
});
test('kernel sampler measures a live allocated workload and fails after it exits', {skip:process.platform!=='darwin'},async()=>{
 const sampler=nativeFootprint(),child=spawn(process.execPath,['-e',"global.buffer=Buffer.alloc(64*2**20,3);process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
 const stopped=once(child,'exit');
 try{await once(child.stdout!,'data');const measured=await sampler.measure(child.pid!);assert.ok(measured>=64*2**20);
  const reference=await physicalBytes(child.pid!);assert.ok(Math.abs(measured-reference)<32*2**20,'same physical footprint as vmmap');
  child.kill();await stopped;await assert.rejects(sampler.measure(child.pid!));
 }finally{child.kill();await sampler.close();}
});

test('native system sampling distinguishes counters from reclaimable estimates and never budgets compression or all file pages',async()=>{
 const {parseNativeMemory}=await import('./native-telemetry.ts');
 const raw={capacity:32*2**30,free:256*2**20,purgeable:2**30,inactive:12*2**30,fileBacked:10*2**30,compressed:8*2**30,wired:3*2**30,swapUsed:4*2**30,swapInBytes:20*2**30,swapOutBytes:30*2**30};
 assert.deepEqual(parseNativeMemory(JSON.stringify(raw)),raw);
 for(const invalid of [{...raw,compressed:-1},{...raw,capacity:0},{...raw,fileBacked:40*2**30},{...raw,swapOutBytes:undefined}])assert.throws(()=>parseNativeMemory(JSON.stringify(invalid)));
});

test('native system counters are available without loading a model', {skip:process.platform!=='darwin'},async()=>{
 const sampler=nativeFootprint();try{const memory=await sampler.system();assert.ok(memory.capacity>0);assert.ok(memory.compressed>=0);assert.ok(memory.swapOutBytes>=0);}finally{await sampler.close();}
});
