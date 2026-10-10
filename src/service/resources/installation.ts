import {existsSync,lstatSync,statfsSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute} from 'node:path';
import {ResourceError,type ResourceExecution,type ResourceTaskState} from './contracts.ts';
import type {ResourceCoordinator} from './coordinator.ts';
const registered=new WeakSet<ResourceCoordinator>();
export function checkDisk(directory:string,bytes:number,probe=statfsSync){
 if(!isAbsolute(directory)||!Number.isSafeInteger(bytes)||bytes<0)throw new Error('磁盘预算参数无效');
 let parent=directory;while(!existsSync(parent)){const next=dirname(parent);if(next===parent)throw new ResourceError('DISK_TELEMETRY_UNAVAILABLE','无法读取安装磁盘');parent=next;}
 if(lstatSync(parent).isSymbolicLink())throw new Error('安装路径不能是符号链接');parent=realpathSync(parent);
 for(let path=parent;;path=dirname(path)){if(lstatSync(path).isSymbolicLink())throw new Error('安装路径不能包含符号链接');if(path===dirname(path))break;}
 let available:number;try{const fs=probe(parent);available=Number(fs.bavail)*Number(fs.bsize);}catch{throw new ResourceError('DISK_TELEMETRY_UNAVAILABLE','无法读取安装磁盘可用量');}
 if(!Number.isSafeInteger(available)||available<0)throw new ResourceError('DISK_TELEMETRY_UNAVAILABLE','安装磁盘指标无效');
 if(bytes>0&&available<bytes+2*2**30)throw new ResourceError('INSUFFICIENT_DISK','安装磁盘空间不足；请释放空间或选择其他目录');return available;
}
export function installTask<T>(resources:ResourceCoordinator,options:{id:string;directory:string;diskBytes:number;signal:AbortSignal;onState?:(state:ResourceTaskState)=>void;execute:(execution:ResourceExecution)=>Promise<T>}){
 if(!registered.has(resources)){resources.register('installation',{resident:()=>undefined,unload:async()=>{}});registered.add(resources);}
 return resources.run({id:options.id,engine:'installation',signal:options.signal,demand:resources.estimate('installation',{directory:options.directory}),onState:options.onState,execute:async context=>{context.signal.throwIfAborted();checkDisk(options.directory,options.diskBytes);context.running();return options.execute(context);}});
}

/** Recheck live disk availability during streams whose response length may be absent. */
export function diskGuard(directory:string){let written=0,next=64*1048576;return (bytes:number)=>{written+=bytes;if(written>=next){checkDisk(directory,64*1048576);next=written+64*1048576;}};}
