import {readMusicRecovery,sameMusicGeneration} from './recovery.ts';
import {musicInputLimits} from './input.ts';
import {generationWithEnding,readDurationCheck,readTruncation} from './ending.ts';
import {readAudioFile} from '../projects/audio-files.ts';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,realpathSync,statSync,createReadStream,unlinkSync} from 'node:fs';
import {dirname,join,isAbsolute} from 'node:path';
import {z} from 'zod';
import {ProjectStore,ServiceError} from '../projects/store.ts';
import type {YuE2Engine} from './engine.ts';
import type {ResourceCoordinator} from '../resources/coordinator.ts';
import {yue2JobSchema,yue2JobId,type YuE2Generate,type YuE2Job,type YuE2JobResult} from './contracts.ts';
import {musicAudioLimit, type AudioDigest, type MusicObjectAudio} from './object-audio.ts';

const archiveSchema=z.object({namespace:z.string(),ready:z.boolean()});
type RecordJob={archive?:z.infer<typeof archiveSchema>;sharedArtifacts?:boolean;purgePending?:boolean;purged?:boolean;checkedAt?:number;job:YuE2Job;directory:string;upstreamId?:string;input?:YuE2Generate;vocalRestsOmitted?:true;hash?:string;bytes?:number};
/** Durable public identity. The upstream accepts one job only while this proxy owns execution. */
export class YuE2Proxy {
 private records=new Map<string,RecordJob>();
 private restored=false;
 private tasks=new Map<string,{controller:AbortController;done:Promise<void>;resumeFrom?:string}>();
 private closed=false;
 private archiveStop=new AbortController();
 private archives=new Map<string,Promise<{archived:true;local:boolean}>>();
 private archiveTimer?:ReturnType<typeof setInterval>;
 private retrying=false;
 private migration?:Promise<void>;private migratedDirectory?:string;
 private engine:YuE2Engine;private store:ProjectStore;private resources:ResourceCoordinator;private objects?:MusicObjectAudio;
 constructor(engine:YuE2Engine,store:ProjectStore,resources:ResourceCoordinator,objects?:MusicObjectAudio){
  this.engine=engine;this.store=store;this.resources=resources;this.objects=objects;
  const path=this.path();if(existsSync(path)){
   if(lstatSync(path).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','音乐任务文件不能是符号链接');
   const data=JSON.parse(readFileSync(path,'utf8'));if(data.version!==1||!Array.isArray(data.jobs))throw new ServiceError('CORRUPT_ENGINE','音乐任务格式无效');
   this.restored=data.restored===true;
   for(const raw of data.jobs){const record=z.object({job:yue2JobSchema,directory:z.string().refine(isAbsolute),upstreamId:yue2JobId.optional(),input:z.unknown().optional(),vocalRestsOmitted:z.literal(true).optional(),hash:z.string().optional(),bytes:z.number().optional(),archive:archiveSchema.optional(),sharedArtifacts:z.boolean().optional(),purgePending:z.boolean().optional(),purged:z.boolean().optional(),checkedAt:z.number().optional()}).parse(raw) as RecordJob;
    if(['queued','running'].includes(record.job.status)){record.job.status='failed';record.job.stage='interrupted';record.job.error='工作台退出，任务已中断；请手动重试';}
    this.records.set(record.job.id,record);
   }this.save();
  }
  if(objects){
   this.archiveTimer=setInterval(()=>void this.retryArchives(),60_000);
   this.archiveTimer.unref();
   queueMicrotask(()=>void this.retryArchives());
  }
 }
 get playbackOrigin(){return this.objects?.playbackOrigin;}
 private async retryArchives(){
  if(this.closed||this.retrying)return;
  this.retrying=true;
  try{
   for(const record of this.records.values()){
    if(this.closed)break;
    if(!record.sharedArtifacts&&record.job.status==='done'&&record.archive&&!record.archive.ready&&
       record.archive.namespace===this.objects?.namespace&&!record.purgePending&&!record.purged){
     await this.archiveAudio(record.job.id).catch(()=>{});
    }
   }
  }finally{this.retrying=false;}
 }
 private path(){return this.store.path('engines','yue2-jobs.json');}
 private save(){this.store.atomicJSON(this.path(),{version:1,restored:this.restored||undefined,jobs:[...this.records.values()]});}
 private async migrate(){
  const directory=(await this.engine.status()).directory;if(!directory)return;if(directory!==this.migratedDirectory){this.migration=undefined;this.migratedDirectory=directory;}
  if(!this.migration)this.migration=(async()=>{
   for(const job of await this.engine.history())if(!this.records.has(job.id)&&![...this.records.values()].some(r=>r.upstreamId===job.id)){
    const record:RecordJob={job:structuredClone(job),directory,upstreamId:job.id,sharedArtifacts:this.restored||undefined};
    if(['queued','running'].includes(job.status)){record.job.status='failed';record.job.stage='interrupted';record.job.error='旧任务未完成；请手动重试';}
    if(record.job.status==='done')try{await this.seal(record);}catch(error){record.job.status='failed';record.job.error=String(error);}
    this.records.set(job.id,record);
   }this.save();
  })().catch(error=>{this.migration=undefined;throw error;});await this.migration;
 }
 private record(id:string){const record=this.records.get(yue2JobId.parse(id));if(!record)throw new ServiceError('NOT_FOUND','音乐任务不存在');return record;}
 private artifactPath(record:RecordJob,name:string){
  if(!record.upstreamId)throw new ServiceError('NOT_FOUND','音乐音频不存在');
  const root=record.directory;if(realpathSync(root)!==root)throw new ServiceError('UNSAFE_PATH','音乐目录不能包含符号链接');
  const marker=join(root,'.music-room-yue2.json');if(lstatSync(marker).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','引擎标记不能是符号链接');const owner=JSON.parse(readFileSync(marker,'utf8'));if(owner.format!=='music-room-yue2'||owner.version!==1)throw new ServiceError('UNSAFE_PATH','音乐目录不属于引擎');
  const path=join(root,'data','songs',record.upstreamId,'song',name);
  for(let current=path;current!==root;current=dirname(current))if(lstatSync(current,{throwIfNoEntry:false})?.isSymbolicLink())throw new ServiceError('UNSAFE_PATH','音乐音频不能包含符号链接');
  return path;
 }
 private localAudio(record:RecordJob){
  if(record.archive?.ready&&!lstatSync(record.directory,{throwIfNoEntry:false}))return;
  const path=this.artifactPath(record,'audio.flac'),stat=statSync(path,{throwIfNoEntry:false});
  if(!stat)return;
  if(!stat.isFile()||stat.size>musicAudioLimit)throw new ServiceError('INVALID_AUDIO','音乐音频无效');
  return path;
 }
 private playable(record:RecordJob){
  if(record.purgePending||record.purged)throw new ServiceError('NOT_FOUND','音乐音频已删除');
  if(record.job.status!=='done')throw new ServiceError('YUE2_NOT_READY','音乐未完成');
 }
 private digest(record:RecordJob):AudioDigest {
  if(!record.hash||!/^[a-f0-9]{64}$/.test(record.hash)||!Number.isSafeInteger(record.bytes)||record.bytes!<8||record.bytes!>musicAudioLimit)
   throw new ServiceError('INVALID_AUDIO','音乐音频校验记录无效');
  return {hash:record.hash,bytes:record.bytes!};
 }
 private objectKey(record:RecordJob){return record.job.id+'/'+this.digest(record).hash+'.flac';}
 private objectStore(record:RecordJob){
  if(!this.objects||record.archive&&this.objects.namespace!==record.archive.namespace)
   throw new ServiceError('MUSIC_STORAGE_UNAVAILABLE','请恢复此工作区的原 MinIO 配置');
  return this.objects;
 }
 async playback(id:string){
  await this.migrate();
  const record=this.record(id);this.playable(record);
  if(record.archive?.ready&&this.objects?.namespace===record.archive.namespace)
   return this.objects.playback(this.objectKey(record));
 }
 async archiveAudio(id:string,release=false):Promise<{archived:true;local:boolean}>{
  await this.migrate();
  if(this.closed)throw new ServiceError('CLOSED','服务正在退出');
  const record=this.record(id);this.playable(record);
  if(record.sharedArtifacts)throw new ServiceError('CONFLICT','恢复副本中的原音频由来源工作区管理');
  const existing=this.archives.get(id);
  if(existing){const result=await existing;return release&&result.local?this.archiveAudio(id,true):result;}
  const task=this.archive(record,release);
  this.archives.set(id,task);
  try{return await task;}finally{if(this.archives.get(id)===task)this.archives.delete(id);}
 }
 private async archive(record:RecordJob,release:boolean):Promise<{archived:true;local:boolean}>{
  const storage=this.objectStore(record);
  const local=this.localAudio(record);
  if(local&&!record.archive&&!record.hash)await this.seal(record);
  const digest=this.digest(record),key=this.objectKey(record);
  if(!record.archive?.ready){
   if(!local)throw new ServiceError('NOT_FOUND','找不到待归档的本地原音频');
   const previous=record.archive;
   record.archive={namespace:storage.namespace,ready:false};
   try{this.save();}catch(error){record.archive=previous;throw error;}
   await storage.upload(key,local,digest,this.archiveStop.signal);
   record.archive.ready=true;
   try{this.save();}catch(error){record.archive.ready=false;throw error;}
  }else if(release&&local){await storage.verify(key,digest,this.archiveStop.signal);}
  if(release&&local){
   const onDisk=await this.inspectAudio(local);
   if(onDisk.bytes!==digest.bytes||onDisk.hash!==digest.hash)throw new ServiceError('INVALID_AUDIO','本地原件已变化，未释放');
   this.archiveStop.signal.throwIfAborted();this.playable(record);unlinkSync(local);
  }
  return {archived:true,local:!!local&&!release};
 }
 private async inspectAudio(path:string):Promise<AudioDigest>{
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path)){
   if(!bytes&&(chunk.length<8||chunk.subarray(0,4).toString()!=='fLaC'))throw new ServiceError('INVALID_AUDIO','音乐音频无效');
   hash.update(chunk);bytes+=chunk.length;
   if(bytes>musicAudioLimit)throw new ServiceError('INVALID_AUDIO','音乐文件超出处理范围');
  }
  if(bytes<8)throw new ServiceError('INVALID_AUDIO','音乐音频无效');
  return {hash:hash.digest('hex'),bytes};
 }
 private async seal(record:RecordJob){
  const path=this.localAudio(record);
  if(!path)throw new ServiceError('NOT_FOUND','音乐音频不存在');
  Object.assign(record,await this.inspectAudio(path));
 }
 private publicJob(record:RecordJob):YuE2Job{const stage=record.upstreamId&&['failed','cancelled'].includes(record.job.status)?readMusicRecovery(record.directory,record.upstreamId):undefined;return {...structuredClone(record.job),checkedAt:record.checkedAt,recovery:stage?{jobId:record.job.id,stage}:undefined};}
 private result(record:RecordJob):YuE2JobResult {
  const available=record.job.status==='done'&&!record.purged&&!record.purgePending;
  const audioPath=available?this.localAudio(record):undefined;
  if(available&&!audioPath&&!record.archive?.ready)throw new ServiceError('NOT_FOUND','音乐音频不存在');
  return {job:this.publicJob(record),audioPath,audioUrl:available&&record.archive?.ready?'/yue2-audio/'+record.job.id:undefined,
   archiveState:available&&record.archive?(record.archive.ready?'ready':'pending'):undefined};
 }
 private async request(path:string,body:unknown|undefined,signal:AbortSignal){
  const url=await this.engine.endpoint();const response=await fetch(url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{...this.engine.headers(),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
  const value=await response.json();if(!response.ok)throw new ServiceError('YUE2_REQUEST_FAILED',`音乐引擎请求失败：HTTP ${response.status}`);return z.object({job:yue2JobSchema}).parse(value).job;
 }
 async generate(input:YuE2Generate,body:unknown,resumeFrom?:string){
  if(this.closed)throw new ServiceError('CLOSED','服务正在退出');await this.migrate();
  const state=await this.engine.status();if(!state.canGenerate||!state.directory)throw new ServiceError('YUE2_UNAVAILABLE','请先准备并启用音乐模型');
  const context=await this.engine.inspectInput(input);
  if(context?.issue)throw new ServiceError('YUE2_CONTEXT_EXCEEDED',context.issue);
  const vocalRestsOmitted=context?.vocalRestsOmitted;
  if(resumeFrom){
   const source=this.record(resumeFrom);
   if(!['failed','cancelled'].includes(source.job.status)||!source.input||source.directory!==state.directory||!source.upstreamId||!sameMusicGeneration(input,{...source.input,seed:source.input.seed??source.job.seed as number|undefined})||!readMusicRecovery(source.directory,source.upstreamId))throw new ServiceError('YUE2_RECOVERY_UNAVAILABLE','恢复点不可用或创作要求已改变，请修改要求后重新生成');
   if(source.vocalRestsOmitted!==vocalRestsOmitted)throw new ServiceError('YUE2_RECOVERY_UNAVAILABLE','恢复点使用了不同的乐谱处理方式，请从头生成');
   body={...(body as object),params:{...(body as {params:object}).params,resume_from:source.upstreamId}};
  }
  if(vocalRestsOmitted)body={...(body as object),params:{...(body as {params:object}).params,abc:input.abc?.trim(),omit_vocal_rests:true}};
  const id=randomUUID().replaceAll('-',''),record:RecordJob={job:{id,kind:'create',status:'queued',title:input.title,created_at:new Date().toISOString()},directory:state.directory,input:structuredClone(input),vocalRestsOmitted};
  this.records.set(id,record);this.save();const controller=new AbortController();
  const done=this.resources.run({id,engine:'yue2',signal:controller.signal,demand:this.resources.estimate('yue2',{...input,...generationWithEnding(input),context,resourceProfile:this.engine.resourceProfile()}),onState:resource=>{record.job.resource=resource;record.job.stage=resource.message??resource.stage;this.save();},execute:async execution=>{
   await this.engine.activate(execution);execution.signal.throwIfAborted();execution.running();
   // POST is intentionally not retried: a lost response may already have created an upstream job.
   let upstream=await this.request('jobs',body,execution.signal);record.upstreamId=upstream.id;if(record.input?.seed===undefined&&Number.isSafeInteger(upstream.seed))record.input!.seed=upstream.seed as number;record.checkedAt=Date.now();this.save();
   for(;;){execution.signal.throwIfAborted();if(['done','failed','cancelled'].includes(upstream.status))break;const next={...upstream,id,resource:record.job.resource};if(JSON.stringify(next)!==JSON.stringify(record.job)){record.job=next;this.save();}
    await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(execution.signal.reason);};const timer=setTimeout(()=>{execution.signal.removeEventListener('abort',abort);resolve();},250);execution.signal.addEventListener('abort',abort,{once:true});});
    upstream=await this.request('jobs/'+record.upstreamId,undefined,execution.signal);record.checkedAt=Date.now();
   }
   if(upstream.status==='done'){await this.seal(record);const songRoot=dirname(dirname(this.artifactPath(record,'audio.flac')));const truncated=readTruncation(join(songRoot,'summary.json'));if(truncated)upstream.truncated=truncated;const durationCheck=readDurationCheck(join(songRoot,'duration.json'));if(durationCheck)upstream.durationCheck=durationCheck;}return upstream;
  }}).then(upstream=>{
   if(upstream.status==='done'&&this.objects)record.archive={namespace:this.objects.namespace,ready:false};
   const next={...upstream,id,resource:record.job.resource};if(JSON.stringify(next)!==JSON.stringify(record.job)){record.job=next;this.save();}
   if(record.archive&&!record.archive.ready)void this.retryArchives();
  }).catch(error=>{record.job.status=controller.signal.aborted?'cancelled':'failed';record.job.error=error instanceof Error?error.message:String(error);this.save();}).finally(()=>this.tasks.delete(id));
  this.tasks.set(id,{controller,done,resumeFrom});return this.result(record);
 }
 async job(id:string){await this.migrate();return this.result(this.record(id));}
 async list(){await this.migrate();return {jobs:[...this.records.values()].reverse().slice(0,30).map(r=>this.publicJob(r))};}
 async cancel(id:string){const record=this.record(id),task=this.tasks.get(id);if(task){task.controller.abort();await task.done;}return this.result(record);}
 async audio(id:string,signal?:AbortSignal){
  await this.migrate();const record=this.record(id);this.playable(record);
  const digest=this.digest(record),path=this.localAudio(record);
  if(!path){
   if(!record.archive?.ready)throw new ServiceError('NOT_FOUND','音乐音频不存在');
   return this.objectStore(record).read(this.objectKey(record),digest,signal);
  }
  const bytes=readAudioFile(path,musicAudioLimit,digest.bytes);
  if(bytes.length!==digest.bytes||createHash('sha256').update(bytes).digest('hex')!==digest.hash)throw new ServiceError('INVALID_AUDIO','音乐音频校验失败');
  return new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 }
 async score(id:string){
  await this.migrate();const record=this.record(id);this.playable(record);
  const path=this.artifactPath(record,'score.abc');
  if(!existsSync(path))throw new ServiceError('NOT_FOUND','此版本没有保存 ABC 乐谱');
  const effective=new TextDecoder('utf-8',{fatal:true}).decode(readAudioFile(path,musicInputLimits.abc*4));
  // Score edits use the native two-voice source. The model-side score remains in the engine artifacts.
  return record.vocalRestsOmitted?record.input?.abc??effective:effective;
 }
 async purge(id:string,removeLocal:(directory:string,id:string)=>void){
  await this.migrate();const record=this.record(id);
  if(record.purged)return;
  if(this.tasks.has(id)||[...this.tasks.values()].some(t=>t.resumeFrom===id))throw new ServiceError('YUE2_BUSY','恢复生成仍在使用此版本，请先取消或等待完成');
  record.purgePending=true;this.save();
  if(!record.sharedArtifacts){
   await this.archives.get(id)?.catch(()=>{});
   if(record.archive)await this.objectStore(record).remove(this.objectKey(record));
   if(!record.archive?.ready||lstatSync(record.directory,{throwIfNoEntry:false}))removeLocal(record.directory,record.upstreamId??id);
  }
  record.purged=true;
  try{this.save();}catch(error){record.purged=false;throw error;}
 }
 async stop(){for(const task of this.tasks.values())task.controller.abort();await Promise.all([...this.tasks.values()].map(t=>t.done));}
 async close(){this.closed=true;clearInterval(this.archiveTimer);this.archiveStop.abort();await this.stop();await Promise.allSettled(this.archives.values());}
}
