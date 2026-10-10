import type {Composition} from '../music/authoring/validate.mjs';
import type {Mix} from '../audio.ts';
import type {Job} from '../service/jobs/jobs.ts';
import type {Operation,OperationInput,OperationResults} from '../service/operations.ts';
type Bootstrap = {token:string;url:string;workspace:string;mcp:unknown};
export class WorkbenchService {
  bootstrap:Bootstrap;
  constructor(bootstrap:Bootstrap){this.bootstrap=bootstrap;}
  async call<K extends Operation>(name:K,args:OperationInput<K>):Promise<OperationResults[K]> {
    const response=await fetch(`/api/${name}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${this.bootstrap.token}`},body:JSON.stringify(args)});
    const value:unknown=await response.json();if(!response.ok)throw new Error((value as {message?:string}).message??'本地服务请求失败');return value as OperationResults[K];
  }
  async artifact(job:Job) {
    const response=await fetch(`/artifacts/${job.request.projectId}/${job.request.revisionId}/${job.id}`,{headers:{authorization:`Bearer ${this.bootstrap.token}`}});
    if(!response.ok)throw new Error('无法读取后台音频产物');return response.blob();
  }
  render(doc:Composition,mix:Mix) {return this.call('render_revision',{projectId:doc.work.id,revisionId:doc.revision.id,idempotencyKey:crypto.randomUUID(),mix:{volume:mix.volume,lead:mix.lead,levels:{...mix.levels},muted:[...mix.muted],solo:[...mix.solo]}});}
}
const element=document.querySelector('#music-room-service');
export const backend=element?new WorkbenchService(JSON.parse(element.textContent!)):undefined;
