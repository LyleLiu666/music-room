// Original three-attempt planning failure: keep the prompt, seed, adapters and automatic duration.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,cp,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {MusicService} from '../src/service/service.ts';
import {createResources} from '../src/service/resources/runtime.ts';
import {createYuE2Driver} from '../src/service/yue2/runtime.ts';
import {processRenderer} from '../src/service/render/process.ts';
import {generationWithEnding} from '../src/service/yue2/input.ts';
import {createAwakeClock} from '../tests/quality/awake-clock.ts';
import {runtimeEnvironment} from '../src/service/yue2/worker.ts';

assert.equal(process.env.MUSIC_ROOM_PLANNING_REAL,'1','explicit real-model opt-in required');
assert.ok(process.env.MUSIC_ROOM_RESOURCE_RUN,'isolated installed models required');
const installation=resolve(process.env.MUSIC_ROOM_RESOURCE_RUN!),out=resolve('test-results/music-planning',`run-${Date.now()}`),workspace=join(out,'workspace');
const fixture=JSON.parse(await readFile('tests/quality/music-planning-regression.json','utf8'));
const request=fixture.request;
assert.equal(createHash('sha256').update(JSON.stringify(generationWithEnding(request))).digest('hex'),fixture.nativeInputSha256,'original model input must not drift');
await mkdir(join(workspace,'engines'),{recursive:true});
await writeFile(join(workspace,'engines/yue2.json'),JSON.stringify({version:1,directory:join(installation,'yue'),autoStart:true}));
const read=(path:string)=>readFile(resolve('public',path)),resources=createResources(read);
const service=await MusicService.open(workspace,processRenderer(),read,false,createYuE2Driver(read),undefined,undefined,resources);
const clock=await createAwakeClock();
const report:any={startedAt:new Date().toISOString(),status:'running',fixture,workspace,installation,nativeInput:generationWithEnding(request),sourceHashes:{},events:[]};
for(const path of ['public/yue2-runtime/duration.py','public/yue2-runtime/recovery.py','src/service/yue2/worker.ts','src/service/resources/profiles.ts','scripts/verify-music-planning-real.ts','tests/quality/music-planning-regression.json'])report.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const save=()=>writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));
let jobId:string|undefined,backendId:string|undefined;
try{
 report.hardware=(await resources.status()).hardware;await save();console.log(JSON.stringify({out,request}));
 const submitted=await service.yue2Client.generate(request);jobId=submitted.job.id;report.jobId=jobId;
 const deadline=await clock.now()+30*60000;let last='';
 for(;;){
  const result=await service.yue2Client.job(jobId);report.result=result;if(typeof result.job.progress?.job_id==='string')backendId=result.job.progress.job_id;
  const state=JSON.stringify({status:result.job.status,stage:result.job.progress?.stage,phase:result.job.progress?.phase});
  if(state!==last){last=state;report.events.push({at:new Date().toISOString(),state:JSON.parse(state)});await save();console.log(state);}
  if(['done','failed','cancelled'].includes(result.job.status))break;
  assert.ok(await clock.now()<deadline,'real planning regression timeout');await new Promise(r=>setTimeout(r,1000));
 }
 assert.equal(report.result.job.status,'done',report.result.job.error);
 assert.equal(report.result.job.truncated?.abc,false);assert.equal(report.result.job.truncated?.semantic,false);
 const audio=await service.yue2Client.audio(jobId);assert.ok(audio.length>44);report.audioSha256=createHash('sha256').update(audio).digest('hex');
 const audioPath=join(out,'audio.flac');await writeFile(audioPath,audio);
 report.analysis=JSON.parse(execFileSync(join(installation,'yue/.venv/bin/python'),['-c',`import soundfile as sf,numpy as np,json,sys
x,sr=sf.read(sys.argv[1],always_2d=True)
print(json.dumps({'seconds':len(x)/sr,'sampleRate':sr,'channels':x.shape[1],'peak':float(np.max(np.abs(x))),'rms':float(np.sqrt(np.mean(x*x))),'finite':bool(np.all(np.isfinite(x)))}))`,audioPath],{env:runtimeEnvironment(join(installation,'yue')),encoding:'utf8',timeout:30000}));
 assert.ok(report.analysis.finite);assert.ok(report.analysis.seconds>3);assert.ok(report.analysis.rms>.001);assert.ok(report.analysis.peak<=1);
 assert.ok(backendId,'real backend job must be observed');
 const jobRoot=join(installation,'yue/data/songs',backendId),planning=JSON.parse(await readFile(join(jobRoot,'duration.json'),'utf8'));
 assert.equal(planning.accepted,true);assert.equal(planning.targetSeconds,null);assert.ok(planning.attempts<=3);
 for(let n=1;n<=planning.attempts;n++){
  const plan=JSON.parse(await readFile(join(jobRoot,`duration-attempt-${n}/plan.json`),'utf8'));
  assert.equal(plan.request.style,report.nativeInput.style,'retry must retain original style');assert.equal(plan.request.lyrics,request.lyrics);
  assert.equal(plan.request.seed,request.seed+n-1);assert.ok(plan.timing.output_tokens<=4096);
  if(n===planning.selectedAttempt)assert.equal(plan.truncated,false);
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{
 if(jobId){const result=await service.yue2Client.job(jobId);if(['running','queued'].includes(result.job.status))await service.yue2Client.cancel(jobId);}
 await service.close();await clock.close();report.resources=resources.snapshot();
 if(backendId){
  const root=join(installation,'yue/data/songs',backendId);report.backendId=backendId;
  for(const name of await readdir(root))if(name==='duration.json'||name==='job.json'||name==='config.json'||name.startsWith('duration-attempt-'))await cp(join(root,name),join(out,name),{recursive:true});
  if(existsSync(join(root,'duration.json')))report.planning=JSON.parse(await readFile(join(root,'duration.json'),'utf8'));
 }
 report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({report:join(out,'verification.json'),status:report.status,error:report.error,planning:report.planning}));
}
