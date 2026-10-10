import {groupMembers} from './processes.ts';
import {processIdentity} from './lease.ts';
import {execFile} from 'node:child_process';
import {totalmem,freemem} from 'node:os';
import type {HardwareSnapshot} from './contracts.ts';
export function commandOutput(command:string,args:string[]){return new Promise<string>((resolve,reject)=>execFile(command,args,{encoding:'utf8',timeout:3000,maxBuffer:2*1048576,env:{...process.env,LC_ALL:'C'}},(error,stdout)=>error?reject(error):resolve(stdout)));}
export function parsePressure(capacity:number,free:string,level:string):HardwareSnapshot{
 const match=free.match(/System-wide memory free percentage:\s*(\d+)%/),code=Number(level.trim()),percent=Number(match?.[1]);
 if(!match||percent<0||percent>100||![1,2,4].includes(code)||!Number.isSafeInteger(capacity)||capacity<1)throw new Error('内存指标无效');
 return {supported:true,topology:'unified',sampledAt:Date.now(),pressure:code===1?'normal':code===2?'warning':'critical',pools:[{id:'memory',capacity,available:Math.floor(capacity*percent/100),owned:0}]};
}
/** phys_footprint includes compressed/swap-backed ownership; RSS is not added to it. */
export function parseFootprint(text:string){const match=text.match(/^Physical footprint:\s*([\d.]+)([KMGT])/m);if(!match)throw new Error('无法读取进程物理占用');const bytes=Math.ceil(Number(match[1])*({K:1024,M:2**20,G:2**30,T:2**40}[match[2]]??NaN));if(!Number.isSafeInteger(bytes)||bytes<0)throw new Error('进程占用指标无效');return bytes;}
export function parseSwap(text:string){const match=text.match(/used\s*=\s*([\d.]+)([KMGT])/),bytes=Math.ceil(Number(match?.[1])*({K:1024,M:2**20,G:2**30,T:2**40}[match?.[2]??'']??NaN));if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('交换空间指标无效');return bytes;}
export async function physicalBytes(pid:number){return parseFootprint(await commandOutput('/usr/bin/vmmap',['-summary',String(pid)]));}
export async function probeHardware():Promise<HardwareSnapshot>{
 if(process.platform!=='darwin'||process.arch!=='arm64'){const capacity=totalmem(),available=freemem();return {supported:true,topology:'cpu',sampledAt:Date.now(),pressure:available<Math.max(2**30,capacity*.1)?'critical':'normal',pools:[{id:'memory',capacity,available,owned:process.memoryUsage().rss}]};}
 const [free,level,owned,swap]=await Promise.all([commandOutput('/usr/bin/memory_pressure',['-Q']),commandOutput('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level']),physicalBytes(process.pid),commandOutput('/usr/sbin/sysctl',['vm.swapusage'])]);
 const snapshot=parsePressure(totalmem(),free,level);snapshot.pools[0].owned=owned;snapshot.swapUsed=parseSwap(swap);return snapshot;
}

export async function observeProcesses(groups:number[],baseline:HardwareSnapshot){
 const pids=new Set<number>([process.pid]);for(const group of groups)for(const pid of groupMembers(group))pids.add(pid);
 const values=await Promise.all([...pids].map(async pid=>{const identity=processIdentity(pid);if(!identity)return 0;try{return await physicalBytes(pid);}catch(error){if(!processIdentity(pid))return 0;throw error;}}));
 const [free,level,swap]=await Promise.all([commandOutput('/usr/bin/memory_pressure',['-Q']),commandOutput('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level']),commandOutput('/usr/sbin/sysctl',['vm.swapusage'])]);
 const current=parsePressure(totalmem(),free,level);return {usage:{memory:Math.max(0,values.reduce((a,b)=>a+b,0)-(baseline.pools.find(p=>p.id==='memory')?.owned??0))},swapUsed:parseSwap(swap),pressure:current.pressure};
}
