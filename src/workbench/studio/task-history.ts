import type {OperationResults} from '../../service/operations.ts';
type Library=OperationResults['studio_library'];
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function projectPage<T extends {title:string}>(projects:T[],query:string,page:number,size=6){
 const matches=projects.filter(p=>p.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const pages=Math.max(1,Math.ceil(matches.length/size)),current=Math.max(1,Math.min(page,pages));
 return {items:matches.slice((current-1)*size,current*size),page:current,pages,total:matches.length};
}
const states={all:['','全部'],running:['◉','生成中'],queued:['◷','排队中'],succeeded:['✓','已完成'],failed:['!','失败'],cancelled:['−','已取消'],interrupted:['!','已中断']} as const;
export type TaskFilter=keyof typeof states;
export type TaskOptions={page?:number;size?:number;query?:string;state?:TaskFilter};
function tasks(library:Library){
 const rank=(s:string)=>s==='running'?0:s==='queued'?1:2;
 return [...(library.taskHistory??[]).map(v=>({...v,key:v.id,label:''})),...(library.lyricTaskHistory??[]).map(v=>({...v,key:v.taskId,label:' · 同步歌词'}))].map(v=>{const sound=library.sounds.find(s=>s.id===v.soundId);return {...v,title:`${sound?.title??'已删除声音'} · V${v.number}${v.label}`,project:library.projects.find(p=>p.id===sound?.projectId)?.title??''};}).sort((a,b)=>rank(a.state)-rank(b.state)||b.createdAt.localeCompare(a.createdAt)||b.key.localeCompare(a.key));
}
export function taskHistorySlice(library:Library,options:TaskOptions={}){
 const all=tasks(library),query=(options.query??'').trim().toLocaleLowerCase();
 const matches=all.filter(v=>(!options.state||options.state==='all'||v.state===options.state)&&`${v.title} ${v.project}`.toLocaleLowerCase().includes(query));
 const size=[10,20,50].includes(options.size??10)?options.size??10:10,pages=Math.max(1,Math.ceil(matches.length/size)),page=Math.max(1,Math.min(Math.floor(options.page??1)||1,pages));
 return {rows:matches.slice((page-1)*size,page*size),page,pages,total:matches.length,counts:Object.fromEntries(Object.keys(states).map(s=>[s,s==='all'?all.length:all.filter(v=>v.state===s).length]))};
}
export function taskHistoryRows(library:Library,options:TaskOptions={}){
 return taskHistorySlice(library,options).rows.map(v=>{
  const [icon,label]=states[v.state]??['','未知'];const failed=v.state==='failed'||v.state==='interrupted';
  const result=failed?`<details data-task-error="${esc(v.key)}"><summary>查看原因</summary><pre>${esc(v.error||v.stage||'暂无详细原因')}</pre></details>`:v.state==='succeeded'?(v.duration?`${Math.floor(v.duration/60)}:${String(Math.floor(v.duration%60)).padStart(2,'0')}`:v.hasAudio?'音频已保存':'处理完成'):v.state==='queued'?'等待执行':v.state==='cancelled'?'任务已取消':esc(v.stage==='running'?'正在生成':v.stage);
  return `<tr class="task-history-row"><td><strong>${esc(v.title)}</strong><small>${esc(v.project)}</small></td><td><span class="task-state task-state--${esc(v.state)}"><span aria-hidden="true">${icon}</span>${label}</span></td><td class="task-result">${result}</td><td><time datetime="${esc(v.createdAt)}">${esc(new Date(v.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}))}</time></td><td><button class="secondary" data-action="task-version" data-id="${esc(v.id)}" data-sound="${esc(v.soundId)}">${v.hasAudio?'查看生成结果':'查看版本'}</button></td></tr>`;
 }).join('');
}
/** Own filter state and update only the list; polling must not replace the search input. */
export class TaskHistoryView{
 private options:TaskOptions={page:1,size:10,state:'all',query:''};private library?:Library;
 private host:HTMLElement;
 constructor(host:HTMLElement){this.host=host;}
 render(library:Library){
  this.library=library;
  if(!this.host.querySelector('#task-history')){
   this.host.innerHTML=`<section id="task-history"><header class="task-heading"><h1>任务列表</h1><p>查看生成进度与历史结果</p></header><div class="task-toolbar"><div class="task-filters" role="group" aria-label="任务状态"></div><input id="task-search" type="search" aria-label="搜索任务" placeholder="搜索项目、声音或版本"></div><div class="task-table-wrap"><table class="task-table"><thead><tr><th>作品</th><th>状态</th><th>进度或结果</th><th>创建时间</th><th>操作</th></tr></thead><tbody></tbody></table><p class="task-empty" hidden>没有符合条件的任务。</p><footer class="task-pagination"><span data-task-total></span><label>每页 <select aria-label="每页任务数"><option>10</option><option>20</option><option>50</option></select> 项</label><nav aria-label="任务分页"></nav></footer></div><p class="task-history-note">已删除内容请到回收站查看；同步歌词显示各版本最近一次任务。</p></section>`;
   const search=this.host.querySelector<HTMLInputElement>('#task-search')!;search.value=this.options.query??'';search.oninput=()=>{this.options.query=search.value;this.options.page=1;this.update();};
   const size=this.host.querySelector<HTMLSelectElement>('.task-pagination select')!;size.value=String(this.options.size);size.onchange=()=>{this.options.size=Number(size.value);this.options.page=1;this.update();};
   this.host.querySelector('#task-history')!.addEventListener('click',event=>{const b=(event.target as HTMLElement).closest<HTMLButtonElement>('button[data-task-filter],button[data-task-page]');if(!b||b.disabled)return;if(b.dataset.taskFilter){this.options.state=b.dataset.taskFilter as TaskFilter;this.options.page=1;}else this.options.page=Number(b.dataset.taskPage);this.update();});
  }
  this.update();
 }
 private update(){
  if(!this.library)return;const result=taskHistorySlice(this.library,this.options);this.options.page=result.page;
  const filters=this.host.querySelector('.task-filters')!;filters.innerHTML=Object.entries(states).map(([state,[icon,label]])=>`<button type="button" class="task-filter" data-task-filter="${state}" aria-pressed="${this.options.state===state}">${icon?`<span class="task-filter-icon task-state--${state}" aria-hidden="true">${icon}</span>`:''}${label}<small>${result.counts[state]}</small></button>`).join('');
  const body=this.host.querySelector('tbody')!,html=taskHistoryRows(this.library,this.options);if(body.innerHTML!==html){const opened=new Set([...body.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d=>d.dataset.taskError));body.innerHTML=html;body.querySelectorAll<HTMLDetailsElement>('details').forEach(d=>d.open=opened.has(d.dataset.taskError));}
  (this.host.querySelector('.task-empty') as HTMLElement).hidden=!!result.total;
  this.host.querySelector('[data-task-total]')!.textContent=`共 ${result.total} 项`;
  const pages=[...new Set([1,result.page-1,result.page,result.page+1,result.pages])].filter(n=>n>=1&&n<=result.pages).sort((a,b)=>a-b);
  this.host.querySelector('.task-pagination nav')!.innerHTML=`<button data-task-page="${result.page-1}" ${result.page===1?'disabled':''} aria-label="上一页任务">上一页</button>`+pages.map((n,i)=>`${i&&n>pages[i-1]+1?'<span>…</span>':''}<button data-task-page="${n}" ${n===result.page?'aria-current="page"':''} aria-label="任务第 ${n} 页">${n}</button>`).join('')+`<button data-task-page="${result.page+1}" ${result.page===result.pages?'disabled':''} aria-label="下一页任务">下一页</button>`;
 }
}
