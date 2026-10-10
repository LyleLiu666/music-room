import {changeAudioSpeed,validateSpeed,type SpeedEdit} from './speed.ts';
import {wavInfo} from '../tts/speech.ts';
import {existsSync,readFileSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {validateComposition} from '../../music/authoring/validate.mjs';
import {ServiceError,hash,identity} from '../projects/store.ts';
import type {MusicService} from '../service.ts';
import type {Project} from '../projects/store.ts';
import type {JobRequest} from '../jobs/jobs.ts';
import type {SpeechVersion} from '../tts/speech.ts';
export type SoundKind='clip'|'music'|'speech';
export type StudioSound={id:string;projectId:string;title:string;kind:SoundKind;createdAt:string;deleted?:boolean;purged?:boolean;finalVersionId?:string;legacyProject?:string};
import type {EmotionStrength} from '../tts/emotion.ts';
export type StudioInput={soundId:string;text:string;voiceId?:string;emotion?:string;emotionStrength?:EmotionStrength;lyrics?:string;instrumental?:boolean;preset?:'fast'|'quality';parentId?:string};
export type StudioVersion={speed?:SpeedEdit;audioHash?:string;id:string;soundId:string;number:number;parentId?:string;createdAt:string;state:SpeechVersion['state'];stage:string;kept:boolean;deleted:boolean;purged?:boolean;purgePending?:boolean;voiceName?:string;error?:string;duration?:number;input?:StudioInput;source:{kind:'speech'|'music'|'score'|'audio';id:string;projectId?:string};audioPath?:string;renderJobId?:string};
type Data={format:'music-room-studio';version:1;sounds:StudioSound[];versions:StudioVersion[]};
const fail=(message:string):never=>{throw new ServiceError('INVALID_STUDIO',message);};
const clone=<T>(v:T):T=>structuredClone(v);
/** Stable ownership and listening decisions. Engine files remain authoritative for audio and task state. */
export class StudioService{
 private data:Data;private pending:Promise<unknown>=Promise.resolve();private yueChecked=0;
 private service:MusicService;
 constructor(service:MusicService){this.service=service;const path=service.store.path('studio.json');this.data=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{format:'music-room-studio',version:1,sounds:[],versions:[]};if(this.data.format!=='music-room-studio'||this.data.version!==1)fail('声音库格式不正确');for(const v of this.data.versions)if(v.source.kind==='music'&&!v.source.id&&v.state==='queued'){v.state='interrupted';v.stage='提交中断，请重新生成';}}
 private async serial<T>(fn:()=>Promise<T>,rollback=true):Promise<T>{const next=this.pending.then(async()=>{const before=clone(this.data);try{const result=await fn();if(JSON.stringify(before)!==JSON.stringify(this.data))this.save();return clone(result);}catch(e){if(rollback)this.data=before;else this.save();throw e;}});this.pending=next.catch(()=>{});return next;}
 private save(){this.service.store.atomicJSON(this.service.store.path('studio.json'),this.data);}
 private sound(id:string){return this.data.sounds.find(s=>s.id===id)??fail('声音不存在');}
 private version(id:string){return this.data.versions.find(v=>v.id===id)??fail('版本不存在');}
 private async sync(){
  const speech=this.service.speech.snapshot(true);
  for(const s of speech.sounds){let target=this.data.sounds.find(x=>x.id===s.id);if(!target){target={...s,kind:'speech'};this.data.sounds.push(target);}Object.assign(target,s);}
  for(const v of speech.versions){const value:StudioVersion={id:v.id,soundId:v.soundId,number:v.number,speed:v.speed,parentId:v.parentId,createdAt:v.createdAt,state:v.state,stage:v.stage,kept:v.kept,deleted:v.deleted,voiceName:v.voiceName,purged:v.purged,purgePending:undefined,error:v.error,duration:v.artifact?.duration,input:{soundId:v.soundId,text:v.text,voiceId:v.voiceId,emotion:v.emotion,emotionStrength:v.emotionStrength,parentId:v.parentId},source:{kind:'speech',id:v.id},audioPath:v.state==='succeeded'?`/speech/audio/${v.id}`:undefined};const old=this.data.versions.find(x=>x.id===v.id);if(old?.purgePending&&!v.purged)continue;if(old)Object.assign(old,value);else this.data.versions.push(value);}
  for(const p of await this.service.store.projects()){
   for(const v of this.data.versions)if(v.source.kind==='score'&&v.source.projectId===p.id&&p.removedRevisionIds?.includes(v.source.id)){v.purged=true;v.purgePending=undefined;v.audioPath=undefined;v.input=undefined;}
   if(!p.revisions.length)continue;
   const unmapped=p.revisions.some(r=>!this.data.versions.some(v=>v.source.kind==='score'&&v.source.id===r.id));
   let s=this.data.sounds.find(x=>x.legacyProject===p.id&&!x.purged&&!x.deleted);if(!s&&unmapped){s={id:`sound-${randomUUID()}`,projectId:p.id,title:p.title,kind:'music',createdAt:p.revisions[0].createdAt,legacyProject:p.id};this.data.sounds.push(s);}
   for(const r of p.revisions){let v=this.data.versions.find(x=>x.source.kind==='score'&&x.source.id===r.id);if(!v){const doc=(await this.service.store.revision(p.id,r.id)).composition;v={id:r.id,soundId:s!.id,number:this.data.versions.filter(x=>x.soundId===s!.id).length+1,parentId:r.parentId,createdAt:r.createdAt,state:'succeeded',stage:'已保存乐谱',kept:false,deleted:false,source:{kind:'score',id:r.id,projectId:p.id},duration:doc.score.duration,input:{soundId:s!.id,text:doc.revision.description??doc.revision.summary??''}};this.data.versions.push(v);}
    const artifact=r.artifacts.at(-1);if(artifact){v.audioPath=`/artifacts/${p.id}/${r.id}/${artifact.jobId}`;v.stage='可以试听';}
    if(v.renderJobId){const job=this.service.jobs.get(v.renderJobId);if(job.state==='failed'||job.state==='cancelled'||job.state==='interrupted'){v.error=job.error??job.stage;v.stage='试听文件未完成';v.renderJobId=undefined;}else if(job.state==='succeeded'){v.stage='可以试听';v.renderJobId=undefined;}else v.stage=job.stage;}
   }
  }
  // Polling is bounded; an unavailable model never hides previously saved music.
  if(Date.now()-this.yueChecked>2000){this.yueChecked=Date.now();const status=await this.service.yue2.status();if(status.canGenerate){
   try{const {jobs}=await this.service.yue2Client.list();for(const v of this.data.versions.filter(v=>v.source.kind==='music'&&v.source.id&&['running','queued'].includes(v.state)&&!jobs.some(j=>j.id===v.source.id))){try{jobs.push((await this.service.yue2Client.job(v.source.id)).job);}catch{}}for(const job of jobs){let v=this.data.versions.find(x=>x.source.kind==='music'&&x.source.id===job.id);
    if(!v){const projects=await this.service.store.projects(true);let p=projects.find(p=>!p.deleted&&!p.purged&&(p.id==='imported-music'||p.id.startsWith('imported-music-')));p??=await this.service.store.createProject(projects.some(p=>p.id==='imported-music')?`imported-music-${randomUUID()}`:'imported-music','以前生成的音乐');const s:StudioSound={id:`sound-${randomUUID()}`,projectId:p.id,title:job.title||'未命名音乐',kind:'music',createdAt:new Date().toISOString()};this.data.sounds.push(s);v={id:`version-${randomUUID()}`,soundId:s.id,number:1,createdAt:s.createdAt,state:'queued',stage:'',kept:false,deleted:false,source:{kind:'music',id:job.id}};this.data.versions.push(v);}
    if(v.purged||v.purgePending)continue;v.state=job.status==='done'?'succeeded':job.status;v.stage=({done:'生成完成',running:'正在生成',queued:'排队中',failed:'生成失败',cancelled:'已取消'}[job.status]);v.error=job.error??undefined;if(v.state==='succeeded')v.audioPath=`/yue2-audio/${job.id}`;
   }}catch{/* Keep saved results visible while the engine reconnects. */}
  }}
 }
 private activeSound(id:string){const s=this.sound(id);this.service.store.assertActive(s.projectId);if(s.deleted||s.purged)fail('片段在回收站中，请先恢复片段');return s;}
 private assertIdle(sounds:StudioSound[]){const ids=new Set(sounds.map(s=>s.id)),speech=this.service.speech.snapshot();if(this.data.versions.some(v=>ids.has(v.soundId)&&(['queued','running'].includes(v.state)||!!v.renderJobId))||speech.versions.some(v=>ids.has(v.soundId)&&['queued','running'].includes(v.state))||this.service.jobs.list().some(j=>this.data.versions.some(v=>ids.has(v.soundId)&&v.source.kind==='score'&&v.source.id===j.request.revisionId&&v.source.projectId===j.request.projectId)&&['queued','running'].includes(j.state)))fail('请先取消或等待生成完成，再删除');}
 async updateProject(args:{projectId:string;title?:string;deleted?:boolean}):Promise<Project>{return this.serial(async()=>{await this.sync();const scope=this.data.sounds.filter(s=>s.projectId===args.projectId&&!s.purged);return this.service.store.updateProject(args.projectId,args,()=>{if(args.deleted)this.assertIdle(scope);});});}
 async updateSound(args:{soundId:string;title?:string;deleted?:boolean}){return this.serial(async()=>{await this.sync();const s=this.sound(args.soundId);if(s.purged)fail('片段已彻底删除');const p=await this.service.store.project(s.projectId);if(p.deleted)fail('请先恢复所属项目');if(args.deleted)this.assertIdle([s]);if(s.kind==='speech'){Object.assign(s,this.service.speech.updateSound(s.id,args));}else{if(args.title!==undefined)s.title=args.title;if(args.deleted!==undefined)s.deleted=args.deleted;}return s;});}
 async purge(args:{kind:'project'|'sound'|'version'|'voice';id:string}):Promise<{purged:true}>{return this.serial(async()=>{
  await this.sync();if(args.kind==='voice'){this.service.speech.purgeVoice(args.id);return {purged:true};}
  const project=args.kind==='project'?await this.service.store.project(args.id):undefined;
  const sound=args.kind==='sound'?this.sound(args.id):args.kind==='version'?this.sound(this.version(args.id).soundId):undefined;
  const owner=project??await this.service.store.project(sound!.projectId);
  const target=args.kind==='version'?this.version(args.id):undefined;
  if(!(project?.deleted||sound?.deleted||owner.deleted||target?.deleted))fail('请先移入回收站，再彻底删除');
  const scope=project?this.data.sounds.filter(s=>s.projectId===project.id&&!s.purged):[sound!];if(target){if(['queued','running'].includes(target.state)||target.renderJobId)fail('请先取消或等待生成完成');}else this.assertIdle(scope);
  const versions=target?[target]:this.data.versions.filter(v=>scope.some(s=>s.id===v.soundId)&&!v.purged);
  for(const v of versions){if(v.purged)continue;v.deleted=true;v.purgePending=true;this.save();if(v.source.kind==='speech')this.service.speech.purgeVersion(v.source.id);else if(v.source.kind==='score'){this.service.jobs.purge(v.source.projectId!,v.source.id);await this.service.store.purgeRevision(v.source.projectId!,v.source.id);}else if(v.source.kind==='audio'){const path=this.service.store.path('studio-audio',`${identity(v.id)}.wav`);if(existsSync(path))unlinkSync(path);}else if(v.audioPath)await this.service.yue2Client.purgeAudio(v.source.id);v.purged=true;v.purgePending=undefined;v.deleted=true;v.audioPath=undefined;v.input=undefined;v.error=undefined;const s=this.sound(v.soundId);if(s.finalVersionId===v.id)s.finalVersionId=undefined;this.save();}
  if(!target)for(const s of scope){if(s.kind==='speech')this.service.speech.purgeSound(s.id);s.purged=true;s.deleted=true;s.title='已删除片段';s.finalVersionId=undefined;}
  this.save();if(project){this.service.jobs.purge(project.id);await this.service.store.purgeProject(project.id);}return {purged:true};
 },false);}
 async close(){await this.pending;}
 async snapshot(){return this.serial(async()=>{await this.sync();return {...this.data,sounds:this.data.sounds.filter(s=>!s.purged),versions:this.data.versions.filter(v=>!v.purged),projects:await this.service.store.projects(),voices:this.service.speech.snapshot().voices,engines:{speech:this.service.speech.status(),music:await this.service.yue2.status()}};});}
 async createSound(args:{projectId:string;title:string;kind:SoundKind}){return this.serial(async()=>{this.service.store.assertActive(args.projectId);if(args.kind==='speech'){const s=await this.service.speech.createSound(args.projectId,args.title);const result:StudioSound={...s,kind:'speech'};this.data.sounds.push(result);return result;}const s:StudioSound={...args,id:`sound-${randomUUID()}`,createdAt:new Date().toISOString()};this.data.sounds.push(s);return s;});}
 async generate(args:StudioInput){return this.serial(async()=>{
  await this.sync();const s=this.activeSound(args.soundId);if(args.parentId){const parent=this.version(args.parentId);if(parent.soundId!==s.id||parent.deleted||parent.purged)fail('来源版本必须属于当前声音且未删除');}
  if(s.kind==='speech'){if(!args.voiceId)fail('请选择参考声音');const v=await this.service.speech.generate({soundId:s.id,voiceId:args.voiceId!,text:args.text,emotion:args.emotion,emotionStrength:args.emotionStrength,parentId:args.parentId});await this.sync();return this.version(v.id);}
  if(!(await this.service.yue2.status()).canGenerate)fail('音乐模型尚未就绪，请在设置中准备');
  const v:StudioVersion={id:`version-${randomUUID()}`,soundId:s.id,number:this.data.versions.filter(x=>x.soundId===s.id).length+1,parentId:args.parentId,createdAt:new Date().toISOString(),state:'queued',stage:'正在提交',kept:false,deleted:false,input:clone(args),source:{kind:'music',id:''}};this.data.versions.push(v);this.save();
  try{const {job}=await this.service.yue2Client.generate({style:args.text,lyrics:args.instrumental===false?args.lyrics||'[verse]':args.lyrics||'[instrumental]',preset:args.preset??'fast',instrumental:args.instrumental!==false,title:s.title});v.source.id=job.id;v.state=job.status==='done'?'succeeded':job.status;v.stage=v.state==='succeeded'?'生成完成':'已提交，等待生成';if(v.state==='succeeded')v.audioPath=`/yue2-audio/${job.id}`;}
  catch(e){v.state='failed';v.stage='提交失败';v.error=(e as Error).message;}return v;
 });}
 audio(id:string){
  const v=this.version(identity(id));this.activeSound(v.soundId);
  if(v.source.kind!=='audio'||v.state!=='succeeded'||v.deleted||v.purged)fail('当前版本没有可下载的音频');
  const bytes=new Uint8Array(readFileSync(this.service.store.path('studio-audio',`${v.id}.wav`)));
  if(hash(bytes)!==v.audioHash)fail('已保存音频发生外部修改');return bytes;
 }
 async saveSpeed(args:{versionId:string;rate:number;requestId:string}){let outputPath:string|undefined;try{return await this.serial(async()=>{
  validateSpeed(args.rate);await this.sync();
  const previous=this.data.versions.find(v=>v.speed?.requestId===args.requestId);
  if(previous){if(previous.speed!.sourceVersionId!==args.versionId||previous.speed!.rate!==args.rate)fail('调速请求与上次不一致');this.activeSound(previous.soundId);if(previous.deleted||previous.purged)fail('调速版已删除，请重新发起请求');return previous;}
  const source=this.version(args.versionId);this.activeSound(source.soundId);
  if(source.state!=='succeeded'||!source.audioPath||source.deleted||source.purged)fail('请先选择已完成且未在回收站中的音频');
  let bytes:Uint8Array;
  if(source.source.kind==='speech')bytes=this.service.speech.audio(source.source.id);
  else if(source.source.kind==='audio')bytes=this.audio(source.id);
  else if(source.source.kind==='music')bytes=await this.service.yue2Client.audio(source.source.id);
  else {const revision=await this.service.store.revision(source.source.projectId!,source.source.id),artifact=revision.metadata.artifacts.at(-1);if(!artifact)fail('请先生成试听音频');bytes=(await this.service.store.artifact(source.source.projectId!,source.source.id,artifact!.jobId)).bytes;}
  const edit:SpeedEdit={rate:args.rate,sourceVersionId:source.id,requestId:args.requestId};
  const adjusted=await changeAudioSpeed(bytes,args.rate);
  if(source.source.kind==='speech'){const saved=this.service.speech.saveSpeed(source.id,edit,adjusted,hash(bytes));await this.sync();return this.version(saved.id);}
  const id=`speed-${randomUUID()}`,v:StudioVersion={...source,id,number:Math.max(0,...this.data.versions.filter(v=>v.soundId===source.soundId).map(v=>v.number))+1,parentId:source.id,speed:edit,createdAt:new Date().toISOString(),kept:false,deleted:false,source:{kind:'audio',id},duration:wavInfo(adjusted).duration,audioPath:`/studio-audio/${id}`,audioHash:hash(adjusted)};
  mkdirSync(this.service.store.path('studio-audio'),{recursive:true,mode:0o700});const path=this.service.store.path('studio-audio',`${id}.wav`);
  writeFileSync(path,adjusted,{flag:'wx',mode:0o600});
  outputPath=path;this.data.versions.push(v);return v;
 });}catch(e){if(outputPath&&existsSync(outputPath))unlinkSync(outputPath);throw e;}}
 async update(args:{versionId:string;kept?:boolean;deleted?:boolean;final?:boolean}){return this.serial(async()=>{await this.sync();const v=this.version(args.versionId),s=this.activeSound(v.soundId);if(v.purged)fail('版本已彻底删除');if(v.purgePending)fail('彻底删除尚未完成，请在回收站重试');if(v.renderJobId||['queued','running'].includes(v.state))fail('请先取消生成');if(args.final&&(v.state!=='succeeded'||v.deleted||args.deleted))fail('只能将已完成的版本选为成品');if(v.source.kind==='speech'){this.service.speech.updateVersion(v.source.id,args);await this.sync();return this.version(v.id);}if(args.kept!==undefined)v.kept=args.kept;if(args.deleted!==undefined)v.deleted=args.deleted;if(args.final)s.finalVersionId=v.id;if((args.final===false||v.deleted)&&s.finalVersionId===v.id)s.finalVersionId=undefined;return v;});}
 async cancel(id:string){return this.serial(async()=>{const v=this.version(id);if(v.source.kind==='speech')await this.service.speech.cancel(v.source.id);else if(v.source.kind==='music'){const {job}=await this.service.yue2Client.cancel(v.source.id);v.state=job.status==='done'?'succeeded':job.status;v.stage=v.state==='succeeded'?'生成完成':'已取消';if(v.state==='succeeded')v.audioPath=`/yue2-audio/${job.id}`;}await this.sync();return this.version(id);});}
 async importScore(args:{soundId:string;compositionJson:string;parentId?:string}){return this.serial(async()=>{
  await this.sync();const s=this.activeSound(args.soundId);if(s.kind==='speech')fail('语音不能导入 MIDI 乐谱');if(args.parentId&&(this.version(args.parentId).soundId!==s.id||this.version(args.parentId).deleted||this.version(args.parentId).purged))fail('来源版本必须属于当前声音');
  const p=await this.service.store.project(s.projectId),doc=validateComposition(args.compositionJson);doc.work={id:p.id,title:p.title};doc.score.title=p.title;doc.revision.id=`score-${randomUUID()}`;
  const r=await this.service.store.importRevision(doc);const v:StudioVersion={id:r.id,soundId:s.id,number:this.data.versions.filter(x=>x.soundId===s.id).length+1,parentId:args.parentId,createdAt:r.createdAt,state:'succeeded',stage:'已导入，等待试听',kept:false,deleted:false,source:{kind:'score',id:r.id,projectId:p.id},duration:doc.score.duration,input:{soundId:s.id,text:doc.revision.description??''}};this.data.versions.push(v);return v;
 });}
 async renderRevision(request:JobRequest){return this.serial(async()=>{await this.sync();const v=this.data.versions.find(v=>v.source.kind==='score'&&v.source.id===request.revisionId&&v.source.projectId===request.projectId);if(v){this.activeSound(v.soundId);if(v.deleted||v.purged||v.purgePending)fail('版本在回收站中，请先恢复');}const job=await this.service.jobs.submit(request);if(v&&['queued','running'].includes(job.state))v.renderJobId=job.id;return job;});}
 async render(id:string){return this.serial(async()=>{const v=this.version(id);this.activeSound(v.soundId);if(v.purged||v.deleted||v.source.kind!=='score')fail('此版本无需合成乐谱');if(v.audioPath||v.renderJobId)return v;const job=await this.service.jobs.submit({kind:'render-score',projectId:v.source.projectId!,revisionId:v.source.id,idempotencyKey:randomUUID()});v.renderJobId=job.id;v.error=undefined;v.stage=job.stage;return v;});}
}
