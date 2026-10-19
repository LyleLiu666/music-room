import {readMusicRecovery,sameMusicGeneration} from './recovery.ts';
import {musicInputLimits} from './input.ts';
import {generationWithEnding,readTruncation} from './ending.ts';
import {readAudioFile} from '../projects/audio-files.ts';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync,statSync,createReadStream} from 'node:fs';
import {dirname,join,isAbsolute} from 'node:path';
import {z} from 'zod';
import {ProjectStore,ServiceError} from '../projects/store.ts';
import type {YuE2Engine} from './engine.ts';
import type {ResourceCoordinator} from '../resources/coordinator.ts';
import {yue2JobSchema,yue2JobId,type YuE2Generate,type YuE2Job} from './contracts.ts';

type RecordJob={checkedAt?:number;job:YuE2Job;directory:string;upstreamId?:string;input?:YuE2Generate;hash?:string;bytes?:number};
/** Durable public identity. The upstream accepts one job only while this proxy owns execution. */
export class YuE2Proxy {
 private records=new Map<string,RecordJob>();
 private tasks=new Map<string,{controller:AbortController;done:Promise<void>;resumeFrom?:string}>();
 private closed=false;
 private migration?:Promise<void>;private migratedDirectory?:string;
 private engine:YuE2Engine;private store:ProjectStore;private resources:ResourceCoordinator;
 constructor(engine:YuE2Engine,store:ProjectStore,resources:ResourceCoordinator){
  this.engine=engine;this.store=store;this.resources=resources;
  const path=this.path();if(existsSync(path)){
   if(lstatSync(path).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','音乐任务文件不能是符号链接');
   const data=JSON.parse(readFileSync(path,'utf8'));if(data.version!==1||!Array.isArray(data.jobs))throw new ServiceError('CORRUPT_ENGINE','音乐任务格式无效');
   for(const raw of data.jobs){const record=z.object({job:yue2JobSchema,directory:z.string().refine(isAbsolute),upstreamId:yue2JobId.optional(),input:z.unknown().optional(),hash:z.string().optional(),bytes:z.number().optional()}).parse(raw) as RecordJob;
    if(['queued','running'].includes(record.job.status)){record.job.status='failed';record.job.stage='interrupted';record.job.error='工作台退出，任务已中断；请手动重试';}
    this.records.set(record.job.id,record);
   }this.save();
  }
 }
 private path(){return this.store.path('engines','yue2-jobs.json');}
 private save(){this.store.atomicJSON(this.path(),{version:1,jobs:[...this.records.values()]});}
 private async migrate(){
  const directory=(await this.engine.status()).directory;if(!directory)return;if(directory!==this.migratedDirectory){this.migration=undefined;this.migratedDirectory=directory;}
  if(!this.migration)this.migration=(async()=>{
   for(const job of await this.engine.history())if(!this.records.has(job.id)&&![...this.records.values()].some(r=>r.upstreamId===job.id)){
    const record:RecordJob={job:structuredClone(job),directory,upstreamId:job.id};
    if(['queued','running'].includes(job.status)){record.job.status='failed';record.job.stage='interrupted';record.job.error='旧任务未完成；请手动重试';}
    if(record.job.status==='done')try{await this.seal(record);}catch(error){record.job.status='failed';record.job.error=String(error);}
    this.records.set(job.id,record);
   }this.save();
  })().catch(error=>{this.migration=undefined;throw error;});await this.migration;
 }
 private record(id:string){const record=this.records.get(yue2JobId.parse(id));if(!record)throw new ServiceError('NOT_FOUND','音乐任务不存在');return record;}
 artifact(record:RecordJob){
  if(!record.upstreamId)throw new ServiceError('NOT_FOUND','音乐音频不存在');
  const root=record.directory;if(realpathSync(root)!==root)throw new ServiceError('UNSAFE_PATH','音乐目录不能包含符号链接');
  const marker=join(root,'.music-room-yue2.json');if(lstatSync(marker).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','引擎标记不能是符号链接');const owner=JSON.parse(readFileSync(marker,'utf8'));if(owner.format!=='music-room-yue2'||owner.version!==1)throw new ServiceError('UNSAFE_PATH','音乐目录不属于引擎');
  const path=join(root,'data','songs',record.upstreamId,'song','audio.flac');
  for(let current=path;current!==root;current=dirname(current))if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','音乐音频不能包含符号链接');
  if(!existsSync(path)||!statSync(path).isFile())throw new ServiceError('NOT_FOUND','音乐音频不存在');if(statSync(path).size>120_000_000)throw new ServiceError('INVALID_AUDIO','音乐文件超出处理范围');return path;
 }
 private async seal(record:RecordJob){const path=this.artifact(record),hash=createHash('sha256');let count=0;for await(const chunk of createReadStream(path)){if(count===0&&(chunk.length<8||chunk.subarray(0,4).toString()!=='fLaC'))throw new ServiceError('INVALID_AUDIO','音乐音频无效');hash.update(chunk);count+=chunk.length;if(count>120_000_000)throw new ServiceError('INVALID_AUDIO','音乐文件超出处理范围');}if(count<8)throw new ServiceError('INVALID_AUDIO','音乐音频无效');record.hash=hash.digest('hex');record.bytes=count;}
 private publicJob(record:RecordJob):YuE2Job{const stage=record.upstreamId&&['failed','cancelled'].includes(record.job.status)?readMusicRecovery(record.directory,record.upstreamId):undefined;return {...structuredClone(record.job),checkedAt:record.checkedAt,recovery:stage?{jobId:record.job.id,stage}:undefined};}
 private result(record:RecordJob){return {job:this.publicJob(record),audioPath:record.job.status==='done'?this.artifact(record):undefined};}
 private async request(path:string,body:unknown|undefined,signal:AbortSignal){
  const url=await this.engine.endpoint();const response=await fetch(url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{...this.engine.headers(),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  const value=await response.json();if(!response.ok)throw new ServiceError('YUE2_REQUEST_FAILED',`音乐引擎请求失败：HTTP ${response.status}`);return z.object({job:yue2JobSchema}).parse(value).job;
 }
 async generate(input:YuE2Generate,body:unknown,resumeFrom?:string){
  if(this.closed)throw new ServiceError('CLOSED','服务正在退出');await this.migrate();
  const state=await this.engine.status();if(!state.canGenerate||!state.directory)throw new ServiceError('YUE2_UNAVAILABLE','请先准备并启用音乐模型');
  if(resumeFrom){
   const source=this.record(resumeFrom);
   if(!['failed','cancelled'].includes(source.job.status)||!source.input||source.directory!==state.directory||!source.upstreamId||!sameMusicGeneration(input,{...source.input,seed:source.input.seed??source.job.seed as number|undefined})||!readMusicRecovery(source.directory,source.upstreamId))throw new ServiceError('YUE2_RECOVERY_UNAVAILABLE','恢复点不可用或创作要求已改变，请修改要求后重新生成');
   body={...(body as object),params:{...(body as {params:object}).params,resume_from:source.upstreamId}};
  }
  const context=await this.engine.inspectInput(input);
  if(context?.issue)throw new ServiceError('YUE2_CONTEXT_EXCEEDED',context.issue);
  const id=randomUUID().replaceAll('-',''),record:RecordJob={job:{id,kind:'create',status:'queued',title:input.title,created_at:new Date().toISOString()},directory:state.directory,input:structuredClone(input)};
  this.records.set(id,record);this.save();const controller=new AbortController();
  const done=this.resources.run({id,engine:'yue2',signal:controller.signal,demand:this.resources.estimate('yue2',{...input,...generationWithEnding(input),context,resourceProfile:this.engine.resourceProfile()}),onState:resource=>{record.job.resource=resource;record.job.stage=resource.message??resource.stage;this.save();},execute:async execution=>{
   await this.engine.activate(execution);execution.signal.throwIfAborted();execution.running();
   // POST is intentionally not retried: a lost response may already have created an upstream job.
   let upstream=await this.request('jobs',body,execution.signal);record.upstreamId=upstream.id;if(record.input?.seed===undefined&&Number.isSafeInteger(upstream.seed))record.input!.seed=upstream.seed as number;record.checkedAt=Date.now();this.save();
   for(;;){execution.signal.throwIfAborted();if(['done','failed','cancelled'].includes(upstream.status))break;const next={...upstream,id,resource:record.job.resource};if(JSON.stringify(next)!==JSON.stringify(record.job)){record.job=next;this.save();}
    await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(execution.signal.reason);};const timer=setTimeout(()=>{execution.signal.removeEventListener('abort',abort);resolve();},250);execution.signal.addEventListener('abort',abort,{once:true});});
    upstream=await this.request('jobs/'+record.upstreamId,undefined,execution.signal);record.checkedAt=Date.now();
   }
   if(upstream.status==='done'){await this.seal(record);const truncated=readTruncation(join(dirname(dirname(this.artifact(record))),'summary.json'));if(truncated)upstream.truncated=truncated;}return upstream;
  }}).then(upstream=>{const next={...upstream,id,resource:record.job.resource};if(JSON.stringify(next)!==JSON.stringify(record.job)){record.job=next;this.save();}}).catch(error=>{record.job.status=controller.signal.aborted?'cancelled':'failed';record.job.error=error instanceof Error?error.message:String(error);this.save();}).finally(()=>this.tasks.delete(id));
  this.tasks.set(id,{controller,done,resumeFrom});return this.result(record);
 }
 async job(id:string){await this.migrate();return this.result(this.record(id));}
 async list(){await this.migrate();return {jobs:[...this.records.values()].reverse().slice(0,30).map(r=>this.publicJob(r))};}
 async cancel(id:string){const record=this.record(id),task=this.tasks.get(id);if(task){task.controller.abort();await task.done;}return this.result(record);}
 async audio(id:string){await this.migrate();const record=this.record(id);if(record.job.status!=='done')throw new ServiceError('YUE2_NOT_READY','音乐未完成');const bytes=readAudioFile(this.artifact(record),120_000_000,record.bytes);if(bytes.length!==record.bytes||createHash('sha256').update(bytes).digest('hex')!==record.hash)throw new ServiceError('INVALID_AUDIO','音乐音频校验失败');return new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
 async score(id:string){await this.migrate();const record=this.record(id);if(record.job.status!=='done')throw new ServiceError('YUE2_NOT_READY','请先选择已完成的音乐版本');const path=join(dirname(this.artifact(record)),'score.abc');if(!existsSync(path))throw new ServiceError('NOT_FOUND','此版本没有保存 ABC 乐谱');return new TextDecoder('utf-8',{fatal:true}).decode(readAudioFile(path,musicInputLimits.abc*4));}
 async purgeTarget(id:string){await this.migrate();const record=this.record(id);if(this.tasks.has(id)||[...this.tasks.values()].some(t=>t.resumeFrom===id))throw new ServiceError('YUE2_BUSY','恢复生成仍在使用此版本，请先取消或等待完成');return {directory:record.directory,id:record.upstreamId??id};}
 async stop(){for(const task of this.tasks.values())task.controller.abort();await Promise.all([...this.tasks.values()].map(t=>t.done));}
 async close(){this.closed=true;await this.stop();}
}
