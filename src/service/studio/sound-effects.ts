import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {randomInt,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ProjectStore,ServiceError,identity} from '../projects/store.ts';
import type {ResourceCoordinator} from '../resources/coordinator.ts';
import type {ResourceExecution,ResourceTaskState} from '../resources/contracts.ts';
import {installTask} from '../resources/installation.ts';
import {SoundLibrary,type EffectSound} from './sound-library.ts';
import {audioShape} from './audio-budget.ts';

export const effectRequest=z.object({requestId:z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),title:z.string().trim().min(1).max(120),prompt:z.string().trim().min(1).max(1000),seconds:z.number().int().min(1).max(5),seed:z.number().int().min(0).max(2147483647).optional(),soundId:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),parentId:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional()}).strict();
export type EffectRequest=z.output<typeof effectRequest>;
export type EffectInput=EffectRequest&{seed:number};
export type EffectDriver={directory?:string;profile:Record<string,unknown>;installed:()=>boolean;prepare:(execution:ResourceExecution,report:(message:string)=>void)=>Promise<void>;generate:(request:EffectInput,execution:ResourceExecution,reportPeak:(bytes:number)=>void)=>Promise<Uint8Array>};
const jobSchema=z.object({id:z.string().regex(/^sfx-[a-f0-9-]{36}$/),request:effectRequest,seed:z.number().int().min(0).max(2147483647),state:z.enum(['queued','running','succeeded','failed','cancelled','interrupted']),message:z.string().max(4000),createdAt:z.string(),processPeakBytes:z.number().int().nonnegative().optional(),resource:z.unknown().optional(),purged:z.boolean().optional()}).strict();
const diskSchema=z.object({format:z.literal('music-room-sound-effects'),version:z.literal(1),jobs:z.array(jobSchema)}).strict();
type EffectRecord=z.infer<typeof jobSchema>;
export type EffectJob=EffectRecord&{item?:EffectSound};
const busy=(job:EffectRecord)=>job.state==='queued'||job.state==='running';
const importKey=(job:EffectRecord)=>job.id;
const shortError=(error:unknown)=>String(error instanceof Error?error.message:error).slice(0,4000);
/** Durable job identities and published recordings are owned here, not by the browser or MCP connection. */
export class SoundEffects{
 private store:ProjectStore;private resources:ResourceCoordinator;private library:SoundLibrary;private driver:EffectDriver;
 private jobs:EffectRecord[];private tasks=new Map<string,{controller:AbortController;done:Promise<void>}>();private closed=false;
 private preparation?:{controller:AbortController;done:Promise<void>};private preparing={state:'idle' as 'idle'|'queued'|'running'|'failed'|'cancelled'|'succeeded',message:''};
 constructor(store:ProjectStore,resources:ResourceCoordinator,library:SoundLibrary,driver:EffectDriver){
  this.store=store;this.resources=resources;this.library=library;this.driver=driver;
  mkdirSync(store.path('sound-effects'),{recursive:true,mode:0o700});const path=store.path('sound-effects','jobs.json');this.jobs=existsSync(path)?diskSchema.parse(JSON.parse(readFileSync(path,'utf8'))).jobs:[];
  for(const job of this.jobs){if(!job.purged&&(busy(job)||job.state==='succeeded')){try{const item=this.findItem(job,true);if(item){job.state='succeeded';job.message='音效已保存到声音库';}else if(job.state==='succeeded'){job.state='failed';job.message='已保存的音效缺失';}else{job.state='interrupted';job.message='服务上次已停止，请重新生成';}}catch{job.state='failed';job.message='已保存的音效缺失或发生变化';}}}
  this.save();resources.register('sound-effects',{resident:()=>undefined,unload:async()=>{}});
 }
 private save(){this.store.atomicJSON(this.store.path('sound-effects','jobs.json'),{format:'music-room-sound-effects',version:1,jobs:this.jobs});}
 private findItem(job:EffectRecord,verify=false):EffectSound|undefined{const item=verify?this.library.verifyRequest(importKey(job)):this.library.findRequest(importKey(job));if(!item)return;if(item.origin!=='sound-effect'||item.title!==job.request.title||item.source.prompt!==job.request.prompt||item.source.seconds!==job.request.seconds||item.source.seed!==job.seed)throw Error('保存的音效与任务输入不一致');return item;}
 private view(job:EffectRecord):EffectJob{const item=!job.purged&&job.state==='succeeded'?this.findItem(job):undefined;return {...structuredClone(job),...(item?{item}:{})};}
 projectJobs(){return this.jobs.filter(job=>!!job.request.soundId).map(job=>this.view(job));}
 projectItemIds(){return new Set(this.jobs.filter(job=>job.request.soundId).map(job=>this.library.findRequest(job.id)?.id).filter((id):id is string=>!!id));}
 projectJobForItem(itemId:string){return this.jobs.find(job=>job.request.soundId&&this.library.findRequest(job.id)?.id===itemId)?.id;}
 audio(id:string){const job=this.jobs.find(j=>j.id===identity(id));if(!job||job.purged||job.state!=='succeeded')throw new ServiceError('NOT_FOUND','音效不存在');const item=this.findItem(job);if(!item)throw new ServiceError('NOT_FOUND','音效文件不存在');return this.library.audioSync(item.id);}
 async purge(id:string){const job=this.jobs.find(j=>j.id===identity(id));if(!job)return;if(busy(job))throw new ServiceError('CONFLICT','请先取消或等待音效生成完成');if(!job.purged){const previous=structuredClone(job);job.purged=true;job.request={...job.request,title:'已删除音效',prompt:'已删除'};job.message='音效已彻底删除';job.resource=undefined;try{this.save();}catch(error){Object.assign(job,previous);throw error;}}await this.library.removeRequest(job.id);}
 status(){return {installed:this.driver.installed(),directory:this.driver.directory,preparation:{...this.preparing},jobs:this.jobs.slice(-50).reverse().map(job=>this.view(job))};}
 get(id:string){identity(id);const job=this.jobs.find(j=>j.id===id);if(!job)throw new ServiceError('NOT_FOUND','音效任务不存在');return this.view(job);}
 prepare(){
  if(this.closed)throw Error('服务正在退出');if(this.preparation||this.driver.installed())return this.status();
  const controller=new AbortController();this.preparing={state:'queued',message:'等待准备音效模型'};
  const done=installTask(this.resources,{id:'install-sound-effects',directory:this.driver.directory??this.store.path('sound-effects'),diskBytes:4_000_000_000,signal:controller.signal,onState:state=>{if(['queued','waiting_resources','loading'].includes(state.stage))this.preparing={state:'queued',message:state.message??'等待准备音效模型'};},execute:async execution=>{this.preparing={state:'running',message:'正在准备音效模型'};await this.driver.prepare(execution,message=>{this.preparing={state:'running',message};});}}).then(()=>{this.preparing={state:'succeeded',message:'音效模型已准备好'};}).catch(error=>{this.preparing={state:controller.signal.aborted?'cancelled':'failed',message:controller.signal.aborted?'已取消准备，已下载文件保留':shortError(error)};}).finally(()=>{this.preparation=undefined;});
  this.preparation={controller,done};return this.status();
 }
 async cancelPreparation(){const task=this.preparation;task?.controller.abort();await task?.done;return this.status();}
 start(input:EffectRequest):EffectJob{
  if(this.closed)throw Error('服务正在退出');const parsed=effectRequest.safeParse(input);if(!parsed.success){const f=parsed.error.issues[0]?.path[0];throw new ServiceError('INVALID_REQUEST',f==='seconds'?'音效时长请选择 1 至 5 秒':f==='prompt'?'请填写有效的音效描述':'音效参数无效');}const request=parsed.data;
  if(request.parentId&&!request.soundId)throw new ServiceError('INVALID_REQUEST','来源版本需要所属声音');
  const previous=this.jobs.find(j=>j.request.requestId===request.requestId);if(previous){if(previous.purged||JSON.stringify(previous.request)!==JSON.stringify(request))throw new ServiceError('CONFLICT','重复请求与原输入不同或原音效已删除');return this.view(previous);}
  if(!this.driver.installed())throw new ServiceError('NOT_READY','请先准备音效模型');
  const job:EffectRecord={id:`sfx-${randomUUID()}`,request,seed:request.seed??randomInt(2147483648),state:'queued',message:'等待生成音效',createdAt:new Date().toISOString()};this.jobs.push(job);try{this.save();}catch(error){this.jobs.pop();throw error;}
  const controller=new AbortController();
  const done=this.resources.run({id:job.id,engine:'sound-effects',demand:this.resources.estimate('sound-effects',{resourceProfile:this.driver.profile,seconds:request.seconds,prompt:request.prompt}),signal:controller.signal,onState:(state:ResourceTaskState)=>{job.resource=state;if(['queued','waiting_resources','loading'].includes(state.stage)){job.state='queued';job.message=state.message??'等待生成音效';}this.save();},execute:async execution=>{
   execution.running();job.state='running';job.message='正在生成音效';this.save();
   const bytes=await this.driver.generate({...request,seed:job.seed},execution,peak=>{if(!Number.isSafeInteger(peak)||peak<0||peak>5_000_000_000)throw Error('音效模型进程内存记录无效或超过 5 GB');job.processPeakBytes=peak;});execution.signal.throwIfAborted();const shape=audioShape(bytes,5);
   if(shape.frames!==shape.rate*request.seconds)throw Error('生成音效的时长与请求不一致');
   await this.library.import({name:`${job.id}.wav`,title:request.title,requestId:importKey(job),bytes,source:{kind:'sound-effect',prompt:request.prompt,seconds:request.seconds,seed:job.seed,model:'Stable Audio 3 Small-SFX'}},execution.signal);
  }}).then(()=>{job.state='succeeded';job.message='音效已保存到声音库';this.save();}).catch(error=>{
   try{const item=this.findItem(job,true);if(item&&!['PEAK_EXCEEDED','PRESSURE_PROTECTION','RESOURCE_TELEMETRY_UNAVAILABLE'].includes(error?.code)){job.state='succeeded';job.message='音效已保存到声音库';}else{job.state=controller.signal.aborted||error?.code==='CANCELLED'?'cancelled':'failed';job.message=job.state==='cancelled'?'已取消音效生成':shortError(error);}this.save();}catch(persistError){job.state='failed';job.message=shortError(persistError);}
  }).finally(()=>this.tasks.delete(job.id));this.tasks.set(job.id,{controller,done});return this.view(job);
 }
 async cancel(id:string){const job=this.jobs.find(j=>j.id===identity(id));if(!job)throw new ServiceError('NOT_FOUND','音效任务不存在');const task=this.tasks.get(id);task?.controller.abort();await task?.done;return this.view(job);}
 async close(){this.closed=true;this.preparation?.controller.abort();for(const task of this.tasks.values())task.controller.abort();await Promise.allSettled([...(this.preparation?[this.preparation.done]:[]),...[...this.tasks.values()].map(t=>t.done)]);}
}
