import {mkdirSync,existsSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {extname} from 'node:path';
import {ProjectStore,ServiceError,hash,identity} from '../projects/store.ts';
import {wavInfo} from '../tts/speech.ts';
export type ConversionPhase='preparing'|'separation'|'conversion'|'mixing'|'complete';
export type ConversionDriver={status:()=>{ready:boolean;message:string};run:(directory:string,progress:(phase:ConversionPhase,stage:string,progress:number)=>void,signal:AbortSignal)=>Promise<{duration:number}>};
type AudioKind='original'|'source'|'converted'|'vocals';
type Artifact={sha256:string;bytes:number};
export type ConversionJob={id:string;requestId:string;name:string;extension:string;voiceId:string;voiceName:string;sourceSha256:string;referenceSha256:string;state:'queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';phase:ConversionPhase;stage:string;progress:number;createdAt:string;duration?:number;error?:string;artifacts?:Partial<Record<AudioKind,Artifact>>};
type Data={format:'music-room-conversion';version:1;jobs:ConversionJob[]};
export const conversionUploadLimit=200*1024*1024;
const extensions=new Set(['.wav','.mp3','.m4a','.flac','.aif','.aiff','.aac']);
/** Each job owns immutable input and reference copies; changing a library voice cannot change an existing job. */
export class ConversionService {
 private store:ProjectStore;private driver:ConversionDriver;private data:Data;private otherEngineBusy:()=>boolean;
 private constructor(store:ProjectStore,driver:ConversionDriver,data:Data,otherEngineBusy:()=>boolean){this.store=store;this.driver=driver;this.data=data;this.otherEngineBusy=otherEngineBusy;}
 private active?:{id:string;controller:AbortController;done:Promise<void>};private closing=false;private timer?:ReturnType<typeof setTimeout>;
 static open(store:ProjectStore,driver:ConversionDriver,otherEngineBusy=()=>false){
  mkdirSync(store.path('conversion'),{recursive:true});const file=store.path('conversion','library.json');
  const data:Data=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{format:'music-room-conversion',version:1,jobs:[]};
  if(data.format!=='music-room-conversion'||data.version!==1||!Array.isArray(data.jobs))throw new ServiceError('CORRUPT_CONVERSION','音色转换记录损坏');
  for(const job of data.jobs){identity(job.id);if(!extensions.has(job.extension))throw new ServiceError('CORRUPT_CONVERSION','音色转换文件记录无效');if(['queued','running'].includes(job.state)){job.state='interrupted';job.stage='服务上次已停止，可以重试';}}
  const service=new ConversionService(store,driver,data,otherEngineBusy);
  for(const job of data.jobs)if(job.state==='succeeded'){try{for(const kind of ['source','converted','vocals'] as const){if(!job.artifacts?.[kind])throw Error('缺少音频校验记录');service.audio(job.id,kind);}}catch{job.state='failed';job.stage='保存的音频不可用，可以重试';job.error='保存的音频缺失或发生外部修改，请重试';}}
  service.persist();return service;
 }
 private persist(){this.store.atomicJSON(this.store.path('conversion','library.json'),this.data);}
 private change<T>(fn:()=>T):T {const before=structuredClone(this.data);try{const result=fn();this.persist();return structuredClone(result);}catch(error){this.data=before;throw error;}}
 private record(id:string){identity(id);const job=this.data.jobs.find(j=>j.id===id);if(!job)throw new ServiceError('NOT_FOUND','转换任务不存在');return job;}
 private directory(id:string){return this.store.path('conversion',identity(id));}
 private path(id:string,name:string){return this.store.path('conversion',identity(id),name);}
 snapshot(){return {status:this.driver.status(),jobs:structuredClone(this.data.jobs)};}
 get(id:string){return structuredClone(this.record(id));}
 isBusy(){return !!this.active||this.data.jobs.some(j=>j.state==='queued');}
 add(name:string,bytes:Uint8Array,voice:{id:string;name:string;audio:Uint8Array},requestId:string){
  if(this.closing)throw new ServiceError('CLOSED','服务正在退出');
  if(typeof name!=='string'||!name.trim()||name.length>240||typeof requestId!=='string'||!requestId||requestId.length>120)throw new ServiceError('INVALID_REQUEST','请提供文件名称和请求标识');
  const extension=extname(name).toLowerCase();if(!extensions.has(extension))throw new ServiceError('INVALID_AUDIO','请选择 WAV、MP3、M4A、FLAC 或 AIFF 音频');
  if(!bytes.length||bytes.length>conversionUploadLimit)throw new ServiceError('TOO_LARGE','音频需大于 0 字节且不超过 200 MiB');
  identity(voice.id);const reference=wavInfo(voice.audio);if(reference.duration<.3||reference.duration>25||reference.peak<.001)throw new ServiceError('INVALID_AUDIO','请选择包含可听见人声的参考音色');
  const sourceSha256=hash(bytes),referenceSha256=hash(voice.audio),existing=this.data.jobs.find(j=>j.requestId===requestId);
  if(existing){if(existing.name!==name||existing.sourceSha256!==sourceSha256||existing.referenceSha256!==referenceSha256||existing.voiceId!==voice.id)throw new ServiceError('CONFLICT','这个请求已使用不同的音频或音色');return structuredClone(existing);}
  if(!this.driver.status().ready)throw new ServiceError('NOT_READY',this.driver.status().message);
  const job:ConversionJob={id:`conversion-${randomUUID()}`,requestId,name,extension,voiceId:voice.id,voiceName:voice.name,sourceSha256,referenceSha256,state:'queued',phase:'preparing',stage:'等待转换',progress:0,createdAt:new Date().toISOString()};
  mkdirSync(this.directory(job.id),{recursive:false,mode:0o700});
  try{writeFileSync(this.path(job.id,'original'+extension),bytes,{flag:'wx',mode:0o600});writeFileSync(this.path(job.id,'reference.wav'),voice.audio,{flag:'wx',mode:0o600});this.store.atomicJSON(this.path(job.id,'meta.json'),{extension});this.change(()=>this.data.jobs.push(job));}
  catch(error){rmSync(this.directory(job.id),{recursive:true,force:true});throw error;}
  this.pump();return this.get(job.id);
 }
 retry(id:string){const job=this.record(id);if(['queued','running','succeeded'].includes(job.state))throw new ServiceError('CONFLICT','仅失败、取消或中断的任务可以重试');return this.add(job.name,this.audio(id,'original'),{id:job.voiceId,name:job.voiceName,audio:this.reference(id)},randomUUID());}
 private reference(id:string){const bytes=new Uint8Array(readFileSync(this.path(id,'reference.wav')));if(hash(bytes)!==this.record(id).referenceSha256)throw new ServiceError('SOURCE_CHANGED','保存的参考音色已发生变化');return bytes;}
 audio(id:string,kind:AudioKind){
  const job=this.record(id);if(!['original','source','converted','vocals'].includes(kind))throw new ServiceError('NOT_FOUND','音频不存在');
  if((kind==='converted'||kind==='vocals')&&job.state!=='succeeded')throw new ServiceError('NOT_READY','转换尚未完成');
  const file=this.path(id,kind==='original'?'original'+job.extension:kind+'.wav');if(!existsSync(file))throw new ServiceError('NOT_FOUND','音频尚未准备好');
  const bytes=new Uint8Array(readFileSync(file)),expected=kind==='original'?job.sourceSha256:job.artifacts?.[kind]?.sha256;
  if(expected&&hash(bytes)!==expected)throw new ServiceError('SOURCE_CHANGED','保存的音频已发生变化');return bytes;
 }
 async cancel(id:string){const job=this.record(id);if(this.active?.id===id){const active=this.active;active.controller.abort(new Error('用户取消转换'));await active.done;}else if(job.state==='queued')this.change(()=>{job.state='cancelled';job.stage='已取消，原音保留';});return this.get(id);}
 private pump(){
  if(this.closing||this.active)return;const next=this.data.jobs.find(j=>j.state==='queued');if(!next)return;
  if(this.otherEngineBusy()){if(next.stage!=='等待其他音频任务完成')this.change(()=>{next.stage='等待其他音频任务完成';});this.timer=setTimeout(()=>this.pump(),1000);this.timer.unref();return;}
  const controller=new AbortController(),id=next.id,active={id,controller,done:Promise.resolve()};this.active=active;
  active.done=Promise.resolve().then(async()=>{
   controller.signal.throwIfAborted();if(this.record(id).state!=='queued')return;this.change(()=>{const j=this.record(id);j.state='running';j.stage='读取完整音频';});this.audio(id,'original');this.reference(id);
   const result=await this.driver.run(this.directory(id),(phase,stage,progress)=>{controller.signal.throwIfAborted();if(!Number.isFinite(progress)||progress<0||progress>1)throw Error('转换进度无效');this.change(()=>Object.assign(this.record(id),{phase,stage,progress}));},controller.signal);
   controller.signal.throwIfAborted();const artifacts:Partial<Record<AudioKind,Artifact>>={};let duration=0;
   for(const name of ['source','converted','vocals'] as const){const bytes=new Uint8Array(readFileSync(this.path(id,name+'.wav'))),info=wavInfo(bytes);if(name==='source')duration=info.duration;else if(Math.abs(info.duration-duration)>1/44100)throw Error('输出长度与原音不一致，未发布不完整结果');artifacts[name]={sha256:hash(bytes),bytes:bytes.length};}
   if(!Number.isFinite(result.duration)||Math.abs(duration-result.duration)>1/44100)throw Error('转换时长验证失败');
   this.change(()=>Object.assign(this.record(id),{state:'succeeded',phase:'complete',stage:'完整音频已保存',progress:1,duration,artifacts}));
  }).catch(error=>{
   const fail=()=>Object.assign(this.record(id),{state:this.closing?'interrupted':controller.signal.aborted?'cancelled':'failed',stage:this.closing?'服务已停止，可以重试':controller.signal.aborted?'已取消，原音保留':'转换失败，原音保留',error:controller.signal.aborted?undefined:String(error?.message??error)});
   try{this.change(fail);}catch{fail();}
  }).finally(()=>{if(this.active===active)this.active=undefined;this.pump();});
 }
 async close(){this.closing=true;if(this.timer)clearTimeout(this.timer);this.active?.controller.abort(new Error('服务关闭'));await this.active?.done;this.change(()=>{for(const j of this.data.jobs)if(j.state==='queued'){j.state='interrupted';j.stage='服务已停止，可以重试';}});}
}
