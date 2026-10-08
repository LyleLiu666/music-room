import {z} from 'zod';
import {join} from 'node:path';
import type {YuE2Engine} from './engine.ts';
import {ServiceError} from '../projects/store.ts';
import {yue2JobId,yue2JobSchema as jobSchema,type YuE2JobResult,type YuE2Generate} from './contracts.ts';
export class YuE2Client {
  private engine:YuE2Engine;
  constructor(engine:YuE2Engine){this.engine=engine;}
  private async request(path:string,body?:unknown) {
    const url=await this.engine.endpoint();
    const response=await fetch(url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const value:unknown=await response.json();
    if(!response.ok){const error=z.object({error:z.object({message:z.string()})}).safeParse(value);throw new ServiceError('YUE2_REQUEST_FAILED',error.success?error.data.error.message:`YuE2 请求失败：HTTP ${response.status}`);}return value;
  }
  private async result(value:unknown):Promise<YuE2JobResult>{const {job}=z.object({job:jobSchema}).parse(value),state=await this.engine.status();return {job,audioPath:job.status==='done'&&state.directory?join(state.directory,'data','songs',job.id,'song','audio.flac'):undefined};}
  async generate(args:YuE2Generate){return this.result(await this.request('jobs',{kind:'create',preset:args.preset,params:{style:args.style,lyrics:args.lyrics,cot:'full',seed:args.seed,title:args.title,...(args.instrumental?{cfg_scale:2}:{})},loras:args.instrumental?[{name:'ar_lora_inst_v3abc.bf16',scale:1},{name:'nar_lora_joint_v4.bf16',scale:1}]:[]}));}
  async job(jobId:string){return this.result(await this.request('jobs/'+yue2JobId.parse(jobId)));}
  async cancel(jobId:string){return this.result(await this.request('jobs/'+yue2JobId.parse(jobId)+'/cancel',{}));}
  async list(){const value=z.object({jobs:z.array(jobSchema)}).parse(await this.request('jobs?limit=30'));return value;}
  async audio(jobId:string){const result=await this.job(jobId);if(result.job.status!=='done')throw new ServiceError('YUE2_NOT_READY','音乐还没有生成完成');const url=await this.engine.endpoint(),response=await fetch(`${url}/api/songs/${yue2JobId.parse(jobId)}/audio.flac`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new ServiceError('NOT_FOUND','YuE2 音频不存在');return new Uint8Array(await response.arrayBuffer());}
}
