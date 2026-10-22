import type {ServiceCaller} from '../../service/operations.ts';
import type {MonitorSnapshot} from '../../service/resources/monitor.ts';
import {poolBudget} from '../../service/resources/policy.ts';
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const bytes=(n:number)=>`${(n/2**30).toFixed(1)} GiB`;
export function monitorMarkup(s?:MonitorSnapshot,error?:string){
 const system=s?.system,app=s?.application,hardware=s?.resources?.hardware,policy=s?.resources?.policy,pool=hardware?.pools.find(p=>p.id==='memory');
 const pressure=hardware?{normal:'压力正常',warning:'压力偏高',critical:'压力紧张',unknown:'压力暂不可用'}[hardware.pressure]:s||error?'压力暂不可用':'采样中';
 const budget=pool&&policy?poolBudget(pool,policy):undefined,task=s?.resources?.task;
 const memory=(n?:number)=>n===undefined?(s||error?'暂不可用':'采样中'):bytes(n);
 const memoryDetails=hardware?.memory;
 const taskNote=task?.demand?`<p class="monitor-budget">${task.stage==='waiting_resources'?'等待资源 · ':task.stage==='queued'?'排队中 · ':''}任务预约 ${bytes((task.demand.startup??task.demand.peak).memory??0)} · 保护上限 ${bytes(task.admission?.allowed?task.admission.budgets.memory:task.demand.peak.memory)}</p>`:'';
 const budgetNote=`<p class="monitor-budget">${budget?`本程序可再用约 <strong>${bytes(budget.startupBudget)}</strong>${hardware?.pressure!=='normal'?' · 暂停新任务':''}`:s||error?'启动预算暂不可用':'启动预算采样中'}</p>`;
 const details=s?`<details class="monitor-details"><summary>内存详情</summary><p>非空闲 ${memory(system?.memoryUsed)} / ${memory(system?.memoryTotal)}（含缓存）</p>${memoryDetails?`<p>空闲 ${bytes(memoryDetails.free)} · 可清理 ${bytes(memoryDetails.purgeable)}</p><p>非活动 ${bytes(memoryDetails.inactive)} · 文件后备 ${bytes(memoryDetails.fileBacked)}</p><p>压缩 ${bytes(memoryDetails.compressed)} · 固定 ${bytes(memoryDetails.wired)}</p><p>交换占用 ${bytes(memoryDetails.swapUsed)}</p><p>累计换入 ${bytes(memoryDetails.swapInBytes)} · 换出 ${bytes(memoryDetails.swapOutBytes)}</p><p>系统可用估计 ${bytes(pool!.available)}（${memoryDetails.pressureAvailablePercent}%）；其中超出空闲约 ${bytes(memoryDetails.estimatedReclaimable)}，可回收程度不确定。</p>`:''}${budget&&pool&&policy?`<p>应用上限 ${bytes(budget.limit)} · 本程序已占 ${bytes(pool.owned)} · 额外余量 ${bytes(policy.headroom)}</p>`:''}<p>启动预算来自系统估计与应用剩余额度，不保证模型一定能运行；各内存分类有重叠，不相加。运行时继续监测。</p>${task?.message?`<p>${esc(task.message)}</p>`:''}${s.resourceError?`<p>${esc(s.resourceError)}</p>`:''}</details>`:'';
 const cpu=(n:number|undefined,failed?:string)=>n===undefined?(failed?'暂不可用':'采样中'):`${n.toFixed(1)}%`;
 const systemNote=error??system?.error??`整机总算力为 100%；共 ${system?.memoryTotal?bytes(system.memoryTotal):'未知'} 内存，非空闲内存含系统缓存`;
 const appNote=error??app?.memoryError??app?.error??`当前服务及生成任务，${app?.processCount??'未知'} 个进程；${app?.memoryKind==='footprint'?'内存含压缩和换出部分':'驻留内存含共享页，不含换出部分'}`;
 return `<table aria-label="实时资源占用"><thead><tr><th scope="col">资源</th><th scope="col">CPU</th><th scope="col">内存状态</th></tr></thead><tbody><tr title="${esc(systemNote)}"><th scope="row">整机</th><td>${cpu(system?.cpuPercent,error??system?.error)}</td><td>${pressure}</td></tr><tr title="${esc(appNote)}"><th scope="row">本程序</th><td>${cpu(app?.cpuPercent,error??app?.error)}</td><td>${memory(app?.memoryBytes)}</td></tr></tbody></table>${budgetNote}${taskNote}${details}${error?`<p class="monitor-error" title="${esc(error)}">资源采样暂不可用</p>`:''}`;
}
/** Sidebar lives across navigation; use the shared refresh tick and stop polling in hidden tabs. */
export class MachineMonitorView{
 private busy=false;private last=-Infinity;
 private readonly host:HTMLElement;private readonly call:ServiceCaller;
 constructor(host:HTMLElement,call:ServiceCaller){this.host=host;this.call=call;}
 mount(){
  this.host.innerHTML=`<section id="machine-monitor" aria-label="电脑与本程序资源"><div class="monitor-values">${monitorMarkup()}</div></section>`;
  void this.refresh();
 }
 async refresh(){
  const target=this.host.querySelector('.monitor-values');
  if(!target||document.hidden||this.busy||performance.now()-this.last<1500)return;
  this.busy=true;
  try{
   const value=await this.call('monitor_status',{});if(!value.system||!value.application)throw Error('监控暂不可用，请确认服务已更新');
   if(target.isConnected){const expanded=target.querySelector('details')?.open;target.innerHTML=monitorMarkup(value);const details=target.querySelector('details');if(details)details.open=!!expanded;}
  }catch(error){if(target.isConnected){target.innerHTML=monitorMarkup(undefined,error instanceof Error?error.message:'暂时无法读取监控数据');}}
  finally{this.busy=false;this.last=performance.now();}
 }
}
