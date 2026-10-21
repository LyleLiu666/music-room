import {cpus,totalmem,freemem} from 'node:os';
import {commandOutput} from './telemetry.ts';
import {nativeFootprint} from './native-telemetry.ts';
import type {AssetReader} from '../render/renderer.ts';
export type MonitorSnapshot={sampledAt:number;cpuCount?:number;system:{cpuPercent?:number;memoryUsed?:number;memoryTotal?:number;error?:string};application:{cpuPercent?:number;memoryBytes?:number;processCount?:number;memoryKind:'footprint'|'rss';error?:string;memoryError?:string}};
type ProcessSample={pid:number;ppid:number;cpuMs:number;rss:number;start:string;zombie:boolean};
type SystemSample={total:number;idle:number;cpuCount:number;memoryTotal:number;memoryFree:number};
type MonitorOptions={pid?:number;now?:()=>number;readSystem?:()=>SystemSample;readProcesses?:()=>Promise<ProcessSample[]>;measure?:(pid:number)=>Promise<number>};
export function parseMonitorProcesses(text:string):ProcessSample[]{
 return text.trim().split('\n').map(line=>{
  const match=line.trim().match(/^(\d+)\s+(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s+(\d+)\s+(\S+)\s+(.+)$/);
  if(!match)throw Error('无法读取进程采样');
  const [,pid,ppid,days,hours,minutes,seconds,rss,state,start]=match;
  const cpuMs=((Number(days??0)*24+Number(hours??0))*3600+Number(minutes)*60+Number(seconds))*1000;
  const result={pid:Number(pid),ppid:Number(ppid),cpuMs,rss:Number(rss)*1024,start,zombie:state.startsWith('Z')};
  if(!Number.isSafeInteger(result.pid)||result.pid<1||!Number.isSafeInteger(result.ppid)||!Number.isFinite(cpuMs)||!Number.isSafeInteger(result.rss))throw Error('进程采样数值无效');
  return result;
 });
}
export function ownedProcesses(rows:ProcessSample[],root:number){
 const alive=rows.filter(r=>!r.zombie),ids=new Set([root]);
 if(!alive.some(r=>r.pid===root))throw Error('服务进程不在采样结果中');
 let added=true;while(added){added=false;for(const r of alive)if(ids.has(r.ppid)&&!ids.has(r.pid)){ids.add(r.pid);added=true;}}
 return alive.filter(r=>ids.has(r.pid));
}
function readSystem():SystemSample {
 const cores=cpus();return {cpuCount:cores.length,total:cores.reduce((sum,c)=>sum+Object.values(c.times).reduce((a,b)=>a+b,0),0),idle:cores.reduce((sum,c)=>sum+c.times.idle,0),memoryTotal:totalmem(),memoryFree:freemem()};
}
const percent=(n:number)=>Math.max(0,Math.min(100,n));
/** Read-only monitoring; independent of admission budgets and model lifecycle. */
export class MachineMonitor{
 private options:MonitorOptions;private pending?:Promise<MonitorSnapshot>;private cached?:MonitorSnapshot;private sampled=-Infinity;
 private previous?:{at:number;system?:SystemSample;rows?:ProcessSample[]};
 constructor(options:MonitorOptions={}){this.options=options;}
 status():Promise<MonitorSnapshot>{
  if(this.pending)return this.pending;
  const now=this.options.now?.()??performance.now();
  if(this.cached&&now-this.sampled<1500)return Promise.resolve(this.cached);
  this.pending=this.sample(now).then(value=>{this.cached=value;this.sampled=now;return value;}).finally(()=>{this.pending=undefined;});return this.pending;
 }
 private async sample(at:number){
  const result:MonitorSnapshot={sampledAt:Date.now(),system:{},application:{memoryKind:this.options.measure?'footprint':'rss'}};
  let system:SystemSample|undefined,rows:ProcessSample[]|undefined;
  const previous=this.previous&&at-this.previous.at<=10000?this.previous:undefined;
  try{
   system=(this.options.readSystem??readSystem)();
   if(!Number.isInteger(system.cpuCount)||system.cpuCount<1||![system.total,system.idle,system.memoryTotal,system.memoryFree].every(Number.isFinite)||system.memoryTotal<=0||system.memoryFree<0||system.memoryFree>system.memoryTotal)throw Error('系统采样无效');
   result.cpuCount=system.cpuCount;result.system.memoryTotal=system.memoryTotal;result.system.memoryUsed=system.memoryTotal-system.memoryFree;
   if(previous?.system&&previous.system.cpuCount===system.cpuCount){const total=system.total-previous.system.total,idle=system.idle-previous.system.idle;if(total>0&&idle>=0&&idle<=total)result.system.cpuPercent=percent(100*(total-idle)/total);}
  }catch{system=undefined;result.system.error='暂时无法读取整机资源';}
  try{
   rows=ownedProcesses(await (this.options.readProcesses?.()??commandOutput('/bin/ps',['-axo','pid=,ppid=,time=,rss=,stat=,lstart=']).then(parseMonitorProcesses)),this.options.pid??process.pid);
   result.application.processCount=rows.length;
   if(previous?.rows&&system&&previous.system?.cpuCount===system.cpuCount&&at>previous.at){
    const old=new Map(previous.rows.map(r=>[r.pid,r]));
    const cpuMs=rows.reduce((sum,r)=>{const before=old.get(r.pid);return sum+(before?.start===r.start?Math.max(0,r.cpuMs-before.cpuMs):0);},0);
    result.application.cpuPercent=percent(100*cpuMs/(at-previous.at)/system.cpuCount);
   }
   try{
    const bytes=await Promise.all(rows.map(async r=>{
     if(!this.options.measure)return r.rss;
     try{return await this.options.measure(r.pid);}catch(error){try{process.kill(r.pid,0);}catch(e:any){if(e.code==='ESRCH')return 0;}throw error;}
    }));
    if(bytes.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('内存采样无效');
    result.application.memoryBytes=bytes.reduce((a,b)=>a+b,0);
   }catch{result.application.memoryError='暂时无法读取本程序内存';}
  }catch{rows=undefined;result.application.error='暂时无法读取本程序进程';}
  this.previous={at,system,rows};return result;
 }
 async settled(){await this.pending;}
}
export function createMachineMonitor(read:AssetReader){
 const native=process.platform==='darwin'?nativeFootprint(read):undefined;
 const monitor=new MachineMonitor({measure:native?.measure});
 return {status:()=>monitor.status(),close:async()=>{await monitor.settled();await native?.close();}};
}
