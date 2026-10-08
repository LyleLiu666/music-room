import {z} from 'zod';
import {SCORE_ID_PATTERN,TRACK_IDS,type Composition} from '../music/authoring/validate.mjs';
import type {Project,Revision,Feedback,ProjectStore} from './projects/store.ts';
import type {Job} from './jobs/jobs.ts';
export const id=z.string().regex(SCORE_ID_PATTERN);
const jobId=z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const ref={projectId:id,revisionId:id};
const text=z.string().min(1).max(8000);
export const operations = {
  status:{description:'查看本地创作服务、工作目录与引擎可用情况。',schema:z.object({}).strict()},
  list_projects:{description:'列出本地作品项目及每个项目的不可覆盖版本。',schema:z.object({}).strict()},
  get_project:{description:'读取项目版本、创作要求和逐版本听评。',schema:z.object({projectId:id}).strict()},
  create_project:{description:'创建一首作品的本地项目，建议先创作 4/8 小节，满意后扩写。',schema:z.object({projectId:id,title:z.string().min(1).max(120),requirements:text.optional()}).strict()},
  get_authoring_context:{description:'获取独立创作格式、示例、当前乐谱和反馈，不需要应用源码。先读取此工具再写音乐。four/eight 写短句，expand 扩写指定父版。',schema:z.object({projectId:id.optional(),revisionId:id.optional(),stage:z.enum(['four','eight','expand']).default('eight')}).strict()},
  validate_score:{description:'校验 music-room-score v1 JSON 乐谱；不执行作曲源码，不评价音乐审美。',schema:z.object({compositionJson:z.string().min(1).max(4*1024*1024)}).strict()},
  import_revision:{description:'将 JSON 乐谱发布为新版本并写盘；沿用 work.id 扩写，同项目 parentId 保留来源，重复版本不会覆盖。',schema:z.object({compositionJson:z.string().min(1).max(4*1024*1024),parentId:id.optional()}).strict()},
  get_revision:{description:'获取指定版本的原始创作乐谱、父版、原件哈希和已渲染产物。',schema:z.object(ref).strict()},
  render_revision:{description:'在独立后台进程渲染指定版本为 WAV，无需打开网页。立即返回 jobId（字段 id），用 get_job 查询；幂等键防止重传重复渲染。',schema:z.object({...ref,idempotencyKey:z.string().min(1).max(120),mix:z.object({volume:z.number().optional(),lead:z.enum(['piano','rhodes','flute']).optional(),levels:z.partialRecord(z.enum(TRACK_IDS),z.number()).optional(),muted:z.array(z.enum(TRACK_IDS)).optional(),solo:z.array(z.enum(TRACK_IDS)).optional()}).strict().optional()}).strict()},
  list_jobs:{description:'查看后台音乐任务，包括当前阶段、状态、产物和失败原因。',schema:z.object({}).strict()},
  get_job:{description:'查询任务状态。只有 succeeded 才完成写盘；artifact 给出相对路径与 SHA-256，可结合工作目录读取 WAV。',schema:z.object({jobId}).strict()},
  cancel_job:{description:'取消尚未提交产物的排队或运行任务，等待所属计算进程停止，不删除旧版。',schema:z.object({jobId}).strict()},
  add_feedback:{description:'保存对指定版本或秒数片段的听评，agent 下次可据此修改。',schema:z.object({...ref,text,range:z.object({start:z.number(),end:z.number()}).strict().optional()}).strict()},
  library:{description:'网页作品与任务快照。',schema:z.object({}).strict()},
} as const;
export type Operation = keyof typeof operations;
export type OperationInput<K extends Operation> = z.input<(typeof operations)[K]['schema']>;
export type OperationArgs<K extends Operation> = z.output<(typeof operations)[K]['schema']>;
export type RevisionDocument = Awaited<ReturnType<ProjectStore['revision']>>;
export type LibrarySnapshot = {projects:Project[];documents:Composition[];jobs:Job[]};
export type AuthoringContext = {project?:Project;revision?:RevisionDocument;feedback:Feedback[];guide:string;example:Composition;prompt:string;rules:string;workflow:Operation[];tracks:string};
export type OperationResults = {
  status:{name:string;version:string;workspace:string;engines:{id:string;available:boolean}[]};
  list_projects:{projects:Project[]};get_project:{project:Project;feedback:Feedback[]};create_project:Project;
  get_authoring_context:AuthoringContext;validate_score:{valid:true;composition:Composition};
  import_revision:Revision;get_revision:RevisionDocument;render_revision:Job;
  list_jobs:{jobs:Job[]};get_job:Job;cancel_job:Job;add_feedback:Feedback;library:LibrarySnapshot;
};
export type ServiceCaller = <K extends Operation>(name:K,args:OperationInput<K>)=>Promise<OperationResults[K]>;
export type OperationHandlers = {[K in Operation]:(args:OperationArgs<K>)=>Promise<OperationResults[K]>};
export function operationName(name:string):Operation {
  if(!Object.hasOwn(operations,name))throw new Error('操作不存在');
  return name as Operation;
}
export function parseOperation<K extends Operation>(name:K,args:unknown):OperationArgs<K> {
  return operations[operationName(name)].schema.parse(args??{}) as OperationArgs<K>;
}
