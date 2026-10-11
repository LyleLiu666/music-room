import type {ResourceStatus,OperationResults} from '../../service/operations.ts';
import {resourceEngineNames} from './resources.ts';
export function queueSummary(status:{active?:unknown;queued:unknown[];paused:boolean}|undefined,offline:boolean){
 if(offline)return '后台连接中断 · 队列状态未知';if(!status)return '正在连接后台…';
 if(status.paused)return `${status.active?'正在处理 1 项 · ':''}队列已暂停 · 等待 ${status.queued.length} 项`;
 return status.active||status.queued.length?`正在处理 ${status.active?1:0} 项 · 排队 ${status.queued.length} 项`:'后台空闲 · 无排队任务';
}
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderTaskQueue(status:ResourceStatus|undefined,offline:boolean,library?:OperationResults['studio_library']){
 const tasks=status?[...(status.active?[status.active]:[]),...status.queued]:[];
 const summary=queueSummary(status,offline),rows=tasks.map(t=>{
  const v=library?.backgroundVersions?.find(v=>v.resource?.id===t.id||v.id===t.id),sound=library?.sounds.find(s=>s.id===v?.soundId),project=library?.projects.find(p=>p.id===sound?.projectId);
  const name=sound?`${project?.title??''} / ${sound.title} · V${v!.number}`:resourceEngineNames[t.engine]??t.engine;
  const stage=t.stage==='running'&&v?v.stage:t.message??({queued:'排队中',waiting_resources:'等待资源',loading:'加载中',running:'处理中',cancelling:'正在取消'} as Record<string,string>)[t.stage]??t.stage;
  return `<li><strong>${esc(name)}</strong><span>${esc(stage)}</span></li>`;
 }).join('');
 for(const host of document.querySelectorAll<HTMLElement>('[data-task-queue]')){
  const open=host.querySelector('details')?.open??false;
  const html=`<details ${open?'open':''}><summary><span class="queue-dot ${offline?'offline':tasks.length?'working':''}" aria-hidden="true"></span><span role="status">${esc(summary)}</span><span aria-hidden="true">⌃</span></summary><div class="queue-list"><h3>后台任务</h3>${offline?'<p>连接恢复后自动更新，请勿将此状态视为空闲。</p>':tasks.length?`<ul>${rows}</ul>`:'<p>当前没有排队或正在执行的任务。</p>'}${status?.paused?'<p>后续任务已暂停，可在设置中恢复。</p>':''}</div></details>`;
  if(host.dataset.queueContent!==html){host.innerHTML=html;host.dataset.queueContent=html;}
 }
}
