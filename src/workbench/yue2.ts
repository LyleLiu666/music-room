import type {WorkbenchService} from './service.ts';
import type {YuE2Status} from '../service/yue2/engine.ts';
import type {YuE2Job} from '../service/yue2/contracts.ts';
const phases:Record<YuE2Status['phase'],string>={uninstalled:'尚未启用',preparing:'正在安装',stopped:'已停止',starting:'正在启动',running:'正在运行',stopping:'正在停止',failed:'操作失败',unsupported:'此电脑暂不支持'};
const states:Record<YuE2Job['status'],string>={queued:'排队中',running:'生成中',done:'已完成',failed:'失败',cancelled:'已取消'};
export class YuE2Panel {
  private service:WorkbenchService;private polling=false;private busy=false;private initialized=false;private directoryEdited=false;private state?:YuE2Status;private jobSignature='';private audioUrl?:string;private audioSequence=0;private pause:()=>void;
  constructor(service:WorkbenchService,pause:()=>void) {
    this.service=service;this.pause=pause;
    document.querySelector('.authoring-tools')!.insertAdjacentHTML('afterbegin','<button id="yue2-jump">AI 音乐 · YuE2</button>');
    document.querySelector('main')!.insertAdjacentHTML('beforeend',`<section class="service-panel yue2-panel" aria-labelledby="yue2-heading"><h2 id="yue2-heading">YuE2 · 本机 AI 音乐</h2><p id="yue2-state" role="status">正在检查引擎…</p><p id="yue2-location"></p><div class="yue2-actions"><button id="yue2-enable">启用 YuE2</button><button id="yue2-start" hidden>启动</button><button id="yue2-stop" hidden>停止</button><a id="yue2-studio" hidden target="_blank" rel="noopener noreferrer">打开 YuE2 Studio</a></div>
    <details id="yue2-setup"><summary>安装目录与模型</summary><p>选择一个专用空文件夹。YuE2 源码、Python、依赖、模型、缓存和生成结果全部保存在这里。安装后，工作台下次启动会自动启动 YuE2。</p><label for="yue2-directory">安装目录</label><div class="yue2-path"><input id="yue2-directory" spellcheck="false" placeholder="请选择文件夹或填写绝对路径" /><button id="yue2-choose">选择文件夹</button></div><label class="yue2-check"><input id="yue2-models" type="checkbox" checked />下载生成模型与纯器乐适配器</label><p>模型约 10 GB，另需运行环境与缓存空间。首次安装需要联网，完成后在本机生成。YuE2 代码为 MIT，模型采用 CC BY-NC 4.0。</p><button id="yue2-install">安装并启动</button></details>
    <details><summary>安装与运行日志</summary><pre id="yue2-logs"></pre></details><p id="yue2-error" role="alert"></p>
    <form id="yue2-form"><label for="yue2-title">曲名（可选）</label><input id="yue2-title" maxlength="200" /><label for="yue2-style">音乐描述</label><textarea id="yue2-style" required rows="3" maxlength="8000" placeholder="例如：钢琴主导的流行器乐，清晰的两小节 riff，有回答、留白和切分鼓，温暖贝斯，副歌逐步展开。"></textarea><details><summary>段落与生成设置</summary><label for="yue2-lyrics">段落结构 / 歌词</label><textarea id="yue2-lyrics" rows="3" maxlength="16000">[instrumental]</textarea><label class="yue2-check"><input id="yue2-instrumental" type="checkbox" checked />纯器乐（使用器乐适配器）</label><label for="yue2-preset">生成质量</label><select id="yue2-preset"><option value="fast">快速试听</option><option value="quality">较高质量 · 更慢</option></select></details><button id="yue2-generate" disabled>生成音乐</button><p>任务由后台继续执行，可以关闭网页。这里显示 YuE2 音频作品；音频不会自动变成 MIDI 乐谱。</p></form><div id="yue2-jobs"></div><div id="yue2-audio"></div></section>`);
    this.button('enable').addEventListener('click',()=>{document.querySelector<HTMLDetailsElement>('#yue2-setup')!.open=true;this.input('directory').focus();});
    this.button('jump').addEventListener('click',()=>document.querySelector('#yue2-heading')!.scrollIntoView({behavior:'smooth',block:'start'}));
    this.input('directory').addEventListener('input',()=>{this.directoryEdited=true;});
    this.button('choose').addEventListener('click',()=>this.action(async()=>{const result=await service.call('yue2_choose_directory',{});if(result.directory){this.directoryEdited=true;this.input('directory').value=result.directory;}}));
    this.button('install').addEventListener('click',()=>this.action(async()=>{this.state=await service.call('prepare_yue2',{directory:this.input('directory').value.trim(),downloadModels:this.input('models').checked});this.draw();}));
    this.button('start').addEventListener('click',()=>this.action(async()=>{this.state=await service.call('start_yue2',{});this.draw();}));
    this.button('stop').addEventListener('click',()=>this.action(async()=>{this.state=await service.call('stop_yue2',{});this.draw();}));
    document.querySelector<HTMLFormElement>('#yue2-form')!.addEventListener('submit',event=>{event.preventDefault();if(this.busy||!this.state?.canGenerate)return;this.action(async()=>{
      const title=this.input('title').value.trim(),style=document.querySelector<HTMLTextAreaElement>('#yue2-style')!.value.trim(),lyrics=document.querySelector<HTMLTextAreaElement>('#yue2-lyrics')!.value.trim();
      await service.call('yue2_generate',{style,lyrics,preset:document.querySelector<HTMLSelectElement>('#yue2-preset')!.value as 'fast'|'quality',instrumental:this.input('instrumental').checked,...(title?{title}:{})});await this.refreshJobs();
    });});
    setInterval(()=>void this.refresh(),2000);void this.refresh();
  }
  private input(name:string){return document.querySelector<HTMLInputElement>('#yue2-'+name)!;}
  private button(name:string){return document.querySelector<HTMLButtonElement>('#yue2-'+name)!;}
  private action(fn:()=>Promise<unknown>){if(this.busy)return;this.busy=true;document.querySelector('#yue2-error')!.textContent='';this.draw();void fn().catch(error=>{document.querySelector('#yue2-error')!.textContent=error.message;}).finally(()=>{this.busy=false;this.draw();});}
  private draw(){const s=this.state;if(!s)return;
    document.querySelector('#yue2-state')!.textContent=`${phases[s.phase]}${s.phase==='running'?(s.canGenerate?' · 模型就绪':' · 生成模型尚未就绪'):''} · ${s.error??s.message}`;
    document.querySelector('#yue2-location')!.textContent=s.directory?`引擎工作区：${s.directory}`:'';document.querySelector('#yue2-logs')!.textContent=s.logs.join('\n');
    const working=['preparing','starting','stopping'].includes(s.phase),running=s.phase==='running';
    this.button('enable').hidden=running||working;this.button('enable').textContent=s.installed?'管理安装':'启用 YuE2';
    this.button('start').hidden=!s.installed||running||working||s.phase==='unsupported';this.button('stop').hidden=!running&&!working;
    this.button('generate').disabled=this.busy||!s.canGenerate;this.button('install').disabled=this.busy||working||s.phase==='unsupported';this.button('choose').disabled=this.busy||working;
    this.button('start').disabled=this.busy;this.button('stop').disabled=this.busy;
    const studio=document.querySelector<HTMLAnchorElement>('#yue2-studio')!;studio.hidden=!running||!s.url;if(s.url)studio.href=s.url;
  }
  private async refresh(){if(this.polling)return;this.polling=true;
    try{this.state=await this.service.call('yue2_status',{});if(!this.initialized){if(!this.directoryEdited)this.input('directory').value=this.state.directory??this.state.defaultDirectory;this.initialized=true;}this.draw();if(this.state.canGenerate)await this.refreshJobs();}
    catch(error){this.state=undefined;document.querySelector('#yue2-state')!.textContent=`无法连接本地服务：${error instanceof Error?error.message:String(error)}`;this.button('generate').disabled=true;}
    finally{this.polling=false;}
  }
  private async refreshJobs(){const data=await this.service.call('yue2_list_jobs',{}),signature=JSON.stringify(data.jobs);if(signature===this.jobSignature)return;this.jobSignature=signature;
    const rows=document.querySelector('#yue2-jobs')!;rows.replaceChildren();
    for(const job of data.jobs){const row=document.createElement('div');row.className='service-job';const label=document.createElement('span');label.textContent=`${job.title??job.id.slice(0,8)} · ${states[job.status]}${job.error?' · '+job.error:''}${job.progress?' · '+JSON.stringify(job.progress):''}`;row.append(label);
      if(job.status==='done')for(const listen of [true,false]){const button=document.createElement('button');button.textContent=listen?'试听':'下载 FLAC';row.append(button);button.addEventListener('click',()=>this.action(async()=>{
        const sequence=listen?++this.audioSequence:0,response=await fetch('/yue2-audio/'+job.id,{headers:{authorization:`Bearer ${this.service.bootstrap.token}`}});if(!response.ok)throw new Error('无法读取 YuE2 音频');const blob=await response.blob();if(listen&&sequence!==this.audioSequence)return;const url=URL.createObjectURL(blob);
        if(listen){this.pauseAudio();if(this.audioUrl)URL.revokeObjectURL(this.audioUrl);this.audioUrl=url;const player=document.createElement('audio');player.controls=true;player.src=url;player.addEventListener('play',this.pause);document.querySelector('#yue2-audio')!.replaceChildren(player);await player.play();}else{const a=document.createElement('a');a.href=url;a.download=`${job.id}.flac`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
      }));}
      else if(job.status==='queued'||job.status==='running'){const button=document.createElement('button');button.textContent='取消任务';row.append(button);button.addEventListener('click',()=>this.action(async()=>{await this.service.call('yue2_cancel_job',{jobId:job.id});await this.refreshJobs();}));}rows.append(row);
    }
  }
  pauseAudio(){this.audioSequence++;document.querySelector<HTMLAudioElement>('#yue2-audio audio')?.pause();}
}
