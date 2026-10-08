import type {Composition} from '../music/authoring/validate.mjs';
import type {Mix} from '../audio.ts';
import type {Job} from '../service/jobs/jobs.ts';
import type {Operation,OperationInput,OperationResults,LibrarySnapshot} from '../service/operations.ts';
type Bootstrap = {token:string;url:string;workspace:string;mcp:unknown};
export type ServerSnapshot = LibrarySnapshot;
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

export class ServicePanel {
  private signature=''; private polling=false; private sequence=0; private audioSequence=0; private audioUrl?:string; private draftId=''; private drafts=new Map<string,string>();
  private draftEdits=new Map<string,number>();
  private service:WorkbenchService; private current:()=>Composition; private range:()=>{start:number;end:number}|undefined;
  private onLibrary:(snapshot:ServerSnapshot)=>void; private report:(message:string)=>void;private pause:()=>void;
  constructor(service:WorkbenchService,current:()=>Composition,range:()=>{start:number;end:number}|undefined,onLibrary:(snapshot:ServerSnapshot)=>void,report:(message:string)=>void,pause:()=>void) {
    this.service=service;this.current=current;this.range=range;this.onLibrary=onLibrary;this.report=report;this.pause=pause;
    document.querySelector('.authoring-tools')!.insertAdjacentHTML('afterbegin',`<details class="service-tools"><summary>本地项目与 MCP</summary><p id="service-location"></p><p>Agent 用 MCP 创作，文件由后台保存在此目录。无需复制应用源码。</p><label>新项目名称<input id="service-title" maxlength="120" placeholder="例如：窗边主题" /></label><label>创作要求<textarea id="service-requirements" rows="3" maxlength="8000"></textarea></label><button id="service-create">新建项目</button><label><input type="checkbox" id="service-parent" />导入时将当前版本记为父版（同项目）</label><button id="service-copy-mcp">复制 MCP 连接配置</button><pre id="service-mcp"></pre></details>`);
    document.querySelector('#service-location')!.textContent=service.bootstrap.workspace;
    document.querySelector('#service-mcp')!.textContent=JSON.stringify(service.bootstrap.mcp,null,2);
    document.querySelector('main')!.insertAdjacentHTML('beforeend',`<section class="service-panel"><h2>后台任务与听评</h2><p id="service-state">正在连接本地服务…</p><div id="service-jobs"></div><div id="service-audio"></div><label for="service-feedback">当前版本 / 所选片段的意见</label><textarea id="service-feedback" rows="3" maxlength="8000" placeholder="例如：保留 riff，回答句再简洁一些"></textarea><button id="service-save-feedback">保存听评，供 agent 修改</button><div id="service-feedback-list"></div></section>`);
    document.querySelector('#service-copy-mcp')!.addEventListener('click',()=>this.action(async()=>{await navigator.clipboard.writeText(JSON.stringify(service.bootstrap.mcp,null,2));report('已复制 MCP 连接配置。该入口会连接同一工作目录的服务。');}));
    document.querySelector('#service-create')!.addEventListener('click',()=>this.action(async()=>{
      const title=document.querySelector<HTMLInputElement>('#service-title')!,requirements=document.querySelector<HTMLTextAreaElement>('#service-requirements')!;
      await service.call('create_project',{projectId:`work-${crypto.randomUUID()}`,title:title.value,requirements:requirements.value});await this.refresh();title.value='';report('项目已写盘。让 agent 获取项目要求，先写一个好听的短乐句。');
    }));
    document.querySelector('#service-feedback')!.addEventListener('input',()=>{
      const id=this.current().revision.id;this.draftEdits.set(id,(this.draftEdits.get(id)??0)+1);
    });
    const saveFeedback=document.querySelector<HTMLButtonElement>('#service-save-feedback')!;
    saveFeedback.addEventListener('click',()=>this.action(async()=>{
      const doc=this.current(),input=document.querySelector<HTMLTextAreaElement>('#service-feedback')!;
      const id=doc.revision.id,text=input.value,edits=this.draftEdits.get(id)??0;
      saveFeedback.disabled=true;
      try {
        await service.call('add_feedback',{projectId:doc.work.id,revisionId:id,text,range:this.range()});
        // Only the submitted, unchanged draft is consumed, including while its version is hidden.
        if((this.draftEdits.get(id)??0)===edits) {
          if(this.current().revision.id===id && input.value===text){input.value='';this.drafts.delete(id);}
          else if(this.drafts.get(id)===text)this.drafts.delete(id);
        }
        await this.selectionChanged();report('听评已保存，agent 可通过 MCP 读取。');
      } finally {saveFeedback.disabled=false;}
    }));
    setInterval(()=>{void this.refresh();},1500);void this.refresh();void this.selectionChanged();
  }
  private action(fn:()=>Promise<unknown>){void fn().catch(error=>this.report(error.message));}
  async refresh() {
    if(this.polling)return;this.polling=true;
    try {
      const data=await this.service.call('library',{});
      const signature=JSON.stringify(data.projects.map(p=>[p.id,p.defaultRevisionId,p.revisions.map(r=>r.id)]));
      if(signature!==this.signature){this.signature=signature;this.onLibrary(data);}
      document.querySelector('#service-state')!.textContent='已连接本地服务 · 音乐任务不依赖网页保持打开';
      const rows=document.querySelector('#service-jobs')!;rows.replaceChildren();
      for(const job of [...data.jobs.filter(j=>['queued','running'].includes(j.state)),...data.jobs.filter(j=>!['queued','running'].includes(j.state)).slice(-12).reverse()]) {
        const row=document.createElement('div');row.className='service-job';const label=document.createElement('span');
        label.textContent=`${job.request.revisionId} · ${job.stage}${job.error?' · '+job.error:''}`;row.append(label);
        if(job.state==='succeeded'&&job.artifact) {
          for(const [text,listen] of [['试听后台 WAV',true],['下载后台 WAV',false]] as const) {
            const button=document.createElement('button');button.textContent=text;button.dataset.job=job.id;row.append(button);
            button.addEventListener('click',()=>this.action(async()=>{
              const sequence=listen?++this.audioSequence:0,blob=await this.service.artifact(job);
              if(listen&&sequence!==this.audioSequence)return;
              const url=URL.createObjectURL(blob);
              if(listen){document.querySelector<HTMLAudioElement>('#service-audio audio')?.pause();if(this.audioUrl)URL.revokeObjectURL(this.audioUrl);this.audioUrl=url;
                const player=document.createElement('audio');player.controls=true;player.src=url;player.dataset.job=job.id;player.addEventListener('play',()=>{this.audioSequence++;this.pause();});
                const note=document.createElement('p');note.textContent=`${job.request.revisionId} · ${job.result?.engine??'后台渲染'} · 已保存的音频`;document.querySelector('#service-audio')!.replaceChildren(note,player);await player.play();
              }else {const a=document.createElement('a');a.href=url;a.download=`${job.request.revisionId}-${job.id}.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
            }));
          }
        } else if(['queued','running'].includes(job.state)) {const button=document.createElement('button');button.textContent='取消';row.append(button);button.addEventListener('click',()=>this.action(async()=>{await this.service.call('cancel_job',{jobId:job.id});await this.refresh();}));}
        rows.append(row);
      }
    } catch(error:any){document.querySelector('#service-state')!.textContent=`本地服务未连接：${error.message}。请确认程序仍在运行；未保存的操作不会写入浏览器副本。`;}
    finally {this.polling=false;}
  }
  pauseAudio() {this.audioSequence++;document.querySelector<HTMLAudioElement>('#service-audio audio')?.pause();}
  async selectionChanged() {
    const seq=++this.sequence,doc=this.current(),input=document.querySelector<HTMLTextAreaElement>('#service-feedback')!;
    if(this.draftId!==doc.revision.id){if(this.draftId)this.drafts.set(this.draftId,input.value);this.draftId=doc.revision.id;input.value=this.drafts.get(this.draftId)??'';}
    try {const value=await this.service.call('get_project',{projectId:doc.work.id});if(seq!==this.sequence)return;
      const list=document.querySelector('#service-feedback-list')!;list.replaceChildren();
      for(const feedback of value.feedback.filter(f=>f.revisionId===doc.revision.id).slice(-8)) {const p=document.createElement('p');p.textContent=feedback.range?`${feedback.range.start.toFixed(1)}–${feedback.range.end.toFixed(1)} 秒：${feedback.text}`:feedback.text;list.append(p);}
    }catch(error:any){this.report(`读取听评失败：${error.message}`);}
  }
}
