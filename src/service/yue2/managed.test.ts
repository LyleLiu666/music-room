import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {ProjectStore} from '../projects/store.ts';
import {YuE2Engine} from './engine.ts';
import {YuE2Client} from './client.ts';
import {testResources} from '../resources/testing.ts';
const delay=()=>new Promise(r=>setTimeout(r,5));
async function fixture(t:any){
 const root=await mkdtemp(join(tmpdir(),'managed-yue-')),directory=join(root,'engine');
 let launches=0,stops=0,submits=0,done=false,progress:Record<string,unknown>|undefined;const bodies:any[]=[];
 const upstream='a'.repeat(32),resources=testResources(),store=await ProjectStore.open(join(root,'workspace'));
 const server=createServer(async(req,res)=>{let body='';for await(const p of req)body+=p;res.setHeader('content-type','application/json');if(req.url==='/api/jobs'&&req.method==='POST'){submits++;bodies.push(JSON.parse(body));}res.end(JSON.stringify({job:{id:upstream,kind:'create',status:done?'done':'running',progress}}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const driver={unsupported:()=>undefined,installed:()=>true,modelsReady:()=>true,chooseDirectory:async()=>directory,prepare:async()=>{},launch:async()=>{launches++;let end!:(n:number)=>void;return {url:`http://127.0.0.1:${(server.address() as any).port}`,exited:new Promise<number>(r=>end=r),status:async()=>({modelsPresent:true,fake:false}),stop:async()=>{stops++;end(0);}};}};
 const engine=await YuE2Engine.open(store,driver,resources);await engine.prepare(directory,true);for(let i=0;i<100&&(await engine.status()).phase==='preparing';i++)await delay();
 const client=new YuE2Client(engine,store,resources);
 t.after(async()=>{await client.close();await resources.close();await engine.close();await store.close();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});});
 return {root,directory,engine,client,resources,store,bodies,setProgress:(value:Record<string,unknown>)=>{progress=value;},counts:()=>({launches,stops,submits}),complete:async(truncated?:{abc:boolean;semantic:boolean})=>{await mkdir(join(directory,'data/songs',upstream,'song'),{recursive:true});await writeFile(join(directory,'data/songs',upstream,'song/audio.flac'),'fLaC test');if(truncated)await writeFile(join(directory,'data/songs',upstream,'summary.json'),JSON.stringify({truncated}));done=true;}};
}
test('managed music is lazy, serialized, and reads completed audio after unloading',async t=>{
 const f=await fixture(t);assert.equal((await f.engine.status()).canGenerate,true);await f.engine.start();assert.equal(f.counts().launches,0);
 const args={style:'piano',lyrics:'[instrumental]',preset:'fast' as const,instrumental:true};const a=await f.client.generate(args),b=await f.client.generate(args);
 for(let i=0;i<100&&f.counts().submits<1;i++)await delay();assert.equal(f.counts().submits,1);assert.equal((await f.client.job(b.job.id)).job.status,'queued');
 await f.client.cancel(b.job.id);await f.complete();for(let i=0;i<200&&(await f.client.job(a.job.id)).job.status!=='done';i++)await delay();
 assert.equal((await f.client.job(a.job.id)).job.status,'done');assert.equal(f.counts().submits,1);await f.engine.stop();assert.equal((await f.client.audio(a.job.id)).length,9);assert.equal(f.counts().launches,1);
});
test('queued music cancellation never launches a model',async t=>{
 const f=await fixture(t);const block=new AbortController();f.resources.register('block',{resident:()=>undefined,unload:async()=>{}});const held=f.resources.run({id:'block',engine:'block',demand:{verified:true,peak:{memory:1}},signal:block.signal,execute:async ctx=>new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}))}).catch(()=>{});
 const a=await f.client.generate({style:'piano',lyrics:'[instrumental]',preset:'fast',instrumental:true});await assert.rejects(f.engine.prepare(f.directory,false),/请先完成或取消/);assert.equal((await f.engine.status()).canGenerate,true);await f.client.cancel(a.job.id);assert.equal((await f.client.job(a.job.id)).job.status,'cancelled');assert.equal(f.counts().launches,0);block.abort();await held;
});
test('resume carries only verified matching artifacts through the normal queue and protects its source',async t=>{
 const f=await fixture(t),input={style:'piano',lyrics:'[instrumental]',preset:'fast' as const,instrumental:true,seed:42};
 const first=await f.client.generate(input);for(let i=0;i<100&&f.counts().submits<1;i++)await delay();await f.client.cancel(first.job.id);
 const plan=join(f.directory,'data/songs','a'.repeat(32),'plan');await mkdir(plan,{recursive:true});const manifest:Record<string,string>={};
 for(const name of ['plan.json','abc_tokens.npy','prefix.npy','score.abc']){await writeFile(join(plan,name),'fixture');manifest[name]=createHash('sha256').update('fixture').digest('hex');}await writeFile(join(plan,'plan_manifest.json'),JSON.stringify(manifest));
 assert.equal((await f.client.job(first.job.id)).job.recovery?.stage,'plan');
 await assert.rejects(f.client.generate({...input,seed:43},first.job.id),/恢复点不可用/);assert.equal(f.counts().submits,1);
 const block=new AbortController();f.resources.register('block',{resident:()=>undefined,unload:async()=>{}});const held=f.resources.run({id:'hold-recovery',engine:'block',demand:{verified:true,peak:{memory:1}},signal:block.signal,execute:async ctx=>new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}))}).catch(()=>{});
 const resumed=await f.client.generate(input,first.job.id);assert.equal(resumed.job.status,'queued');await assert.rejects(f.client.purgeAudio(first.job.id),/恢复生成仍在使用/);
 block.abort();await held;for(let i=0;i<100&&f.counts().submits<2;i++)await delay();
 assert.equal(f.bodies[1].params.resume_from,'a'.repeat(32));assert.equal(f.bodies[1].params.seed,42);assert.equal(f.bodies[1].loras.length,2);await f.client.cancel(resumed.job.id);
});

test('reopening marks unfinished local and old upstream tasks interrupted without execution',async t=>{
 const f=await fixture(t);await f.client.close();
 const old='c'.repeat(32),pending='d'.repeat(32);
 await writeFile(f.store.path('engines','yue2-jobs.json'),JSON.stringify({version:1,jobs:[{directory:f.directory,job:{id:pending,kind:'create',status:'running'}}]}));
 f.engine.history=async()=>[{id:old,kind:'create',status:'queued'}];
 const client=new YuE2Client(f.engine,f.store,f.resources);t.after(()=>client.close());
 assert.equal((await client.job(pending)).job.stage,'interrupted');assert.equal((await client.job(old)).job.stage,'interrupted');assert.equal(f.counts().launches,0);
});
test('managed enable and disable are meaningful without loading a model',async t=>{
 const f=await fixture(t);await f.engine.stop();assert.equal((await f.engine.status()).canGenerate,false);await assert.rejects(f.client.generate({style:'piano',lyrics:'[instrumental]',preset:'fast',instrumental:true}));await f.engine.start();assert.equal((await f.engine.status()).canGenerate,true);assert.equal(f.counts().launches,0);
});

for(const truncated of [{abc:false,semantic:true},{abc:true,semantic:false},{abc:false,semantic:false}])test(`saved truncation evidence survives completion and restart: ${JSON.stringify(truncated)}`,async t=>{
 const f=await fixture(t),result=await f.client.generate({style:'piano',lyrics:'[instrumental]',preset:'fast',instrumental:true});
 await f.complete(truncated);for(let i=0;i<200&&(await f.client.job(result.job.id)).job.status!=='done';i++)await delay();
 assert.equal((await f.client.job(result.job.id)).job.status,'done');assert.deepEqual((await f.client.job(result.job.id)).job.truncated,truncated);
 await f.client.close();const restored=new YuE2Client(f.engine,f.store,f.resources);t.after(()=>restored.close());
 assert.deepEqual((await restored.job(result.job.id)).job.truncated,truncated);
 assert.equal((await restored.audio(result.job.id)).length,9);
});

test('resource admission counts the full ending guidance rather than only the original description',async t=>{
 const f=await fixture(t);let measured:any;
 f.resources.estimate=(_engine,input)=>{measured=input;return {verified:false,peak:{memory:0}};};
 const result=await f.client.generate({style:'琴'.repeat(1000),lyrics:'[instrumental]',preset:'fast',instrumental:true});
 assert.ok(measured.style.length>1000);assert.match(measured.style,/Ending arrangement/);assert.match(measured.style,/No vocals/);assert.equal(measured.lyrics,'[instrumental]');
 for(let i=0;i<100&&(await f.client.job(result.job.id)).job.status==='queued';i++)await delay();
 assert.equal(f.counts().submits,0);
});

test('model context overflow is rejected before loading or creating an upstream job',async t=>{
 const f=await fixture(t);
 f.engine.inspectInput=async()=>({prefixTokens:12000,planningTokens:4098,semanticTokens:9000,contextTokens:24576,requiredTokens:25098,remainingTokens:-522,issue:'创作内容超过模型上下文容量'});
 await assert.rejects(f.client.generate({style:'piano',lyrics:'[instrumental]',preset:'fast',instrumental:true}),/上下文/);
 assert.equal(f.counts().launches,0);assert.equal(f.counts().submits,0);
});

test('saved ABC is read as a copy and rejects symbolic-link artifacts',async t=>{
 const f=await fixture(t);const result=await f.client.generate({style:'piano',lyrics:'[instrumental]',preset:'fast',instrumental:true});
 await f.complete();for(let i=0;i<200&&(await f.client.job(result.job.id)).job.status!=='done';i++)await delay();
 const path=join(f.directory,'data/songs','a'.repeat(32),'song/score.abc'),abc='X:1\nM:4/4\nK:C\nC D E F|';await writeFile(path,abc);
 assert.equal(await f.client.score(result.job.id),abc);
 const {symlink}=await import('node:fs/promises');await rm(path);await symlink(join(f.directory,'installed.json'),path);
 await assert.rejects(f.client.score(result.job.id));assert.equal(f.counts().submits,1);
});

test('engine responses refresh independently of actual model progress',async t=>{
 const f=await fixture(t);const progress={type:'stage',stage:'synthesize',completed:12,total:32,unit:'steps',seconds:333.312,ts:'2026-10-11T14:52:28Z'};f.setProgress(progress);
 const result=await f.client.generate({style:'piano',lyrics:'[instrumental]',preset:'fast',instrumental:true});
 let first=await f.client.job(result.job.id);for(let i=0;i<100&&!first.job.checkedAt;i++){await delay();first=await f.client.job(result.job.id);}
 assert.ok(first.job.checkedAt);assert.equal(first.job.progress?.ts,progress.ts);
 await new Promise(r=>setTimeout(r,350));const next=await f.client.job(result.job.id);assert.ok(next.job.checkedAt!>first.job.checkedAt!);assert.deepEqual(next.job.progress,first.job.progress);
 assert.equal((await f.client.list()).jobs.find(j=>j.id===result.job.id)?.checkedAt,next.job.checkedAt);
});
