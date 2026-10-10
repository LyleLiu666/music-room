import '../studio/style.css';
import './style.css';
import '../studio/theme.ts';
import {backend} from '../service.ts';

type Job={id:string;name:string;voiceName:string;state:string;stage:string;phase:string;progress:number;error?:string};
type Voice={id:string;name:string;deleted?:boolean;purged?:boolean;processing?:{state:string}};
const root=document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML=`<main class="conversion-page"><header><a class="brand" href="./">♫ Music Room</a><a href="./">返回创作空间</a></header><section class="conversion-intro"><p class="eyebrow">声音创作</p><h1>换一种音色，保留原来的声音场景</h1><p>上传歌曲或录音，选择目标音色。自动提取人声、转换音色，再合回原来的伴奏和背景音。</p><p class="conversion-note">歌词、旋律和说话节奏沿用原录音。效果受原音清晰度和参考音色影响。适合单人演唱或说话；多人声音会一起处理。</p></section><section class="conversion-card"><h2>新建音色转换</h2><form id="conversion-form"><label for="source-file">原始音频</label><input id="source-file" type="file" accept=".wav,.mp3,.m4a,.flac,.aiff,.aif" required><p class="conversion-note">支持 WAV、MP3、M4A、FLAC、AIFF，最大 200 MiB、最长 20 分钟。按完整音频处理。</p><label for="voice">目标音色</label><select id="voice" required><option value="">选择音色库中的声音</option></select><p class="conversion-note">使用已有音色库；可返回创作空间添加或清理参考声音。</p><button id="submit-conversion" type="submit" disabled>开始转换</button></form><p id="engine-status" role="status">正在连接本地服务…</p><p id="conversion-error" role="alert" hidden></p></section><section class="conversion-history"><h2>转换记录</h2><p class="conversion-note">任务保存在本机。关闭网页后会继续处理，本地服务需保持运行。</p><div id="conversion-jobs"></div><nav class="conversion-pagination" aria-label="转换记录分页"><button id="previous-page" type="button">上一页</button><span id="page-label" role="status"></span><button id="next-page" type="button">下一页</button></nav></section><section id="conversion-listening" class="conversion-card" hidden><h2 id="listening-title">试听</h2><audio controls preload="metadata"></audio></section></main>`;
const file=document.querySelector<HTMLInputElement>('#source-file')!,select=document.querySelector<HTMLSelectElement>('#voice')!,submit=document.querySelector<HTMLButtonElement>('#submit-conversion')!,status=document.querySelector('#engine-status')!,error=document.querySelector<HTMLElement>('#conversion-error')!,list=document.querySelector('#conversion-jobs')!,player=document.querySelector<HTMLAudioElement>('audio')!;
let ready=false,uploading=false,polling=false,voiceSignature='',requestId=crypto.randomUUID(),audioUrl='',audioSequence=0;
let currentPage=1,totalPages=1,pageRevision=0;
const previous=document.querySelector<HTMLButtonElement>('#previous-page')!,next=document.querySelector<HTMLButtonElement>('#next-page')!;
function updatePages(){previous.disabled=polling||currentPage<=1;next.disabled=polling||currentPage>=totalPages;}
async function changePage(page:number){currentPage=page;pageRevision++;await refresh();}
previous.addEventListener('click',()=>void changePage(currentPage-1));next.addEventListener('click',()=>void changePage(currentPage+1));
const signatures=new Map<string,string>();
const active=(job:Job)=>['queued','running'].includes(job.state);
function report(value:unknown){error.textContent=value instanceof Error?value.message:String(value);error.hidden=false;}
function clearError(){error.hidden=true;error.textContent='';}
function updateSubmit(){submit.disabled=!ready||uploading||!file.files?.length||!select.value;}
function resetRequest(){requestId=crypto.randomUUID();updateSubmit();}
file.addEventListener('change',resetRequest);select.addEventListener('change',resetRequest);
function button(label:string,action:()=>Promise<void>){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>{b.disabled=true;clearError();void action().catch(report).finally(()=>{b.disabled=false;});});return b;}
async function audio(job:Job,kind:'original'|'converted'|'vocals',download:boolean){
 if(!backend)return;const sequence=download?0:++audioSequence;
 const response=await fetch(`/conversion/audio/${encodeURIComponent(job.id)}/${kind}`,{headers:{authorization:`Bearer ${backend.bootstrap.token}`}});
 if(!response.ok)throw Error('音频暂时无法读取，请稍后重试');const blob=await response.blob();if(!download&&sequence!==audioSequence)return;const url=URL.createObjectURL(blob);
 const label={original:'原始音频',converted:'转换结果',vocals:'转换人声'}[kind];
 if(download){const a=document.createElement('a');a.href=url;a.download=kind==='original'?job.name:`${job.name.replace(/\.[^.]+$/,'')}-${label}.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);return;}
 player.pause();if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=url;player.src=url;document.querySelector('#listening-title')!.textContent=`${job.name} · ${label}`;document.querySelector<HTMLElement>('#conversion-listening')!.hidden=false;await player.play();
}
function renderJob(job:Job){
 const signature=JSON.stringify(job);if(signatures.get(job.id)===signature)return;signatures.set(job.id,signature);
 let row=document.getElementById(`conversion-${job.id}`);if(!row){row=document.createElement('article');row.id=`conversion-${job.id}`;row.className='conversion-job';list.append(row);}row.replaceChildren();
 const title=document.createElement('h3');title.textContent=job.name;title.title=job.name;const target=document.createElement('p');target.className='conversion-note';target.textContent=`目标音色：${job.voiceName}`;target.title=target.textContent;
 const state=document.createElement('span');state.className='conversion-state';state.textContent=({queued:'排队中',running:'处理中',succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'} as Record<string,string>)[job.state]??job.state;
 const info=document.createElement('div');info.className='conversion-job-info';info.append(title,target);row.append(info,state);
 if(active(job)){const stage=document.createElement('p');stage.className='conversion-job-stage';stage.textContent=job.stage;stage.setAttribute('role','status');const progress=document.createElement('progress');progress.max=1;progress.value=Math.max(0,Math.min(1,job.progress));progress.setAttribute('aria-label','转换进度');row.append(stage,progress);}
 if(job.error){const details=document.createElement('details');details.className='conversion-job-error';const summary=document.createElement('summary');summary.textContent='查看错误';const note=document.createElement('p');note.textContent=job.error;details.append(summary,note);row.append(details);}

 const actions=document.createElement('div');actions.className='conversion-actions';
 if(job.state==='succeeded')actions.append(button('试听转换结果',()=>audio(job,'converted',false)),button('下载转换结果',()=>audio(job,'converted',true)));
 const more=document.createElement('details');more.className='conversion-more';const summary=document.createElement('summary');summary.textContent='更多音频';more.append(summary);const menu=document.createElement('div');menu.className='conversion-more-menu';menu.append(button('试听原音',()=>audio(job,'original',false)),button('下载原音',()=>audio(job,'original',true)));if(job.state==='succeeded')menu.append(button('试听转换人声',()=>audio(job,'vocals',false)),button('下载转换人声',()=>audio(job,'vocals',true)));more.append(menu);actions.append(more);
 if(active(job))actions.append(button('取消任务',async()=>{await backend!.call('svc_cancel',{jobId:job.id});await refresh();}));
 if(['failed','cancelled','interrupted'].includes(job.state))actions.append(button('重试',async()=>{await backend!.call('svc_retry',{jobId:job.id});await changePage(1);}));row.append(actions);
}
async function refresh(){
 if(!backend||polling)return;polling=true;updatePages();const revision=pageRevision;
 try{const library=await backend.call('svc_library',{page:currentPage,pageSize:10});if(revision!==pageRevision)return;if(!library.pagination)throw Error('服务未返回分页信息，请更新本地服务');currentPage=library.pagination.page;totalPages=library.pagination.totalPages;document.querySelector('#page-label')!.textContent=`第 ${currentPage} / ${totalPages} 页 · 共 ${library.pagination.total} 条`;ready=library.status.ready;status.textContent=library.status.message;
 const voices=(library.voices as Voice[]).filter(v=>!v.deleted&&!v.purged&&(!v.processing||v.processing.state==='succeeded'));const nextSignature=JSON.stringify(voices.map(v=>[v.id,v.name]));if(nextSignature!==voiceSignature){voiceSignature=nextSignature;const current=select.value;select.replaceChildren(new Option('选择音色库中的声音',''));for(const voice of voices)select.add(new Option(voice.name,voice.id));select.value=current;}
 for(const job of library.jobs)renderJob(job);const ids=new Set(library.jobs.map(j=>`conversion-${j.id}`));for(const row of [...list.children])if(!ids.has(row.id)){signatures.delete(row.id.slice(11));row.remove();}
 for(const job of library.jobs){const row=document.getElementById(`conversion-${job.id}`);if(row)list.append(row);}
 if(!library.jobs.length){list.textContent='还没有转换记录。上传一段声音开始。';signatures.clear();}else for(const node of list.childNodes)if(node.nodeType===Node.TEXT_NODE)node.remove();
 }catch(e){ready=false;status.textContent='暂时无法连接本地服务，正在重试。已提交的任务由后台保留。';}finally{polling=false;updateSubmit();updatePages();if(revision!==pageRevision)void refresh();}
}
document.querySelector('form')!.addEventListener('submit',event=>{event.preventDefault();void (async()=>{if(!backend||uploading)return;const source=file.files?.[0];if(!source||!select.value)return;if(source.size>200*1024*1024)throw Error('音频超过 200 MB，请选择较小的文件');if(!/\.(wav|mp3|m4a|flac|aiff|aif)$/i.test(source.name))throw Error('请选择 WAV、MP3、M4A、FLAC 或 AIFF 音频');uploading=true;updateSubmit();submit.textContent='正在上传…';clearError();
 try{const query=new URLSearchParams({name:source.name,voiceId:select.value,requestId});const response=await fetch(`/conversion/upload?${query}`,{method:'POST',headers:{authorization:`Bearer ${backend.bootstrap.token}`,'content-type':'application/octet-stream'},body:source});const result=await response.json();if(!response.ok)throw Error(result.message??'上传失败，请重试');requestId=crypto.randomUUID();file.value='';await changePage(1);}finally{uploading=false;submit.textContent='开始转换';updateSubmit();}})().catch(report);});
if(backend){void refresh();setInterval(()=>void refresh(),1500);}else{status.textContent='请通过 Music Room 本地服务打开此页面。';}
window.addEventListener('pagehide',()=>{audioSequence++;if(audioUrl)URL.revokeObjectURL(audioUrl);});
