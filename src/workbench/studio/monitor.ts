import type {ServiceCaller} from '../../service/operations.ts';
import type {MonitorSnapshot} from '../../service/resources/monitor.ts';
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const bytes=(n:number)=>`${(n/2**30).toFixed(1)} GB`;
export function monitorMarkup(s?:MonitorSnapshot,error?:string){
 const system=s?.system,app=s?.application;
 const cpu=(n:number|undefined,failed?:string)=>n===undefined?(failed?'暂不可用':'采样中'):`${n.toFixed(1)}%`;
 const memory=(n?:number)=>n===undefined?(s||error?'暂不可用':'采样中'):bytes(n);
 const systemNote=error??system?.error??`整机总算力为 100%；共 ${system?.memoryTotal?bytes(system.memoryTotal):'未知'} 内存，非空闲内存含系统缓存`;
 const appNote=error??app?.memoryError??app?.error??`当前服务及生成任务，${app?.processCount??'未知'} 个进程；${app?.memoryKind==='footprint'?'内存含压缩和换出部分':'驻留内存含共享页，不含换出部分'}`;
 return `<table aria-label="实时资源占用"><thead><tr><th scope="col">资源</th><th scope="col">CPU</th><th scope="col">内存</th></tr></thead><tbody><tr title="${esc(systemNote)}"><th scope="row">整机</th><td>${cpu(system?.cpuPercent,error??system?.error)}</td><td>${memory(system?.memoryUsed)}</td></tr><tr title="${esc(appNote)}"><th scope="row">本程序</th><td>${cpu(app?.cpuPercent,error??app?.error)}</td><td>${memory(app?.memoryBytes)}</td></tr></tbody></table>${error?`<p class="monitor-error" title="${esc(error)}">资源采样暂不可用</p>`:''}`;
}
/** Sidebar lives across navigation; use the shared refresh tick and stop polling in hidden tabs. */
export class MachineMonitorView{
 private busy=false;private last=-Infinity;
 constructor(private readonly host:HTMLElement,private readonly call:ServiceCaller){}
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
   if(target.isConnected){target.innerHTML=monitorMarkup(value);}
  }catch(error){if(target.isConnected){target.innerHTML=monitorMarkup(undefined,error instanceof Error?error.message:'暂时无法读取监控数据');}}
  finally{this.busy=false;this.last=performance.now();}
 }
}
