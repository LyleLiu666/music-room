import type {WorkbenchService} from './service.ts';
import type {YuE2Status} from '../service/yue2/engine.ts';
import type {YuE2Job} from '../service/yue2/contracts.ts';
import {yue2Examples} from './yue2-examples.ts';
const phases:Record<YuE2Status['phase'],string>={uninstalled:'尚未启用',preparing:'正在安装',stopped:'已停止',starting:'正在启动',running:'正在运行',stopping:'正在停止',failed:'操作失败',unsupported:'此电脑暂不支持'};
const states:Record<YuE2Job['status'],string>={queued:'排队中',running:'生成中',done:'已完成',failed:'失败',cancelled:'已取消'};
export function describeYuE2Progress(progress:YuE2Job['progress']) {
  if(!progress)return '';if(progress.type==='abc')return '编写音乐结构';if(progress.type==='token')return '生成演奏';
  if(progress.type!=='stage')return '';
  const names:Record<string,string>={load:'准备模型与音色',plan:'编写音乐结构',semantic:'生成演奏',synthesize:'合成声音',decode:'导出音频',transcribe:'识别音符'};
  const label=typeof progress.stage==='string'?names[progress.stage]??'处理中':'处理中',done=progress.completed,total=progress.total;
  return label+(typeof done==='number'&&Number.isFinite(done)&&typeof total==='number'&&Number.isFinite(total)&&total>0?` · ${Math.min(100,Math.max(0,Math.round(done/total*100)))}%`:'');
}
export class YuE2Panel {
  private service:WorkbenchService;private polling=false;private busy=false;private initialized=false;private directoryEdited=false;private state?:YuE2Status;private jobSignature='';private audioUrl?:string;private audioSequence=0;private pause:()=>void;
  constructor(service:WorkbenchService,pause:()=>void) {
    this.service=service;this.pause=pause;
    document.querySelector('.authoring-tools')!.insertAdjacentHTML('afterbegin','<button id="yue2-jump">AI 音乐 · YuE2</button>');
    document.querySelector('main')!.insertAdjacentHTML('beforeend',`<section class="service-panel yue2-panel" aria-labelledby="yue2-heading"><h2 id="yue2-heading">YuE2 · 本机 AI 音乐</h2><p id="yue2-state" role="status">正在检查引擎…</p><p id="yue2-location"></p><div class="yue2-actions"><button id="yue2-enable">启用 YuE2</button><button id="yue2-start" hidden>启动</button><button id="yue2-stop" hidden>停止</button><a id="yue2-studio" hidden target="_blank" rel="noopener noreferrer">打开 YuE2 Studio</a></div>
    <details id="yue2-setup"><summary>安装目录与模型</summary><p>选择一个专用空文件夹。YuE2 源码、Python、依赖、模型、缓存和生成结果全部保存在这里。安装后，工作台下次启动会自动启动 YuE2。</p><label for="yue2-directory">安装目录</label><div class="yue2-path"><input id="yue2-directory" spellcheck="false" placeholder="请选择文件夹或填写绝对路径" /><button id="yue2-choose">选择文件夹</button></div><label class="yue2-check"><input id="yue2-models" type="checkbox" checked />下载生成模型与纯器乐适配器</label><p>模型约 10 GB，另需运行环境与缓存空间。首次安装需要联网，完成后在本机生成。YuE2 代码为 MIT，模型采用 CC BY-NC 4.0。</p><button id="yue2-install">安装并启动</button></details>
    <details><summary>安装与运行日志</summary><pre id="yue2-logs"></pre></details><p id="yue2-error" role="alert"></p>
    <div class="yue2-examples" role="group" aria-labelledby="yue2-examples-heading"><h3 id="yue2-examples-heading">提示词示例</h3><p>① 选一个示例　② 修改音乐描述或歌词　③ 点击生成音乐，完成后试听。示例提供英文音乐描述和中文说明。</p><p>「填入」会替换当前曲名、音乐描述、歌词及生成设置，切换到对应的人声 / 器乐模式和快速试听；不会自动开始生成。</p><details open><summary>纯音乐 · 4 个示例</summary><div class="yue2-example-grid" id="yue2-instrumental-examples"></div></details><details open><summary>带人声 · 3 个原创歌词示例</summary><div class="yue2-example-grid" id="yue2-vocal-examples"></div></details><p id="yue2-example-status" role="status"></p></div>
    <details class="yue2-prompt-guide"><summary>提示词怎么写？</summary><p>写清楚：风格与情绪 → 主要乐器 → 速度与节奏 → 记得住的旋律 → 段落如何变化与收尾。带人声时，再描述演唱语言、男声或女声以及唱法。</p><p>例如，不只写「好听的钢琴曲」，还可以写「钢琴流行器乐，温暖、88 BPM，两小节主题（riff）贯穿，贝斯和轻鼓逐步加入；副歌更饱满，回到主题时改变配器，最后自然收尾」。先改一两处，听过再调整。</p><p>纯音乐：勾选「纯器乐」，段落栏保留 [instrumental]，或写 [intro]、[verse]、[chorus]、[outro] 等标签，无需歌词或起止秒数。</p><p>带人声：取消勾选「纯器乐」，音乐描述里写明人声特点；将要唱的文字放在 [Verse]（主歌）、[Chorus]（副歌）等标签下面，不要只把歌词写进音乐描述。示例会自动填好这些设置。</p><p>示例是创作起点，尚未逐一生成试听，效果以实际结果为准。模型不能保证精确时长、逐字演唱或指定音色。</p></details>
    <form id="yue2-form"><label for="yue2-title">曲名（可选）</label><input id="yue2-title" maxlength="200" /><label for="yue2-style">音乐描述</label><textarea id="yue2-style" required rows="6" maxlength="8000" placeholder="选一个上方示例，或写下风格、乐器、节奏、旋律特点和段落变化。"></textarea><details id="yue2-settings"><summary>段落与生成设置</summary><label for="yue2-lyrics">段落结构 / 歌词</label><textarea id="yue2-lyrics" rows="3" maxlength="16000">[instrumental]</textarea><label class="yue2-check"><input id="yue2-instrumental" type="checkbox" checked />纯器乐（使用器乐适配器）</label><label for="yue2-preset">生成质量</label><select id="yue2-preset"><option value="fast">快速试听</option><option value="quality">较高质量 · 更慢</option></select></details><button id="yue2-generate" disabled>生成音乐</button><p>任务由后台继续执行，可以关闭网页。这里显示 YuE2 音频作品；音频不会自动变成 MIDI 乐谱。</p></form><div id="yue2-jobs"></div><div id="yue2-audio"></div></section>`);
    for(const example of yue2Examples){
      const card=document.createElement('div');card.className='yue2-example';
      const heading=document.createElement('h4');heading.textContent=example.name;
      const description=document.createElement('p');description.textContent=example.description;
      const button=document.createElement('button');button.type='button';button.textContent='填入'+example.name;
      button.addEventListener('click',()=>{
        this.input('title').value=example.title;
        document.querySelector<HTMLTextAreaElement>('#yue2-style')!.value=example.style;
        document.querySelector<HTMLTextAreaElement>('#yue2-lyrics')!.value=example.lyrics;
        this.input('instrumental').checked=example.instrumental;
        document.querySelector<HTMLSelectElement>('#yue2-preset')!.value='fast';
        const lyrics=document.querySelector<HTMLTextAreaElement>('#yue2-lyrics')!;
        lyrics.rows=example.instrumental?3:10;
        if(!example.instrumental)document.querySelector<HTMLDetailsElement>('#yue2-settings')!.open=true;
        document.querySelector('#yue2-example-status')!.textContent=`已填入「${example.name}」：${example.instrumental?'纯器乐':'带人声'} · 快速试听。可以继续修改音乐描述${example.instrumental?'':'和歌词'}，再点击生成音乐。`;
      });
      card.append(heading,description,button);document.querySelector(example.instrumental?'#yue2-instrumental-examples':'#yue2-vocal-examples')!.append(card);
    }
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
    for(const job of data.jobs){const row=document.createElement('div');row.className='service-job';const label=document.createElement('span'),progress=describeYuE2Progress(job.progress);label.textContent=`${job.title??job.id.slice(0,8)} · ${states[job.status]}${job.error?' · '+job.error:''}${progress?' · '+progress:''}`;row.append(label);
      if(job.status==='done')for(const listen of [true,false]){const button=document.createElement('button');button.textContent=listen?'试听':'下载 FLAC';row.append(button);button.addEventListener('click',()=>this.action(async()=>{
        const sequence=listen?++this.audioSequence:0,response=await fetch('/yue2-audio/'+job.id,{headers:{authorization:`Bearer ${this.service.bootstrap.token}`}});if(!response.ok)throw new Error('无法读取 YuE2 音频');const blob=await response.blob();if(listen&&sequence!==this.audioSequence)return;const url=URL.createObjectURL(blob);
        if(listen){this.pauseAudio();if(this.audioUrl)URL.revokeObjectURL(this.audioUrl);this.audioUrl=url;const player=document.createElement('audio');player.controls=true;player.src=url;player.addEventListener('play',this.pause);document.querySelector('#yue2-audio')!.replaceChildren(player);await player.play();}else{const a=document.createElement('a');a.href=url;a.download=`${job.id}.flac`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
      }));}
      else if(job.status==='queued'||job.status==='running'){const button=document.createElement('button');button.textContent='取消任务';row.append(button);button.addEventListener('click',()=>this.action(async()=>{await this.service.call('yue2_cancel_job',{jobId:job.id});await this.refreshJobs();}));}rows.append(row);
    }
  }
  pauseAudio(){this.audioSequence++;document.querySelector<HTMLAudioElement>('#yue2-audio audio')?.pause();}
}
