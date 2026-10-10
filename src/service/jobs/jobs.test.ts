import {ResourceCoordinator} from '../resources/coordinator.ts';
import {ResourceLease} from '../resources/lease.ts';
import {testResources} from '../resources/testing.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../projects/store.ts';
import {JobManager} from './jobs.ts';
import {processRenderer} from '../render/process.ts';
const example = JSON.parse(await readFile(new URL('../../music/authoring/example.json',import.meta.url),'utf8'));
const request = {projectId:'window-study',revisionId:'window-study-v1',idempotencyKey:'first',kind:'render-score' as const};
async function fixture(t:any,renderer=processRenderer()) {
  const root=await mkdtemp(join(tmpdir(),'music-jobs-')); const store=await ProjectStore.open(root);
  await store.importRevision(example); const jobs=await JobManager.open(store,renderer);
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
  const restarted=await JobManager.open(store,processRenderer()); assert.equal(restarted.get(c.id).state,'interrupted'); await restarted.close();
  assert.ok((await readFile(join(root,'jobs',`${c.id}.json`),'utf8')).includes('interrupted'));
});

test('worker failure leaves the published revision and its original file intact',async t=>{
  const {store,jobs}=await fixture(t); await jobs.close();
  const broken=await JobManager.open(store,()=>({result:Promise.reject(new Error('worker crashed')),cancel:()=>{}}));
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

test('a committed WAV survives terminal status write failure and restart',async t=>{
  const {store,jobs,root}=await fixture(t);
  t.mock.method(console,'error',()=>{});
  const first=await jobs.submit(request),save=store.atomicJSON.bind(store);
  store.atomicJSON=(path,value)=>{
    if((value as {id?:string;state?:string}).id===first.id && (value as {state?:string}).state==='succeeded')throw new Error('success status disk failure');
    save(path,value);
  };
  const failed=await jobs.wait(first.id);
  assert.equal(failed.state,'failed','the caller must see the persistence failure');
  assert.match(failed.error??'',/success status disk failure/);
  assert.ok(failed.artifact,'the committed artifact must stay associated in memory');
  assert.equal(JSON.parse(await readFile(join(root,'jobs',`${first.id}.json`),'utf8')).state,'running');
  await jobs.close();store.atomicJSON=save;
  const recovered=await JobManager.open(store,processRenderer());t.after(()=>recovered.close());
  assert.equal(recovered.get(first.id).state,'succeeded');
  assert.equal(recovered.get(first.id).artifact?.sha256,failed.artifact.sha256);
  assert.equal(recovered.get(first.id).error,undefined);
  assert.equal((await recovered.submit(request)).id,first.id,'recovery preserves idempotency');
  assert.equal(JSON.parse(await readFile(join(root,'jobs',`${first.id}.json`),'utf8')).state,'succeeded');
});

for(const damage of ['missing','tampered'] as const)test(`restart rejects ${damage} committed WAV instead of reporting success`,async t=>{
  const {store,jobs}=await fixture(t);
  const first=await jobs.submit(request),done=await jobs.wait(first.id);assert.equal(done.state,'succeeded');
  await jobs.close();
  const path=store.path('projects',request.projectId,done.artifact!.path);
  if(damage==='missing')await unlink(path);else await writeFile(path,'tampered WAV');
  const recovered=await JobManager.open(store,processRenderer());t.after(()=>recovered.close());
  assert.equal(recovered.get(first.id).state,'failed');assert.ok(recovered.get(first.id).error);
  assert.equal(recovered.get(first.id).artifact,undefined);
});

for(const damage of ['uncommitted','wrong-input'] as const)test(`restart cannot recover an ${damage} output as successful`,async t=>{
  const {store,jobs,root}=await fixture(t);
  const first=await jobs.submit(request),done=await jobs.wait(first.id);assert.equal(done.state,'succeeded');await jobs.close();
  const path=store.path('jobs',`${first.id}.json`),stored=JSON.parse(await readFile(path,'utf8'));
  stored.state='running';delete stored.artifact;delete stored.result;
  if(damage==='wrong-input')stored.inputHash='0'.repeat(64);
  else {
    const project=await store.project(request.projectId);project.revisions[0].artifacts=[];
    store.atomicJSON(store.path('projects',request.projectId,'project.json'),project);
  }
  store.atomicJSON(path,stored);
  const recovered=await JobManager.open(store,processRenderer());t.after(()=>recovered.close());
  assert.equal(recovered.get(first.id).state,damage==='uncommitted'?'interrupted':'failed');
  assert.equal(recovered.get(first.id).artifact,undefined);
  assert.ok(await readFile(join(root,'projects',request.projectId,done.artifact!.path)),'unclaimed file is preserved, not blindly deleted');
});

test('render completion is published only after the user execution lease releases',async t=>{
 const root=await mkdtemp(join(tmpdir(),'render-release-')),store=await ProjectStore.open(root),lease=new ResourceLease(join(root,'lease'));let observed:string|undefined,id:string|undefined;const release=lease.release.bind(lease);
 const resources=new ResourceCoordinator({policy:testResources().snapshot().policy,lease,estimate:()=>({verified:true,peak:{memory:256*2**20}}),probe:async()=>({supported:true,topology:'cpu',sampledAt:Date.now(),pressure:'normal',pools:[{id:'memory',capacity:16*2**30,available:12*2**30,owned:2**30}]})});await store.importRevision(example);const jobs=await JobManager.open(store,processRenderer(),resources);lease.release=()=>{if(id)observed=jobs.get(id).state;release();};
 t.after(async()=>{await jobs.close();await resources.close();await store.close();await rm(root,{recursive:true,force:true});});const job=await jobs.submit(request);id=job.id;assert.equal((await jobs.wait(id)).state,'succeeded');assert.equal(observed,'running','completed audio must stay running until release is confirmed');
});

test('restart validates committed render files without loading complete audio buffers',async t=>{
 const {store,jobs}=await fixture(t),job=await jobs.submit(request);assert.equal((await jobs.wait(job.id)).state,'succeeded');await jobs.close();t.mock.method(store,'artifact',async()=>{throw Error('完整音频读取不能用于恢复校验');});const restarted=await JobManager.open(store,processRenderer());try{assert.equal(restarted.get(job.id).state,'succeeded');}finally{await restarted.close();}
});
