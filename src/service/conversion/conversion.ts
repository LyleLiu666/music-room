import {checkDisk} from '../resources/installation.ts';
import {readAudioFile,verifyAudioFile} from '../projects/audio-files.ts';
import {userCancelled} from '../resources/contracts.ts';
import type {ResourceCoordinator} from '../resources/coordinator.ts';
import type {ResourceExecution,ResourceTaskState} from '../resources/contracts.ts';
import {mkdirSync,existsSync,readFileSync,writeFileSync,rmSync,statSync,copyFileSync,constants} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {extname} from 'node:path';
import {ProjectStore,ServiceError,hash,identity} from '../projects/store.ts';
import {wavInfo} from '../tts/speech.ts';
export type ConversionPhase='preparing'|'separation'|'conversion'|'mixing'|'complete';
export type ConversionDriver={resourceProfile?:()=>Record<string,unknown>|undefined;status:()=>{ready:boolean;message:string;model?:string;backend?:string;separationModel?:string;directory?:string};run:(directory:string,progress:(phase:ConversionPhase,stage:string,progress:number)=>void,signal:AbortSignal,execution?:ResourceExecution)=>Promise<{duration:number}>};
export type ConversionPageOptions={page?:number;pageSize?:number};
export type ConversionPagination={page:number;pageSize:number;total:number;totalPages:number};
export type ConversionSnapshot={status:ReturnType<ConversionDriver['status']>;jobs:ConversionJob[];pagination?:ConversionPagination};
type AudioKind='original'|'source'|'converted'|'vocals';
type Artifact={sha256:string;bytes:number};
export type ConversionOwner={projectId:string;soundId:string;parentId?:string};
export type ConversionJob={resource?:ResourceTaskState;pitchShiftSemitones?:number;projectId?:string;soundId?:string;parentId?:string;purged?:boolean;id:string;requestId:string;name:string;extension:string;voiceId:string;voiceName:string;sourceSha256:string;referenceSha256:string;state:'queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';phase:ConversionPhase;stage:string;progress:number;createdAt:string;duration?:number;error?:string;artifacts?:Partial<Record<AudioKind,Artifact>>};
type Data={format:'music-room-conversion';version:1;jobs:ConversionJob[]};
export const conversionUploadLimit=200*1024*1024;
const extensions=new Set(['.wav','.mp3','.m4a','.flac','.aif','.aiff','.aac']);
/** Each job owns immutable input and reference copies; changing a library voice cannot change an existing job. */
export class ConversionService {
 private store:ProjectStore;private driver:ConversionDriver;private data:Data;private otherEngineBusy:()=>boolean;
 private constructor(store:ProjectStore,driver:ConversionDriver,data:Data,otherEngineBusy:()=>boolean){this.store=store;this.driver=driver;this.data=data;this.otherEngineBusy=otherEngineBusy;}
 private resources?:ResourceCoordinator;private scheduled=new Map<string,{id:string;controller:AbortController;done:Promise<void>}>();
 private active?:{id:string;controller:AbortController;done:Promise<void>};private closing=false;private timer?:ReturnType<typeof setTimeout>;
 static open(store:ProjectStore,driver:ConversionDriver,otherEngineBusy=()=>false,resources?:ResourceCoordinator){
  mkdirSync(store.path('conversion'),{recursive:true});const file=store.path('conversion','library.json');
  const data:Data=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{format:'music-room-conversion',version:1,jobs:[]};
  if(data.format!=='music-room-conversion'||data.version!==1||!Array.isArray(data.jobs))throw new ServiceError('CORRUPT_CONVERSION','音色转换记录损坏');
  for(const job of data.jobs){job.pitchShiftSemitones??=0;if(!Number.isInteger(job.pitchShiftSemitones)||job.pitchShiftSemitones < -12||job.pitchShiftSemitones > 12)throw new ServiceError('CORRUPT_CONVERSION','移调记录无效');identity(job.id);if(!extensions.has(job.extension))throw new ServiceError('CORRUPT_CONVERSION','音色转换文件记录无效');if(['queued','running'].includes(job.state)){job.state='interrupted';job.stage='服务上次已停止，可以重试';}}
  const service=new ConversionService(store,driver,data,otherEngineBusy);service.resources=resources;resources?.register('conversion',{resident:()=>undefined,unload:async()=>{}});
  for(const job of data.jobs)if(job.state==='succeeded'){try{for(const kind of ['source','converted','vocals'] as const){if(!job.artifacts?.[kind])throw Error('缺少音频校验记录');verifyAudioFile(service.path(job.id,kind+'.wav'),job.artifacts[kind]!.sha256,undefined,job.artifacts[kind]!.bytes);}}catch{job.state='failed';job.stage='保存的音频不可用，可以重试';job.error='保存的音频缺失或发生外部修改，请重试';}}
  service.persist();return service;
 }
 private persist(){this.store.atomicJSON(this.store.path('conversion','library.json'),this.data);}
 private change<T>(fn:()=>T):T {const before=structuredClone(this.data);try{const result=fn();this.persist();return structuredClone(result);}catch(error){this.data=before;throw error;}}
 private record(id:string){identity(id);const job=this.data.jobs.find(j=>j.id===id);if(!job)throw new ServiceError('NOT_FOUND','转换任务不存在');return job;}
 private directory(id:string){return this.store.path('conversion',identity(id));}
 private path(id:string,name:string){return this.store.path('conversion',identity(id),name);}
 snapshot(options:ConversionPageOptions={}):ConversionSnapshot {
  const {page:requestedPage,pageSize=10}=options;
  if(requestedPage!==undefined&&(!Number.isSafeInteger(requestedPage)||requestedPage<1)||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>50)throw new ServiceError('INVALID_REQUEST','页码必须为正整数，每页数量为 1–50');
  const status=this.driver.status();
  if(requestedPage===undefined)return {status,jobs:structuredClone(this.data.jobs)};
  const total=this.data.jobs.length,totalPages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(requestedPage,totalPages);
  const ordered=this.data.jobs.map((job,index)=>({job,index})).sort((a,b)=>b.job.createdAt.localeCompare(a.job.createdAt)||b.index-a.index);
  return {status,jobs:structuredClone(ordered.slice((page-1)*pageSize,page*pageSize).map(item=>item.job)),pagination:{page,pageSize,total,totalPages}};
 }
 get(id:string){return structuredClone(this.record(id));}
 bindOwner(id:string,owner:ConversionOwner){identity(owner.projectId);identity(owner.soundId);const job=this.record(id);if(job.soundId&&(job.soundId!==owner.soundId||job.projectId!==owner.projectId))throw new ServiceError('CONFLICT','转换任务已有所属声音');return this.change(()=>Object.assign(job,owner));}
 purge(id:string){const job=this.record(id);if(this.active?.id===id||['queued','running'].includes(job.state))throw new ServiceError('CONFLICT','请先取消或等待转换完成');this.change(()=>Object.assign(job,{purged:true,name:'已删除音色转换',voiceName:'',artifacts:undefined,state:'cancelled'}));rmSync(this.directory(id),{recursive:true,force:true});}
 isBusy(){return !!this.active||this.data.jobs.some(j=>j.state==='queued');}
 add(name:string,bytes:Uint8Array|{sourceJobId:string},voice:{id:string;name:string;audio:Uint8Array},requestId:string,owner?:ConversionOwner,pitchShiftSemitones=0){
  if(this.closing)throw new ServiceError('CLOSED','服务正在退出');
  if(!Number.isInteger(pitchShiftSemitones)||pitchShiftSemitones < -12||pitchShiftSemitones > 12)throw new ServiceError('INVALID_REQUEST','整体移调必须是 -12 至 12 的整数半音');
  if(typeof name!=='string'||!name.trim()||name.length>240||typeof requestId!=='string'||!requestId||requestId.length>120)throw new ServiceError('INVALID_REQUEST','请提供文件名称和请求标识');
  const extension=extname(name).toLowerCase();if(!extensions.has(extension))throw new ServiceError('INVALID_AUDIO','请选择 WAV、MP3、M4A、FLAC 或 AIFF 音频');
  const source=bytes instanceof Uint8Array?undefined:this.record(bytes.sourceJobId);if(source?.purged)throw new ServiceError('NOT_FOUND','原音已永久删除');const sourcePath=source?this.path(source.id,'original'+source.extension):undefined;const size=sourcePath?statSync(sourcePath).size:(bytes as Uint8Array).length;if(!size||size>conversionUploadLimit)throw new ServiceError('TOO_LARGE','音频需大于 0 字节且不超过 200 MiB');if(sourcePath)verifyAudioFile(sourcePath,source!.sourceSha256,conversionUploadLimit,size);
  if(owner){identity(owner.soundId);this.store.assertActive(owner.projectId);if(owner.parentId)identity(owner.parentId);}
  identity(voice.id);const reference=wavInfo(voice.audio);if(reference.duration<.3||reference.duration>25||reference.peak<.001)throw new ServiceError('INVALID_AUDIO','请选择包含可听见人声的参考音色');
  const sourceSha256=source?.sourceSha256??hash(bytes as Uint8Array),referenceSha256=hash(voice.audio),existing=this.data.jobs.find(j=>j.requestId===requestId);
  if(existing){if((existing.pitchShiftSemitones??0)!==pitchShiftSemitones)throw new ServiceError('CONFLICT','这个请求已使用不同的移调参数');if(existing.purged)throw new ServiceError('NOT_FOUND','原转换已永久删除');if(existing.soundId!==owner?.soundId||existing.projectId!==owner?.projectId||existing.parentId!==owner?.parentId)throw new ServiceError('CONFLICT','请求已有不同所属声音');if(existing.name!==name||existing.sourceSha256!==sourceSha256||existing.referenceSha256!==referenceSha256||existing.voiceId!==voice.id)throw new ServiceError('CONFLICT','这个请求已使用不同的音频或音色');return structuredClone(existing);}
  if(!this.driver.status().ready)throw new ServiceError('NOT_READY',this.driver.status().message);
  const job:ConversionJob={...owner,pitchShiftSemitones,id:`conversion-${randomUUID()}`,requestId,name,extension,voiceId:voice.id,voiceName:voice.name,sourceSha256,referenceSha256,state:'queued',phase:'preparing',stage:'等待转换',progress:0,createdAt:new Date().toISOString()};
  checkDisk(this.store.root,size+voice.audio.length);mkdirSync(this.directory(job.id),{recursive:false,mode:0o700});
  try{if(sourcePath){copyFileSync(sourcePath,this.path(job.id,'original'+extension),constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);verifyAudioFile(this.path(job.id,'original'+extension),sourceSha256,conversionUploadLimit,size);}else writeFileSync(this.path(job.id,'original'+extension),bytes as Uint8Array,{flag:'wx',mode:0o600});writeFileSync(this.path(job.id,'reference.wav'),voice.audio,{flag:'wx',mode:0o600});this.store.atomicJSON(this.path(job.id,'meta.json'),{extension,pitchShiftSemitones});this.change(()=>this.data.jobs.push(job));}
  catch(error){rmSync(this.directory(job.id),{recursive:true,force:true});throw error;}
  this.pump();return this.get(job.id);
 }
 retry(id:string){const job=this.record(id);if(job.purged)throw new ServiceError('NOT_FOUND','转换已永久删除');if(['queued','running','succeeded'].includes(job.state))throw new ServiceError('CONFLICT','仅失败、取消或中断的任务可以重试');return this.add(job.name,{sourceJobId:id},{id:job.voiceId,name:job.voiceName,audio:this.reference(id)},randomUUID(),job.soundId&&job.projectId?{soundId:job.soundId,projectId:job.projectId,parentId:job.id}:undefined,job.pitchShiftSemitones??0);}
 private reference(id:string){const bytes=readAudioFile(this.path(id,'reference.wav'),10*2**20);if(hash(bytes)!==this.record(id).referenceSha256)throw new ServiceError('SOURCE_CHANGED','保存的参考音色已发生变化');return new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
 audio(id:string,kind:AudioKind){
  const job=this.record(id);if(job.purged)throw new ServiceError('NOT_FOUND','转换已永久删除');if(!['original','source','converted','vocals'].includes(kind))throw new ServiceError('NOT_FOUND','音频不存在');
  if((kind==='converted'||kind==='vocals')&&job.state!=='succeeded')throw new ServiceError('NOT_READY','转换尚未完成');
  const file=this.path(id,kind==='original'?'original'+job.extension:kind+'.wav');if(!existsSync(file))throw new ServiceError('NOT_FOUND','音频尚未准备好');
  const bytes=readAudioFile(file,kind==='original'?conversionUploadLimit:undefined,job.artifacts?.[kind]?.bytes),expected=kind==='original'?job.sourceSha256:job.artifacts?.[kind]?.sha256;
  if(expected&&hash(bytes)!==expected)throw new ServiceError('SOURCE_CHANGED','保存的音频已发生变化');return new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 }
 async cancel(id:string){const job=this.record(id);if(this.scheduled.has(id)){const active=this.scheduled.get(id)!;active.controller.abort(new Error('用户取消转换'));await active.done;}else if(job.state==='queued')this.change(()=>{job.state='cancelled';job.stage='已取消，原音保留';});return this.get(id);}
 private pump(){
  if(this.closing||this.active&&!this.resources)return;const next=this.data.jobs.find(j=>j.state==='queued'&&!this.scheduled.has(j.id));if(!next)return;
  if(!this.resources&&this.otherEngineBusy()){if(next.stage!=='等待其他音频任务完成')this.change(()=>{next.stage='等待其他音频任务完成';});this.timer=setTimeout(()=>this.pump(),1000);this.timer.unref();return;}
  const controller=new AbortController(),id=next.id,active={id,controller,done:Promise.resolve()};this.active=active;this.scheduled.set(id,active);
  let prepared:{duration:number;artifacts:Partial<Record<AudioKind,Artifact>>}|undefined;const execute=async(execution?:ResourceExecution)=>{
   controller.signal.throwIfAborted();if(this.record(id).state!=='queued')return;this.change(()=>{const j=this.record(id);j.state='running';j.stage='读取完整音频';});verifyAudioFile(this.path(id,'original'+this.record(id).extension),this.record(id).sourceSha256,conversionUploadLimit);this.reference(id);
   const result=await this.driver.run(this.directory(id),(phase,stage,progress)=>{controller.signal.throwIfAborted();if(!Number.isFinite(progress)||progress<0||progress>1)throw Error('转换进度无效');this.change(()=>Object.assign(this.record(id),{phase,stage,progress}));},controller.signal,execution);
   controller.signal.throwIfAborted();const artifacts:Partial<Record<AudioKind,Artifact>>={};let duration=0;
   for(const name of ['source','converted','vocals'] as const){const bytes=readAudioFile(this.path(id,name+'.wav')),info=wavInfo(bytes);if(name==='source')duration=info.duration;else if(Math.abs(info.duration-duration)>1/44100)throw Error('输出长度与原音不一致，未发布不完整结果');artifacts[name]={sha256:hash(bytes),bytes:bytes.length};}
   if(!Number.isFinite(result.duration)||Math.abs(duration-result.duration)>1/44100)throw Error('转换时长验证失败');
   prepared={duration,artifacts};
  };
  const run=()=>this.resources?this.resources.run({
   id,engine:'conversion',demand:this.resources.estimate('conversion',{...this.record(id),resourceProfile:this.driver.resourceProfile?.()}),signal:controller.signal,
   execute:async execution=>{
    const abort=()=>controller.abort(execution.signal.reason);
    execution.signal.addEventListener('abort',abort,{once:true});
    try{execution.signal.throwIfAborted();execution.running();await execute(execution);}
    finally{execution.signal.removeEventListener('abort',abort);}
   },
   onState:resource=>this.change(()=>{
    const j=this.record(id);j.resource=resource;
    if(resource.stage==='waiting_resources')j.stage=resource.message??'等待资源';
   }),
  }):execute();
  active.done=Promise.resolve().then(run).then(()=>{controller.signal.throwIfAborted();if(prepared)this.change(()=>Object.assign(this.record(id),{state:'succeeded',phase:'complete',stage:'完整音频已保存',progress:1,...prepared}));}).catch(error=>{
   const fail=()=>Object.assign(this.record(id),{state:this.closing?'interrupted':userCancelled(controller.signal)?'cancelled':'failed',stage:this.closing?'服务已停止，可以重试':userCancelled(controller.signal)?'已取消，原音保留':'转换失败，原音保留',error:userCancelled(controller.signal)?undefined:String(error?.message??error)});
   try{this.change(fail);}catch{fail();}
  }).finally(()=>{this.scheduled.delete(id);if(this.active===active)this.active=undefined;this.pump();});if(this.resources)this.pump();
 }
 async close(){this.closing=true;if(this.timer)clearTimeout(this.timer);const tasks=[...this.scheduled.values()];for(const a of tasks)a.controller.abort(new Error('服务关闭'));await Promise.all(tasks.map(a=>a.done));this.change(()=>{for(const j of this.data.jobs)if(j.state==='queued'){j.state='interrupted';j.stage='服务已停止，可以重试';}});}
}
