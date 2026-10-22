/** Isolated calibration: holds the shared model lease; never writes production lyrics. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {ResourceLease} from '../../src/service/resources/lease.ts';
import {commandOutput} from '../../src/service/resources/telemetry.ts';
const workspace=process.argv[2]??'/Users/liu_y/Music/MusicRoom';
const out=resolve(process.argv[3]??`test-results/lyrics-memory-${Date.now()}`);
await mkdir(out,{recursive:true});
const engine=join(workspace,'engines/lyrics'),python=join(engine,'venv/bin/python');
const native=resolve('public/resource-native/footprint-darwin-arm64'),worker=resolve('public/lyrics-runtime/worker.py');
const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));
const headers={authorization:'Bearer '+runtime.token,'content-type':'application/json'};
const status=await(await fetch(runtime.url+'/api/resource_status',{method:'POST',headers,body:'{}'})).json();
if(status.active||status.queued?.length)throw Error('正式服务正在执行或排队，不能争用模型资源');
const lease=new ResourceLease();if(!lease.acquire())throw Error('另一个任务持有模型资源');
const system=async()=>JSON.parse(await commandOutput(native,['system']));
const report:any={startedAt:new Date().toISOString(),workerSha256:createHash('sha256').update(await readFile(worker)).digest('hex'),
 machine:{platform:process.platform,arch:process.arch},method:{physical:'kernel proc_pid_rusage ri_phys_footprint; 200ms sampling, includes load and inference',diagnostics:'RSS and Metal sampled separately at 100ms; never added to physical footprint',guards:'8 GiB physical footprint, production worker 8 GiB RSS+Metal guard, critical pressure or 512 MiB swap-out/growth while warning',admission:'Explicit isolated calibration may run under warning pressure; normal application admission policy is unchanged',cloudReview:'Not invoked: existing reviewed passages for real songs; raw ASR passages for synthetic input. No accuracy claim.'},runs:[]};
const save=()=>writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
let child:ReturnType<typeof spawn>|undefined;
const stop=()=>child?.kill('SIGTERM');process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{
 const library=JSON.parse(await readFile(join(workspace,'studio.json'),'utf8'));
 const definitions=[{id:'direction',version:'version-ed5e6547-66d8-46bd-81c7-a7229075436a'},
  {id:'lakeside',version:'version-1e56948b-6690-4721-be4b-6e06f10976fb'}];
 const samples:any[]=[];
 for(const d of definitions){
  const v=library.versions.find((v:any)=>v.id===d.version);const response=await fetch(runtime.url+v.audioPath,{headers});if(!response.ok)throw Error('样本读取失败');
  const audio=join(out,d.id+'.flac');const bytes=new Uint8Array(await response.arrayBuffer());await writeFile(audio,bytes);
  const lyrics=JSON.parse(await readFile(join(workspace,'lyrics',v.id+'.json'),'utf8'));
  const reviewed=join(out,d.id+'-reviewed.json');await writeFile(reviewed,JSON.stringify({duration:lyrics.duration,chunks:lyrics.analysis}));
  samples.push({...d,audio,reference:v.input.lyrics,duration:lyrics.duration,reviewed,audioSha256:createHash('sha256').update(bytes).digest('hex')});
 }
 const longAudio=join(out,'synthetic-600s.wav');
 execFileSync(python,['-c',"import sys,soundfile as sf,numpy as np;a,r=sf.read(sys.argv[1],dtype='float32',always_2d=True);a=np.tile(a,(int(np.ceil(600*r/len(a))),1))[:600*r];sf.write(sys.argv[2],a,r,subtype='FLOAT')",samples[1].audio,longAudio],{timeout:60000});
 samples.push({id:'synthetic-600s',audio:longAudio,reference:samples[1].reference,duration:600});
 samples.push({...samples[1],id:'lakeside-repeat'});
 report.samples=samples.map(({id,version,duration,audioSha256})=>({id,version,duration,audioSha256}));
 for(const sample of samples)for(const phase of ['transcribe','align']){
  const initial=await system(),run:any={sample:sample.id,duration:sample.duration,phase,startedAt:new Date().toISOString(),baseline:initial,physicalPeak:0,rssPeak:0,metalDriverPeak:0,metalActivePeak:0,productionGuardPeak:0,samples:0};report.runs.push(run);await save();
  const output=join(out,`${sample.id}-${phase}.json`),taskFile=join(out,`${sample.id}-${phase}-task.json`);
  const transcription=sample.reviewed??join(out,`${sample.id}-transcribe.json`);
  await writeFile(taskFile,JSON.stringify({phase,audio:sample.audio,output,asr:join(engine,'asr-model'),aligner:join(engine,'aligner-model'),reference:sample.reference,budget:8*2**30,...(phase==='align'?{transcription}:{})}));
  console.log(JSON.stringify({starting:sample.id,phase,duration:sample.duration}));
  const started=performance.now();let stderr='',guard:unknown;const rows:any[]=[];
  child=spawn(python,[resolve('scripts/experiments/measure-lyrics-memory.py'),worker,taskFile],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'}});
  const current=child;const completed=new Promise<number|null>((res,rej)=>{current.once('error',rej);current.once('close',res);});
  lease.track(current.pid!);current.stderr!.on('data',b=>{stderr=(stderr+b).slice(-12000);});
  const lines=createInterface({input:current.stdout!});let progress='';
  lines.on('line',line=>{try{const data=JSON.parse(line);if(data.measurement){const m=data.measurement;run.rssPeak=Math.max(run.rssPeak,m.rss);run.metalDriverPeak=Math.max(run.metalDriverPeak,m.metalDriver);run.metalActivePeak=Math.max(run.metalActivePeak,m.metalActive);run.productionGuardPeak=Math.max(run.productionGuardPeak,m.rss+m.metalDriver);}else if(data.message){progress=data.message;rows.push({at:performance.now()-started,...data});}else rows.push({line});}catch{rows.push({diagnostic:line});}});
  let finished=false;completed.finally(()=>{finished=true;}).catch(()=>{});
  let checks=0;
  while(!finished){
   try{
    const m=JSON.parse(await commandOutput(native,[String(current.pid)]));run.physicalPeak=Math.max(run.physicalPeak,m.bytes);run.samples++;
    rows.push({at:performance.now()-started,physical:m.bytes,progress});
    if(m.bytes>8*2**30)throw Error('实验进程实际内存超过 8 GiB');
    if(checks++%5===0){const memory=await system(),pressure=Number(await commandOutput('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level']));
     rows.push({at:performance.now()-started,system:memory,pressure});
     if(pressure===4||pressure!==1&&(memory.swapOutBytes-initial.swapOutBytes>=512*2**20||memory.swapUsed-initial.swapUsed>=512*2**20))throw Error('系统压力或持续交换触发实验保护');
    }
    if(performance.now()-started>10*60000)throw Error('单阶段超时');
   }catch(e){if(!finished){try{process.kill(current.pid!,0);guard=e;current.kill('SIGTERM');setTimeout(()=>{if(!finished)current.kill('SIGKILL');},1500);}catch{}}}
   await new Promise(r=>setTimeout(r,200));
  }
  run.exitCode=await completed;child=undefined;run.elapsedSeconds=(performance.now()-started)/1000;run.final=await system();run.error=guard?String(guard):run.exitCode!==0?stderr:undefined;
  await writeFile(join(out,`${sample.id}-${phase}-samples.json`),JSON.stringify(rows));run.stderr=stderr;await save();
  console.log(JSON.stringify({finished:sample.id,phase,seconds:Math.round(run.elapsedSeconds),physicalGiB:run.physicalPeak/2**30,rssGiB:run.rssPeak/2**30,metalGiB:run.metalDriverPeak/2**30,guardGiB:run.productionGuardPeak/2**30,exitCode:run.exitCode,error:run.error}));
  if(run.exitCode!==0||guard)throw Error(run.error??'模型阶段失败');
 }
}catch(error){report.error=String(error);console.error(report.error);process.exitCode=1;}
finally{if(child){child.kill('SIGTERM');await new Promise(r=>child!.once('close',r));}lease.release();report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({report:join(out,'report.json')}));}
