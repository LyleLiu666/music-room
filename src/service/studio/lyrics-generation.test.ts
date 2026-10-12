import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LyricsGeneration,localLyricsProcessor,type LyricProcessor} from './lyrics-generation.ts';
import {testResources} from '../resources/testing.ts';
const result={duration:10,lines:[{text:'参考句',start:1,end:2},{text:'新增段落',start:3,end:4},{text:'参考句',start:5,end:6}]};
async function wait(manager:LyricsGeneration,id='v8'){for(let n=0;n<200;n++){const job=manager.status(id).job;if(job&&!['queued','running'].includes(job.state))return job;await new Promise(r=>setTimeout(r,5));}throw Error('job did not finish');}
test('background progress retains timestamps and drops finished tasks',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lyrics-progress-')),resources=testResources();resources.pause();let report:(message:string,percent:number)=>void=()=>{},release!:()=>void;
 const gate=new Promise<void>(r=>release=r),jobs=new LyricsGeneration(dir,resources,()=>({id:'v8',audioPath:'/a/8',reference:'x',audio:async()=>new Uint8Array([1])}),{ready:()=>true,run:async(_source,_bytes,_execution,progress)=>{report=progress;report('识别完成 1 / 3 段',22);await gate;return result;}});
 try{
  jobs.start('v8','progress');assert.equal(jobs.activeJobs()[0].startedAt,undefined);resources.resume();
  for(let n=0;n<200&&jobs.status('v8').job?.progress!==22;n++)await new Promise(r=>setTimeout(r,5));
  const job=jobs.activeJobs()[0];assert.equal(job.progress,22);assert.ok(job.startedAt);assert.ok(job.updatedAt!>=job.startedAt!);
  job.progress=0;assert.equal(jobs.activeJobs()[0].progress,22,'snapshot does not mutate job');
  assert.throws(()=>report('bad progress',NaN),/进度无效/);assert.throws(()=>report('bad progress',101),/进度无效/);
  release();assert.equal((await wait(jobs)).progress,100);assert.equal(jobs.activeJobs().length,0);
 }finally{release();await jobs.close();await resources.close();rmSync(dir,{recursive:true,force:true});}
});
test('generation is queued and idempotent, persists repeated/new sections, and survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lyrics-job-')),resources=testResources();resources.pause();let calls=0;
 const processor:LyricProcessor={ready:()=>true,run:async()=>{calls++;return result;}};
 const source=()=>({id:'v8',audioPath:'/a/8',reference:'参考句',audio:async()=>new Uint8Array([1,2])});const jobs=new LyricsGeneration(dir,resources,source,processor);
 try{const a=jobs.start('v8','one'),b=jobs.start('v8','two');assert.equal(a.job!.taskId,b.job!.taskId);assert.equal(calls,0);resources.resume();const completed=await wait(jobs);assert.equal(completed.state,'succeeded',completed.message);assert.equal(calls,1);assert.equal(JSON.parse(readFileSync(join(dir,'v8.json'),'utf8')).lines.length,3);assert.equal(jobs.start('v8','one').job!.state,'succeeded');
 }finally{await jobs.close();await resources.close();rmSync(dir,{recursive:true,force:true});}
});
test('local worker progress failures reject the job and preserve the previous timeline',async()=>{
 const root=mkdtempSync(join(tmpdir(),'lyrics-worker-')),dir=join(root,'lyrics'),engine=join(root,'engine'),resources=testResources();let invalid=false;
 mkdirSync(join(engine,'venv/bin'),{recursive:true});symlinkSync(process.execPath,join(engine,'venv/bin/python'));
 const processor=localLyricsProcessor(engine,async()=>Buffer.from(`
  const fs=require('node:fs');
  require('node:readline').createInterface({input:process.stdin}).once('line',line=>{
   const task=JSON.parse(line);fs.writeFileSync(task.output,JSON.stringify(${JSON.stringify(result)}));
   console.log('Model loading diagnostic');
   console.log(JSON.stringify({message:'识别进度',progress:${invalid?101:22}}));
   process.exit(0);
  });
 `));
 processor.ready=()=>true;
 const jobs=new LyricsGeneration(dir,resources,()=>({id:'v8',audioPath:'/a/8',reference:'参考句',audio:async()=>new Uint8Array([1])}),processor);
 try{
  jobs.start('v8','valid-worker');assert.equal((await wait(jobs)).state,'succeeded');
  const previous=readFileSync(join(dir,'v8.json'),'utf8');invalid=true;jobs.start('v8','invalid-worker');
  const failed=await wait(jobs);assert.equal(failed.state,'failed');assert.match(failed.message,/歌词进度无效/);
  assert.equal(readFileSync(join(dir,'v8.json'),'utf8'),previous);
 }finally{await jobs.close();await resources.close();rmSync(root,{recursive:true,force:true});}
});
test('failed retry retains the last timeline and cancelled jobs publish no result',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lyrics-job-')),resources=testResources();let fail=false;const source=()=>({id:'v8',audioPath:'/a/8',reference:'参考句',audio:async()=>new Uint8Array([1])});const jobs=new LyricsGeneration(dir,resources,source,{ready:()=>true,run:async()=>{if(fail)throw Error('test failure');return result;}});
 try{jobs.start('v8','one');await wait(jobs);const original=readFileSync(join(dir,'v8.json'),'utf8');fail=true;jobs.start('v8','two');assert.equal((await wait(jobs)).state,'failed');assert.equal(readFileSync(join(dir,'v8.json'),'utf8'),original);resources.pause();jobs.start('v8','three');await jobs.cancel('v8');assert.equal(jobs.status('v8').job!.state,'cancelled');assert.equal(readFileSync(join(dir,'v8.json'),'utf8'),original);
 }finally{await jobs.close();await resources.close();rmSync(dir,{recursive:true,force:true});}
});
test('restarting marks pending jobs interrupted; deleted sources cannot publish',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'lyrics-job-')),resources=testResources();writeFileSync(join(dir,'jobs.json'),JSON.stringify({v8:{versionId:'v8',state:'running'}}));let deleted=false;
 const jobs=new LyricsGeneration(dir,resources,()=>{if(deleted)throw Error('deleted');return {id:'v8',audioPath:'/a/8',reference:'x',audio:async()=>new Uint8Array([1])};},{ready:()=>true,run:async()=>{deleted=true;return result;}});
 try{assert.equal(jobs.status('v8').job!.state,'interrupted');jobs.start('v8','one');assert.equal((await wait(jobs)).state,'failed');assert.equal(existsSync(join(dir,'v8.json')),false);}finally{await jobs.close();await resources.close();rmSync(dir,{recursive:true,force:true});}
});
