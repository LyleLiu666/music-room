import test from 'node:test';
import assert from 'node:assert/strict';
import {changeAudioSpeed} from '../studio/speed.ts';
import {encodeWav} from '../../wav.ts';
import {testResources} from './testing.ts';
import {JobManager} from '../jobs/jobs.ts';
import {ProjectStore} from '../projects/store.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SONGS} from '../../catalog.ts';
test('speed decoding checks allocation bounds and responds to cancellation',async()=>{
 const bytes=new Uint8Array(encodeWav([new Float32Array(44100*4)],44100));const signal=AbortSignal.abort();
 await assert.rejects(changeAudioSpeed(bytes,.5,signal),/abort/i);
 await assert.rejects(changeAudioSpeed(bytes,.5,undefined,1024),/预算/);
});
test('rendering waits behind music rights and queued cancellation never starts renderer',async t=>{
 const root=await mkdtemp(join(tmpdir(),'render-budget-')),store=await ProjectStore.open(root),resources=testResources();let starts=0;
 const jobs=await JobManager.open(store,()=>{starts++;throw Error('unexpected');},resources);
 t.after(async()=>{await jobs.close();await resources.close();await store.close();await rm(root,{recursive:true,force:true});});
 const song=SONGS[0];await store.importRevision({format:'music-room-score',version:1,work:{id:song.workId,title:song.title},revision:{id:song.id,label:song.edition},score:song.compose()});
 resources.register('held',{resident:()=>undefined,unload:async()=>{}});const controller=new AbortController();
 const held=resources.run({id:'held',engine:'held',signal:controller.signal,demand:{verified:true,peak:{memory:1}},execute:async ctx=>new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}))}).catch(()=>{});
 const job=await jobs.submit({kind:'render-score',projectId:song.workId,revisionId:song.id,idempotencyKey:'test'});await jobs.cancel(job.id);assert.equal(starts,0);assert.equal(jobs.get(job.id).state,'cancelled');controller.abort();await held;
});
