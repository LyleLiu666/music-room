import {YuE2Proxy} from './proxy.ts';
import type {ProjectStore} from '../projects/store.ts';
import type {ResourceCoordinator} from '../resources/coordinator.ts';
import {z} from 'zod';
import {existsSync,lstatSync,rmSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import type {YuE2Engine} from './engine.ts';
import {ServiceError} from '../projects/store.ts';
import {yue2JobId,yue2JobSchema as jobSchema,type YuE2JobResult,type YuE2Generate} from './contracts.ts';
export class YuE2Client {
  private engine:YuE2Engine;
  private proxy?:YuE2Proxy;
  constructor(engine:YuE2Engine,store?:ProjectStore,resources?:ResourceCoordinator){this.engine=engine;if(store&&resources)this.proxy=new YuE2Proxy(engine,store,resources);}
  private async request(path:string,body?:unknown) {
    const url=await this.engine.endpoint();
    const response=await fetch(url+'/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    const value:unknown=await response.json();
    if(!response.ok){const error=z.object({error:z.object({message:z.string()})}).safeParse(value);throw new ServiceError('YUE2_REQUEST_FAILED',error.success?error.data.error.message:`YuE2 请求失败：HTTP ${response.status}`);}return value;
  }
  private async result(value:unknown):Promise<YuE2JobResult>{const {job}=z.object({job:jobSchema}).parse(value),state=await this.engine.status();return {job,audioPath:job.status==='done'&&state.directory?join(state.directory,'data','songs',job.id,'song','audio.flac'):undefined};}
  async generate(args:YuE2Generate){const body={kind:'create',preset:args.preset,params:{style:args.style,lyrics:args.lyrics,cot:'full',seed:args.seed,title:args.title,...(args.instrumental?{cfg_scale:2}:{})},loras:args.instrumental?[{name:'ar_lora_inst_v3abc.bf16',scale:1},{name:'nar_lora_joint_v4.bf16',scale:1}]:[]};return this.proxy?this.proxy.generate(args,body):this.result(await this.request('jobs',body));}
  async job(jobId:string){if(this.proxy)return this.proxy.job(jobId);return this.result(await this.request('jobs/'+yue2JobId.parse(jobId)));}
  async cancel(jobId:string){if(this.proxy)return this.proxy.cancel(jobId);return this.result(await this.request('jobs/'+yue2JobId.parse(jobId)+'/cancel',{}));}
  async list(){if(this.proxy)return this.proxy.list();const value=z.object({jobs:z.array(jobSchema)}).parse(await this.request('jobs?limit=30'));return value;}
  async purgeAudio(jobId:string){yue2JobId.parse(jobId);const target=await this.proxy?.purgeTarget(jobId);if(target)jobId=target.id;const status=target??await this.engine.status();if(!status.directory)throw new ServiceError('YUE2_UNAVAILABLE','请先指定原音乐引擎目录，以便删除保存的音频');const root=status.directory;if(realpathSync(root)!==root)throw new ServiceError('UNSAFE_PATH','音乐目录不能包含符号链接');
    for(const path of [root,join(root,'data'),join(root,'data','songs'),join(root,'data','songs',jobId)])if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','音频目录不能是符号链接');
    const marker=join(root,'.music-room-yue2.json');if(!existsSync(marker)||lstatSync(marker).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','音乐目录不属于当前引擎');const owner=JSON.parse(readFileSync(marker,'utf8'));if(owner.format!=='music-room-yue2'||owner.version!==1)throw new ServiceError('UNSAFE_PATH','音乐目录不属于当前引擎');
    rmSync(join(root,'data','songs',jobId),{recursive:true,force:true});
  }
  async stop(){await this.proxy?.stop();}
  async close(){await this.proxy?.close();}
  async audio(jobId:string){if(this.proxy)return this.proxy.audio(jobId);const result=await this.job(jobId);if(result.job.status!=='done')throw new ServiceError('YUE2_NOT_READY','音乐还没有生成完成');const url=await this.engine.endpoint(),response=await fetch(`${url}/api/songs/${yue2JobId.parse(jobId)}/audio.flac`,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new ServiceError('NOT_FOUND','YuE2 音频不存在');return new Uint8Array(await response.arrayBuffer());}
}
