// Deterministic lifecycle/scale soak with isolated service/client memory.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {statfsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {fork} from 'node:child_process';
import {encodeWav} from '../src/wav.ts';
const cycles=Number(process.env.MUSIC_ROOM_SOAK_CYCLES??40),scale=Number(process.env.MUSIC_ROOM_SCALE_VERSIONS??2000),minutes=Number(process.env.MUSIC_ROOM_SOAK_MINUTES??0);
assert.ok(Number.isSafeInteger(cycles)&&cycles>=10&&cycles<=10000);
assert.ok(Number.isSafeInteger(scale)&&scale>=100&&scale<=20000);
assert.ok(Number.isFinite(minutes)&&minutes>=0&&minutes<=120);
const root=await mkdtemp(join(tmpdir(),'studio-soak-')),out=resolve(process.env.MUSIC_ROOM_SOAK_OUTPUT??'test-results/soak');await mkdir(out,{recursive:true});
const wav=new Uint8Array(encodeWav([Float32Array.from({length:22050},(_,i)=>Math.sin(i*.1)*.1)],22050));
const sources={};for(const path of ['scripts/verify-soak.mjs','src/server/fixtures/soak-server.mjs','src/service/tts/speech.ts','src/service/studio/studio.ts','src/service/projects/copy-data.ts'])sources[path]=createHash('sha256').update(await readFile(resolve(path))).digest('hex');
const report={mode:'deterministic drivers; real HTTP and persistence; service and client are separate processes',pid:process.pid,startedAt:new Date().toISOString(),sources,requested:{cycles,scale,minutes},completed:0,restarts:0,samples:[],status:'running'};
const latencies=[];let deadline;
const child=fork(resolve('src/server/fixtures/soak-server.mjs'),[root,String(scale)],{execArgv:['--expose-gc'],silent:true});child.stdout.resume();
let stderr='',endpoint,sequence=0;const pending=new Map();
child.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-8000);});
let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{const error=Error(`isolated service exited ${code??signal}: ${stderr}`);readyReject(error);for(const request of pending.values())request.reject(error);pending.clear();resolve({code,signal});}));
child.on('message',message=>{if(message.type==='ready'){endpoint=message.result;report.servicePid=endpoint.pid;readyResolve();return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(message.error)):request.resolve(message.result);});
const rpc=(type,args={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error(`soak ${type} protocol timed out`));},30000);pending.set(id,{resolve,reject,timer});child.send({id,type,...args},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});});
const call=async(name,args={})=>{const start=performance.now(),response=await fetch(endpoint.url+'/api/'+name,{method:'POST',headers:{authorization:`Bearer ${endpoint.token}`,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});assert.equal(response.status,200,await response.clone().text());const result=await response.json();if(name==='studio_library')latencies.push(performance.now()-start);return result;};
const save=()=>writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));
let startupTimer;
try{
 await Promise.race([ready,new Promise((_,reject)=>{startupTimer=setTimeout(()=>reject(Error('soak service startup timed out')),30000);})]);clearTimeout(startupTimer);
 await call('create_project',{projectId:'soak',title:'生命周期循环'});const sound=await call('studio_create_sound',{projectId:'soak',title:'短旁白',kind:'speech'});
 const voice=await call('tts_add_voice',{name:'测试参考',audioBase64:Buffer.from(wav).toString('base64'),cleanup:false}),reference=await readFile(join(root,'speech/voices',voice.id+'.wav'));
 report.loopStartedAt=new Date().toISOString();deadline=Date.now()+minutes*60000;
 let baseline;
 for(let i=0;i<cycles||Date.now()<deadline;i++){
  await call('resource_pause');const v=await call('studio_generate',{soundId:sound.id,text:`第 ${i+1} 次生命周期检查`,voiceId:voice.id});
  if(i%3===0)await call('studio_cancel',{versionId:v.id});await call('resource_resume');
  let current;for(let n=0;n<200;n++){current=await call('tts_get_version',{versionId:v.id});if(['succeeded','cancelled'].includes(current.state))break;assert.ok(!['failed','interrupted'].includes(current.state),JSON.stringify(current));await new Promise(r=>setTimeout(r,10));}
  assert.equal(current.state,i%3===0?'cancelled':'succeeded');
  if(current.state==='succeeded'){await call('studio_update_version',{versionId:v.id,kept:true,final:true});assert.deepEqual(await readFile(join(root,'speech/audio',v.id+'.wav')),Buffer.from(wav));await call('studio_update_version',{versionId:v.id,deleted:true});await call('studio_update_version',{versionId:v.id,deleted:false});}
  const snapshot=await call('studio_library',{paginateConversions:true,conversionSoundId:`scale-sound-${i%Math.ceil(scale/20)}`,conversionPage:2,conversionPageSize:7});
  assert.ok(snapshot.conversionPagination.versionIds.length<=7);assert.equal(snapshot.taskHistory.length,scale+i+1);assert.equal(new Set(snapshot.taskHistory.map(v=>v.id)).size,snapshot.taskHistory.length);
  const resource=await call('resource_status');assert.equal(resource.queued.length,0);assert.equal(resource.active,undefined);
  if((i+1)%10===0){endpoint=await rpc('restart');assert.equal(endpoint.pid,child.pid,'restart must keep the service process for leak detection');report.restarts++;assert.deepEqual(await readFile(join(root,'speech/voices',voice.id+'.wav')),reference);}
  const stats=await rpc('memory',{hardware:i%60===0}),memory=stats.memory,rss=memory.rss;global.gc?.();const client=process.memoryUsage();
  if(i===9){baseline=rss;report.warmupRSS=rss;report.clientWarmupRSS=client.rss;}report.maxSampledRSS=Math.max(report.maxSampledRSS??0,rss);report.maxClientRSS=Math.max(report.maxClientRSS??0,client.rss);
  report.completed=i+1;if(i%10===0||i===cycles-1){const sample={cycle:i+1,at:new Date().toISOString(),rss,heap:memory.heapUsed,heapTotal:memory.heapTotal,external:memory.external,arrayBuffers:memory.arrayBuffers,clientRSS:client.rss,clientHeap:client.heapUsed,hardware:stats.hardware,hardwareErrors:stats.hardwareErrors};if(i%60===0){const disk=statfsSync(root);sample.diskAvailable=Number(disk.bavail)*Number(disk.bsize);}report.samples.push(sample);await save();}
  if(baseline)assert.ok(rss-baseline<256*2**20,'service RSS grew by more than 256 MiB after warmup');
  if(minutes>0)await new Promise(r=>setTimeout(r,1000));
 }
 latencies.sort((a,b)=>a-b);report.latencyMs={p50:latencies[Math.floor(latencies.length*.5)],p95:latencies[Math.floor(latencies.length*.95)],max:latencies.at(-1)};
 if(minutes>0)assert.ok(Date.now()-Date.parse(report.loopStartedAt)>=minutes*60000);
 assert.ok(report.latencyMs.p95<5000,'local library p95 exceeded the 5s regression guard');report.status='passed';
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{
 clearTimeout(startupTimer);report.finishedAt=new Date().toISOString();report.durationSeconds=(Date.parse(report.finishedAt)-Date.parse(report.startedAt))/1000;report.operationDurationSeconds=report.loopStartedAt?(Date.parse(report.finishedAt)-Date.parse(report.loopStartedAt))/1000:0;await save();
 try{if(child.exitCode===null&&child.signalCode===null)await rpc('close');const exit=await exited;assert.equal(exit.code,0,stderr);}finally{for(const request of pending.values())clearTimeout(request.timer);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
 console.log(JSON.stringify({status:report.status,completed:report.completed,report:join(out,'verification.json')}));
}
