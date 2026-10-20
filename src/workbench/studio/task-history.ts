import type {OperationResults} from '../../service/operations.ts';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function projectPage<T extends {title:string}>(projects:T[],query:string,page:number,size=6){
 const matches=projects.filter(p=>p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const pages=Math.max(1,Math.ceil(matches.length/size)),current=Math.max(1,Math.min(page,pages));
 return {items:matches.slice((current-1)*size,current*size),page:current,pages,total:matches.length};
}
export function taskHistoryRows(library:OperationResults['studio_library']){
 const rows=[...(library.taskHistory??[]).map(v=>({...v,label:''})),...(library.lyricTaskHistory??[]).map(v=>({...v,label:' · 同步歌词'}))].sort((a,b)=>Number(['queued','running'].includes(b.state))-Number(['queued','running'].includes(a.state))||b.createdAt.localeCompare(a.createdAt));
 return rows.map(v=>{
  const sound=library.sounds.find(s=>s.id===v.soundId),project=library.projects.find(p=>p.id===sound?.projectId);
  const state={queued:'排队中',running:'进行中',succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'}[v.state]??v.state;
  return `<li class="task-history-row"><div><strong>${esc(project?.title)} / ${esc(sound?.title)} · V${v.number}${v.label}</strong><p>${esc(state)}${(v.error??v.stage)!==state?' · '+esc(v.error??v.stage):''}</p><small>创建于 ${esc(new Date(v.createdAt).toLocaleString())}</small></div><button class="secondary" data-action="task-version" data-id="${esc(v.id)}" data-sound="${esc(v.soundId)}">${v.hasAudio?'查看生成结果':'查看版本'}</button></li>`;
 }).join('');
}
export function taskHistoryPage(library:OperationResults['studio_library']){
 return `<header class="project-header"><h1>任务列表</h1></header><p class="field-note">进行中的任务优先显示，其余按创建时间倒序。保留已完成、失败和取消的生成版本，以及各版本最近一次同步歌词任务；已删除内容可在回收站查看。</p><ul class="task-history-list">${taskHistoryRows(library)||'<li>还没有生成任务。</li>'}</ul>`;
}
