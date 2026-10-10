import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {testResources} from './testing.ts';
import {checkDisk,installTask} from './installation.ts';
test('disk admission uses the target filesystem and leaves a reserve; unknown values fail closed',()=>{
 const fs=(available:number)=>()=>({bavail:available,bsize:1}) as any;
 assert.throws(()=>checkDisk(tmpdir(),1,fs(2**30)),/空间不足/);assert.equal(checkDisk(tmpdir(),1,fs(3*2**30)),3*2**30);
 assert.throws(()=>checkDisk(tmpdir(),1,fs(NaN)),/指标无效/);assert.throws(()=>checkDisk(tmpdir(),1,()=>{throw Error();}),/无法读取/);
});
test('installation shares inference rights; cancellation while waiting never writes files',async()=>{
 const resources=testResources(),controller=new AbortController();resources.register('tts',{resident:()=>undefined,unload:async()=>{}});let release!:()=>void;
 const held=resources.run({id:'infer',engine:'tts',demand:{verified:true,peak:{memory:1}},execute:async()=>new Promise<void>(r=>release=r)});while(!release)await new Promise(r=>setTimeout(r,1));
 let writes=0;const install=installTask(resources,{id:'install',directory:tmpdir(),diskBytes:1,signal:controller.signal,execute:async()=>{writes++;}});controller.abort();await assert.rejects(install,/取消/);assert.equal(writes,0);release();await held;await resources.close();
});

test('managed speech preparation waits and cancellation never invokes the installer',async t=>{
 const {SpeechService}=await import('../tts/speech.ts'),{ProjectStore}=await import('../projects/store.ts'),{mkdtemp,rm}=await import('node:fs/promises'),{join}=await import('node:path');
 const root=await mkdtemp(join(tmpdir(),'install-tts-')),store=await ProjectStore.open(root),resources=testResources();let downloads=0,release!:()=>void;
 const speech=await SpeechService.open(store,{installed:()=>false,prepare:async()=>{downloads++;},generate:async()=>{}},()=>false,resources);t.after(async()=>{await speech.close();await resources.close();await store.close();await rm(root,{recursive:true,force:true});});
 resources.register('music',{resident:()=>undefined,unload:async()=>{}});const held=resources.run({id:'music',engine:'music',demand:{verified:true,peak:{memory:1}},execute:()=>new Promise<void>(r=>release=r)});while(!release)await new Promise(r=>setTimeout(r,1));
 await speech.prepare(join(root,'models'));await new Promise(r=>setTimeout(r,10));assert.equal(downloads,0);await speech.cancelPreparation();assert.equal(downloads,0);release();await held;
});
