import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {ProjectStore,ServiceError,identity,hash,type Artifact} from '../projects/store.ts';
import {validateMix,type RenderMix} from '../render/renderer.ts';
import type {Renderer,RenderResult,RenderSnapshot} from '../render/process.ts';
export type JobRequest = {kind:'render-score';projectId:string;revisionId:string;mix?:Partial<RenderMix>;idempotencyKey:string};
type State = 'queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';
export type Job = {id:string;request:JobRequest;fingerprint:string;state:State;stage:string;createdAt:string;updatedAt:string;inputHash:string;error?:string;artifact?:Artifact;result?:Omit<RenderResult,'wav'>};
type StoredJob = Job & {snapshot:RenderSnapshot};
const terminal = (s:State)=>['succeeded','failed','cancelled','interrupted'].includes(s);
export class JobManager {
  private jobs=new Map<string,StoredJob>();
  private active?:{job:StoredJob;cancel:()=>void;done:Promise<void>;cancelled:boolean;committing:boolean};
  private pending: Promise<unknown>=Promise.resolve();
  private closing=false;
  private store: ProjectStore;
  private renderer: Renderer;
  private constructor(store:ProjectStore,renderer:Renderer) {
    this.store=store;this.renderer=renderer;
  }
  static async open(store:ProjectStore,renderer:Renderer) {
    const manager=new JobManager(store,renderer);
    for(const file of readdirSync(store.path('jobs')).filter(x=>x.endsWith('.json'))) {
      const j=JSON.parse(readFileSync(store.path('jobs',file),'utf8')) as StoredJob;
      if (`${identity(j.id)}.json`!==file || !['queued','running','succeeded','failed','cancelled','interrupted'].includes(j.state)) throw new ServiceError('CORRUPT_JOB','任务记录无效');
      const previous=JSON.stringify(j);
      // The revision manifest is the commit receipt. An orphan WAV alone is not success.
      if(j.state!=='cancelled') {
        try {
          const {metadata}=await store.revision(j.request.projectId,j.request.revisionId);
          if(metadata.sha256!==j.inputHash)throw new Error('任务输入与版本原件不一致');
          const committed=metadata.artifacts.find(a=>a.id===j.id);
          if(committed) {
            const {metadata:artifact}=await store.artifact(j.request.projectId,j.request.revisionId,j.id);
            if(artifact.jobId!==j.id || artifact.mime!=='audio/wav')throw new Error('音频产物与任务不一致');
            j.artifact=artifact;j.state='succeeded';j.stage='音频已保存';delete j.error;
          } else if(j.state==='succeeded' || j.artifact)throw new Error('已完成任务缺少音频提交记录');
          else if(!terminal(j.state)){j.state='interrupted';j.stage='服务重启，任务已中断';}
        } catch(error) {
          j.state='failed';j.stage='音频恢复校验失败';j.error=error instanceof Error?error.message:String(error);delete j.artifact;delete j.result;
        }
      }
      if(JSON.stringify(j)!==previous)manager.save(j);
      manager.jobs.set(j.id,j);
    }
    return manager;
  }
  private save(job:StoredJob) { job.updatedAt=new Date().toISOString();this.store.atomicJSON(this.store.path('jobs',`${job.id}.json`),job); }
  private public(job:StoredJob):Job {const {snapshot,...value}=job;return structuredClone(value);}
  get(id:string) { const j=this.jobs.get(identity(id));if(!j)throw new ServiceError('NOT_FOUND','任务不存在');return this.public(j); }
  list() {return [...this.jobs.values()].map(j=>this.public(j));}
  async submit(input:JobRequest) {
    const next=this.pending.then(async()=> {
      if(this.closing)throw new ServiceError('CLOSED','服务正在退出');
      if(!input || input.kind!=='render-score' || Object.keys(input).some(k=>!['kind','projectId','revisionId','mix','idempotencyKey'].includes(k)))throw new ServiceError('UNSUPPORTED_JOB','不支持该任务；基础引擎只提供 render-score');
      identity(input.projectId);identity(input.revisionId);
      if(typeof input.idempotencyKey!=='string' || !input.idempotencyKey || input.idempotencyKey.length>120)throw new ServiceError('INVALID_KEY','必须提供 1–120 字符幂等键');
      const mix=validateMix(input.mix),request={kind:input.kind,projectId:input.projectId,revisionId:input.revisionId,idempotencyKey:input.idempotencyKey,mix};
      const fingerprint=hash(JSON.stringify({...request,mix:{...mix,levels:Object.fromEntries(Object.entries(mix.levels).sort()),muted:[...mix.muted].sort(),solo:[...mix.solo].sort()}}));
      const prior=[...this.jobs.values()].find(j=>j.request.idempotencyKey===request.idempotencyKey);
      if(prior) {if(prior.fingerprint!==fingerprint)throw new ServiceError('IDEMPOTENCY_CONFLICT','幂等键已用于不同请求');return this.public(prior);}
      const {metadata,composition}=await this.store.revision(request.projectId,request.revisionId);
      const j:StoredJob={id:`job-${randomUUID()}`,request,fingerprint,state:'queued',stage:'等待渲染',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),inputHash:metadata.sha256,snapshot:{composition,mix}};
      this.save(j);this.jobs.set(j.id,j);queueMicrotask(()=>this.pump());return this.public(j);
    });
    this.pending=next.catch(()=>{});return next;
  }
  private pump() {
    if(this.active || this.closing)return;
    const j=[...this.jobs.values()].find(j=>j.state==='queued');if(!j)return;
    j.state='running';j.stage='启动渲染';
    try {this.save(j);} catch(error){j.state='failed';j.stage='任务状态保存失败';j.error=String(error);queueMicrotask(()=>this.pump());return;}
    const active={job:j,cancel:()=>{},done:Promise.resolve(),cancelled:false,committing:false};this.active=active;
    active.done=(async()=> {
      try {
        const run=this.renderer(j.snapshot,stage=>{if(!active.cancelled && !this.closing){j.stage=stage;this.save(j);}});active.cancel=run.cancel;
        const {wav,...result}=await run.result;
        if(active.cancelled || this.closing)return;
        const bytes=Buffer.from(wav),expected=44+Math.round(j.snapshot.composition.score.duration*44100)*4;
        if(bytes.length!==expected || bytes.toString('ascii',0,4)!=='RIFF' || !Number.isFinite(result.peak) || result.peak<0 || result.peak>.891)throw new Error('音频产物校验失败');
        active.committing=true;j.stage='保存音频';
        j.artifact=await this.store.publishArtifact(j.request.projectId,j.request.revisionId,j.id,wav);
        j.result=result;j.state='succeeded';j.stage='音频已保存';
      } catch(error) {if(!active.cancelled && !this.closing){j.state='failed';j.stage='渲染失败';j.error=error instanceof Error?error.message:String(error);}}
      finally {
        if(this.closing && !j.artifact){j.state='interrupted';j.stage='退出服务，任务中断';}
        else if(active.cancelled){j.state='cancelled';j.stage='已取消';}
        try {this.save(j);}catch(error){
          j.state='failed';j.stage=j.artifact?'音频已保存，任务状态保存失败':'任务状态保存失败';
          j.error=error instanceof Error?error.message:String(error);console.error('任务状态保存失败：',error);
        }
        finally {if(this.active===active)this.active=undefined;queueMicrotask(()=>this.pump());}
      }
    })();
    // A disk failure during terminal status write must not become an unhandled rejection.
    active.done.catch(error=>{console.error('任务执行收尾失败：',error);});
  }
  async cancel(id:string) {
    const j=this.jobs.get(identity(id));if(!j)throw new ServiceError('NOT_FOUND','任务不存在');
    if(terminal(j.state))return this.public(j);
    if(this.active?.job===j){
      const active=this.active;if(active.committing)return this.public(j);
      active.cancelled=true;j.stage='正在取消';let saveError:unknown;
      try{this.save(j);}catch(error){saveError=error;}
      active.cancel();await active.done;if(saveError)throw saveError;
    }
    else {j.state='cancelled';j.stage='已取消';this.save(j);}return this.public(j);
  }
  async wait(id:string,timeoutMs=120000) {
    const start=Date.now();while(!terminal(this.get(id).state)){if(Date.now()-start>timeoutMs)throw new ServiceError('TIMEOUT','任务仍在执行，请继续查询');await new Promise(r=>setTimeout(r,20));}return this.get(id);
  }
  async close() {
    this.closing=true;await this.pending;
    if(this.active){this.active.cancel();await this.active.done;}
    for(const j of this.jobs.values())if(!terminal(j.state)){j.state='interrupted';j.stage='退出服务，任务中断';this.save(j);}
  }
}
