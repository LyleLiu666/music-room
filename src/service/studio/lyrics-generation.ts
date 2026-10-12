import {copyFileSync,existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import type {ResourceCoordinator} from '../resources/coordinator.ts';
import type {ResourceExecution,ResourceTaskState} from '../resources/contracts.ts';
import {readLyrics,type LyricLine} from './lyrics.ts';
export type LyricSource={id:string;audioPath:string;reference:string;audio:()=>Promise<Uint8Array>};
export type LyricJob={versionId:string;requestId:string;taskId:string;state:'queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';message:string;progress:number;startedAt?:number;updatedAt?:number;resource?:ResourceTaskState};
export type LyricOutput={duration:number;lines:LyricLine[];unresolved?:unknown[];transcription?:unknown};
export type LyricProcessor={ready:()=>boolean;run:(source:LyricSource,bytes:Uint8Array,execution:ResourceExecution,progress:(message:string,percent:number)=>void)=>Promise<LyricOutput>};
const busy=(job?:LyricJob)=>job?.state==='queued'||job?.state==='running';
export class LyricsGeneration{
 private jobs:Record<string,LyricJob>={};private tasks=new Map<string,{controller:AbortController;done:Promise<void>}>();private closed=false;
 private directory:string;private resources:ResourceCoordinator;private source:(id:string)=>LyricSource;processor:LyricProcessor;
 constructor(directory:string,resources:ResourceCoordinator,source:(id:string)=>LyricSource,processor:LyricProcessor){
  this.directory=directory;this.resources=resources;this.source=source;this.processor=processor;
  mkdirSync(directory,{recursive:true});if(existsSync(join(directory,'jobs.json')))this.jobs=JSON.parse(readFileSync(join(directory,'jobs.json'),'utf8'));
  for(const job of Object.values(this.jobs))if(busy(job)){job.state='interrupted';job.message='服务已重启，请重新生成';}
  this.save();resources.register('lyrics',{resident:()=>undefined,unload:async()=>{}});
 }
 private save(){const file=join(this.directory,'jobs.json');writeFileSync(file+'.partial',JSON.stringify(this.jobs));renameSync(file+'.partial',file);}
 status(id:string){return {available:this.processor.ready(),job:this.jobs[id]?structuredClone(this.jobs[id]):undefined};}
 activeJobs(){return structuredClone(Object.values(this.jobs).filter(busy));}
 start(id:string,requestId:string){
  if(this.closed)throw Error('服务正在退出');const source=this.source(id);if(!requestId||requestId.length>100)throw Error('生成请求无效');
  const previous=this.jobs[id];if(this.tasks.has(id)||busy(previous)||previous?.requestId===requestId)return this.status(id);
  if(!this.processor.ready())throw Error('本机尚未准备歌词模型，请先安装歌词引擎');
  const job:LyricJob={versionId:id,requestId,taskId:'lyrics-'+randomUUID(),state:'queued',message:'等待生成同步歌词',progress:0};this.jobs[id]=job;this.save();const controller=new AbortController();
  const done=this.resources.run({id:job.taskId,engine:'lyrics',demand:{verified:true,peak:{memory:8*2**30}},signal:controller.signal,
   onState:state=>{job.resource=state;if(['queued','waiting_resources','loading'].includes(state.stage)){job.state='queued';job.message=state.message??'等待生成同步歌词';}this.save();},
   execute:async execution=>{
    execution.running();job.state='running';job.startedAt=job.updatedAt=Date.now();job.message='正在读取音频';this.save();const bytes=await source.audio();execution.signal.throwIfAborted();
    job.message='正在加载歌词模型';job.updatedAt=Date.now();this.save();const result=await this.processor.run(source,bytes,execution,(message,progress)=>{
     execution.signal.throwIfAborted();if(!Number.isFinite(progress)||progress<0||progress>100)throw Error('歌词进度无效');
     job.message=message;job.progress=progress;job.updatedAt=Date.now();this.save();
    });execution.signal.throwIfAborted();
    job.message='正在校验与保存同步歌词';job.progress=99;job.updatedAt=Date.now();this.save();
    const current=this.source(id);if(current.audioPath!==source.audioPath||current.reference!==source.reference)throw Error('歌曲或参考歌词已变化，请重试');
    const record={format:'music-room-lyrics',version:1,versionId:id,audioPath:source.audioPath,audioSha256:createHash('sha256').update(bytes).digest('hex'),duration:result.duration,draft:true,lines:result.lines,unresolved:result.unresolved??[],analysis:result.transcription??[],source:'local-asr',generatedAt:new Date().toISOString()};
    const staging=await mkdtemp(join(this.directory,'result-'));try{await writeFile(join(staging,id+'.json'),JSON.stringify(record));readLyrics(staging,{id,audioPath:source.audioPath});execution.signal.throwIfAborted();this.source(id);const target=join(this.directory,id+'.json');if(existsSync(target)){const history=join(this.directory,'history');mkdirSync(history,{recursive:true});copyFileSync(target,join(history,id+'-'+job.taskId+'.json'));}renameSync(join(staging,id+'.json'),target);}finally{await rm(staging,{recursive:true,force:true});}
    job.state='succeeded';job.progress=100;job.updatedAt=Date.now();job.message=result.unresolved?.length?`已生成草稿，${result.unresolved.length} 处未定位，请核对`:'同步歌词已生成，可播放核对';this.save();
   }}).catch(error=>{job.state=controller.signal.aborted||error?.code==='CANCELLED'?'cancelled':'failed';job.message=job.state==='cancelled'?'已取消歌词生成':String(error?.message??error);this.save();}).finally(()=>this.tasks.delete(id));
  this.tasks.set(id,{controller,done});return this.status(id);
 }
 async cancel(id:string){const task=this.tasks.get(id);task?.controller.abort();await task?.done;return this.status(id);}
 async close(){this.closed=true;for(const task of this.tasks.values())task.controller.abort();await Promise.all([...this.tasks.values()].map(t=>t.done));}
}
export function localLyricsProcessor(engine:string,readAsset:(name:string)=>Promise<Uint8Array>):LyricProcessor{
 const python=join(engine,'venv/bin/python'),asr=join(engine,'asr-model'),aligner=join(engine,'aligner-model');
 return {ready:()=>process.platform==='darwin'&&process.arch==='arm64'&&[python,join(asr,'config.json'),join(aligner,'config.json')].every(existsSync),run:async(source,bytes,execution,progress)=>{
  const temporary=await mkdtemp(join(engine,'task-'));try{
   const audio=join(temporary,'audio'),output=join(temporary,'result.json'),worker=join(temporary,'worker.py');await writeFile(audio,bytes);await writeFile(worker,await readAsset('lyrics-runtime/worker.py'));execution.signal.throwIfAborted();
   await new Promise<void>((resolve,reject)=>{
    const child=spawn(python,[worker],{stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'}});let error='',failure:unknown;let timer:ReturnType<typeof setTimeout>|undefined;
    const stop=()=>{child.kill('SIGTERM');timer??=setTimeout(()=>child.kill('SIGKILL'),1500);};execution.signal.addEventListener('abort',stop,{once:true});child.stdin.on('error',()=>{});child.once('error',e=>{failure=e;});child.stderr.on('data',b=>{error=(error+b).slice(-3000);});
    const lines=createInterface({input:child.stdout});lines.on('line',line=>{
     let data;try{data=JSON.parse(line);}catch{/* Library diagnostics are not progress. */return;}
     try{if(data?.error)error=String(data.error);else if(typeof data?.message==='string'&&Number.isFinite(data.progress))progress(data.message,data.progress);}
     catch(e){failure??=e;stop();}
    });
    child.once('close',code=>{if(timer)clearTimeout(timer);execution.signal.removeEventListener('abort',stop);lines.close();if(execution.signal.aborted)reject(execution.signal.reason);else if(failure||code!==0)reject(failure??Error(error||'歌词分析失败'));else resolve();});
    try{if(child.pid)execution.trackProcess(child.pid);execution.signal.throwIfAborted();child.stdin.write(JSON.stringify({audio,output,asr,aligner,reference:source.reference,budget:execution.budgets.memory})+'\n');}catch(e){failure=e;stop();}
   });return JSON.parse(await readFile(output,'utf8'));
  }finally{await rm(temporary,{recursive:true,force:true});}
 }};
}
