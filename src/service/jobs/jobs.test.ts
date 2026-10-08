import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../projects/store.ts';
import {JobManager} from './jobs.ts';
import {processRenderer} from '../render/process.ts';
const example = JSON.parse(await readFile(new URL('../../music/authoring/example.json',import.meta.url),'utf8'));
const request = {projectId:'window-study',revisionId:'window-study-v1',idempotencyKey:'first',kind:'render-score' as const};
async function fixture(t:any,renderer=processRenderer()) {
  const root=await mkdtemp(join(tmpdir(),'music-jobs-')); const store=await ProjectStore.open(root);
  await store.importRevision(example); const jobs=new JobManager(store,renderer);
  t.after(async()=>{await jobs.close();await store.close();await rm(root,{recursive:true,force:true});}); return {store,jobs,root};
}
test('real background render persists output, idempotency and fixed mix; retry is new identity',async t=>{
  const {store,jobs}=await fixture(t);
  const first=await jobs.submit(request); const again=await jobs.submit(request); assert.equal(first.id,again.id);
  await assert.rejects(jobs.submit({...request,mix:{volume:.2}}),/幂等/);
  const job=await jobs.wait(first.id); assert.equal(job.state,'succeeded',job.error??'');
  assert.ok(job.result && job.result.peak>.01); const artifact=await store.artifact(request.projectId,request.revisionId,job.id);
  assert.equal(artifact.bytes.length,44+20*44100*4); assert.equal(artifact.metadata.sha256,job.artifact?.sha256);
  const second=await jobs.submit({...request,idempotencyKey:'retry',mix:{volume:0}}); const silent=await jobs.wait(second.id);
  assert.equal(silent.state,'succeeded'); assert.equal(silent.result?.peak,0);
  assert.equal((await store.project(request.projectId)).revisions[0].artifacts.length,2);
  await assert.rejects(jobs.submit({...request,kind:'arbitrary-shell'} as any),/任务/);
});
test('cancel queued/running computation and restart statuses never produce false success',async t=>{
  const {store,jobs,root}=await fixture(t);
  const a=await jobs.submit(request); const b=await jobs.submit({...request,idempotencyKey:'queued'});
  await jobs.cancel(b.id); assert.equal((await jobs.wait(b.id)).state,'cancelled');
  await jobs.cancel(a.id); assert.equal((await jobs.wait(a.id)).state,'cancelled');
  assert.equal((await store.project(request.projectId)).revisions[0].artifacts.length,0);
  const c=await jobs.submit({...request,idempotencyKey:'shutdown'}); await jobs.close(); assert.equal(jobs.get(c.id).state,'interrupted');
  const restarted=new JobManager(store,processRenderer()); assert.equal(restarted.get(c.id).state,'interrupted'); await restarted.close();
  assert.ok((await readFile(join(root,'jobs',`${c.id}.json`),'utf8')).includes('interrupted'));
});

test('worker failure leaves the published revision and its original file intact',async t=>{
  const {store,jobs}=await fixture(t); await jobs.close();
  const broken=new JobManager(store,()=>({result:Promise.reject(new Error('worker crashed')),cancel:()=>{}}));
  const a=await broken.submit(request); assert.equal((await broken.wait(a.id)).state,'failed');
  assert.equal((await store.project(request.projectId)).revisions[0].artifacts.length,0);
  assert.equal((await store.revision(request.projectId,request.revisionId)).composition.score.notes.length,example.score.notes.length);
  await broken.close();
});

for (const stop of ['cancel','close'] as const) test(`terminal status write failure preserves the next renderer for ${stop}`,async t=>{
  const runs:{reject:(error:Error)=>void;cancel:()=>void;cancelled:boolean}[]=[];
  const {store,jobs:controlled}=await fixture(t,()=>{
    let reject!:(error:Error)=>void;
    const result=new Promise<never>((_,fail)=>{reject=fail;});
    const run={reject,cancelled:false,cancel:()=>{run.cancelled=true;reject(new Error('cancelled'));}};
    runs.push(run);return {result,cancel:run.cancel};
  });
  t.after(()=>{for(const run of runs)run.cancel();});
  t.mock.method(console,'error',()=>{});
  const first=await controlled.submit(request);
  const second=await controlled.submit({...request,idempotencyKey:'second'});
  const save=store.atomicJSON.bind(store);let injected=false;
  store.atomicJSON=(path,value)=>{
    if(!injected && (value as {id?:string;state?:string}).id===first.id && (value as {state?:string}).state==='failed'){
      injected=true;throw new Error('terminal status disk failure');
    }
    save(path,value);
  };
  runs[0].reject(new Error('first worker failed'));await new Promise(r=>setImmediate(r));
  const third=await controlled.submit({...request,idempotencyKey:'third'});
  await new Promise(r=>setImmediate(r));
  assert.ok(injected);assert.equal(controlled.get(second.id).state,'running');
  assert.equal(controlled.get(third.id).state,'queued');assert.equal(runs.length,2);
  if(stop==='cancel') {
    await controlled.cancel(second.id);assert.ok(runs[1].cancelled);
    assert.equal(controlled.get(second.id).state,'cancelled');
  }else {
    await controlled.close();assert.ok(runs[1].cancelled);
    assert.equal(controlled.get(second.id).state,'interrupted');
    assert.equal(controlled.get(third.id).state,'interrupted');
  }
});

test('cancel still stops its renderer when persisting the cancelling stage fails',async t=>{
  let cancelled=false;
  let reject!:(error:Error)=>void;
  const {store,jobs:controlled}=await fixture(t,()=>({result:new Promise<never>((_,fail)=>{reject=fail;}),cancel:()=>{cancelled=true;reject(new Error('cancelled'));}}));
  const job=await controlled.submit(request),save=store.atomicJSON.bind(store);
  store.atomicJSON=(path,value)=>{if((value as {stage?:string}).stage==='正在取消')throw new Error('cancel status disk failure');save(path,value);};
  await assert.rejects(controlled.cancel(job.id),/cancel status disk failure/);
  assert.ok(cancelled);assert.equal(controlled.get(job.id).state,'cancelled');
});
