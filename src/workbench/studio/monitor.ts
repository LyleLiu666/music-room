import type {ServiceCaller} from '../../service/operations.ts';
import type {MonitorSnapshot} from '../../service/resources/monitor.ts';
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const bytes=(n:number)=>`${(n/2**30).toFixed(1)} GB`;
function metric(title:string,value:string,detail:string,level?:number){return `<div class="monitor-metric"><h3>${title}</h3><strong>${value}</strong><div class="monitor-meter" aria-hidden="true"><i style="width:${level===undefined?0:Math.max(0,Math.min(100,level))}%"></i></div><p>${esc(detail)}</p></div>`;}
export function monitorMarkup(s?:MonitorSnapshot,error?:string){
 const system=s?.system,app=s?.application,total=system?.memoryTotal;
 const cpu=(n:number|undefined,failed?:string)=>n===undefined?(failed?'暂不可用':'采样中…'):`${n.toFixed(1)}<small>%</small>`;
 const memory=(n?:number)=>n===undefined?'暂不可用':bytes(n);
 return `<header class="project-header"><div><p class="eyebrow">当前电脑 · 实时资源</p><h1>监控</h1><p class="library-intro">查看电脑负载，以及 Music Room 正在使用的资源。</p></div><p class="monitor-updated" role="status">${error?esc(error):s?'更新于 '+new Date(s.sampledAt).toLocaleTimeString('zh-CN',{hour12:false}):'正在读取资源…'}</p></header>
 <div class="monitor-grid"><section class="monitor-group" aria-label="整机资源"><header><h2>整台电脑</h2><span>${s?.cpuCount?s.cpuCount+' 个逻辑核心':'等待采样'}</span></header>${metric('CPU 占用',cpu(system?.cpuPercent,error??system?.error),'整机总算力为 100%',system?.cpuPercent)}${metric('内存占用',memory(system?.memoryUsed),system?.error??(total?'共 '+bytes(total)+' · 非空闲内存，含系统缓存':'正在读取物理内存'),total&&system?.memoryUsed!==undefined?system.memoryUsed/total*100:undefined)}</section>
 <section class="monitor-group" aria-label="本程序资源"><header><h2>Music Room</h2><span>${app?.processCount===undefined?'服务与生成任务':app.processCount+' 个进程'}</span></header>${metric('CPU 占用',cpu(app?.cpuPercent,error??app?.error),app?.error??'与整机使用相同的百分比口径',app?.cpuPercent)}${metric('内存占用',memory(app?.memoryBytes),app?.memoryError??app?.error??(app?.memoryKind==='footprint'?'本程序及生成任务，含压缩和换出内存':'进程驻留内存，含共享页，不含换出部分'),total&&app?.memoryBytes!==undefined?app.memoryBytes/total*100:undefined)}</section></div>
 <div class="monitor-notes"><p>本程序包含当前服务及其音乐生成、语音等子进程，不包含浏览器或其他 Music Room 实例。</p><p>页面可见时约每 2 秒更新。CPU 根据两次采样的差值计算，首次打开需等待下一次更新。</p><p>整机与本程序的内存统计方式不同，不宜直接相减；共享内存可能重复计入。</p></div>`;
}
/** No background polling or model actions; the workbench supplies its existing refresh tick. */
export class MachineMonitorView{
 private busy=false;private last=-Infinity;
 constructor(private readonly host:HTMLElement,private readonly call:ServiceCaller){}
 mount(){if(!this.host.querySelector('#machine-monitor')){this.host.innerHTML='<section id="machine-monitor">'+monitorMarkup()+'</section>';this.last=-Infinity;}void this.refresh();}
 async refresh(){
  const target=this.host.querySelector('#machine-monitor');
  if(!target||document.hidden||this.busy||performance.now()-this.last<1500)return;
  this.busy=true;
  try{const value=await this.call('monitor_status',{});if(!value.system||!value.application)throw Error('监控暂不可用，请确认服务已更新');if(target.isConnected)target.innerHTML=monitorMarkup(value);}
  catch(error){if(target.isConnected)target.innerHTML=monitorMarkup(undefined,error instanceof Error?error.message:'暂时无法读取监控数据');}
  finally{this.busy=false;this.last=performance.now();}
 }
}
