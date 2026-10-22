import {execFile} from 'node:child_process';
import {totalmem,freemem} from 'node:os';
import type {HardwareSnapshot,SystemMemory} from './contracts.ts';
export function commandOutput(command:string,args:string[],timeout=3000){return new Promise<string>((resolve,reject)=>execFile(command,args,{encoding:'utf8',timeout,maxBuffer:2*1048576,env:{...process.env,LC_ALL:'C'}},(error,stdout)=>error?reject(error):resolve(stdout)));}
/** One asynchronous process-table read per sample, with one bounded retry for OS timeouts. */
export async function processGroupPids(groups:number[],read:(command:string,args:string[],timeout:number)=>Promise<string>=commandOutput){
 let output:string;
 try{output=await read('/bin/ps',['-axo','pid=,pgid=,stat='],2000);}
 catch(error:any){if(error?.code!=='ETIMEDOUT'&&error?.killed!==true)throw error;output=await read('/bin/ps',['-axo','pid=,pgid=,stat='],1000);}
 const selected=new Set(groups);
 return output.trim().split('\n').flatMap(line=>{
  const fields=line.trim().split(/\s+/),[pid,group,state]=fields;
  if(fields.length!==3||!/^\d+$/.test(pid)||!/^\d+$/.test(group)||!Number.isSafeInteger(Number(pid))||Number(pid)<1||!Number.isSafeInteger(Number(group))||!state)throw Error('无法读取完整进程列表');
  return selected.has(Number(group))&&!state.startsWith('Z')?[Number(pid)]:[];
 });
}
export function ownedProcesses<T extends {pid:number;ppid:number;zombie:boolean}>(rows:T[],root:number){
 const alive=rows.filter(r=>!r.zombie),ids=new Set([root]);
 if(!alive.some(r=>r.pid===root))throw Error('服务进程不在采样结果中');
 let added=true;while(added){added=false;for(const r of alive)if(ids.has(r.ppid)&&!ids.has(r.pid)){ids.add(r.pid);added=true;}}
 return alive.filter(r=>ids.has(r.pid));
}
/** Include the service and its living descendants in application headroom accounting. */
export async function applicationFootprint(measure:(pid:number)=>Promise<number>,read=commandOutput,root=process.pid){
 const text=await read('/bin/ps',['-axo','pid=,ppid=,stat=']);
 const rows=text.trim().split('\n').map(line=>{
  const match=line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/u);
  if(!match||!Number.isSafeInteger(Number(match[1]))||Number(match[1])<1||!Number.isSafeInteger(Number(match[2])))throw Error('无法读取本程序进程列表');
  return {pid:Number(match[1]),ppid:Number(match[2]),zombie:match[3].startsWith('Z')};
 });
 const owned=ownedProcesses(rows,root);
 const values=await Promise.all(owned.map(async row=>{try{return await measure(row.pid);}catch(error){if(!processExists(row.pid))return 0;throw error;}}));
 if(values.some(value=>!Number.isSafeInteger(value)||value<0))throw Error('本程序占用指标无效');
 return {total:values.reduce((sum,value)=>sum+value,0),service:values[owned.findIndex(row=>row.pid===root)]};
}
function processExists(pid:number){try{process.kill(pid,0);return true;}catch(error:any){if(error.code==='ESRCH')return false;throw error;}}
export function parsePressure(capacity:number,free:string,level:string):HardwareSnapshot{
 const match=free.match(/System-wide memory free percentage:\s*(\d+)%/),code=Number(level.trim()),percent=Number(match?.[1]);
 if(!match||percent<0||percent>100||![1,2,4].includes(code)||!Number.isSafeInteger(capacity)||capacity<1)throw new Error('内存指标无效');
 return {supported:true,topology:'unified',sampledAt:Date.now(),pressure:code===1?'normal':code===2?'warning':'critical',pools:[{id:'memory',capacity,available:Math.floor(capacity*percent/100),owned:0}]};
}
/** phys_footprint includes compressed/swap-backed ownership; RSS is not added to it. */
export function parseFootprint(text:string){const match=text.match(/^Physical footprint:\s*([\d.]+)([KMGT])/m);if(!match)throw new Error('无法读取进程物理占用');const bytes=Math.ceil(Number(match[1])*({K:1024,M:2**20,G:2**30,T:2**40}[match[2]]??NaN));if(!Number.isSafeInteger(bytes)||bytes<0)throw new Error('进程占用指标无效');return bytes;}
export function parseSwap(text:string){const match=text.match(/used\s*=\s*([\d.]+)([KMGT])/),bytes=Math.ceil(Number(match?.[1])*({K:1024,M:2**20,G:2**30,T:2**40}[match?.[2]??'']??NaN));if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('交换空间指标无效');return bytes;}
export async function physicalBytes(pid:number){return parseFootprint(await commandOutput('/usr/bin/vmmap',['-summary',String(pid)]));}
export async function probeHardware(measure:(pid:number)=>Promise<number>=physicalBytes,system?:()=>Promise<SystemMemory>):Promise<HardwareSnapshot>{
 if(process.platform!=='darwin'||process.arch!=='arm64'){const capacity=totalmem(),available=freemem();return {supported:true,topology:'cpu',sampledAt:Date.now(),pressure:available<Math.max(2**30,capacity*.1)?'critical':'normal',pools:[{id:'memory',capacity,available,owned:process.memoryUsage().rss}]};}
 const [free,level,owned,swap,memory]=await Promise.all([commandOutput('/usr/bin/memory_pressure',['-Q']),commandOutput('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level']),applicationFootprint(measure),commandOutput('/usr/sbin/sysctl',['vm.swapusage']),system?.()]);
 const snapshot=parsePressure(totalmem(),free,level);snapshot.pools[0].owned=owned.total;snapshot.serviceOwned=owned.service;snapshot.swapUsed=memory?.swapUsed??parseSwap(swap);if(memory)attachMemory(snapshot,memory);return snapshot;
}

export async function observeProcesses(groups:number[],baseline:HardwareSnapshot,measure:(pid:number)=>Promise<number>=physicalBytes,system?:()=>Promise<SystemMemory>){
 const pids=new Set<number>([process.pid,...await processGroupPids(groups)]);
 const values=await Promise.all([...pids].map(async pid=>{if(!processExists(pid))return 0;try{return await measure(pid);}catch(error){if(!processExists(pid))return 0;throw error;}}));
 const [free,level,swap,memory]=await Promise.all([commandOutput('/usr/bin/memory_pressure',['-Q']),commandOutput('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level']),commandOutput('/usr/sbin/sysctl',['vm.swapusage']),system?.()]);
 const current=parsePressure(totalmem(),free,level);return {usage:{memory:Math.max(0,values.reduce((a,b)=>a+b,0)-(baseline.serviceOwned??baseline.pools.find(p=>p.id==='memory')?.owned??0))},swapUsed:memory?.swapUsed??parseSwap(swap),swapOutBytes:memory?.swapOutBytes,pressure:current.pressure};
}

/** OS pressure availability is an estimate, not a sum of inactive/file-backed/compressed pages. */
export function attachMemory(snapshot:HardwareSnapshot,memory:SystemMemory){
 const pool=snapshot.pools.find(p=>p.id==='memory');if(!pool||pool.capacity!==memory.capacity)throw Error('系统内存容量采样不一致');
 snapshot.memory={...memory,pressureAvailablePercent:Math.round(pool.available/pool.capacity*100),estimatedReclaimable:Math.max(0,pool.available-memory.free)};
 return snapshot;
}
