import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout} from 'node:timers/promises';
import {LivePlay} from './live-play.ts';
import {ProjectStore} from '../projects/store.ts';
import {testResources} from '../resources/testing.ts';
import {ResourceLease} from '../resources/lease.ts';
import {SoundLibrary} from './sound-library.ts';
import {liveFramesPerSecond as rate} from './live-ring.ts';
import {audioShape} from './audio-budget.ts';

test('live playback gates lookahead, captures exactly 15 seconds, survives restart, and holds the shared queue until release',async()=>{
 const root=await mkdtemp(join(tmpdir(),'live-play-')),store=await ProjectStore.open(root),resources=testResources(),library=new SoundLibrary(store);
 const mixtures:number[]=[];let released=false,following=false;
 const live=new LivePlay(resources,library,{
  installed:()=>true,prepare:async()=>{},open:async execution=>({
   next:async style=>{mixtures.push(style.mix);return new Uint8Array(new Int16Array(rate*2).fill(mixtures.length).buffer);},
   done:new Promise<void>(resolve=>execution.signal.addEventListener('abort',()=>{released=true;resolve();},{once:true})),
  }),
 },root);
 resources.register('following',{resident:()=>undefined,unload:async()=>{}});
 try{
  live.start('live-test');
  assert.throws(()=>live.start('live-conflict'),/已有一个/);
  for(let i=0;i<100&&live.status().session?.phase!=='running';i++)await setTimeout(5);
  assert.equal(live.status().session?.phase,'running');
  const future=resources.run({id:'following',engine:'following',demand:{verified:true,peak:{memory:1}},execute:async()=>{assert.equal(released,true);following=true;}});
  const req={sessionId:'live-test',offset:0,heardFrame:0,startFrame:rate/2,style:{left:'Jazz',right:'Disco',mix:0}};
  const duplicate=await Promise.all([live.next(req),live.next(req)]);
  assert.equal(duplicate[0].block?.pcm,duplicate[1].block?.pcm);
  assert.equal(mixtures.length,1);
  for(let i=1;i<3;i++)assert.ok((await live.next({...req,offset:i*rate})).block);
  assert.equal((await live.next({...req,offset:3*rate})).block,undefined);
  for(let i=3;i<18;i++){
   const {block}=await live.next({...req,offset:i*rate,heardFrame:(i-2)*rate,style:{...req.style,mix:1}});
   assert.equal(block?.toMix,1);if(i===3)assert.equal(block?.fromMix,0);
  }
  const preview=live.preview({sessionId:'live-test',startFrame:rate,heardFrame:16*rate});
  assert.deepEqual(audioShape(Buffer.from(preview.wav,'base64')),{frames:15*rate,channels:2,rate});
  assert.equal(library.list().length,0,'preview must not publish recordings');
  assert.equal(following,false);
  const capture={title:'演奏片段',requestId:'capture-test',sessionId:'live-test',heardFrame:rate*16+rate/2};
  const item=await live.save(capture);
  assert.equal(item.origin,'live-capture');
  assert.deepEqual(audioShape(library.audioSync(item.id)),{frames:rate*15,channels:2,rate});
  assert.equal((await live.save(capture)).id,item.id);
  await assert.rejects(()=>live.save({...capture,heardFrame:16*rate}),/不同/);
  for(let i=18;i<42;i++)await live.next({...req,offset:i*rate,heardFrame:(i-2)*rate,startFrame:rate/2});
  const longPreview=live.preview({sessionId:'live-test',startFrame:rate/2,heardFrame:40*rate+rate/2});
  assert.deepEqual(audioShape(Buffer.from(longPreview.wav,'base64')),{frames:40*rate,channels:2,rate});
  const longItem=await live.save({sessionId:'live-test',requestId:'long-recording',title:'长录音',startFrame:rate/2,heardFrame:40*rate+rate/2});
  assert.equal(longItem.duration,40);
  const stopped=await live.stop('live-test');assert.equal(stopped.phase,'stopped');assert.equal(stopped.released,true);await future;
  assert.equal((await live.stop('live-test')).released,true);
  await assert.rejects(live.stop('live-missing'),{code:'NOT_FOUND'});
  assert.equal(following,true);
  const reopened=new SoundLibrary(store);
  assert.equal(reopened.get(item.id).origin,'live-capture');
 }finally{await live.close();await resources.close();await store.close();await rm(root,{recursive:true,force:true});}
});

test('a streaming failure reaps the worker and leaves the resource queue reusable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'live-failure-')),store=await ProjectStore.open(root),resources=testResources();
 let reaped=false;
 const live=new LivePlay(resources,new SoundLibrary(store),{
  installed:()=>true,prepare:async()=>{},open:async execution=>({
   next:async()=>{throw Error('输出损坏');},
   done:new Promise<void>(resolve=>execution.signal.addEventListener('abort',()=>{reaped=true;resolve();},{once:true})),
  }),
 },root);
 try{
  live.start('live-failure');
  for(let i=0;i<100&&live.status().session?.phase!=='running';i++)await setTimeout(5);
  await assert.rejects(live.next({sessionId:'live-failure',offset:0,heardFrame:0,style:{left:'A',right:'B',mix:0}}),/输出损坏/);
  const stopped=await live.stop('live-failure');
  assert.equal(stopped.phase,'failed');
  assert.equal(stopped.released,true);
  assert.equal(stopped.message,'输出损坏');assert.equal(reaped,true);
  assert.equal(resources.snapshot().active,undefined);
  assert.equal(resources.snapshot().history.find(task=>task.id==='live-failure')?.stage,'failed');
  live.start('live-next');assert.equal((await live.stop('live-next')).phase,'stopped');
 }finally{await live.close();await resources.close();await store.close();await rm(root,{recursive:true,force:true});}
});

test('stop during warm-up waits for the driver to finish even if it reports readiness at cancellation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'live-warmup-')),store=await ProjectStore.open(root),resources=testResources();
 let entered=false,exited=false;
 const live=new LivePlay(resources,new SoundLibrary(store),{
  installed:()=>true,prepare:async()=>{},open:async execution=>{
   entered=true;
   await new Promise<void>(resolve=>execution.signal.addEventListener('abort',()=>resolve(),{once:true}));
   return {next:async()=>new Uint8Array(),done:setTimeout(25).then(()=>{exited=true;})};
  },
 },root);
 try{
  live.start('live-warmup');
  for(let i=0;i<100&&!entered;i++)await setTimeout(5);
  assert.equal(entered,true);
  const result=await live.stop('live-warmup');
  assert.equal(exited,true);
  assert.equal(result.phase,'stopped');
  assert.equal(resources.snapshot().active,undefined);
 }finally{await live.close();await resources.close();await store.close();await rm(root,{recursive:true,force:true});}
});

test('failed lease release keeps the stop unconfirmed and reports a failure',async()=>{
 const root=await mkdtemp(join(tmpdir(),'live-stop-fault-')),store=await ProjectStore.open(root);
 const lease=new ResourceLease(join(root,'lease')),release=lease.release.bind(lease),resources=testResources({lease});
 let canRelease=false;
 lease.release=()=>{if(!canRelease)throw Error('模拟无法确认释放');release();};
 const live=new LivePlay(resources,new SoundLibrary(store),{
  installed:()=>true,prepare:async()=>{},open:async execution=>({
   next:async()=>new Uint8Array(),done:new Promise<void>(resolve=>execution.signal.addEventListener('abort',()=>resolve(),{once:true})),
  }),
 },root);
 try{
  live.start('live-release-fault');
  for(let i=0;i<100&&live.status().session?.phase!=='running';i++)await setTimeout(5);
  assert.equal(live.status().session?.phase,'running');
  const stopped=await live.stop('live-release-fault');
  assert.equal(stopped.released,false);
  assert.equal(stopped.phase,'failed');
  assert.equal(stopped.resource?.reason,'UNLOAD_FAILED');
  assert.match(stopped.message,/无法确认释放/);
  assert.equal((await live.stop('live-release-fault')).released,false);
  assert.equal(resources.snapshot().fault?.code,'UNLOAD_FAILED');
  canRelease=true;
  assert.equal(resources.retryLeaseRelease('unrelated-task'),false);
  assert.equal((await live.stop('live-release-fault')).released,true);
  assert.equal(resources.snapshot().fault,undefined);
  live.start('live-after-recovery');
  assert.equal((await live.stop('live-after-recovery')).phase,'stopped');
 }finally{await live.close();await resources.close();release();await store.close();await rm(root,{recursive:true,force:true});}
});
