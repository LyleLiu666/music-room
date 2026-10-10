import type {ResourceCoordinator} from './resources/coordinator.ts';
import type {ConversionService,ConversionJob} from './conversion/conversion.ts';
import type {StudioService,StudioSound,StudioVersion} from './studio/studio.ts';
import {z} from 'zod';
import {emotionStrengths} from './tts/emotion.ts';
import type {SpeechService,SpeechStatus,SpeechSound,SpeechVersion,SpeechVoice} from './tts/speech.ts';
import {SCORE_ID_PATTERN,TRACK_IDS,type Composition} from '../music/authoring/validate.mjs';
import type {Project,Revision,Feedback,ProjectStore} from './projects/store.ts';
import type {Job} from './jobs/jobs.ts';
import type {YuE2Status} from './yue2/engine.ts';
import {yue2JobId,type YuE2Job,type YuE2JobResult} from './yue2/contracts.ts';
export const id=z.string().regex(SCORE_ID_PATTERN);
const jobId=z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const ref={projectId:id,revisionId:id};
const text=z.string().min(1).max(8000);
const mixSchema=z.object({volume:z.number().optional(),lead:z.enum(['piano','rhodes','flute']).optional(),levels:z.partialRecord(z.enum(TRACK_IDS),z.number()).optional(),muted:z.array(z.enum(TRACK_IDS)).optional(),solo:z.array(z.enum(TRACK_IDS)).optional()}).strict();
export const operations = {
  resource_status:{description:'查看同一服务的硬件、估计预算、实际任务采样、队列、等待原因及模型驻留。查询不会启动模型。',schema:z.object({}).strict()},
  resource_pause:{description:'暂停后续重型任务；当前已取得执行权的任务继续。作品浏览和播放可用。',schema:z.object({}).strict()},
  resource_resume:{description:'恢复后续重型任务调度；每项任务仍需重新检查资源。',schema:z.object({}).strict()},
  resource_cancel:{description:'取消指定资源任务并等待所属处理停止；保留原输入和已完成作品。',schema:z.object({taskId:z.string().min(1).max(200)}).strict()},
  resource_release:{description:'空闲时确认释放模型；有任务时须先完成或取消。',schema:z.object({}).strict()},
  resource_set_limit:{description:'空闲时保存应用内存上限（字节），只能收紧默认安全额度；null 恢复自动管理。不会降低系统保留量。',schema:z.object({memoryBytes:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()}).strict()},
  svc_library:{description:'读取音色转换引擎状态和持久化任务。原音、参考音色与完整转换结果独立保存。',schema:z.object({page:z.number().int().positive().optional(),pageSize:z.number().int().positive().max(50).optional()}).strict()},
  svc_create_version:{description:'使用当前声音版本保存的原音和指定音色新建转换版本。',schema:z.object({pitchShiftSemitones:z.number().int().min(-12).max(12).optional(),soundId:id,sourceJobId:jobId,voiceId:id,requestId:z.string().min(1).max(120)}).strict()},
  svc_cancel:{description:'取消指定音色转换任务，保留原音。',schema:z.object({jobId}).strict()},
  svc_retry:{description:'用原任务保存的音频和参考音色新建重试任务，不覆盖历史结果。',schema:z.object({jobId}).strict()},
  studio_library:{description:'统一读取项目、声音和版本。',schema:z.object({paginateConversions:z.boolean().optional(),includeDeletedConversions:z.boolean().optional(),conversionSoundId:id.optional(),conversionPage:z.number().int().positive().optional(),conversionPageSize:z.number().int().positive().max(50).optional(),selectedVersionId:id.optional()}).strict()},
  studio_create_sound:{description:'在项目内创建音乐片段、完整音乐或语音。',schema:z.object({projectId:id,title:z.string().trim().min(1).max(120),kind:z.enum(['clip','music','speech','conversion'])}).strict()},
  studio_update_project:{description:'项目重命名或移入/恢复回收站；整个层级保持原状态，生成中拒绝删除。',schema:z.object({projectId:id,title:z.string().trim().min(1).max(120).optional(),deleted:z.boolean().optional()}).strict()},
  studio_update_sound:{description:'片段重命名或移入/恢复回收站，保留其版本和成品选择。',schema:z.object({soundId:id,title:z.string().trim().min(1).max(120).optional(),deleted:z.boolean().optional()}).strict()},
  studio_purge:{description:'彻底删除回收站中的项目、片段、版本或音色及其保存文件；不可恢复。',schema:z.object({kind:z.enum(['project','sound','version','voice']),id}).strict()},
  studio_generate:{description:'在指定声音内生成新版本，来源和结果均保存在当前声音。',schema:z.object({soundId:id,text:z.string().trim().min(1).max(8000),voiceId:id.optional(),emotion:z.string().max(2000).optional(),emotionStrength:z.enum(emotionStrengths).optional(),lyrics:z.string().max(16000).optional(),instrumental:z.boolean().optional(),preset:z.enum(['fast','quality']).optional(),parentId:id.optional()}).strict()},
  studio_update_version:{description:'保留灵感、选成品、可恢复删除版本。',schema:z.object({versionId:id,kept:z.boolean().optional(),deleted:z.boolean().optional(),final:z.boolean().optional()}).strict()},
  studio_cancel:{description:'取消指定声音版本的生成任务。',schema:z.object({versionId:id}).strict()},
  studio_import_score:{description:'将 Agent 交付的 JSON 乐谱导入指定声音，新版保留来源，不覆盖旧版。',schema:z.object({soundId:id,compositionJson:z.string().min(1).max(4*1024*1024),parentId:id.optional()}).strict()},
  studio_save_speed:{description:'将已完成音频按指定速度保存为独立新版本，保持音调并保留原版。requestId 用于安全重试。',schema:z.object({versionId:id,rate:z.number().min(.5).max(2).refine(n=>n!==1),requestId:z.string().min(1).max(120)}).strict()},
  studio_save_mix:{description:'将当前乐谱混音保存为同一声音的新版本并后台合成，保留原版与成品选择；requestId 保证重试不重复创建。',schema:z.object({versionId:id,requestId:id,mix:mixSchema}).strict()},
  studio_render:{description:'把已有乐谱合成为试听文件。',schema:z.object({versionId:id}).strict()},
  tts_status:{description:'查看固定的 IndexTTS 2.0 环境、模型准备状态和日志。',schema:z.object({}).strict()},
  tts_prepare:{description:'在专用目录准备 IndexTTS 2.0 推理引擎和固定模型；Apple Silicon 默认使用 audio.cpp F16；后台准备，通过 tts_status 查询。',schema:z.object({directory:z.string().min(1).max(4096).optional()}).strict()},
  tts_cancel_preparation:{description:'取消语音环境准备，保留下载文件以便重试。',schema:z.object({}).strict()},
  tts_library:{description:'读取持久化的参考声音、项目语音及所有语音版本。',schema:z.object({}).strict()},
  tts_add_voice:{description:'保存 0.3–15 秒、16 位 PCM WAV 参考素材，默认在后台提取人声、降噪、去混响；轮询 tts_library 的 voices[].processing，succeeded 后才能生成。已干净素材可 cleanup=false。音色跨项目复用，原音保留。',schema:z.object({name:z.string().min(1).max(120),audioBase64:z.string().min(1).max(4*1024*1024),cleanup:z.boolean().default(true)}).strict()},
  tts_clean_voice:{description:'清理已有音色，旧音色另存清理版以免改变历史版本；失败或中断的清理可重试。轮询 tts_library 查看处理状态。',schema:z.object({voiceId:id}).strict()},
  tts_update_voice:{description:'给已保存音色改名、标记常用或移入/恢复回收站，所有项目共用同一个音色库。',schema:z.object({voiceId:id,name:z.string().trim().min(1).max(120).optional(),favorite:z.boolean().optional(),deleted:z.boolean().optional(),usage:z.enum(['all','conversion']).optional()}).strict()},
  tts_create_sound:{description:'在已有项目中创建一个语音，如片头旁白；后续生成均属于此声音。',schema:z.object({projectId:id,title:z.string().min(1).max(120)}).strict()},
  tts_generate:{description:'使用 IndexTTS 2.0 根据参考人声、正文和可选情绪生成新版本；当前原生档案正文最多 140 字，其他配置须有已验证档案。立即返回版本 id，后台继续执行。',schema:z.object({soundId:id,voiceId:id,text:z.string().trim().min(1).max(8000),emotion:z.string().max(2000).optional(),emotionStrength:z.enum(emotionStrengths).optional(),parentId:id.optional(),seed:z.number().int().min(0).max(0xffffffff).optional()}).strict()},
  tts_get_version:{description:'查询语音版本的真实状态、创作输入和音频校验信息。',schema:z.object({versionId:id}).strict()},
  tts_cancel:{description:'取消排队或生成中的语音版本，停止所属推理进程。',schema:z.object({versionId:id}).strict()},
  tts_update_version:{description:'语音版本保留灵感、选作成品或移入/恢复回收站；删除不会删除后续版本。',schema:z.object({versionId:id,kept:z.boolean().optional(),final:z.boolean().optional(),deleted:z.boolean().optional()}).strict()},
  yue2_status:{description:'查看 YuE2 安装目录、准备进度、日志与真实模型就绪状态。',schema:z.object({}).strict()},
  yue2_choose_directory:{description:'弹出本机文件夹选择窗口，用户指定 YuE2 程序、Python、模型、缓存和产物的统一目录。',schema:z.object({}).strict()},
  prepare_yue2:{description:'在用户指定的空文件夹安装 YuE2 专用环境；生成时按需加载。downloadModels=true 下载约 10GB 权重及器乐适配器；后台运行，用 yue2_status 轮询。',schema:z.object({directory:z.string().min(1).max(4096),downloadModels:z.boolean().default(true)}).strict()},
  start_yue2:{description:'启用已安装的 YuE2；工作台打开时保持空闲，生成时统一申请资源。',schema:z.object({}).strict()},
  stop_yue2:{description:'停止所属 YuE2 及安装下载进程，保留文件；关闭自动启动。',schema:z.object({}).strict()},
  yue2_generate:{description:'使用本地真实 YuE2 模型生成音乐，立即返回 job.id。instrumental 默认 true，自动使用器乐适配器；lyrics 为段落结构（如 [instrumental]），cot=full。用 yue2_get_job 查询，done 后 audioPath 是本机 FLAC。',schema:z.object({style:z.string().min(1).max(8000),lyrics:z.string().min(1).max(16000).default('[instrumental]'),preset:z.enum(['fast','quality']).default('fast'),instrumental:z.boolean().default(true),seed:z.number().int().min(0).max(2147483647).optional(),title:z.string().min(1).max(200).optional()}).strict()},
  yue2_get_job:{description:'查询 YuE2 真实生成状态、失败原因及完成后音频路径。',schema:z.object({jobId:yue2JobId}).strict()},
  yue2_list_jobs:{description:'列出 YuE2 最近 30 个任务，网页重开后仍可查询和试听。',schema:z.object({}).strict()},
  yue2_cancel_job:{description:'取消 YuE2 排队或生成中的指定任务。',schema:z.object({jobId:yue2JobId}).strict()},
  status:{description:'查看本地创作服务、工作目录与引擎可用情况。',schema:z.object({}).strict()},
  list_projects:{description:'列出本地作品项目及每个项目的不可覆盖版本。',schema:z.object({}).strict()},
  get_project:{description:'读取项目版本、创作要求和逐版本听评。',schema:z.object({projectId:id}).strict()},
  create_project:{description:'创建一首作品的本地项目，建议先创作 4/8 小节，满意后扩写。',schema:z.object({projectId:id,title:z.string().min(1).max(120),requirements:text.optional()}).strict()},
  get_authoring_context:{description:'获取独立创作格式、示例、当前乐谱和反馈，不需要应用源码。先读取此工具再写音乐。four/eight 写短句，expand 扩写指定父版。',schema:z.object({projectId:id.optional(),revisionId:id.optional(),stage:z.enum(['four','eight','expand']).default('eight')}).strict()},
  validate_score:{description:'校验 music-room-score v1 JSON 乐谱；不执行作曲源码，不评价音乐审美。',schema:z.object({compositionJson:z.string().min(1).max(4*1024*1024)}).strict()},
  import_revision:{description:'将 JSON 乐谱发布为新版本并写盘；沿用 work.id 扩写，同项目 parentId 保留来源，重复版本不会覆盖。',schema:z.object({compositionJson:z.string().min(1).max(4*1024*1024),parentId:id.optional()}).strict()},
  get_revision:{description:'获取指定版本的原始创作乐谱、父版、原件哈希和已渲染产物。',schema:z.object(ref).strict()},
  render_revision:{description:'在独立后台进程渲染指定版本为 WAV，无需打开网页。立即返回 jobId（字段 id），用 get_job 查询；幂等键防止重传重复渲染。',schema:z.object({...ref,idempotencyKey:z.string().min(1).max(120),mix:mixSchema.optional()}).strict()},
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
export type ResourceStatus=Awaited<ReturnType<ResourceCoordinator['status']>>;
export type OperationResults = {
  resource_status:ResourceStatus;resource_pause:ResourceStatus;resource_resume:ResourceStatus;resource_cancel:ResourceStatus;resource_release:ResourceStatus;resource_set_limit:ResourceStatus;
  svc_library:ReturnType<ConversionService['snapshot']>&{voices:SpeechVoice[]};svc_create_version:ConversionJob;svc_cancel:ConversionJob;svc_retry:ConversionJob;
  studio_update_project:Project;studio_update_sound:StudioSound;studio_purge:{purged:true};
  studio_library:Awaited<ReturnType<StudioService['snapshot']>>;studio_create_sound:StudioSound;studio_generate:StudioVersion;studio_update_version:StudioVersion;studio_cancel:StudioVersion;studio_render:StudioVersion;studio_save_mix:StudioVersion;studio_save_speed:StudioVersion;studio_import_score:StudioVersion;
  tts_status:SpeechStatus;tts_prepare:SpeechStatus;tts_cancel_preparation:SpeechStatus;
  tts_library:ReturnType<SpeechService['snapshot']>;tts_add_voice:SpeechVoice;tts_clean_voice:SpeechVoice;tts_update_voice:SpeechVoice;tts_create_sound:SpeechSound;
  tts_generate:SpeechVersion;tts_get_version:SpeechVersion;tts_cancel:SpeechVersion;tts_update_version:SpeechVersion;
  yue2_status:YuE2Status;yue2_choose_directory:{directory?:string};prepare_yue2:YuE2Status;start_yue2:YuE2Status;stop_yue2:YuE2Status;
  yue2_generate:YuE2JobResult;yue2_get_job:YuE2JobResult;yue2_cancel_job:YuE2JobResult;yue2_list_jobs:{jobs:YuE2Job[]};
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
