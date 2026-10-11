import type {Composition} from '../music/authoring/validate.mjs';
import type {Mix} from '../audio.ts';
import type {Job} from '../service/jobs/jobs.ts';
import type {Operation,OperationInput,OperationResults} from '../service/operations.ts';
type Bootstrap = {token:string;url:string;workspace:string;mcp:unknown};
export class WorkbenchService {
  bootstrap:Bootstrap;
  private reconnecting?:Promise<void>;
  private retryAfter=0;
  private connectionError=new Error('本地服务连接失效，正在重新连接，请稍后重试。');
  constructor(bootstrap:Bootstrap){this.bootstrap=bootstrap;}
  private async reconnect(token:string) {
    if(this.bootstrap.token!==token)return;
    if(!this.reconnecting){
      this.reconnecting=(async()=>{
        const response=await fetch('/local-session',{cache:'no-store',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error('无法重新连接本地服务，请刷新页面后重试。');
        const next=await response.json() as Bootstrap;
        if(next.workspace!==this.bootstrap.workspace||next.url!==this.bootstrap.url)throw new Error('本地服务的工作目录或地址已改变，请刷新页面后确认。');
        if(typeof next.token!=='string'||!next.token)throw new Error('无法重新连接本地服务，请刷新页面后重试。');
        this.bootstrap=next;
      })().finally(()=>{this.reconnecting=undefined;});
    }
    await this.reconnecting;
  }
  async request(path:string,init:RequestInit={}) {
    if(Date.now()<this.retryAfter)throw this.connectionError;
    const token=this.bootstrap.token;
    const send=()=>{const headers=new Headers(init.headers);headers.set('authorization',`Bearer ${this.bootstrap.token}`);return fetch(path,{...init,headers});};
    let response=await send();
    // Only a rejected credential proves that the server has not executed the operation.
    if(response.status===401){
      await response.body?.cancel();
      try{
        await this.reconnect(token);
        response=await send();
        if(response.status===401){await response.body?.cancel();throw new Error('本地服务连接失效，正在重新连接，请稍后重试。');}
      }catch(error){
        this.connectionError=error instanceof Error?error:new Error('无法重新连接本地服务');
        this.retryAfter=Date.now()+10000;
        throw this.connectionError;
      }
    }
    return response;
  }
  async call<K extends Operation>(name:K,args:OperationInput<K>):Promise<OperationResults[K]> {
    // Bound background reads, including response-body consumption. Mutations may
    // legitimately take minutes and must never be replayed after an ambiguous timeout.
    const signal=name==='studio_library'||name==='resource_status'||name==='yue2_inspect_input'||name==='yue2_score'?AbortSignal.timeout(10000):undefined;
    try{
      const response=await this.request(`/api/${name}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args),signal});
      const value:unknown=await response.json();if(!response.ok)throw new Error((value as {message?:string}).message??'本地服务请求失败');return value as OperationResults[K];
    }catch(error){
      if(signal?.aborted)throw new Error(name==='yue2_inspect_input'?'输入容量检查超时，请重试':name==='yue2_score'?'读取乐谱超时，请重试':'状态查询超时');
      throw error;
    }
  }
  async artifact(job:Job) {
    const response=await this.request(`/artifacts/${job.request.projectId}/${job.request.revisionId}/${job.id}`);
    if(!response.ok)throw new Error('无法读取后台音频产物');return response.blob();
  }
  render(doc:Composition,mix:Mix) {return this.call('render_revision',{projectId:doc.work.id,revisionId:doc.revision.id,idempotencyKey:crypto.randomUUID(),mix:{volume:mix.volume,lead:mix.lead,levels:{...mix.levels},muted:[...mix.muted],solo:[...mix.solo]}});}
}
const element=typeof document==='undefined'?null:document.querySelector('#music-room-service');
export const backend=element?new WorkbenchService(JSON.parse(element.textContent!)):undefined;
