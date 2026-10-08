import {ProjectStore,ServiceError} from './projects/store.ts';
import {JobManager} from './jobs/jobs.ts';
import {validateComposition} from '../music/authoring/validate.mjs';
import {buildAuthoringPrompt} from '../music/authoring/prompt.ts';
import {SONGS} from '../catalog.ts';
import type {AssetReader} from './render/renderer.ts';
import type {Renderer} from './render/process.ts';
import {parseOperation,type Operation,type OperationInput,type OperationArgs,type OperationResults,type OperationHandlers,type ServiceCaller} from './operations.ts';
export type {ServiceCaller} from './operations.ts';
export class MusicService {
  store:ProjectStore; jobs:JobManager; read:AssetReader;
  private constructor(store:ProjectStore,jobs:JobManager,read:AssetReader) {this.store=store;this.jobs=jobs;this.read=read;}
  static async open(root:string,renderer:Renderer,read:AssetReader,seed=true) {
    const store=await ProjectStore.open(root);
    try {
      const service=new MusicService(store,await JobManager.open(store,renderer),read);
      if(seed) {
        const existing=await store.documents();
        for(const song of SONGS) if(!existing.some(d=>d.revision.id===song.id)) {
          await store.importRevision({format:'music-room-score',version:1,work:{id:song.workId,title:song.title},revision:{id:song.id,label:song.edition,englishTitle:song.englishTitle,summary:song.summary,description:song.description,key:song.key},comparisonSections:song.comparisonSections,score:song.compose()});
        }
      }
      return service;
    } catch(error){await store.close();throw error;}
  }
  private handlers:OperationHandlers = {
    status:async()=>({name:'Music Room',version:'1.0.0',workspace:this.store.root,engines:[{id:'sample-pcm-v1',available:true},{id:'transcription',available:false},{id:'yue2',available:false}]}),
    list_projects:async()=>({projects:await this.store.projects()}),
    get_project:async args=>({project:await this.store.project(args.projectId),feedback:await this.store.feedback(args.projectId)}),
    create_project:async args=>this.store.createProject(args.projectId,args.title,args.requirements??''),
    validate_score:async args=>({valid:true,composition:validateComposition(args.compositionJson)}),
    import_revision:async args=>this.store.importRevision(args.compositionJson,args.parentId),
    get_revision:async args=>this.store.revision(args.projectId,args.revisionId),
    render_revision:async args=>this.jobs.submit({kind:'render-score',...args}),
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
  async close() {await this.jobs.close();await this.store.close();}
}
