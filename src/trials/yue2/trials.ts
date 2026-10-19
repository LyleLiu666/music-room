import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {scoreOperation} from '../../service/yue2/score.ts';
export {scoreOperation} from '../../service/yue2/score.ts';
import {z} from 'zod';
import {generationWithEnding} from '../../service/yue2/input.ts';
export const inputSchema=z.object({style:z.string().trim().min(1,'请填写音乐描述').max(100000,'音乐描述过长'),lyrics:z.string().min(1,'请填写歌词或段落标签').max(100000,'歌词或段落标签过长'),instrumental:z.boolean(),seed:z.number().int().min(0).max(2147483647),preset:z.enum(['fast','quality'])}).strict();
export type Input=z.infer<typeof inputSchema>;
export type Summary={bpm:number;nominal_duration_seconds:number;sections:{start:string;label:string}[];voices:Record<string,{sounding_notes:number;measures:number;notes:{onset_quarters:string;midi_pitch:number;duration_quarters:string}[];chords:unknown[]}>};
export type Version={id:string;hash:string;abc:string;created:string;label:string;parent?:string;input:Input;summary:Summary;check?:unknown;feedback?:string};
export type Job={id:string;kind:'plan'|'render';status:string;created:string;input:Input;versionId?:string;hash?:string;resultVersion?:string;error?:string;log:string;request:ReturnType<typeof prepareRequest>;progress?:{stage:string;completed?:number;total?:number;unit?:string};summary?:{seconds?:number;truncated?:{abc?:boolean;semantic?:boolean}}};
type Proposal={id:string;parent:string;hash:string;abc:string;kind:string;status:'accepted'|'rejected';error?:string;versionId?:string};
type State={versions:Version[];jobs:Job[];proposals:Proposal[]};
export const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function prepareRequest(raw:Input,abc?:string){const input=inputSchema.parse(raw);return {preset:input.preset,params:{...generationWithEnding({...input,ending:'as-described'}),cot:'full',seed:input.seed,...(abc?{abc}:{}),...(input.instrumental?{cfg_scale:2}:{})},loras:input.instrumental?[{name:'ar_lora_inst_v3abc.bf16',scale:1},{name:'nar_lora_joint_v4.bf16',scale:1}]:[]};}
export class Trials{
 readonly directory:string;private state:State;private controllers=new Map<string,AbortController>();private pending=new Set<Promise<void>>();
 constructor(directory:string){this.directory=directory;mkdirSync(directory,{recursive:true});const path=join(directory,'index.json');this.state=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{versions:[],jobs:[],proposals:[]};
  for(const j of this.state.jobs)if(!['succeeded','failed','cancelled','interrupted'].includes(j.status)){j.status='interrupted';j.error='服务已重启；未自动继续生成';}for(const j of this.state.jobs)if(j.kind==='render'&&j.status==='succeeded'&&!j.summary)this.readSummary(j);this.save();}
 private readSummary(job:Job){const path=join(this.directory,'jobs',job.id,'summary.json');if(existsSync(path)){const s=JSON.parse(readFileSync(path,'utf8'));job.summary={seconds:s.seconds,truncated:s.truncated};}}
 private save(){const path=join(this.directory,'index.json');writeFileSync(path+'.tmp',JSON.stringify(this.state,null,2),{mode:0o600});renameSync(path+'.tmp',path);}
 snapshot(){return structuredClone(this.state);}
 version(id:string,expected?:string){const v=this.state.versions.find(v=>v.id===id);if(!v)throw Error('乐谱版本不存在');if(expected!==undefined&&v.hash!==expected)throw Error('乐谱版本已不匹配，请重新选择');return structuredClone(v);}
 async importScore(abc:string,raw:Input,label='导入乐谱',parent?:string,check?:unknown){
  if(typeof abc!=='string'||!abc.trim()||abc.length>100000)throw Error('乐谱为空或过长');const input=inputSchema.parse(raw);prepareRequest(input);
  const summary=await scoreOperation({op:'inspect',abc}) as Summary;
  const v:Version={id:randomUUID(),hash:hash(abc),abc,input,summary,created:new Date().toISOString(),label,parent,check};
  const path=join(this.directory,'scores',v.id);mkdirSync(path,{recursive:true});writeFileSync(join(path,'score.abc'),abc,{flag:'wx'});writeFileSync(join(path,'version.json'),JSON.stringify(v,null,2),{flag:'wx'});this.state.versions.push(v);this.save();return structuredClone(v);
 }
 async transfer(id:string,expected:string,overlap:'error'|'vocal',style:string){const a=this.version(id,expected);if(!['error','vocal'].includes(overlap))throw Error('重叠处理方式无效');const result=await scoreOperation({op:'transfer',abc:a.abc,overlap});const labels=a.summary.sections.map(s=>'['+s.label+']').join('\n')||'[instrumental]';return this.importScore(result.abc,{...a.input,style,instrumental:true,lyrics:labels},'器乐转换',a.id,result.check);}
 async propose(id:string,expected:string,abc:string,kind:'harmony'|'tempo'){
  const a=this.version(id,expected);if(typeof abc!=='string'||abc.length>100000)throw Error('提案乐谱过长');const p:Proposal={id:randomUUID(),parent:id,hash:expected,abc,kind,status:'rejected'};
  try{const check=await scoreOperation({op:'check',before:a.abc,abc,kind});const b=await this.importScore(abc,a.input,kind==='harmony'?'和弦改谱':'速度改谱',id,check);p.status='accepted';p.versionId=b.id;return b;}
  catch(error){p.error=(error as Error).message;throw error;}finally{this.state.proposals.push(p);this.save();}
 }
 async section(id:string,expected:string,index:number,action:'repeat'|'delete'){const a=this.version(id,expected);const r=await scoreOperation({op:'section',abc:a.abc,lyrics:a.input.lyrics,instrumental:a.input.instrumental,index,action});return this.importScore(r.abc,{...a.input,lyrics:r.lyrics},action==='repeat'?'重复段落':'删除段落',id,r.check);}
 brief(id:string,expected:string,kind:string,instruction:string){const v=this.version(id,expected);if(!['harmony','tempo'].includes(kind)||typeof instruction!=='string'||instruction.length>10000)throw Error('改谱要求无效');return {versionId:v.id,hash:v.hash,operation:kind,instruction,constraints:kind==='harmony'?'仅修改和弦；保持两个声部音高、起音、时值、拍号、速度、调号和段落不变':'仅修改 Q:1/4 的速度；保持音符、和弦、拍号、调号和段落不变',lyrics:v.input.lyrics,abc:v.abc,submit:{method:'POST',path:'/api/proposal',body:{id:v.id,hash:v.hash,kind,abc:'替换为完整修改后 ABC'}},note:'这是交给 AI / LLM 的需求包，导出不代表模型已经执行。可将修改后的 ABC 粘贴回提案框。'};}
 feedback(id:string,value:string){const v=this.state.versions.find(v=>v.id===id);if(!v||!['like','dislike','adopt',''].includes(value))throw Error('反馈无效');v.feedback=value;this.save();}
 start(kind:'plan'|'render',raw:Input,id:string|undefined,expected:string|undefined,runner:(job:Job,path:string,signal:AbortSignal,report:(s:string)=>void,status:(s:string)=>void)=>Promise<void>){
  if(this.controllers.size>=64)throw Error('试用队列已满，请等待或取消任务');
  const input=inputSchema.parse(raw);const v=kind==='render'?this.version(id??'',expected??''):undefined;
  if(v&&(v.input.instrumental!==input.instrumental||v.input.lyrics!==input.lyrics))throw Error('生成方式与歌词必须保持所选乐谱版本的设置');
  const job:Job={id:randomUUID(),kind,status:'queued',input,versionId:v?.id,hash:v?.hash,created:new Date().toISOString(),log:'',request:prepareRequest(input,v?.abc)};
  const path=join(this.directory,'jobs',job.id);mkdirSync(path,{recursive:true});writeFileSync(join(path,'request.json'),JSON.stringify(job,null,2));this.state.jobs.push(job);this.save();const controller=new AbortController();this.controllers.set(job.id,controller);
  let eventBuffer='';
  const report=(line:string)=>{job.log=(job.log+line).slice(-16000);eventBuffer+=line;const lines=eventBuffer.split('\n');eventBuffer=lines.pop()!.slice(-16000);for(const text of lines){try{const event=JSON.parse(text);if(event.type==='stage'&&typeof event.stage==='string'){job.progress={stage:event.stage.slice(0,200),...(Number.isFinite(event.completed)&&event.completed>=0?{completed:event.completed}:{}),...(Number.isFinite(event.total)&&event.total>0?{total:event.total}:{}),unit:typeof event.unit==='string'?event.unit:undefined};}}catch{/* stderr is retained as a log, not a protocol event. */}}this.save();};
  const work=(async()=>{try{await runner(structuredClone(job),path,controller.signal,report,s=>{if(!['succeeded','failed','cancelled'].includes(s)){job.status=s;this.save();}});controller.signal.throwIfAborted();
   if(kind==='plan'){const abc=readFileSync(join(path,'plan','score.abc'),'utf8');const result=await this.importScore(abc,input,'模型写谱');job.resultVersion=result.id;}
   else {const actual=readFileSync(join(path,'song','score.abc'),'utf8');if(hash(actual)!==job.hash)throw Error('生成返回的乐谱与选定版本不一致');if(!existsSync(join(path,'song','audio.flac')))throw Error('缺少音频产物');this.readSummary(job);}
   controller.signal.throwIfAborted();job.status='succeeded';
  }catch(e){job.status=controller.signal.aborted?'cancelled':'failed';job.error=(e as Error).message;}finally{this.controllers.delete(job.id);this.save();}})();
  this.pending.add(work);void work.finally(()=>this.pending.delete(work));return structuredClone(job);
 }
 cancel(id:string){const c=this.controllers.get(id);if(c)c.abort(new Error('用户取消'));else if(!this.state.jobs.some(j=>j.id===id))throw Error('任务不存在');}
 async close(){for(const c of this.controllers.values())c.abort(new Error('服务退出'));await Promise.allSettled(this.pending);}
}
