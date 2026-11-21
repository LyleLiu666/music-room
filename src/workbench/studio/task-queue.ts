type QueueStatus={active?:unknown;queued:unknown[];paused:boolean};

export function queueSummary(status:QueueStatus|undefined,offline:boolean){
 if(offline)return '后台连接中断 · 队列状态未知';if(!status)return '正在连接后台…';
 if(status.paused)return `${status.active?'正在处理 1 项 · ':''}队列已暂停 · 等待 ${status.queued.length} 项`;
 return status.active||status.queued.length?`正在处理 ${status.active?1:0} 项 · 排队 ${status.queued.length} 项`:'后台空闲 · 无排队任务';
}
/** 侧栏「任务与资源」右侧的一行实时状态；空闲时为空。 */
export function liveSummary(status:QueueStatus|undefined,offline:boolean){
 if(offline)return {text:'连接中断',state:'offline'};
 if(!status)return {text:'',state:''};
 const waiting=status.queued.length;
 if(status.paused)return {text:waiting?`已暂停 · ${waiting} 排队`:'已暂停',state:'paused'};
 if(status.active||waiting)return {text:[status.active?'1 进行中':'',waiting?`${waiting} 排队`:''].filter(Boolean).join(' · '),state:'working'};
 return {text:'',state:''};
}
export function renderTaskSidebar(status:QueueStatus|undefined,offline:boolean){
 const summary=queueSummary(status,offline),live=liveSummary(status,offline);
 for(const el of document.querySelectorAll<HTMLElement>('[data-task-live]')){
  if(el.textContent!==live.text)el.textContent=live.text;
  el.dataset.state=live.state;el.closest('button')?.setAttribute('title',summary);
 }
}
