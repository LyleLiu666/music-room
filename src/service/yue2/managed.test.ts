import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
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
 let launches=0,stops=0,submits=0,done=false;
 const upstream='a'.repeat(32),resources=testResources(),store=await ProjectStore.open(join(root,'workspace'));
 const server=createServer(async(req,res)=>{let body='';for await(const p of req)body+=p;res.setHeader('content-type','application/json');if(req.url==='/api/jobs'&&req.method==='POST')submits++;res.end(JSON.stringify({job:{id:upstream,kind:'create',status:done?'done':'running'}}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const driver={unsupported:()=>undefined,installed:()=>true,modelsReady:()=>true,chooseDirectory:async()=>directory,prepare:async()=>{},launch:async()=>{launches++;let end!:(n:number)=>void;return {url:`http://127.0.0.1:${(server.address() as any).port}`,exited:new Promise<number>(r=>end=r),status:async()=>({modelsPresent:true,fake:false}),stop:async()=>{stops++;end(0);}};}};
 const engine=await YuE2Engine.open(store,driver,resources);await engine.prepare(directory,true);for(let i=0;i<100&&(await engine.status()).phase==='preparing';i++)await delay();
 const client=new YuE2Client(engine,store,resources);
 t.after(async()=>{await client.close();await resources.close();await engine.close();await store.close();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});});
 return {root,directory,engine,client,resources,store,counts:()=>({launches,stops,submits}),complete:async()=>{await mkdir(join(directory,'data/songs',upstream,'song'),{recursive:true});await writeFile(join(directory,'data/songs',upstream,'song/audio.flac'),'fLaC test');done=true;}};
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
