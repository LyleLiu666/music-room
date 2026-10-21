import {musicProgressMarkup} from './music-progress.ts';
import type {ResourceStatus,OperationResults} from '../../service/operations.ts';
import {resourceEngineNames} from './resources.ts';
import type {LyricJob} from '../../service/studio/lyrics-generation.ts';
export function queueSummary(status:{active?:unknown;queued:unknown[];paused:boolean}|undefined,offline:boolean){
 if(offline)return '后台连接中断 · 队列状态未知';if(!status)return '正在连接后台…';
 if(status.paused)return `${status.active?'正在处理 1 项 · ':''}队列已暂停 · 等待 ${status.queued.length} 项`;
 return status.active||status.queued.length?`正在处理 ${status.active?1:0} 项 · 排队 ${status.queued.length} 项`:'后台空闲 · 无排队任务';
}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const duration=(seconds:number)=>{const s=Math.max(0,Math.floor(seconds));return s<60?`${s} 秒`:`${Math.floor(s/60)} 分 ${s%60} 秒`;};
function lyricProgressMarkup(job:LyricJob,now:number){
 const percent=Number.isFinite(job.progress)&&job.progress>0?Math.min(99,job.progress):undefined;
 const age=job.updatedAt===undefined?undefined:Math.max(0,Math.floor((now-job.updatedAt)/1000));
 const timing=[job.startedAt===undefined?'':`已运行 ${duration((now-job.startedAt)/1000)}`,age===undefined?'':age>120?`${age} 秒内未收到新进度；仍在等待模型处理`:`最近推进：${age} 秒前`].filter(Boolean).join(' · ');
 return `<div class="task-progress"><span>${esc(job.message)}${percent===undefined?'':` · ${percent}%`}</span><progress aria-label="同步歌词处理进度"${percent===undefined?'':` max="100" value="${percent}"`} title="按已处理音频分段估算，不代表耗时比例"></progress>${timing?`<span>${esc(timing)}</span>`:''}</div>`;
}
export function taskQueueRows(status:ResourceStatus|undefined,library?:OperationResults['studio_library'],now=Date.now()){
 const tasks=status?[...(status.active?[status.active]:[]),...status.queued]:[];
 return tasks.map((t,index)=>{
  const lyric=library?.backgroundLyrics?.find(entry=>entry.job.taskId===t.id);
  const v=library?.backgroundVersions?.find(v=>v.resource?.id===t.id||v.id===t.id||v.source?.id===t.id||v.renderJobId===t.id),sound=library?.sounds.find(s=>s.id===(lyric?.soundId??v?.soundId)),project=library?.projects.find(p=>p.id===sound?.projectId);
  const name=sound?`${project?.title??''} / ${sound.title} · V${lyric?.number??v!.number}${lyric?' · 同步歌词':''}`:resourceEngineNames[t.engine]??t.engine;
  const stage=t.stage==='running'&&v?v.stage:t.message??({queued:'排队中',waiting_resources:'等待资源',loading:'加载中',running:'处理中',cancelling:'正在取消'} as Record<string,string>)[t.stage]??t.stage;
  const queued=status?.queued.some(q=>q.id===t.id);
  const feedback=lyric&&t.stage==='running'?lyricProgressMarkup(lyric.job,now):v&&t.stage==='running'?musicProgressMarkup(v):'';
  const versionId=lyric?.job.versionId??v?.id;
  const title=versionId&&sound&&!sound.deleted&&!sound.purged&&project&&!project.deleted?`<button type="button" class="task-title-link" data-action="task-version" data-id="${esc(versionId)}" data-sound="${esc(sound.id)}">${esc(name)}</button>`:`<strong>${esc(name)}</strong>`;
  return `<li>${title}${feedback||`<span>${esc(queued?`${stage} · 前面还有 ${index} 项`:stage)}</span>`}</li>`;
 }).join('');
}
export function renderTaskQueue(status:ResourceStatus|undefined,offline:boolean,library?:OperationResults['studio_library']){
 const tasks=status?[...(status.active?[status.active]:[]),...status.queued]:[];
 const summary=queueSummary(status,offline),rows=taskQueueRows(status,library);
 for(const host of document.querySelectorAll<HTMLElement>('[data-task-queue]')){
  const open=host.querySelector('details')?.open??false;
  const html=`<details ${open?'open':''}><summary><span class="queue-dot ${offline?'offline':tasks.length?'working':''}" aria-hidden="true"></span><span role="status">${esc(summary)}</span><span aria-hidden="true">⌃</span></summary><div class="queue-list"><h3>后台任务</h3>${offline?'<p>连接恢复后自动更新，请勿将此状态视为空闲。</p>':tasks.length?`<ul>${rows}</ul>`:'<p>当前没有排队或正在执行的任务。</p>'}${status?.paused?'<p>后续任务已暂停，可在设置中恢复。</p>':''}</div></details>`;
  if(host.dataset.queueContent!==html){
   const current=host.querySelector('details');
   if(!current)host.innerHTML=html;
   else{
    const template=document.createElement('template');template.innerHTML=html;
    const next=template.content.querySelector('details')!,label=current.querySelector('[role=status]')!,nextLabel=next.querySelector('[role=status]')!;
    if(label.textContent!==nextLabel.textContent)label.textContent=nextLabel.textContent;
    current.querySelector('.queue-dot')!.className=next.querySelector('.queue-dot')!.className;
    const focused=current.contains(document.activeElement)?(document.activeElement as HTMLElement).dataset.id:undefined;
    current.querySelector('.queue-list')!.innerHTML=next.querySelector('.queue-list')!.innerHTML;
    if(focused)Array.from(current.querySelectorAll<HTMLButtonElement>('.task-title-link')).find(b=>b.dataset.id===focused)?.focus({preventScroll:true});
   }
   host.dataset.queueContent=html;
  }
 }
}
