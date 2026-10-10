import {ConversionService,type ConversionDriver} from './conversion/conversion.ts';
import {createNativeConversionDriver} from './conversion/native.ts';
import {StudioService} from './studio/studio.ts';
import {SpeechService,type SpeechDriver} from './tts/speech.ts';
import {createSpeechDriver} from './tts/runtime.ts';
import {ProjectStore,ServiceError} from './projects/store.ts';
import {JobManager} from './jobs/jobs.ts';
import {validateComposition} from '../music/authoring/validate.mjs';
import {buildAuthoringPrompt} from '../music/authoring/prompt.ts';
import {SONGS} from '../catalog.ts';
import type {AssetReader} from './render/renderer.ts';
import type {Renderer} from './render/process.ts';
import {YuE2Engine,type YuE2Driver} from './yue2/engine.ts';
import {createYuE2Driver} from './yue2/runtime.ts';
import {YuE2Client} from './yue2/client.ts';
import {parseOperation,type Operation,type OperationInput,type OperationArgs,type OperationResults,type OperationHandlers,type ServiceCaller} from './operations.ts';
export type {ServiceCaller} from './operations.ts';
export class MusicService {
  store:ProjectStore; jobs:JobManager; read:AssetReader;yue2:YuE2Engine;yue2Client:YuE2Client;speech:SpeechService;studio:StudioService;conversion:ConversionService;
  private constructor(store:ProjectStore,jobs:JobManager,read:AssetReader,yue2:YuE2Engine,speech:SpeechService,conversion:ConversionService) {this.conversion=conversion;this.speech=speech;this.store=store;this.jobs=jobs;this.read=read;this.yue2=yue2;this.yue2Client=new YuE2Client(yue2);this.studio=new StudioService(this);}
  static async open(root:string,renderer:Renderer,read:AssetReader,seed=true,driver:YuE2Driver=createYuE2Driver(read),speechDriver:SpeechDriver=createSpeechDriver(),conversionDriver?:ConversionDriver) {
    const store=await ProjectStore.open(root);
    let jobs:JobManager|undefined,yue2:YuE2Engine|undefined,speech:SpeechService|undefined,conversion:ConversionService|undefined;
    try {
      jobs=await JobManager.open(store,renderer);yue2=await YuE2Engine.open(store,driver);
      speech=await SpeechService.open(store,speechDriver,()=>conversion?.isBusy()??false);conversion=ConversionService.open(store,conversionDriver??createNativeConversionDriver(store.path('engines','voice-conversion')),()=>speech!.isBusy());const service=new MusicService(store,jobs,read,yue2,speech,conversion);
      if(seed) {
        const existing=await store.documents(),records=await store.projects(true);
        for(const song of SONGS) if(!existing.some(d=>d.revision.id===song.id)&&!records.some(p=>p.id===song.workId&&(p.deleted||p.purged||p.removedRevisionIds?.includes(song.id)))) {
          await store.importRevision({format:'music-room-score',version:1,work:{id:song.workId,title:song.title},revision:{id:song.id,label:song.edition,englishTitle:song.englishTitle,summary:song.summary,description:song.description,key:song.key},comparisonSections:song.comparisonSections,score:song.compose()});
        }
      }
      return service;
    } catch(error){await conversion?.close();await speech?.close();await yue2?.close();await jobs?.close();await store.close();throw error;}
  }
  private handlers:OperationHandlers = {
    svc_library:async args=>({...this.conversion.snapshot(args),voices:this.speech.conversionVoices()}),svc_create_version:async args=>this.studio.createConversionVersion(args),svc_cancel:async args=>this.studio.cancelConversion(args.jobId),svc_retry:async args=>this.studio.retryConversion(args.jobId),
    studio_update_project:async args=>this.studio.updateProject(args),studio_update_sound:async args=>this.studio.updateSound(args),studio_purge:async args=>this.studio.purge(args),
    studio_save_speed:async args=>this.studio.saveSpeed(args),
    studio_import_score:async args=>this.studio.importScore(args),
    studio_library:async args=>this.studio.snapshot(args),studio_create_sound:async args=>this.studio.createSound(args),studio_generate:async args=>this.studio.generate(args),studio_update_version:async args=>this.studio.update(args),studio_cancel:async args=>this.studio.cancel(args.versionId),studio_render:async args=>this.studio.render(args.versionId),
    tts_status:async()=>this.speech.status(),tts_prepare:async args=>this.speech.prepare(args.directory),tts_cancel_preparation:async()=>this.speech.cancelPreparation(),
    tts_library:async()=>this.speech.snapshot(),tts_add_voice:async args=>this.speech.addVoice(args.name,Buffer.from(args.audioBase64,'base64'),args.cleanup),
    tts_clean_voice:async args=>this.speech.cleanVoice(args.voiceId),tts_update_voice:async args=>this.speech.updateVoice(args.voiceId,args),
    tts_create_sound:async args=>this.speech.createSound(args.projectId,args.title),tts_generate:async args=>this.speech.generate(args),
    tts_get_version:async args=>this.speech.job(args.versionId),tts_cancel:async args=>this.speech.cancel(args.versionId),tts_update_version:async args=>this.speech.updateVersion(args.versionId,args),
    yue2_status:async()=>this.yue2.status(),yue2_choose_directory:async()=>this.yue2.chooseDirectory(),
    prepare_yue2:async args=>this.yue2.prepare(args.directory,args.downloadModels),start_yue2:async()=>this.yue2.start(),stop_yue2:async()=>this.yue2.stop(),
    yue2_generate:async args=>this.yue2Client.generate(args),yue2_get_job:async args=>this.yue2Client.job(args.jobId),yue2_cancel_job:async args=>this.yue2Client.cancel(args.jobId),yue2_list_jobs:async()=>this.yue2Client.list(),
    status:async()=>({name:'Music Room',version:'1.0.0',workspace:this.store.root,engines:[{id:'sample-pcm-v1',available:true},{id:'indextts-2.0',available:this.speech.status().canGenerate},{id:'transcription',available:false},{id:'yue2',available:(await this.yue2.status()).canGenerate}]}),
    list_projects:async()=>({projects:await this.store.projects()}),
    get_project:async args=>({project:await this.store.project(args.projectId),feedback:await this.store.feedback(args.projectId)}),
    create_project:async args=>this.store.createProject(args.projectId,args.title,args.requirements??''),
    validate_score:async args=>({valid:true,composition:validateComposition(args.compositionJson)}),
    import_revision:async args=>this.store.importRevision(args.compositionJson,args.parentId),
    get_revision:async args=>this.store.revision(args.projectId,args.revisionId),
    render_revision:async args=>this.studio.renderRevision({kind:'render-score',...args}),
    list_jobs:async()=>({jobs:this.jobs.list()}),
    get_job:async args=>this.jobs.get(args.jobId),
    cancel_job:async args=>this.jobs.cancel(args.jobId),
    add_feedback:async args=>this.store.addFeedback(args.projectId,args.revisionId,args.text,args.range),
    get_authoring_context:async args=>{
        if(args.revisionId && !args.projectId)throw new ServiceError('INVALID_REQUEST','指定版本时必须同时指定所属项目');
        const project=args.projectId ? await this.store.project(args.projectId):undefined;
        const revisionId=args.revisionId??project?.defaultRevisionId;
        const revision=revisionId&&project?await this.store.revision(project.id,revisionId):undefined;
        if(args.stage==='expand'&&!revision)throw new ServiceError('INVALID_PARENT','扩写需要指定已有项目及版本');
        const example=validateComposition(new TextDecoder().decode(await this.read('authoring-kit/example.json')));
        const prompt=project && args.stage!=='expand' ? `请为已有项目 ${JSON.stringify(project.title)} 先写 ${args.stage==='four'?4:8} 小节的完整器乐乐句。保留下面给定的项目身份，先设计清晰的 riff 与回答、留白和律动，再根据试听反馈扩写。按 guide 与 example 交付 JSON，用新 revision.id；作曲语言不受限。` : buildAuthoringPrompt(args.stage,revision?.composition??example);
        return {project,revision,feedback:project?await this.store.feedback(project.id):[],guide:new TextDecoder().decode(await this.read('authoring-kit/README.md')),example,prompt,
          rules:project?`本次必须沿用 work.id=${project.id}、work.title=${JSON.stringify(project.title)}，新 revision.id 不重复；扩写时 parentId 指定父版。项目创作要求：${project.requirements}`:'先创建项目，再导入其乐谱。作曲语言不受限，服务不执行上传的代码。',
          workflow:['create_project','validate_score','import_revision','render_revision','get_job','add_feedback'],tracks:'melody,piano,rhodes,pluck,flute,strings,bass,kick,snare,hat,cymbal'};
    },
    library:async()=>({projects:await this.store.projects(),documents:await this.store.documents(),jobs:this.jobs.list()}),
  };
  call:ServiceCaller = <K extends Operation>(name:K,args:OperationInput<K>):Promise<OperationResults[K]>=>{
    // The handler and parsed arguments share the same operation key.
    const handler=this.handlers[name] as (args:OperationArgs<K>)=>Promise<OperationResults[K]>;
    return handler(parseOperation(name,args));
  };
  async close() {await this.conversion.close();await this.studio.close();await this.speech.close();await this.yue2.close();await this.jobs.close();await this.store.close();}
}
