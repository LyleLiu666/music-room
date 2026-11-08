import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../projects/store.ts';
import {testResources} from '../resources/testing.ts';
import {SoundLibrary} from './sound-library.ts';
import {SoundEffects,type EffectDriver} from './sound-effects.ts';
import {encodeWav} from '../../wav.ts';
const audio=(seconds:number)=>Buffer.from(encodeWav([Float32Array.from({length:seconds*24000},(_,i)=>Math.sin(i*.1)*.1)],24000));
const wait=async(fn:()=>boolean)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('任务没有结束');};
function fakeDriver():EffectDriver{return {profile:{id:'fake'},installed:()=>true,prepare:async()=>{},generate:async(req,execution)=>{execution.signal.throwIfAborted();return audio(req.seconds);}};}
test('effect generation queues, persists a distinct playable recording and safely deduplicates across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sfx-'));let store=await ProjectStore.open(dir),resources=testResources(),library=new SoundLibrary(store),effects=new SoundEffects(store,resources,library,fakeDriver());
 try{
  const request={requestId:'req-123',title:'碎纸机',prompt:'Close up paper shredder',seconds:3,seed:42};
  const started=effects.start(request);assert.equal(started.state,'queued');await wait(()=>effects.get(started.id).state==='succeeded');
  const done=effects.get(started.id);assert.equal(done.item?.title,'碎纸机');assert.equal(done.item?.source?.kind,'sound-effect');assert.deepEqual(await library.audio(done.item!.id),audio(3));
  assert.equal(effects.start(request).id,started.id);assert.throws(()=>effects.start({...request,prompt:'Different'}),/请求|冲突/);
  await effects.close();await resources.close();await library.close();await store.close();store=await ProjectStore.open(dir);resources=testResources();library=new SoundLibrary(store);effects=new SoundEffects(store,resources,library,fakeDriver());
  assert.equal(effects.get(started.id).state,'succeeded');assert.equal(effects.start(request).item?.id,done.item?.id);assert.deepEqual(await library.audio(done.item!.id),audio(3));
  assert.throws(()=>effects.start({...request,requestId:'other',seconds:6}),/时长/);
  assert.throws(()=>effects.start({...request,requestId:'empty',prompt:' '}),/描述/);
 }finally{await effects.close();await resources.close();await library.close();await store.close();await rm(dir,{recursive:true,force:true});}
});
test('cancelled queued effects do not execute or publish; failed output is never published',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sfx-cancel-')),store=await ProjectStore.open(dir),resources=testResources(),library=new SoundLibrary(store);let calls=0;
 const driver=fakeDriver();driver.generate=async()=>{calls++;return Buffer.from('invalid audio');};const effects=new SoundEffects(store,resources,library,driver);
 try{resources.pause();const job=effects.start({requestId:'queued',title:'音效',prompt:'Rain falling',seconds:3,seed:1});await effects.cancel(job.id);assert.equal(effects.get(job.id).state,'cancelled');assert.equal(calls,0);resources.resume();
  const bad=effects.start({requestId:'bad',title:'错误',prompt:'Rain falling',seconds:3,seed:1});await wait(()=>effects.get(bad.id).state==='failed');assert.equal(library.list().length,0);
 }finally{await effects.close();await resources.close();await library.close();await store.close();await rm(dir,{recursive:true,force:true});}
});
test('restart recovers a published sound after interrupted status update without creating a duplicate',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sfx-recover-'));let store=await ProjectStore.open(dir),resources=testResources(),library=new SoundLibrary(store),effects=new SoundEffects(store,resources,library,fakeDriver());
 try{const job=effects.start({requestId:'recover',title:'雨',prompt:'Rain falling',seconds:3,seed:1});await wait(()=>effects.get(job.id).state==='succeeded');const doc=JSON.parse(await readFile(store.path('sound-effects','jobs.json'),'utf8'));doc.jobs[0].state='running';delete doc.jobs[0].item;store.atomicJSON(store.path('sound-effects','jobs.json'),doc);
  await effects.close();await resources.close();await library.close();await store.close();store=await ProjectStore.open(dir);resources=testResources();library=new SoundLibrary(store);effects=new SoundEffects(store,resources,library,fakeDriver());assert.equal(effects.get(job.id).state,'succeeded');assert.equal(library.list().length,1);
 }finally{await effects.close();await resources.close();await library.close();await store.close();await rm(dir,{recursive:true,force:true});}
});

test('preparation is a background resource task and can be cancelled before model installation begins',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sfx-prepare-')),store=await ProjectStore.open(dir),resources=testResources(),library=new SoundLibrary(store);let installs=0;
 const driver=fakeDriver();driver.installed=()=>false;driver.prepare=async()=>{installs++;};const effects=new SoundEffects(store,resources,library,driver);
 try{resources.pause();assert.equal(effects.prepare().preparation.state,'queued');await effects.cancelPreparation();assert.equal(effects.status().preparation.state,'cancelled');assert.equal(installs,0);assert.throws(()=>effects.start({requestId:'missing',title:'雨',prompt:'rain',seconds:3}),/准备/);}
 finally{await effects.close();await resources.close();await library.close();await store.close();await rm(dir,{recursive:true,force:true});}
});
test('cancelling a running model waits for it to stop and does not create a recording',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sfx-stop-')),store=await ProjectStore.open(dir),resources=testResources(),library=new SoundLibrary(store);let entered=false,stopped=false;
 const driver=fakeDriver();driver.generate=async(_req,execution)=>new Promise((_resolve,reject)=>{entered=true;execution.signal.addEventListener('abort',()=>{stopped=true;reject(execution.signal.reason);},{once:true});});const effects=new SoundEffects(store,resources,library,driver);
 try{const job=effects.start({requestId:'cancel-running',title:'雨',prompt:'rain',seconds:3});await wait(()=>entered);const result=await effects.cancel(job.id);assert.equal(stopped,true);assert.equal(result.state,'cancelled');assert.equal(library.list().length,0);}
 finally{await effects.close();await resources.close();await library.close();await store.close();await rm(dir,{recursive:true,force:true});}
});
test('restart reports changed audio as failed instead of returning an invalid result',async()=>{
 const {writeFile}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'sfx-tamper-'));let store=await ProjectStore.open(dir),resources=testResources(),library=new SoundLibrary(store),effects=new SoundEffects(store,resources,library,fakeDriver());
 try{const job=effects.start({requestId:'tamper',title:'雨',prompt:'rain',seconds:3,seed:42});await wait(()=>effects.get(job.id).state==='succeeded');const item=effects.get(job.id).item!;await effects.close();await resources.close();await library.close();await store.close();await writeFile(join(dir,'sound-library',item.id+'.wav'),Buffer.from('bad'));
  store=await ProjectStore.open(dir);resources=testResources();library=new SoundLibrary(store);effects=new SoundEffects(store,resources,library,fakeDriver());assert.equal(effects.get(job.id).state,'failed');assert.match(effects.get(job.id).message,/缺失|变化/);
 }finally{await effects.close();await resources.close();await library.close();await store.close();await rm(dir,{recursive:true,force:true});}
});

test('sound effect recordings are searchable independently of external imports',async()=>{
 const {SoundCatalog}=await import('./sound-catalog.ts');const dir=await mkdtemp(join(tmpdir(),'sfx-filter-')),store=await ProjectStore.open(dir),resources=testResources(),library=new SoundLibrary(store),effects=new SoundEffects(store,resources,library,fakeDriver()),catalog=new SoundCatalog(store,async()=>library.list());
 try{await library.import({name:'external.wav',title:'外部录音',requestId:'external',bytes:audio(3)});const job=effects.start({requestId:'filter',title:'碎纸机',prompt:'paper shredder',seconds:3,seed:4});await wait(()=>effects.get(job.id).state==='succeeded');
  const generated=await catalog.page({filter:'effects'}),external=await catalog.page({filter:'imported'});assert.equal(generated.items.length,1);assert.equal(generated.items[0].item?.origin,'sound-effect');assert.equal(external.items.length,1);assert.equal(external.items[0].item?.origin,'imported');
 }finally{await effects.close();await resources.close();await catalog.close();await library.close();await store.close();await rm(dir,{recursive:true,force:true});}
});

test('a process peak above 5 GB fails without publishing an audio file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sfx-peak-')),store=await ProjectStore.open(dir),resources=testResources(),library=new SoundLibrary(store),driver=fakeDriver();
 driver.generate=async(req,_execution,reportPeak)=>{reportPeak(5_000_000_001);return audio(req.seconds);};const effects=new SoundEffects(store,resources,library,driver);
 try{const job=effects.start({requestId:'peak',title:'雨',prompt:'rain',seconds:3,seed:42});await wait(()=>effects.get(job.id).state==='failed');assert.match(effects.get(job.id).message,/5 GB/);assert.equal(library.list().length,0);}
 finally{await effects.close();await resources.close();await library.close();await store.close();await rm(dir,{recursive:true,force:true});}
});
