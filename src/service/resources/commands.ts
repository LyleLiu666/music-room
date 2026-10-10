import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {isAbsolute} from 'node:path';
import {signalWorkload} from './processes.ts';
import {ResourceLease} from './lease.ts';
import type {ResourceExecution} from './contracts.ts';
export type CommandContext=Pick<ResourceExecution,'signal'|'lease'>&{trackProcess?:(pid:number)=>void;report:(line:string)=>void};
let worker={command:process.execPath,args:[fileURLToPath(new URL('./command-worker-entry.ts',import.meta.url))]};
export function configureCommandWorker(command:string,args:string[]){worker={command,args};}
export async function ownedCommand(command:string,args:string[],cwd:string,context:CommandContext){
 context.signal.throwIfAborted();await new Promise<void>((resolve,reject)=>{
  const child=spawn(worker.command,worker.args,{detached:!!context.lease,stdio:['pipe','pipe','pipe']});let failure:unknown,timer:ReturnType<typeof setTimeout>|undefined;child.stdin.on('error',()=>{});child.once('error',error=>failure=error);
  const stop=()=>{child.stdin.end();timer??=setTimeout(()=>{try{if(context.lease&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}},7000);};context.signal.addEventListener('abort',stop,{once:true});
  for(const output of [child.stdout,child.stderr])output.on('data',chunk=>{try{context.report(chunk.toString().slice(-4000));}catch(error){failure=error;stop();}});
  child.once('close',code=>{if(timer)clearTimeout(timer);context.signal.removeEventListener('abort',stop);if(context.signal.aborted)reject(context.signal.reason);else if(failure||code!==0)reject(failure??new Error(`命令失败：${code}`));else resolve();});
  try{if(child.pid)context.trackProcess?.(child.pid);context.signal.throwIfAborted();child.stdin.write(JSON.stringify({command,args,cwd,lease:context.lease})+'\n');}catch(error){failure=error;stop();}
 });
}
export async function runCommandWorker(){
 const lines=createInterface({input:process.stdin});let started=false;
 await new Promise<void>((resolve,reject)=>{lines.once('line',line=>{try{
  if(line.length>65536)throw new Error('命令参数过大');const task=JSON.parse(line);if(!isAbsolute(task.command)||!isAbsolute(task.cwd)||!Array.isArray(task.args)||task.args.some((x:unknown)=>typeof x!=='string'))throw new Error('命令参数无效');
  const child=spawn(task.command,task.args,{cwd:task.cwd,detached:!task.lease,stdio:['ignore','inherit','inherit']});started=true;let timer:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{signalWorkload(child.pid,!!task.lease,'SIGTERM');timer??=setTimeout(()=>signalWorkload(child.pid,!!task.lease,'SIGKILL'),3000);};lines.once('close',stop);process.once('SIGTERM',stop);process.once('SIGINT',stop);
  child.once('error',reject);child.once('close',code=>{signalWorkload(child.pid,!!task.lease,'SIGKILL');if(timer)clearTimeout(timer);lines.removeListener('close',stop);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);lines.close();process.stdin.destroy();process.exitCode=code??1;resolve();});
  try{if(child.pid)ResourceLease.trackWorker(task.lease,child.pid);}catch(error){stop();reject(error);}
 }catch(error){lines.close();process.stdin.destroy();reject(error);}});lines.once('close',()=>{if(!started)reject(new Error('命令输入缺失'));});});
}
