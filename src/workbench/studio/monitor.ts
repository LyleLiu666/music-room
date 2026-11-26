import type {ServiceCaller} from '../../service/operations.ts';
import type {MonitorSnapshot} from '../../service/resources/monitor.ts';
import {poolBudget} from '../../service/resources/policy.ts';
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const bytes=(n:number)=>`${(n/2**30).toFixed(1)} GiB`;
export function monitorMarkup(s?:MonitorSnapshot,error?:string,inline=false){
 const system=s?.system,app=s?.application,hardware=s?.resources?.hardware,policy=s?.resources?.policy,pool=hardware?.pools.find(p=>p.id==='memory');
 const pressure=hardware?{normal:'压力正常',warning:'压力偏高',critical:'压力紧张',unknown:'压力暂不可用'}[hardware.pressure]:s||error?'压力暂不可用':'采样中';
 const budget=pool&&policy?poolBudget(pool,policy):undefined,task=s?.resources?.task;
 const memory=(n?:number)=>n===undefined?(s||error?'暂不可用':'采样中'):bytes(n);
 const memoryDetails=hardware?.memory;
 const taskNote=task?.demand?`<p class="monitor-budget">${task.stage==='waiting_resources'?'等待资源 · ':task.stage==='queued'?'排队中 · ':''}任务预约 ${bytes((task.demand.startup??task.demand.peak).memory??0)} · 保护上限 ${bytes(task.admission?.allowed?task.admission.budgets.memory:task.demand.peak.memory)}</p>`:'';
 const budgetNote=`<p class="monitor-budget">${budget?`本程序可再用约 <strong>${bytes(budget.startupBudget)}</strong>${hardware?.pressure==='critical'?'（含缓存粗估；压力过高，已暂停新任务）':hardware?.pressure==='warning'?'（含缓存粗估；压力偏高，预算充足可启动）':''}`:s||error?'启动预算暂不可用':'启动预算采样中'}</p>`;
 const details=s?`<${inline?'div':'details'} class="monitor-details">${inline?'':'<summary>内存详情</summary>'}<dl><dt>总内存</dt><dd>${memory(system?.memoryTotal)}</dd>${budget?`<dt>程序上限</dt><dd>${bytes(budget.limit)}</dd>`:''}${memoryDetails?`<dt>压缩</dt><dd>${bytes(memoryDetails.compressed)}</dd><dt>交换</dt><dd>${bytes(memoryDetails.swapUsed)}</dd>`:''}</dl>${s.resourceError?`<p title="${esc(s.resourceError)}">内存数据暂不可用</p>`:''}</${inline?'div':'details'}>`:'';
 const cpu=(n:number|undefined,failed?:string)=>n===undefined?(failed?'暂不可用':'采样中'):`${n.toFixed(1)}%`;
 const systemNote=error??system?.error??`整机总算力为 100%；共 ${system?.memoryTotal?bytes(system.memoryTotal):'未知'} 内存，非空闲内存含系统缓存`;
 const appNote=error??app?.memoryError??app?.error??`当前服务及生成任务，${app?.processCount??'未知'} 个进程；${app?.memoryKind==='footprint'?'内存含压缩和换出部分':'驻留内存含共享页，不含换出部分'}`;
 return `<table aria-label="实时资源占用"><thead><tr><th scope="col">资源</th><th scope="col">CPU</th><th scope="col">内存状态</th></tr></thead><tbody><tr title="${esc(systemNote)}"><th scope="row">整机</th><td>${cpu(system?.cpuPercent,error??system?.error)}</td><td>${pressure}</td></tr><tr title="${esc(appNote)}"><th scope="row">本程序</th><td>${cpu(app?.cpuPercent,error??app?.error)}</td><td>${memory(app?.memoryBytes)}</td></tr></tbody></table>${budgetNote}${taskNote}${details}${error?`<p class="monitor-error" title="${esc(error)}">资源采样暂不可用</p>`:''}`;
}
/** 侧栏底部的一行本机状态：只回答「现在能不能开始新的重型任务」。完整数据在「任务与资源」。 */
export function monitorLine(s?:MonitorSnapshot,error?:string){
 const hardware=s?.resources?.hardware,policy=s?.resources?.policy,pool=hardware?.pools.find(p=>p.id==='memory')??hardware?.pools[0];
 const budget=pool&&policy?poolBudget(pool,policy):undefined;
 const meter=(ratio:number)=>`<span class="monitor-meter" aria-hidden="true">${Array.from({length:5},(_,i)=>`<i${i<Math.round(Math.min(1,Math.max(0,ratio))*5)?' class="on"':''}></i>`).join('')}</span>`;
 if(error||s?.resourceError&&!hardware)return {state:'error',html:`<span class="monitor-text">暂时无法读取内存</span>`};
 if(!s||!hardware)return {state:'',html:`<span class="monitor-text">内存 采样中</span>`};
 if(hardware.pressure==='critical')return {state:'error',html:`<span class="monitor-text">内存过高 · 已停止重型任务</span>`};
 if(hardware.pressure==='unknown'||!budget)return {state:'error',html:`<span class="monitor-text">暂时无法读取内存</span>`};
 if(hardware.pressure==='warning')return {state:'warn',html:`<span class="monitor-text">内存偏高 · 可用约 <b>${bytes(budget.startupBudget)}</b></span>${meter(budget.limit?1-budget.startupBudget/budget.limit:0)}`};
 return {state:'',html:`<span class="monitor-text">内存 <b>正常</b> · 可用约 <b>${bytes(budget.startupBudget)}</b></span>${meter(budget.limit?1-budget.startupBudget/budget.limit:0)}`};
}
/** Sidebar lives across navigation; use the shared refresh tick and stop polling in hidden tabs. */
export class MachineMonitorView{
 private busy=false;private last=-Infinity;
 private readonly host:HTMLElement;private readonly call:ServiceCaller;
 snapshot?:MonitorSnapshot;error?:string;
 onUpdate?:()=>void;
 constructor(host:HTMLElement,call:ServiceCaller){this.host=host;this.call=call;}
 mount(){
  this.host.innerHTML=`<button type="button" id="machine-monitor" data-action="resource-overview" aria-label="本机内存状态，查看任务与资源"></button>`;
  this.paint();void this.refresh();
 }
 /** 任务与资源页「详细数据」：整机 / 本程序 CPU 与内存。 */
 details(){return `<div class="monitor-values">${monitorMarkup(this.snapshot,this.error,true)}</div>`;}
 private paint(){
  const target=this.host.querySelector<HTMLElement>('#machine-monitor');
  if(!target)return;
  const line=monitorLine(this.snapshot,this.error);
  if(target.innerHTML!==line.html)target.innerHTML=line.html;
  target.dataset.state=line.state;
 }
 async refresh(){
  if(!this.host.querySelector('#machine-monitor')||document.hidden||this.busy||performance.now()-this.last<1500)return;
  this.busy=true;
  try{
   const value=await this.call('monitor_status',{});if(!value.system||!value.application)throw Error('监控暂不可用，请确认服务已更新');
   this.snapshot=value;this.error=undefined;
  }catch(error){this.snapshot=undefined;this.error=error instanceof Error?error.message:'暂时无法读取监控数据';}
  finally{this.busy=false;this.last=performance.now();this.paint();this.onUpdate?.();}
 }
}
